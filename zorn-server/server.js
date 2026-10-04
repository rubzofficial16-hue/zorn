// ============================================================
// ===== ZORN GAME SERVER + КОМНАТЫ + ДНЕВНОЙ ЛИМИТ =====
// ============================================================

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const os = require('os');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const players = {};
const rooms = {};

const LIMIT_FILE = path.join(__dirname, 'limit.json');
const LIMIT_SECONDS = 120 * 60; // 2 часа
const WARNING_SECONDS = 5 * 60; // 5 минут

let limitData = { date: new Date().toISOString().slice(0,10), usedSeconds: 0 };

function todayStr(){ return new Date().toISOString().slice(0,10); }

function loadLimit(){
  try{
    if(fs.existsSync(LIMIT_FILE)) {
      limitData = JSON.parse(fs.readFileSync(LIMIT_FILE, 'utf8'));
    } else { 
      limitData = { date: todayStr(), usedSeconds: 0 }; 
      saveLimit(); 
    }
    if(limitData.date !== todayStr()){
      limitData.date = todayStr();
      limitData.usedSeconds = 0;
      saveLimit();
    }
  }catch(e){ 
    console.error("Ошибка чтения limit.json, сброс...", e);
    limitData = { date: todayStr(), usedSeconds: 0 }; 
  }
}
function saveLimit(){
  try{ fs.writeFileSync(LIMIT_FILE, JSON.stringify(limitData, null, 2), 'utf8'); }catch(e){}
}
function isLimitReached(){ return limitData.usedSeconds >= LIMIT_SECONDS; }
function remainingSeconds(){ return Math.max(0, LIMIT_SECONDS - limitData.usedSeconds); }
loadLimit();

setInterval(() => {
  if(limitData.date !== todayStr()){
    limitData.date = todayStr();
    limitData.usedSeconds = 0;
    saveLimit();
    io.emit('limitReset');
    return;
  }
  const inGame = Object.keys(rooms).length > 0;
  if(!inGame) return;
  limitData.usedSeconds += 1;
  saveLimit();
  const left = remainingSeconds();
  if(left === WARNING_SECONDS) io.emit('limitWarning', { secondsLeft: left });
  if(left === 0){
    io.emit('serverLimitReached', { message: "Дневной лимит сервера исчерпан. Возвращайтесь завтра!" });
    for(const id in rooms){ io.to(id).emit('roomClosed'); }
    for(const id in rooms){ delete rooms[id]; }
    io.emit('roomsUpdate', []);
  }
}, 1000);

function getLocalIP(){
  const ifaces = os.networkInterfaces();
  for(const name in ifaces){
    for(const iface of ifaces[name]){
      if(iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return 'localhost';
}
function roomsList(){
  return Object.values(rooms).map(r => ({
    id: r.id, name: r.name, type: r.type, hostName: r.hostName, players: r.players.length
  }));
}

io.on('connection', socket => {
  socket.emit('limitStatus', {
    usedSeconds: limitData.usedSeconds,
    limitSeconds: LIMIT_SECONDS,
    remainingSeconds: remainingSeconds(),
    reached: isLimitReached()
  });

  if(isLimitReached()){
    socket.emit('serverLimitReached', { message: "Дневной лимит сервера исчерпан. Возвращайтесь завтра!" });
    return;
  }

  socket.on('createRoom', data => {
    if(isLimitReached()){ socket.emit('serverLimitReached', { message: "Дневной лимит исчерпан." }); return; }
    const id = 'r_' + Date.now() + '_' + Math.floor(Math.random()*1000);
    rooms[id] = {
      id, name: data.name || 'Server', type: data.type || 'public',
      hostName: data.hostName || 'host', hostSocket: socket.id, players: [socket.id]
    };
    socket.join(id);
    socket.emit('roomCreated', { id });
    io.emit('roomsUpdate', roomsList());
  });

  socket.on('getRooms', () => socket.emit('roomsUpdate', roomsList()));

  socket.on('joinRoom', data => {
    if(isLimitReached()){ socket.emit('serverLimitReached', { message: "Дневной лимит исчерпан." }); return; }
    const room = rooms[data.id];
    if(!room){ socket.emit('joinRoomError', 'Комната не найдена'); return; }
    if(room.players.includes(socket.id)) return;
    room.players.push(socket.id);
    socket.join(room.id);
    socket.to(room.id).emit('playerJoined', { socketId: socket.id, name: data.name });
    socket.emit('roomJoined', { id: room.id, hostSocket: room.hostSocket });
    io.emit('roomsUpdate', roomsList());
  });

  socket.on('leaveRoom', () => {
    for(const id in rooms){
      const room = rooms[id];
      if(room.players.includes(socket.id)){
        room.players = room.players.filter(p => p !== socket.id);
        socket.leave(id);
        io.to(id).emit('playerLeft', { socketId: socket.id });
        if(room.hostSocket === socket.id){
          io.to(id).emit('roomClosed');
          delete rooms[id];
        } else if(room.players.length === 0){
          delete rooms[id];
        }
        io.emit('roomsUpdate', roomsList());
        break;
      }
    }
  });

  socket.on('playerMove', data => {
    for(const id in rooms){
      if(rooms[id].players.includes(socket.id)){
        socket.to(id).emit('playerMoved', { id: socket.id, x: data.x, y: data.y, rotation: data.rotation, name: data.name });
        break;
      }
    }
  });

  socket.on('chatMessage', data => {
    for(const id in rooms){
      if(rooms[id].players.includes(socket.id)){
        socket.to(id).emit('chatMessage', { name: data.name || 'guest', text: data.text });
        break;
      }
    }
  });

  socket.on('disconnect', () => {
    for(const id in rooms){
      const room = rooms[id];
      if(room.players.includes(socket.id)){
        room.players = room.players.filter(p => p !== socket.id);
        io.to(id).emit('playerLeft', { socketId: socket.id });
        if(room.hostSocket === socket.id){
          io.to(id).emit('roomClosed');
          delete rooms[id];
        } else if(room.players.length === 0){
          delete rooms[id];
        }
      }
    }
    io.emit('roomsUpdate', roomsList());
  });
});

app.get('/', (req, res) => {
  const r = Object.keys(rooms).length;
  const used = Math.floor(limitData.usedSeconds / 60);
  const left = Math.floor(remainingSeconds() / 60);
  res.send('<h1>🎮 Zorn Server</h1><p>Rooms: <b>' + r + '</b></p><p>Used today: <b>' + used + ' / 120</b> min</p><p>Left today: <b>' + left + '</b> min</p>');
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  const ip = getLocalIP();
  console.log('===========================================');
  console.log('  🎮 ZORN SERVER IS RUNNING');
  console.log('  Local:   http://localhost:' + PORT);
  console.log('  Network: http://' + ip + ':' + PORT);
  console.log('  Used today: ' + Math.floor(limitData.usedSeconds/60) + ' / 120 min');
  console.log('===========================================');
});
