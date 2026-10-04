// ============================================================
// ===== ZORN SOUND GENERATOR (Web Audio API) =====
// ============================================================
// Генерирует все звуки прямо в браузере.
// Никаких mp3-файлов не нужно!

let audioCtx = null;

// ===== ИНИЦИАЛИЗАЦИЯ AUDIO CONTEXT =====
function initAudio(){
  if(!audioCtx){
    try{
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }catch(e){
      console.warn('Web Audio API не поддерживается:', e);
    }
  }
  if(audioCtx && audioCtx.state === 'suspended'){
    audioCtx.resume();
  }
  return audioCtx;
}

// ===== БАЗОВЫЙ ПРОИГРЫВАТЕЛЬ НОТЫ =====
function playTone(freq, duration, type='square', volume=0.15, startTime=0){
  const ctx = initAudio();
  if(!ctx) return;
  const now = ctx.currentTime + startTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = type;
  osc.frequency.setValueAtTime(freq, now);

  gain.gain.setValueAtTime(volume, now);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(now);
  osc.stop(now + duration);
}

// ===== ЗВУК: ПРЫЖОК =====
function playJumpSound(){
  const ctx = initAudio();
  if(!ctx) return;
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'square';
  osc.frequency.setValueAtTime(300, now);
  osc.frequency.exponentialRampToValueAtTime(800, now + 0.15);
  gain.gain.setValueAtTime(0.15, now);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.2);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(now);
  osc.stop(now + 0.2);
}

// ===== ЗВУК: УДАР / ПРИЗЕМЛЕНИЕ =====
function playHitSound(){
  const ctx = initAudio();
  if(!ctx) return;
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(120, now);
  osc.frequency.exponentialRampToValueAtTime(40, now + 0.15);
  gain.gain.setValueAtTime(0.3, now);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.2);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(now);
  osc.stop(now + 0.2);
}

// ===== ЗВУК: КЛИК В МЕНЮ =====
function playMenuSound(){
  playTone(880, 0.08, 'square', 0.1);
}

// ===== ЗВУК: ПРЕДУПРЕЖДЕНИЕ (лимит) =====
function playWarningSound(){
  playTone(440, 0.15, 'sawtooth', 0.15);
  playTone(330, 0.2, 'sawtooth', 0.15, 0.2);
}

// ===== ЗВУК: СООБЩЕНИЕ В ЧАТ =====
function playChatSound(){
  playTone(1200, 0.05, 'sine', 0.08);
  playTone(1600, 0.08, 'sine', 0.08, 0.06);
}

// ============================================================
// ===== ФОНОВАЯ МУЗЫКА (простой цикл) =====
// ============================================================
let musicLoop = null;
let musicPlaying = false;

function startMenuMusic(){
  if(musicPlaying) return;
  const ctx = initAudio();
  if(!ctx) return;
  musicPlaying = true;

  // Мелодия в стиле retro platformer
  const melody = [
    {f: 523, d: 0.15}, // C5
    {f: 659, d: 0.15}, // E5
    {f: 784, d: 0.15}, // G5
    {f: 659, d: 0.15}, // E5
    {f: 523, d: 0.15}, // C5
    {f: 587, d: 0.15}, // D5
    {f: 659, d: 0.3},  // E5
    {f: 0,   d: 0.15}, // пауза
    {f: 659, d: 0.15}, // E5
    {f: 587, d: 0.15}, // D5
    {f: 523, d: 0.15}, // C5
    {f: 440, d: 0.3},  // A4
    {f: 0,   d: 0.15}, // пауза
    {f: 523, d: 0.15}, // C5
    {f: 659, d: 0.15}, // E5
    {f: 784, d: 0.4},  // G5
  ];

  function playLoop(){
    if(!musicPlaying) return;
    let t = 0;
    melody.forEach(note => {
      if(note.f > 0){
        playTone(note.f, note.d * 0.9, 'triangle', 0.06, t);
      }
      t += note.d;
    });
    musicLoop = setTimeout(playLoop, t * 1000);
  }
  playLoop();
}

function stopMenuMusic(){
  musicPlaying = false;
  if(musicLoop){
    clearTimeout(musicLoop);
    musicLoop = null;
  }
}

// ============================================================
// ===== АВТО-ИНИЦИАЛИЗАЦИЯ =====
// ============================================================
// Браузеры (Chrome, Safari) требуют "жест" пользователя
// для запуска AudioContext. Ловим первый клик/нажатие клавиши.
document.addEventListener('click', function once(){
  initAudio();
  document.removeEventListener('click', once);
}, { once: true });

document.addEventListener('keydown', function once(){
  initAudio();
  document.removeEventListener('keydown', once);
}, { once: true });
