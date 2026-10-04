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

// ===== ЛИМИТ =====
const LIMIT_FILE = path.join(__dirname, 'limit.json');
const LIMIT_SECONDS = 120 * 60;      // 120 минут в день
const WARNING_SECONDS = 5 * 60;      // за 5 минут до конца

let limitData = {
  date: new Date().toISOString().slice(0, 10), // YYYY-MM-DD
  usedSeconds: 0
};

function todayStr(){
  return new Date().toISOString().slice(0, 10);
}

function loadLimit(){
  try{
    if(fs.existsSync(LIMIT_FILE)){
      limitData = JSON.parse(fs.readFileSync(LIMIT_FILE, 'utf8'));
    } else {
      limitData = { date: todayStr(), usedSeconds: 0 };
      saveLimit();
    }
    // Новый день → сброс
    if(limitData.date !== todayStr()){
      limitData.date = todayStr();
      limitData.usedSeconds = 0;
      saveLimit();
      console.log('🌅 Новый день — лимит сброшен');
    }
    console.log('📊 Лимит: ' + Math.floor(limitData.usedSeconds/60) + ' / ' + (LIMIT_SECONDS/60) + ' мин');
  }catch(e){
    console.log('❌ Ошибка загрузки limit.json:', e);
    limitData = { date: todayStr(), usedSeconds: 0 };
  }
}

function saveLimit(){
  try{
    fs.writeFileSync(LIMIT_FILE, JSON.stringify(limitData, null, 2), 'utf8');
  }catch(e){ console.log('❌ Ошибка сохранения limit.json:', e); }
}

function isLimitReached(){
  return limitData.usedSeconds >= LIMIT_SECONDS;
}

function remainingSeconds(){
  return Math.max(0, LIMIT_SECONDS - limitData.usedSeconds);
}

loadLimit();

// ===== Тик каждую секунду =====
setInterval(() => {
  // Новый день?
  if(limitData.date !== todayStr()){
    limitData.date = todayStr();
    limitData.usedSeconds = 0;
    saveLimit();
    console.log('🌅 Новый день');
    io.emit('limitReset');
    return;
  }

  // Если есть хоть кто-то в комнатах — считаем
  const inGame = Object.keys(rooms).length > 0;
  if(!inGame) return;

  limitData.usedSeconds += 1;
  saveLimit();

  const left = remainingSeconds();

  // Предупреждение за 5 минут
  if(left === WARNING_SECONDS){
    io.emit('limitWarning', { secondsLeft: left });
    console.log('⚠️ 5 минут до лимита');
  }

  // Лимит достигнут
  if(left === 0){
    io.emit('serverLimitReached', {
      message: "The server's daily limit has been reached. Join us tomorrow!"
    });
    // Кикаем всех из комнат
    for(const id in rooms){
      io.to(id).emit('roomClosed');
    }
    for(const id in rooms){ delete rooms[id]; }
    io.emit('roomsUpdate', []);
    console.log('🛑 Дневной лимит исчерпан');
  }
}, 1000);

// ===== IP =====
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
    id: r.id, name: r.name, type: r.type,
    hostName: r.hostName, players: r.players.length
  }));
}

// ===== СОКЕТЫ =====
io.on('connection', socket => {
  console.log('🎮 Connected:', socket.id);

  // Сообщаем новому — сколько осталось
  socket.emit('limitStatus', {
    usedSeconds: limitData.usedSeconds,
    limitSeconds: LIMIT_SECONDS,
    remainingSeconds: remainingSeconds(),
    reached: isLimitReached()
  });

  // Если лимит уже исчерпан — не пускаем
  if(isLimitReached()){
    socket.emit('serverLimitReached', {
      message: "The server's daily limit has been reached. Join us tomorrow!"
    });
    return;
  }

  // ==== КОМНАТЫ ====
  socket.on('createRoom', data => {
    if(isLimitReached()){ socket.emit('serverLimitReached', { message: "Daily limit reached." }); return; }
    const id = 'r_' + Date.now() + '_' + Math.floor(Math.random()*1000);
    rooms[id] = {
      id: id,
      name: data.name || 'Server',
      type: data.type || 'public',
      hostName: data.hostName || 'host',
      hostSocket: socket.id,
      players: [socket.id]
    };
    socket.join(id);
    socket.emit('roomCreated', { id: id });
    io.emit('roomsUpdate', roomsList());
    console.log('🏠 Комната создана: ' + id);
  });

  socket.on('getRooms', () => {
    socket.emit('roomsUpdate', roomsList());
  });

  socket.on('joinRoom', data => {
    if(isLimitReached()){ socket.emit('serverLimitReached', { message: "Daily limit reached." }); return; }
    const room = rooms[data.id];
    if(!room){ socket.emit('joinRoomError', 'Комната не найдена'); return; }
    if(room.players.includes(socket.id)) return;
    room.players.push(socket.id);
    socket.join(room.id);

    socket.to(room.id).emit('playerJoined', { socketId: socket.id, name: data.name });
    socket.emit('roomJoined', { id: room.id, hostSocket: room.hostSocket });
    io.emit('roomsUpdate', roomsList());
    console.log('👤 ' + data.name + ' вошёл в ' + room.id);
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

  // ==== ИГРА ====
  socket.on('playerMove', data => {
    for(const id in rooms){
      const room = rooms[id];
      if(room.players.includes(socket.id)){
        socket.to(id).emit('playerMoved', { id: socket.id, x: data.x, y: data.y, rotation: data.rotation, name: data.name });
        break;
      }
    }
  });

  socket.on('chatMessage', data => {
    for(const id in rooms){
      const room = rooms[id];
      if(room.players.includes(socket.id)){
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

const PORT = 3000;
server.listen(PORT, '0.0.0.0', () => {
  const ip = getLocalIP();
  console.log('===========================================');
  console.log('  🎮 ZORN SERVER IS RUNNING');
  console.log('  Local:   http://localhost:' + PORT);
  console.log('  Network: http://' + ip + ':' + PORT);
  console.log('  Used today: ' + Math.floor(limitData.usedSeconds/60) + ' / 120 min');
  console.log('===========================================');
});
