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
  // 花火（90点以上）：ドンという低い音と、パチパチという高い音を5発
  fireworks: () => {
    for (let i = 0; i < 5; i++) {
      const t = i * 0.55;
      tone(700, t, 0.3, 'triangle', 0.04, 1500); // 上がる音
      tone(110, t + 0.3, 0.4, 'sine', 0.16, 45); // ドン
      for (let j = 0; j < 7; j++) tone(1400 + ((i * 7 + j) * 173) % 1500, t + 0.36 + j * 0.05, 0.07, 'triangle', 0.035);
    }
  },
  // 100点の演出：だんだん上がる音 → 長いファンファーレ（約6秒）
  jackpot: () => {
    for (let i = 0; i < 16; i++) tone(262 * Math.pow(2, i / 12), i * 0.09, 0.1, 'square', 0.05);
    const melody = [523, 523, 659, 784, 1047, 784, 1047, 1319];
    melody.forEach((f, i) => { tone(f, 1.6 + i * 0.22, 0.2, 'square', 0.07); tone(f / 2, 1.6 + i * 0.22, 0.2, 'triangle', 0.06); });
    [1047, 1319, 1568, 2093].forEach((f) => tone(f, 3.5, 1.6, 'square', 0.045));
    [523, 659, 784].forEach((f) => tone(f, 3.5, 1.8, 'triangle', 0.06));
    for (let i = 0; i < 10; i++) tone(1568 + (i % 4) * 262, 4.2 + i * 0.12, 0.1, 'triangle', 0.04);
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

// ---------- 花火（90点以上のとき） ----------
// 画面の下から玉が上がって、開く。4秒ほどで終わる
export function fireworks(ms = 4200) {
  if (reduceMotion()) return;
  const cv = document.createElement('canvas');
  cv.className = 'confetti fx-layer';
  cv.width = window.innerWidth;
  cv.height = window.innerHeight;
  document.body.append(cv);
  const ctx = cv.getContext('2d');
  const shells = [], sparks = [];
  const start = performance.now();
  let last = start, launched = 0;
  const total = Math.max(5, Math.round(ms / 520));
  function launch() {
    const x = cv.width * (0.15 + Math.random() * 0.7);
    shells.push({ x, y: cv.height + 10, vy: -(cv.height * (0.011 + Math.random() * 0.005)), top: cv.height * (0.15 + Math.random() * 0.3), color: CONFETTI_COLORS[launched % CONFETTI_COLORS.length] });
    launched++;
  }
  function burst(sh) {
    const n = 70, power = Math.min(cv.width, cv.height) * 0.011;
    for (let i = 0; i < n; i++) {
      const a = (Math.PI * 2 * i) / n + Math.random() * 0.1, v = power * (0.45 + Math.random() * 0.65);
      sparks.push({ x: sh.x, y: sh.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 1, color: i % 3 === 0 ? '#ffffff' : sh.color });
    }
  }
  function frame(now) {
    const dt = Math.min(40, now - last) / 16.7;
    last = now;
    const t = now - start;
    while (launched < total && t > launched * (ms * 0.6 / total)) launch();
    ctx.clearRect(0, 0, cv.width, cv.height);
    for (const sh of shells) {
      if (sh.done) continue;
      sh.y += sh.vy * dt;
      ctx.fillStyle = sh.color;
      ctx.beginPath();
      ctx.arc(sh.x, sh.y, 4, 0, 7);
      ctx.fill();
      if (sh.y <= sh.top) { sh.done = true; burst(sh); }
    }
    for (const p of sparks) {
      if (p.life <= 0) continue;
      p.vx *= 0.975; p.vy = p.vy * 0.975 + 0.09 * dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.life -= 0.013 * dt;
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 2.2 + p.life * 2.2, 0, 7);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    if (t < ms + 1600 && cv.isConnected) requestAnimationFrame(frame);
    else cv.remove();
  }
  requestAnimationFrame(frame);
  setTimeout(() => cv.remove(), ms + 3000); // 画面が裏にあってアニメが止まっても、必ず消す
}

// ---------- 100点の演出（全画面、約7秒） ----------
// 画面が暗くなる → 虹色の光がゆっくり回る → できた絵が回りながら大きくなる → 「100点」の文字。
// 強い点滅は使わない（光はゆっくり動かすだけ）。スキップできる。終わったら onEnd を呼ぶ
export function jackpot(picture, onEnd) {
  const calm = reduceMotion();
  const total = calm ? 3000 : 7200;
  const box = document.createElement('div');
  box.className = 'jackpot fx-layer';
  const cv = document.createElement('canvas');
  const title = document.createElement('p');
  title.className = 'jackpot-title';
  title.textContent = '100点';
  const sub = document.createElement('p');
  sub.className = 'jackpot-sub';
  sub.textContent = 'パーフェクト！ すごい合体！';
  const skip = document.createElement('button');
  skip.className = 'btn ghost jackpot-skip';
  skip.type = 'button';
  skip.textContent = 'スキップ';
  box.append(cv, title, sub, skip);
  document.body.append(box);
  const ctx = cv.getContext('2d');
  cv.width = window.innerWidth;
  cv.height = window.innerHeight;
  let ended = false;
  const end = () => {
    if (ended) return;
    ended = true;
    const wasShown = box.isConnected;
    box.remove();
    if (wasShown && onEnd) { try { onEnd(); } catch (e) { /* 演出が失敗しても続ける */ } }
  };
  skip.addEventListener('click', end);
  const start = performance.now();
  const ease = (x) => 1 - Math.pow(1 - Math.max(0, Math.min(1, x)), 3);
  function frame(now) {
    if (ended) return;
    if (!box.isConnected) { ended = true; return; } // ほかの画面へ行って、消された
    const t = now - start, W = cv.width, H = cv.height, cx = W / 2, cy = H * 0.42;
    ctx.clearRect(0, 0, W, H);
    // 虹色の光（12本）。ゆっくり回る
    if (!calm) {
      const rays = 12, R = Math.hypot(W, H), spin = t / 5200, show = ease((t - 600) / 1200) * 0.5;
      for (let i = 0; i < rays; i++) {
        const a0 = spin + (Math.PI * 2 * i) / rays, a1 = a0 + Math.PI / rays;
        ctx.fillStyle = `hsla(${(i * 30 + t / 40) % 360}, 95%, 60%, ${show})`;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, R, a0, a1);
        ctx.closePath();
        ctx.fill();
      }
    }
    // できた絵：回りながら大きくなる（3回転して止まる）
    const k = calm ? 1 : ease((t - 1100) / 2600);
    if (k > 0 && picture) {
      const side = Math.min(W * 0.78, H * 0.46), ratio = picture.width / picture.height;
      const pw = ratio >= 1 ? side : side * ratio, ph = ratio >= 1 ? side / ratio : side;
      ctx.save();
      ctx.translate(cx, cy + (calm ? 0 : Math.sin(t / 420) * 6 * k));
      ctx.rotate((1 - k) * Math.PI * 6);
      ctx.scale(0.08 + 0.92 * k, 0.08 + 0.92 * k);
      ctx.fillStyle = '#ffc928';
      ctx.fillRect(-pw / 2 - 12, -ph / 2 - 12, pw + 24, ph + 24);
      ctx.fillStyle = '#fff';
      ctx.fillRect(-pw / 2, -ph / 2, pw, ph);
      ctx.drawImage(picture, -pw / 2, -ph / 2, pw, ph);
      ctx.restore();
    }
    if (t > (calm ? 200 : 3400)) box.classList.add('show-title');
    if (t > total - 700) box.classList.add('leaving');
    if (t >= total) { end(); return; }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  setTimeout(end, total + 2500); // 画面が裏にあってアニメが止まっても、必ず終わる
}

// 出ている演出（花火、100点の演出）を全部消す。ほかの画面へ行くときに呼ぶ
export function stopFx() {
  document.querySelectorAll('.fx-layer').forEach((el) => el.remove());
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
