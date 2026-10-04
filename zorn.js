// ============================================================
// ===== ZORN — Multiplayer + Single + лимит =====
// ============================================================

// ============================================================
// ===== АВТОМАТИЧЕСКОЕ ОПРЕДЕЛЕНИЕ URL СЕРВЕРА =====
// ============================================================
let SERVER_URL = 'http://localhost:3000';

if (window.location.hostname.includes('neocities.org')) {
    // ⚠️⚠️⚠️ ЗАМЕНИ НА СВОЮ ССЫЛКУ ИЗ CODESPACES! ⚠️⚠️⚠️
    SERVER_URL = 'https://ТВОЙ-КОД-3000.app.github.dev';
} else if (window.location.hostname.includes('github.dev')) {
    SERVER_URL = window.location.origin;
} else if (window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
    SERVER_URL = window.location.protocol + '//' + window.location.hostname + ':3000';
}

console.log('🔗 Подключение к серверу:', SERVER_URL);
// ============================================================

let socket = null;
let socketReady = false;
let currentUser = null;
let inGame = false;
let multiplayerMode = false;
let currentRoomId = null;
let currentRoomIsHost = false;
let otherPlayers = {};
let selfMessage = { text: '', timeout: null, el: null };

function loadAccounts(){try{return JSON.parse(localStorage.getItem('zorn_accounts')||'{}')}catch(e){return{}}}
function saveAccounts(a){localStorage.setItem('zorn_accounts',JSON.stringify(a))}

// ===== ОКНО DISCONNECTION / WARNING =====
function showLimitWindow(title, text, showOK){
  const old = document.getElementById('limitOverlay');
  if(old) old.remove();

  const overlay = document.createElement('div');
  overlay.id = 'limitOverlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.9);z-index:100000;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#fff;font-family:"Courier New",monospace;padding:40px;text-align:center;';

  let html = '<h1 style="font-size:56px;margin:0 0 24px;letter-spacing:6px;">' + title + '</h1>';
  html += '<div style="width:460px;max-width:90%;border-top:2px solid #fff;margin-bottom:30px;"></div>';
  html += '<p style="font-size:20px;max-width:560px;margin:0 0 30px;line-height:1.5;">' + text + '</p>';
  if(showOK){
    html += '<button onclick="location.reload()" style="font-family:inherit;font-size:18px;padding:12px 36px;background:#fff;color:#000;border:none;border-radius:8px;cursor:pointer;">OK</button>';
  }
  overlay.innerHTML = html;

  document.body.appendChild(overlay);
}

function showLimitWarning(secondsLeft){
  const old = document.getElementById('limitWarning');
  if(old) old.remove();

  const w = document.createElement('div');
  w.id = 'limitWarning';
  w.style.cssText = 'position:fixed;top:20px;left:50%;transform:translateX(-50%);background:#c43b3b;color:#fff;padding:14px 28px;border-radius:10px;font-family:"Courier New",monospace;font-size:16px;font-weight:bold;z-index:99999;box-shadow:0 4px 12px rgba(0,0,0,.4);';
  w.textContent = '⚠️ Осталось ' + Math.ceil(secondsLeft / 60) + ' мин до дневного лимита';
  document.body.appendChild(w);

  setTimeout(() => { if(w) w.remove(); }, 10000);
}

// ===== СОКЕТ =====
function connectToServer(){
  if(typeof io === 'undefined'){ console.log('⚠️ Socket.IO не загружен'); return; }
  try{
    socket = io(SERVER_URL, { transports:['websocket','polling'] });

    socket.on('connect', () => {
      socketReady = true;
      console.log('✅ Сервер подключён:', SERVER_URL);
    });
    socket.on('connect_error', (err) => { 
      socketReady = false; 
      console.log('❌ Ошибка подключения:', err.message);
    });
    socket.on('disconnect', () => { socketReady = false; });

    // ==== ЛИМИТ ====
    socket.on('limitStatus', data => {
      // Сразу знаем, сколько осталось
    });

    socket.on('limitWarning', data => {
      showLimitWarning(data.secondsLeft);
    });

    socket.on('serverLimitReached', data => {
      showLimitWindow('Disconnection', data.message || "The server's daily limit has been reached. Join us tomorrow!", true);
      if(socket) socket.disconnect();
    });

    socket.on('limitReset', () => {
      const old = document.getElementById('limitOverlay');
      if(old) old.remove();
    });

    // ==== КОМНАТЫ ====
    socket.on('roomsUpdate', list => renderServerList(list));
    socket.on('roomCreated', data => {
      currentRoomId = data.id;
      currentRoomIsHost = true;
      enterGame();
    });
    socket.on('roomJoined', data => {
      currentRoomId = data.id;
      currentRoomIsHost = false;
      enterGame();
    });
    socket.on('joinRoomError', err => alert('Ошибка: ' + err));
    socket.on('roomClosed', () => { alert('Сервер закрыт'); exitToMainMenu(); });

    socket.on('playerJoined', data => addSystemMessage('👤 ' + data.name + ' подключился'));
    socket.on('playerLeft', data => {
      if(otherPlayers[data.socketId]){
        if(otherPlayers[data.socketId].el) otherPlayers[data.socketId].el.remove();
        delete otherPlayers[data.socketId];
        renderPlayersList();
      }
    });
    socket.on('playerMoved', data => {
      if(!inGame) return;
      if(data.id === socket.id) return;
      if(!otherPlayers[data.id]){
        otherPlayers[data.id] = {
          name: data.name, x: data.x, y: data.y, rotation: data.rotation,
          targetX: data.x, targetY: data.y, targetRotation: data.rotation, el: null
        };
        createOtherPlayerEl(data.id);
        renderPlayersList();
      }
      otherPlayers[data.id].targetX = data.x;
      otherPlayers[data.id].targetY = data.y;
      otherPlayers[data.id].targetRotation = data.rotation;
    });
    socket.on('chatMessage', data => {
      const cb = document.getElementById('chatBody');
      if(cb){
        const d = document.createElement('div');
        d.innerHTML = '<b>' + data.name + ':</b> ' + data.text;
        cb.appendChild(d);
        cb.scrollTop = cb.scrollHeight;
      }
      if(!chatWindow.classList.contains('show')) showUnreadDot();
      if(currentUser && data.name === currentUser.username){
        showSelfMessage(data.text);
      } else {
        Object.keys(otherPlayers).forEach(pid => {
          if(otherPlayers[pid].name === data.name){
            showMessageOverPlayer(pid, data.text);
          }
        });
      }
    });
  }catch(e){ console.log('Ошибка:', e); }
}

const loginScreen=document.getElementById('loginScreen');
const mainMenu=document.getElementById('mainMenu');
const menuUser=document.getElementById('menuUser');
const menuAvatar=document.getElementById('menuAvatar');
const userBadge=document.getElementById('userBadge');
const accountMenu=document.getElementById('accountMenu');
const profileScreen=document.getElementById('profileScreen');
const loginUsername=document.getElementById('loginUsername');
const loginPassword=document.getElementById('loginPassword');
const rememberMe=document.getElementById('rememberMe');
const loginBtn=document.getElementById('loginBtn');
const loginError=document.getElementById('loginError');
const forgotLink=document.getElementById('forgotLink');
const regName=document.getElementById('regName');
const regUsername=document.getElementById('regUsername');
const regPassword=document.getElementById('regPassword');
const registerBtn=document.getElementById('registerBtn');
const registerError=document.getElementById('registerError');
const forgotModal=document.getElementById('forgotModal');
const forgotUsername=document.getElementById('forgotUsername');
const forgotCancel=document.getElementById('forgotCancel');
const forgotSend=document.getElementById('forgotSend');
const recoveryResult=document.getElementById('recoveryResult');
const profileAvatar=document.getElementById('profileAvatar');
const profileName=document.getElementById('profileName');
const profileUsername=document.getElementById('profileUsername');
const profileBio=document.getElementById('profileBio');
const avatarFileInput=document.getElementById('avatarFileInput');
const playersList=document.getElementById('playersList');
const mpList=document.getElementById('mpList');
const mpSearch=document.getElementById('mpSearch');
const createModal=document.getElementById('createModal');
const editModal=document.getElementById('editModal');
const chatWindow=document.getElementById('chatWindow');
const chatBody=document.getElementById('chatBody');
const chatInput=document.getElementById('chatInput');

const DEFAULT_AVATAR='data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" fill="%233b82c4"/><circle cx="20" cy="15" r="7" fill="%23ffffff"/><ellipse cx="20" cy="34" rx="13" ry="9" fill="%23ffffff"/></svg>';
function getAvatarFor(u){const a=loadAccounts();if(a[u]&&a[u].avatar)return a[u].avatar;return DEFAULT_AVATAR}

const sndMenu=document.getElementById('sndMenu');sndMenu.volume=.35;
function startMenuMusic(){try{sndMenu.volume=.35;sndMenu.play().catch(()=>{})}catch(e){}}
function stopMenuMusic(){try{sndMenu.pause();sndMenu.currentTime=0}catch(e){}}

const TRANSLATIONS = {
  en:{flag:'🇺🇸',name:'USA',welcome:'Welcome to Zorn!',login:'Log in',register:'Register',username:'Username',password:'Password',name:'Name',remember:'Remember Me',forgot:'Forgot your password?',play:'Play',friends:'Friends',catalog:'Catalog',workshop:'Workshop',hint:'More to come soon',profile:'Profile',logout:'Log out',bio:'Bio',back:'Back',save:'Save',recovery:'Password recovery',enterUsername:'Enter your username',cancel:'Cancel',find:'Find',pause:'PAUSE',players:'PLAYERS',backToMenu:'Back to menu',continue:'Continue',chat:'Chat',send:'Send',chooseLang:'Choose language',placeholderMsg:'Message...',single:'Single Player',multi:'Multiplayer',myServers:'SERVERS',joinBtn:'Join',chooseMode:'Choose mode',noServers:'No servers. Click + to create.',serverOffline:'Server offline'},
  ru:{flag:'🇷🇺',name:'Русский',welcome:'Добро пожаловать в Zorn!',login:'Вход',register:'Регистрация',username:'Имя пользователя',password:'Пароль',name:'Имя',remember:'Запомнить меня',forgot:'Забыли пароль?',play:'Играть',friends:'Друзья',catalog:'Каталог',workshop:'Мастерская',hint:'Скоро больше',profile:'Профиль',logout:'Выйти',bio:'О себе',back:'Назад',save:'Сохранить',recovery:'Восстановление пароля',enterUsername:'Введите ваш Username',cancel:'Отмена',find:'Найти',pause:'ПАУЗА',players:'ИГРОКИ',backToMenu:'В меню',continue:'Продолжить',chat:'Чат',send:'Отправить',chooseLang:'Выбор языка',placeholderMsg:'Сообщение...',single:'Одиночная игра',multi:'Мультиплеер',myServers:'СЕРВЕРА',joinBtn:'Войти',chooseMode:'Выбор режима',noServers:'Серверов нет. Нажми + чтобы создать.',serverOffline:'Сервер выключен'}
};
let currentLang = localStorage.getItem('zorn_lang') || 'en';
function t(key){
  if(TRANSLATIONS[currentLang] && TRANSLATIONS[currentLang][key]) return TRANSLATIONS[currentLang][key];
  return TRANSLATIONS.en[key] || key;
}
function applyLang(){
  document.querySelectorAll('[data-t]').forEach(el => { el.textContent = t(el.dataset.t); });
  if(loginUsername) loginUsername.placeholder = t('username');
  if(loginPassword) loginPassword.placeholder = t('password');
  if(chatInput) chatInput.placeholder = t('placeholderMsg');
  document.title = 'Zorn';
}
function renderLangList(){
  const list = document.getElementById('langList');
  if(!list) return;
  list.innerHTML = '';
  const langs = Object.keys(TRANSLATIONS).map(c => ({code:c, flag:TRANSLATIONS[c].flag, name:TRANSLATIONS[c].name}));
  langs.sort((a,b) => a.name.localeCompare(b.name));
  langs.forEach(l => {
    const row = document.createElement('div');
    row.className = 'lang-row' + (l.code === currentLang ? ' active' : '');
    row.innerHTML = '<span class="flag">' + l.flag + '</span><span>' + l.name + '</span>';
    row.addEventListener('click', () => {
      currentLang = l.code;
      localStorage.setItem('zorn_lang', currentLang);
      applyLang(); renderLangList();
      document.getElementById('langMenu').classList.remove('show');
    });
    list.appendChild(row);
  });
}

function checkLoginValid(){
  const u = loginUsername.value.trim().length >= 3;
  const p = loginPassword.value.length >= 8;
  loginBtn.disabled = !(u && p);
}
function checkRegisterValid(){
  const n = regName.value.trim().length >= 3;
  const u = regUsername.value.trim().length >= 3;
  const p = regPassword.value.length >= 8;
  registerBtn.disabled = !(n && u && p);
}
loginUsername.addEventListener('input',()=>{checkLoginValid();loginError.textContent=''});
loginPassword.addEventListener('input',()=>{checkLoginValid();loginError.textContent=''});
regName.addEventListener('input',()=>{checkRegisterValid();registerError.textContent=''});
regUsername.addEventListener('input',()=>{checkRegisterValid();registerError.textContent=''});
regPassword.addEventListener('input',()=>{checkRegisterValid();registerError.textContent=''});
setInterval(()=>{checkLoginValid();checkRegisterValid()},300);

registerBtn.addEventListener('click',()=>{
  const n=regName.value.trim(), u=regUsername.value.trim(), p=regPassword.value;
  const acc = loadAccounts();
  if(acc[u]){
    registerError.style.color = '#d32f2f';
    registerError.textContent = 'This account already exists';
    return;
  }
  acc[u] = { name: n || u, password: p, bio: '', avatar: '' };
  saveAccounts(acc);
  registerError.style.color = '#2a9d3f';
  registerError.textContent = 'Account created! You can log in now.';
  setTimeout(()=>{ registerError.textContent=''; registerError.style.color='#d32f2f'; }, 2500);
  regName.value=''; regUsername.value=''; regPassword.value=''; checkRegisterValid();
});

loginBtn.addEventListener('click',()=>{
  const u=loginUsername.value.trim(), p=loginPassword.value;
  const acc = loadAccounts();
  if(!acc[u]){ loginError.textContent = 'Account does not exist'; return; }
  if(acc[u].password !== p){ loginError.textContent = 'Incorrect username or password'; return; }
  loginError.textContent = '';
  if(rememberMe.checked) localStorage.setItem('zorn_remember', JSON.stringify({ username: u, password: p }));
  else localStorage.removeItem('zorn_remember');
  localStorage.setItem('zorn_current', JSON.stringify({ username: u, password: p }));
  currentUser = { username: u, name: acc[u].name || u, bio: acc[u].bio || '', avatar: acc[u].avatar || '' };
  goToMainMenu();
});

(function(){
  const s = localStorage.getItem('zorn_remember');
  if(s){ try{ const d = JSON.parse(s); loginUsername.value = d.username || ''; loginPassword.value = d.password || ''; rememberMe.checked = true; }catch(e){} }
})();

forgotLink.addEventListener('click',()=>{forgotModal.classList.add('show');forgotUsername.value='';recoveryResult.classList.remove('show');recoveryResult.textContent=''});
forgotCancel.addEventListener('click',()=>forgotModal.classList.remove('show'));
forgotSend.addEventListener('click',()=>{
  const u = forgotUsername.value.trim();
  if(!u){ recoveryResult.textContent = 'Enter username'; recoveryResult.classList.add('show'); return; }
  const acc = loadAccounts();
  if(!acc[u]){ recoveryResult.textContent = 'Account not found.'; recoveryResult.classList.add('show'); return; }
  recoveryResult.textContent = 'Found:\n\nName: ' + (acc[u].name||u) + '\nUsername: ' + u + '\nPassword: ' + acc[u].password;
  recoveryResult.classList.add('show');
});

function renderPlayersList(){
  if(!playersList) return;
  playersList.innerHTML = '';
  if(currentUser){
    const row = document.createElement('div');
    row.className = 'player-row me';
    const av = document.createElement('div');
    av.className = 'mini-avatar';
    av.style.backgroundImage = 'url("' + getAvatarFor(currentUser.username) + '")';
    const s = document.createElement('span');
    s.textContent = currentUser.username;
    row.appendChild(av); row.appendChild(s);
    playersList.appendChild(row);
  }
  Object.keys(otherPlayers).forEach(id => {
    const p = otherPlayers[id];
    const row = document.createElement('div');
    row.className = 'player-row';
    const av = document.createElement('div');
    av.className = 'mini-avatar';
    av.style.backgroundImage = 'url("' + DEFAULT_AVATAR + '")';
    const s = document.createElement('span');
    s.textContent = p.name || 'Player';
    row.appendChild(av); row.appendChild(s);
    playersList.appendChild(row);
  });
}
function goToMainMenu(){
  loginScreen.classList.add('hidden'); profileScreen.classList.remove('show');
  mainMenu.classList.add('show'); accountMenu.classList.remove('show');
  menuUser.textContent = currentUser ? currentUser.username : 'guest';
  menuAvatar.style.backgroundImage = 'url("' + getAvatarFor(currentUser ? currentUser.username : '') + '")';
  renderPlayersList(); startMenuMusic();
}
function goToLogin(){
  mainMenu.classList.remove('show'); profileScreen.classList.remove('show'); accountMenu.classList.remove('show');
  loginScreen.classList.remove('hidden'); stopMenuMusic();
}
function exitToMainMenu(){
  inGame = false; multiplayerMode = false; currentRoomId = null; currentRoomIsHost = false;
  clearOtherPlayers();
  clearSelfMessage();
  document.getElementById('game').style.display='none';
  document.getElementById('ground').style.display='none';
  document.getElementById('hud').style.display='none';
  goToMainMenu();
}

userBadge.addEventListener('click', function(e){ e.stopPropagation(); e.preventDefault(); accountMenu.classList.toggle('show'); });
document.addEventListener('click', function(e){
  if(accountMenu.classList.contains('show')){
    if(!accountMenu.contains(e.target) && !userBadge.contains(e.target)) accountMenu.classList.remove('show');
  }
});
document.getElementById('btnProfile').addEventListener('click', function(e){ e.stopPropagation(); accountMenu.classList.remove('show'); openProfile(); });
document.getElementById('btnLogoutMenu').addEventListener('click', function(e){
  e.stopPropagation();
  localStorage.removeItem('zorn_current');
  currentUser = null;
  accountMenu.classList.remove('show');
  goToLogin();
});
function openProfile(){
  profileName.value = currentUser ? currentUser.name : '';
  profileUsername.textContent = '@' + (currentUser ? currentUser.username : 'user');
  profileBio.value = currentUser ? (currentUser.bio || '') : '';
  profileAvatar.style.backgroundImage = 'url("' + getAvatarFor(currentUser ? currentUser.username : '') + '")';
  profileScreen.classList.add('show');
}
document.getElementById('btnProfileBack').addEventListener('click', function(){ profileScreen.classList.remove('show'); });
document.getElementById('btnProfileSave').addEventListener('click', function(){
  if(!currentUser) return;
  currentUser.name = profileName.value.trim() || currentUser.username;
  currentUser.bio = profileBio.value;
  const acc = loadAccounts();
  if(acc[currentUser.username]){
    acc[currentUser.username].name = currentUser.name;
    acc[currentUser.username].bio = currentUser.bio;
    saveAccounts(acc);
  }
  profileScreen.classList.remove('show');
  goToMainMenu();
});
profileAvatar.addEventListener('click', function(){ avatarFileInput.click(); });
avatarFileInput.addEventListener('change', function(e){
  const f = e.target.files[0];
  if(!f) return;
  const r = new FileReader();
  r.onload = function(ev){
    const url = ev.target.result;
    if(!currentUser) return;
    currentUser.avatar = url;
    profileAvatar.style.backgroundImage = 'url("' + url + '")';
    menuAvatar.style.backgroundImage = 'url("' + url + '")';
    const acc = loadAccounts();
    if(acc[currentUser.username]){
      acc[currentUser.username].avatar = url;
      saveAccounts(acc);
    }
    renderPlayersList();
  };
  r.readAsDataURL(f);
});

document.getElementById('btnPlay').addEventListener('click', function(){
  mainMenu.classList.remove('show'); stopMenuMusic();
  document.getElementById('mpScreen').classList.add('show');
  renderModeChoice();
});

function renderModeChoice(){
  mpList.innerHTML = '';
  const title = document.createElement('div');
  title.style.cssText = 'color:#fff;font-size:26px;font-weight:bold;letter-spacing:4px;margin-bottom:30px;text-align:center;text-shadow:2px 2px 0 #3b82c4;';
  title.textContent = t('chooseMode');
  mpList.appendChild(title);
  const box = document.createElement('div');
  box.style.cssText = 'display:flex;gap:20px;';

  const btnSingle = document.createElement('button');
  btnSingle.textContent = '🎮 ' + t('single');
  btnSingle.style.cssText = 'flex:1;font-family:inherit;font-size:22px;font-weight:bold;padding:40px 20px;background:#2a9d3f;color:#fff;border:3px solid #fff;border-radius:16px;cursor:pointer;box-shadow:0 6px 0 #1e7530;';
  btnSingle.addEventListener('click', startSinglePlayer);

  const btnMulti = document.createElement('button');
  btnMulti.textContent = '🌐 ' + t('multi');
  btnMulti.style.cssText = 'flex:1;font-family:inherit;font-size:22px;font-weight:bold;padding:40px 20px;background:#3b82c4;color:#fff;border:3px solid #fff;border-radius:16px;cursor:pointer;box-shadow:0 6px 0 #2a5c8e;';
  btnMulti.addEventListener('click', function(){
    if(!socketReady){ alert('🔴 Сервер выключен. Запусти node server.js'); return; }
    renderMultiplayerLobby();
    socket.emit('getRooms');
  });

  box.appendChild(btnSingle); box.appendChild(btnMulti);
  mpList.appendChild(box);
}

function renderMultiplayerLobby(){
  mpList.innerHTML = '';
  const h = document.createElement('div');
  h.className = 'mp-section-title';
  h.textContent = t('myServers');
  mpList.appendChild(h);
}

function renderServerList(list){
  if(!mpList) return;
  if(inGame) return;
  if(!document.getElementById('mpScreen').classList.contains('show')) return;

  mpList.innerHTML = '';
  const h = document.createElement('div');
  h.className = 'mp-section-title';
  h.textContent = t('myServers');
  mpList.appendChild(h);

  if(!list || list.length === 0){
    const empty = document.createElement('div');
    empty.style.cssText = 'text-align:center;color:rgba(255,255,255,.9);font-size:14px;padding:16px;background:rgba(255,255,255,.2);border-radius:12px;';
    empty.textContent = t('noServers');
    mpList.appendChild(empty);
    return;
  }

  list.forEach(s=>{
    const row = document.createElement('div');
    row.className = 'mp-item';
    if(s.hostName === (currentUser ? currentUser.username : '')) row.classList.add('my-server');
    const icon = document.createElement('div'); icon.className = 'mp-item-icon';
    icon.textContent = s.type === 'private' ? '🔒' : '🌐';
    const info = document.createElement('div'); info.className = 'mp-item-info';
    const nm = document.createElement('div'); nm.className = 'mp-item-name'; nm.textContent = s.name;
    const meta = document.createElement('div'); meta.className = 'mp-item-meta';
    meta.textContent = 'Host: ' + s.hostName;
    info.appendChild(nm); info.appendChild(meta);
    const pl = document.createElement('div'); pl.className = 'mp-item-players';
    pl.textContent = '👥 ' + s.players;
    const acts = document.createElement('div'); acts.className = 'mp-item-actions';
    const j = document.createElement('button'); j.className='mp-btn join'; j.textContent=t('joinBtn');
    j.addEventListener('click', ()=>{
      if(s.hostName === (currentUser ? currentUser.username : '')){
        currentRoomId = s.id;
        currentRoomIsHost = true;
        enterGame();
      } else {
        socket.emit('joinRoom', { id: s.id, name: currentUser ? currentUser.username : 'guest' });
      }
    });
    acts.appendChild(j);
    row.appendChild(icon); row.appendChild(info); row.appendChild(pl); row.appendChild(acts);
    mpList.appendChild(row);
  });
}

document.getElementById('mpBack').addEventListener('click', function(){
  if(inGame){ exitToMainMenu(); return; }
  document.getElementById('mpScreen').classList.remove('show');
  mainMenu.classList.add('show'); startMenuMusic();
});

document.getElementById('mpCreateBtn').addEventListener('click', function(){
  if(!socketReady){ alert('🔴 Сервер выключен'); return; }
  createName.value='';
  document.querySelector('input[name="serverType"][value="public"]').checked=true;
  lblPublic.classList.add('checked'); lblPrivate.classList.remove('checked');
  createModal.classList.add('show');
});
document.querySelectorAll('input[name="serverType"]').forEach(r=>{
  r.addEventListener('change',()=>{
    if(r.value==='public'){lblPublic.classList.add('checked');lblPrivate.classList.remove('checked');}
    else{lblPrivate.classList.add('checked');lblPublic.classList.remove('checked');}
  });
});
document.getElementById('createCancel').addEventListener('click',()=>createModal.classList.remove('show'));
document.getElementById('createConfirm').addEventListener('click', function(){
  const name = createName.value.trim() || 'My Server';
  const ti = document.querySelector('input[name="serverType"]:checked');
  const type = ti ? ti.value : 'public';
  socket.emit('createRoom', { name: name, type: type, hostName: currentUser ? currentUser.username : 'host' });
  createModal.classList.remove('show');
});

function startSinglePlayer(){
  stopMenuMusic();
  multiplayerMode = false;
  currentRoomId = null;
  clearOtherPlayers();
  document.getElementById('mpScreen').classList.remove('show');
  document.getElementById('loadingScreen').classList.add('show');
  setTimeout(function(){
    document.getElementById('loadingScreen').classList.remove('show');
    document.getElementById('game').style.display='block';
    document.getElementById('ground').style.display='block';
    document.getElementById('hud').style.display='flex';
    inGame = true;
    startGameIfNeeded();
    addSystemMessage('🎮 Single player');
  },3000);
}

function enterGame(){
  stopMenuMusic();
  multiplayerMode = true;
  clearOtherPlayers();
  document.getElementById('mpScreen').classList.remove('show');
  document.getElementById('loadingScreen').classList.add('show');
  setTimeout(function(){
    document.getElementById('loadingScreen').classList.remove('show');
    document.getElementById('game').style.display='block';
    document.getElementById('ground').style.display='block';
    document.getElementById('hud').style.display='flex';
    inGame = true;
    startGameIfNeeded();
    addSystemMessage('🎮 Multiplayer');
    if(currentRoomIsHost) addSystemMessage('👑 You are the host');
  },3000);
}

document.getElementById('game').style.display='none';
document.getElementById('ground').style.display='none';
document.getElementById('hud').style.display='none';

const sndJump=document.getElementById('sndJump'); sndJump.volume=.5;
function playSound(el){try{el.currentTime=0;el.play().catch(()=>{})}catch(e){}}
const worldEl=document.getElementById('world'); const playerEl=document.getElementById('player');
const PW=60,PH=60; let px=0,py=60,vx=0,vy=0,onGround=true,alive=true,rotation=0;
const SPEED=5,GRAVITY=.8,JUMP=-15,MAX_FALL=20;
let camX=0,camInit=false; const LOOK_AHEAD=40;
const keys={};

document.addEventListener('keydown',e=>{
  if(document.activeElement && (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA')) return;
  if(!loginScreen.classList.contains('hidden'))return;
  if(mainMenu.classList.contains('show'))return;
  if(document.getElementById('mpScreen').classList.contains('show'))return;
  if(document.getElementById('loadingScreen').classList.contains('show'))return;
  if(document.getElementById('limitOverlay'))return;
  if(['Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','KeyW','KeyS','KeyA','KeyD'].includes(e.code))e.preventDefault();
  if(e.repeat)return; keys[e.code]=true;
  if((e.code==='KeyW'||e.code==='ArrowUp'||e.code==='Space')&&alive&&onGround){
    vy=JUMP; onGround=false; playSound(sndJump);
    if(vx>0)rotation+=90; else if(vx<0)rotation-=90;
    playerEl.style.transform='rotate('+rotation+'deg)';
  }
});
document.addEventListener('keyup',e=>{keys[e.code]=false});
let gameStarted=false;
function startGameIfNeeded(){if(gameStarted)return; gameStarted=true; requestAnimationFrame(update)}
let lastSend = 0;
function update(){
  if(!alive)return;
  if(!loginScreen.classList.contains('hidden')||mainMenu.classList.contains('show')){requestAnimationFrame(update);return}
  if(document.getElementById('mpScreen').classList.contains('show')){requestAnimationFrame(update);return}
  if(document.getElementById('loadingScreen').classList.contains('show')){requestAnimationFrame(update);return}
  if(document.getElementById('limitOverlay')){requestAnimationFrame(update);return}
  vx=0; if(keys['KeyA']||keys['ArrowLeft'])vx=-SPEED; if(keys['KeyD']||keys['ArrowRight'])vx=SPEED;
  vy+=GRAVITY; if(vy>MAX_FALL)vy=MAX_FALL;
  px+=vx;
  let nY=py-vy; onGround=false;
  if(nY<=60){nY=60; vy=0; onGround=true}
  py=nY;
  const la=vx*LOOK_AHEAD; const tX=px-window.innerWidth/2+PW/2+la;
  if(!camInit){camX=px-window.innerWidth/2+PW/2; camInit=true}else camX+=(tX-camX)*.08;
  worldEl.style.transform='translateX('+(-camX)+'px)';
  playerEl.style.left=px+'px'; playerEl.style.bottom=py+'px';

  if(selfMessage.el){
    selfMessage.el.style.left = (px + PW/2) + 'px';
    selfMessage.el.style.bottom = (py + PH + 50) + 'px';
  }

  Object.keys(otherPlayers).forEach(id => {
    const p = otherPlayers[id];
    p.x += (p.targetX - p.x) * 0.25;
    p.y += (p.targetY - p.y) * 0.25;
    let diff = p.targetRotation - p.rotation;
    while(diff > 180) diff -= 360;
    while(diff < -180) diff += 360;
    p.rotation += diff * 0.25;
    updateOtherPlayerEl(id);
  });

  if(inGame && multiplayerMode && socketReady && socket && socket.connected){
    const now = Date.now();
    if(now - lastSend > 100){
      lastSend = now;
      try{ socket.emit('playerMove',{x:px,y:py,rotation:rotation,name: currentUser ? currentUser.username : 'guest'}); }catch(e){}
    }
  }
  requestAnimationFrame(update);
}

const powerMenu=document.getElementById('powerMenu');
document.getElementById('iconPower').addEventListener('click', function(){renderPlayersList(); powerMenu.classList.add('show')});
document.getElementById('powerClose').addEventListener('click',()=>powerMenu.classList.remove('show'));
document.getElementById('powerBackToMenu').addEventListener('click', function(){
  powerMenu.classList.remove('show');
  if(multiplayerMode && currentRoomId) socket.emit('leaveRoom');
  exitToMainMenu();
});

document.getElementById('iconChat').addEventListener('click', function(){
  chatWindow.classList.toggle('show');
  if(chatWindow.classList.contains('show')) hideUnreadDot();
});
document.getElementById('chatClose').addEventListener('click', function(){ chatWindow.classList.remove('show'); });

function sendChat(){
  const txt = chatInput.value.trim();
  if(!txt) return;
  if(multiplayerMode && socketReady && socket && socket.connected){
    socket.emit('chatMessage', { name: currentUser ? currentUser.username : 'guest', text: txt });
  } else {
    const d = document.createElement('div');
    d.innerHTML = '<b>' + (currentUser ? currentUser.username : 'guest') + ':</b> ' + txt;
    chatBody.appendChild(d);
    chatBody.scrollTop = chatBody.scrollHeight;
    showSelfMessage(txt);
  }
  chatInput.value = '';
}
document.getElementById('chatSend').addEventListener('click',sendChat);
chatInput.addEventListener('keydown',e=>{if(e.key==='Enter')sendChat()});

function showSelfMessage(text){
  if(!selfMessage.el){
    selfMessage.el = document.createElement('div');
    selfMessage.el.style.cssText = 'position:absolute;transform:translateX(-50%);background:#fff;color:#000;font-size:12px;font-weight:bold;padding:4px 8px;border-radius:6px;max-width:200px;word-wrap:break-word;white-space:normal;text-align:center;box-shadow:0 2px 6px rgba(0,0,0,.3);pointer-events:none;opacity:0;transition:opacity 0.3s;z-index:10;';
    document.getElementById('world').appendChild(selfMessage.el);
  }
  selfMessage.el.textContent = text;
  selfMessage.el.style.opacity = '1';
  clearTimeout(selfMessage.timeout);
  selfMessage.timeout = setTimeout(() => {
    if(selfMessage.el) selfMessage.el.style.opacity = '0';
  }, 5000);
}
function clearSelfMessage(){
  if(selfMessage.el){ selfMessage.el.remove(); selfMessage.el = null; }
  clearTimeout(selfMessage.timeout);
}

function createOtherPlayerEl(id){
  const worldEl = document.getElementById('world');
  if(!worldEl) return;
  if(otherPlayers[id].el) return;
  const el = document.createElement('div');
  el.className = 'other-player';
  const sprite = document.createElement('div');
  sprite.className = 'sprite';
  el.appendChild(sprite);
  const msgEl = document.createElement('div');
  msgEl.className = 'player-message';
  el.appendChild(msgEl);
  const nameEl = document.createElement('div');
  nameEl.className = 'player-name';
  nameEl.textContent = otherPlayers[id].name || 'Player';
  el.appendChild(nameEl);
  worldEl.appendChild(el);
  otherPlayers[id].el = el;
  otherPlayers[id].sprite = sprite;
  otherPlayers[id].nameEl = nameEl;
  otherPlayers[id].msgEl = msgEl;
  updateOtherPlayerEl(id);
}
function updateOtherPlayerEl(id){
  const p = otherPlayers[id];
  if(!p || !p.el) return;
  p.el.style.left = p.x + 'px';
  p.el.style.bottom = p.y + 'px';
  if(p.sprite){ p.sprite.style.transform = 'rotate(' + (p.rotation || 0) + 'deg)'; }
}
function showMessageOverPlayer(id, text){
  const p = otherPlayers[id];
  if(!p || !p.msgEl) return;
  p.msgEl.textContent = text;
  p.msgEl.classList.add('show');
  clearTimeout(p.msgTimeout);
  p.msgTimeout = setTimeout(() => { p.msgEl.classList.remove('show'); }, 5000);
}
function clearOtherPlayers(){
  Object.keys(otherPlayers).forEach(id => {
    if(otherPlayers[id].el) otherPlayers[id].el.remove();
    delete otherPlayers[id];
  });
}
function addSystemMessage(text){
  const cb = document.getElementById('chatBody');
  if(!cb) return;
  const d = document.createElement('div');
  d.style.cssText = 'color:#3b82c4;font-style:italic;font-size:12px;margin:4px 0;';
  d.innerHTML = '<b>System:</b> ' + text;
  cb.appendChild(d);
  cb.scrollTop = cb.scrollHeight;
  if(!chatWindow.classList.contains('show')) showUnreadDot();
}
function showUnreadDot(){
  const icon = document.getElementById('iconChat');
  if(!icon) return;
  let dot = icon.querySelector('.unread-dot');
  if(!dot){ dot = document.createElement('div'); dot.className = 'unread-dot'; icon.appendChild(dot); }
  dot.classList.add('show');
}
function hideUnreadDot(){
  const icon = document.getElementById('iconChat');
  if(!icon) return;
  const dot = icon.querySelector('.unread-dot');
  if(dot) dot.classList.remove('show');
}

(function(){
  const saved = localStorage.getItem('zorn_current');
  if(!saved) return;
  try{
    const data = JSON.parse(saved);
    const acc = loadAccounts();
    if(data && data.username && acc[data.username]){
      currentUser = {
        username: data.username,
        name: acc[data.username].name || data.username,
        bio: acc[data.username].bio || '',
        avatar: acc[data.username].avatar || ''
      };
      goToMainMenu();
    }
  }catch(e){}
})();

renderLangList(); applyLang();
checkLoginValid(); checkRegisterValid();
connectToServer();
