// fx.js
// 見た目と音の演出：効果音（Web Audio で合成。音声ファイルなし）、紙ふぶき、らくがきが流れる背景。
// どれも失敗してもゲームは止めない。「動きを減らす」設定の人には動きを出さない。

const reduceMotion = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---------- 効果音 ----------
let audio = null;
let muted = false;
try { muted = localStorage.getItem('oekaki_muted') === '1'; } catch (e) { /* 保存できなくてもよい */ }

function ac() {
  if (!audio) {
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return null;
    audio = new Ctor();
  }
  if (audio.state === 'suspended') audio.resume();
  return audio;
}

// 1音。t0 秒後に鳴らす。slideTo を渡すと音の高さがすべる
function tone(freq, t0, dur, type = 'square', vol = 0.07, slideTo = 0) {
  const a = ac();
  if (!a) return;
  const at = a.currentTime + t0;
  const osc = a.createOscillator(), gain = a.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, at);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, at + dur);
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(vol, at + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  osc.connect(gain).connect(a.destination);
  osc.start(at);
  osc.stop(at + dur + 0.03);
}

const SOUNDS = {
  tap: () => tone(620, 0, 0.07, 'triangle', 0.1, 900),
  back: () => tone(520, 0, 0.09, 'triangle', 0.08, 300),
  ready: () => { tone(523, 0, 0.1); tone(784, 0.09, 0.18); },
  unready: () => { tone(523, 0, 0.1); tone(392, 0.09, 0.16); },
  join: () => { tone(880, 0, 0.06, 'triangle', 0.09); tone(1175, 0.06, 0.12, 'triangle', 0.09); },
  topic: () => { for (let i = 0; i < 9; i++) tone(180 + i * 12, i * 0.055, 0.05, 'sawtooth', 0.045); tone(784, 0.52, 0.28, 'square', 0.08); tone(1047, 0.52, 0.28, 'square', 0.05); },
  go: () => { tone(659, 0, 0.1); tone(988, 0.1, 0.24); },
  tick: () => tone(1040, 0, 0.05, 'square', 0.05),
  done: () => { tone(659, 0, 0.09, 'triangle', 0.1); tone(988, 0.08, 0.22, 'triangle', 0.1); },
  merge: () => tone(160, 0, 0.5, 'sawtooth', 0.04, 620),
  fanfare: () => {
    [523, 659, 784].forEach((f, i) => tone(f, i * 0.1, 0.12));
    [1047, 784, 659].forEach((f) => tone(f, 0.32, 0.55, 'square', 0.05));
    tone(1319, 0.5, 0.4, 'triangle', 0.08);
  },
  error: () => { tone(220, 0, 0.12, 'sawtooth', 0.06); tone(180, 0.12, 0.18, 'sawtooth', 0.06); },
};

export function sfx(name) {
  if (muted || !SOUNDS[name]) return;
  try { SOUNDS[name](); } catch (e) { /* 音が出なくても続ける */ }
}

export const isMuted = () => muted;
export function setMuted(value) {
  muted = !!value;
  try { localStorage.setItem('oekaki_muted', muted ? '1' : '0'); } catch (e) { /* 保存できなくてもよい */ }
}

// ---------- 紙ふぶき ----------
const CONFETTI_COLORS = ['#ffc928', '#ff5d8f', '#3ec5ff', '#3ddc84', '#ff9a3c', '#ffffff'];

export function confetti() {
  if (reduceMotion()) return;
  const cv = document.createElement('canvas');
  cv.className = 'confetti';
  cv.width = window.innerWidth;
  cv.height = window.innerHeight;
  document.body.append(cv);
  const ctx = cv.getContext('2d');
  const pieces = [];
  for (let i = 0; i < 150; i++) {
    const fromLeft = i % 2 === 0;
    pieces.push({
      x: fromLeft ? -10 : cv.width + 10, y: cv.height * (0.35 + Math.random() * 0.3),
      vx: (fromLeft ? 1 : -1) * (4 + Math.random() * 9), vy: -(6 + Math.random() * 10),
      w: 6 + Math.random() * 8, h: 8 + Math.random() * 10, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 0.5,
      color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
    });
  }
  const start = performance.now();
  let last = start;
  function frame(now) {
    const dt = Math.min(40, now - last) / 16.7;
    last = now;
    ctx.clearRect(0, 0, cv.width, cv.height);
    for (const p of pieces) {
      p.vy += 0.32 * dt;
      p.vx *= 0.992;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * Math.abs(Math.cos(p.rot * 2)) + 1);
      ctx.restore();
    }
    if (now - start < 3200) requestAnimationFrame(frame);
    else cv.remove();
  }
  requestAnimationFrame(frame);
  setTimeout(() => cv.remove(), 5000); // 画面が裏にあってアニメが止まっても、必ず消す
}

// ---------- 背景：らくがきがゆっくり流れる ----------
const DOODLE_COLORS = ['#ffc928', '#ff5d8f', '#3ec5ff', '#3ddc84', '#ff9a3c'];

function drawDoodle(ctx, d) {
  ctx.save();
  ctx.translate(d.x, d.y);
  ctx.rotate(d.rot);
  ctx.strokeStyle = d.color;
  ctx.lineWidth = Math.max(3, d.size / 9);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  const s = d.size;
  if (d.kind === 0) { // 星
    for (let i = 0; i < 5; i++) {
      const a = -Math.PI / 2 + i * (Math.PI * 4 / 5);
      ctx[i ? 'lineTo' : 'moveTo'](Math.cos(a) * s, Math.sin(a) * s);
    }
    ctx.closePath();
  } else if (d.kind === 1) { // 丸
    ctx.arc(0, 0, s * 0.8, 0.3, Math.PI * 2.1);
  } else if (d.kind === 2) { // くねくね
    ctx.moveTo(-s, 0);
    ctx.bezierCurveTo(-s * 0.5, -s, -s * 0.5, s, 0, 0);
    ctx.bezierCurveTo(s * 0.5, -s, s * 0.5, s, s, 0);
  } else if (d.kind === 3) { // 三角
    ctx.moveTo(0, -s);
    ctx.lineTo(s * 0.9, s * 0.7);
    ctx.lineTo(-s * 0.9, s * 0.7);
    ctx.closePath();
  } else { // ばつ
    ctx.moveTo(-s * 0.7, -s * 0.7);
    ctx.lineTo(s * 0.7, s * 0.7);
    ctx.moveTo(s * 0.7, -s * 0.7);
    ctx.lineTo(-s * 0.7, s * 0.7);
  }
  ctx.stroke();
  ctx.restore();
}

export function startBackdrop() {
  const cv = document.createElement('canvas');
  cv.className = 'backdrop';
  cv.setAttribute('aria-hidden', 'true');
  document.body.prepend(cv);
  const ctx = cv.getContext('2d');
  let doodles = [];

  function resize() {
    cv.width = window.innerWidth;
    cv.height = window.innerHeight;
    const count = Math.round(Math.min(34, Math.max(14, cv.width * cv.height / 42000)));
    doodles = Array.from({ length: count }, (_, i) => ({
      x: Math.random() * cv.width, y: Math.random() * cv.height,
      size: 14 + Math.random() * 26, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 0.006,
      vx: (Math.random() - 0.5) * 0.18, vy: -(0.08 + Math.random() * 0.22),
      kind: i % 5, color: DOODLE_COLORS[i % DOODLE_COLORS.length],
    }));
    paint();
  }

  function paint() {
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.globalAlpha = 0.2;
    doodles.forEach((d) => drawDoodle(ctx, d));
  }

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(50, now - last) / 16.7;
    last = now;
    for (const d of doodles) {
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      d.rot += d.vr * dt;
      if (d.y < -60) { d.y = cv.height + 60; d.x = Math.random() * cv.width; }
      if (d.x < -60) d.x = cv.width + 60;
      if (d.x > cv.width + 60) d.x = -60;
    }
    paint();
    requestAnimationFrame(frame);
  }

  window.addEventListener('resize', resize);
  resize();
  if (!reduceMotion()) requestAnimationFrame(frame);
}
