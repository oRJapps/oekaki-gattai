// app.js
// 画面とゲームの流れ。企画の図のとおりに進む：
//   S（シングル）  → 難易度 A/B/C → CPUと合体（片方を描くと、もう片方をCPUが自動で描く）
//   対（対戦）     → 難易度 A/B/C → オンライン（同じ難易度の部屋へ自動で入る）
//   フレ（フレンド）→ カギ（入力）→ 対戦
//   フレ（フレンド）→ 部屋（作る）→ 難易度 A/B/C → カギ（発行）

import { LEVELS, WIDE_TOPICS, nextTopic, markTopic, parseTopic, sampleFile, topicDir, sampleFlip } from './topics.js?v=20261119170138';
import { loadSample, loadAlternates, COLOR_LIST } from './samples.js?v=20261119170138';
import { Pad, makeLayout, pickLayout, layoutsFor, drawLayoutPreview, drawSample, LAYOUT_NAMES, startReveal, similarity, partPicture, samplePartLayers, scoreCVDB, seamMarks } from './draw.js?v=20261119170138';
import { sfx, confetti, fireworks, jackpot, stopFx, startBackdrop, isMuted, setMuted } from './fx.js?v=20261119170138';
import { createIdentity, idOf, importKey, verify } from './sec.js?v=20261119170138';
import { makeCard } from './card.js?v=20261119170138';
import * as net from './net.js?v=20261119170138';

const $app = document.getElementById('app');
const params = new URLSearchParams(location.search);
// 描く時間は180秒。確認用に ?sec=10 のように短くできる
const DRAW_SECONDS = Math.max(5, parseInt(params.get('sec'), 10) || 180);
const INTRO_MS = 4000; // お題と、自分が描くパートを見せる時間
// 合体のしかた。true：描いたままの絵を、そのまま並べる（大きさや位置を合わせない）。false：見本に合わせて大きさ・位置を直してから、つなぎめを合わせる
const SIMPLE_MERGE = true;
// 描く画面の「描ける範囲の四角」。false：四角を出さない。パートの中なら、どこにでも描ける
const USE_BOX = false;
// つなぎめの〇。true：描く画面のつなぎめに〇を2つ出して、合体のときに、絵のはしを〇に合わせる
const USE_MARKS = true;
// 初級（子ども向け）：お手本を、色つきのまま、描いている間もずっと出す。ほかの難易度：最初の2秒だけ、シルエットで出す
const keepSample = () => G.level === 'A';
// 激辛：お手本を出さない（お題の画面でも、描く画面でも）。お題は上級と同じ
const noSample = () => G.level === 'D';
const SAMPLE_MS = 2000; // お手本（シルエット）を見せる時間。最初のこの間だけ見える
const SITE_URL = 'https://orjapps.github.io/oekaki-gattai/'; // シェアするときに入れる公開先
// スマホかタブレットなら true（iPad は Mac と名のるので、タッチできるかどうかも見る）
const IS_PHONE = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (/Macintosh/i.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
const MAX_PLAYERS = 5;
const SEATS = [
  { name: '赤', color: '#ff5252' }, { name: '青', color: '#3ec5ff' },
  { name: '緑', color: '#3ddc84' }, { name: '黄', color: '#ffc928' }, { name: '紫', color: '#b388ff' },
];
// 色：12色の色鉛筆と同じ並び。色の一覧は samples.js にある（見本の絵も、同じ12色で描くため）
const COLORS = COLOR_LIST.map(([c]) => c);
const COLOR_NAMES = Object.fromEntries(COLOR_LIST);
const WIDTHS = [['細', 6], ['中', 12], ['太', 26]];

// id と pub（公開する鍵）と sign（署名する関数）は、最後の「はじめに1回だけ」で作る。typed = 入力したなまえ、name = 画面に出すなまえ
const me = { id: '', pub: '', sign: null, typed: '', name: '' };

// G.phase：title / lobby / intro / draw / wait / reveal
const G = {
  phase: 'title', mode: null, level: null,
  room: null, chan: null, players: [], ready: false, joinedAt: 0, starting: false, busy: false, lobbySig: '',
  round: null, layout: null, roomTopics: new Set(), parts: {}, done: new Set(), submitted: false, pad: null, reveal: null, seen: {},
  timers: [], beat: null, resend: null, endAt: 0,
  // なりすまし対策：keys = 本物と確かめた人の鍵、orderIds = 部屋に来た順、seenRounds = もう使ったラウンドの番号
  keys: new Map(), pending: new Set(), lastList: [], orderIds: [], goneAt: {}, joinTimes: {}, admitted: false,
  seenRounds: new Set(), queue: Promise.resolve(), startTimer: null,
};

// ---------- 絵（SVG）。中身はこのファイルに書いた決まった文字だけ ----------
const ICONS = {
  pen: '<path d="M4 20l1-5L16 4l4 4L9 19l-5 1Z"/><path d="M13.5 6.5l4 4"/>',
  bucket: '<path d="M4 12l8-8 8 8-7 7a2 2 0 0 1-2.8 0L4 12.8Z"/><path d="M4 12h16M9 3l3 3"/><path d="M20 16c1 1.5 1.5 2.5 1.5 3.3a1.5 1.5 0 0 1-3 0c0-.8.5-1.8 1.5-3.3Z" fill="currentColor"/>',
  people: '<circle cx="8" cy="8" r="3"/><circle cx="17" cy="9" r="2.5"/><path d="M2.5 20c.5-4 2.5-6 5.5-6s5 2 5.5 6M14.5 14.6c3-.6 5.8.8 6.8 5"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M17 6l3 3M14 9l2.5 2.5"/>',
  door: '<path d="M4 21V5a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v16M2 21h20"/><path d="M10.5 9v6M7.5 12h6"/>',
  eraser: '<path d="M9 20h11M5.5 13.5l8-8a2 2 0 0 1 2.8 0l3.2 3.2a2 2 0 0 1 0 2.8L12 19H8.5l-3-3a2 2 0 0 1 0-2.5Z"/>',
  undo: '<path d="M8 6 4 10l4 4"/><path d="M4 10h10a5 5 0 0 1 0 10h-3"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6"/>',
  save: '<path d="M12 3v12M7 10l5 5 5-5M4 20h16"/>',
  x: '<path d="M4 4l16 16M20 4L4 20"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
  soundOn: '<path d="M4 9v6h4l5 4V5L8 9H4Z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/>',
  soundOff: '<path d="M4 9v6h4l5 4V5L8 9H4Z"/><path d="M17 9.5l5 5M22 9.5l-5 5"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  again: '<path d="M20 12a8 8 0 1 1-2.6-5.9M20 4v5h-5"/>',
  home: '<path d="M4 11l8-7 8 7M6 10v10h12V10"/>',
  back: '<path d="M10 6l-6 6 6 6M4 12h16"/>',
  clock: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l3 2M9 2.5h6"/>',
};
function icon(name) {
  const el = document.createElement('span');
  el.className = 'ico';
  el.setAttribute('aria-hidden', 'true');
  el.innerHTML = `<svg viewBox="0 0 24 24">${ICONS[name]}</svg>`;
  return el;
}

// タイトルのマスコット：線を描いているえんぴつ
const MASCOT = '<svg viewBox="0 0 240 110" role="img" aria-label="えんぴつのマスコット">'
  + '<path class="squiggle" d="M12 86 C 34 46, 52 112, 78 80 S 112 52, 132 84 S 150 96, 160 84" />'
  + '<g class="pencil" transform="translate(160 84)"><g class="pencil-body" transform="rotate(-38)">'
  + '<path d="M0 0 L24 -11 L24 11 Z" fill="#f6d2a6" stroke="#0a0f2e" stroke-width="4" stroke-linejoin="round"/>'
  + '<path d="M0 0 L9 -4 L9 4 Z" fill="#0a0f2e"/>'
  + '<rect x="24" y="-11" width="62" height="22" fill="#ff5d8f" stroke="#0a0f2e" stroke-width="4"/>'
  + '<rect x="86" y="-11" width="10" height="22" fill="#cfd6ee" stroke="#0a0f2e" stroke-width="4"/>'
  + '<rect x="96" y="-11" width="16" height="22" rx="6" fill="#ffd3df" stroke="#0a0f2e" stroke-width="4"/>'
  + '<circle cx="46" cy="-2" r="5" fill="#fff"/><circle cx="62" cy="-2" r="5" fill="#fff"/>'
  + '<circle cx="45" cy="-1.5" r="2.4" fill="#0a0f2e"/><circle cx="61" cy="-1.5" r="2.4" fill="#0a0f2e"/>'
  + '<path d="M49 5 q5 4 10 0" fill="none" stroke="#0a0f2e" stroke-width="2.5" stroke-linecap="round"/>'
  + '</g></g></svg>';

// マスコットの動き：えんぴつの先が線の上を進み、通ったところまで線が出る（えんぴつが線を描いて見える）
// 1周 4秒：描く（2.4秒）→ 止まる（0.9秒）→ 線が消えて、えんぴつが最初の位置へもどる（0.7秒）
function animateMascot(root) {
  const line = root.querySelector('.squiggle');
  const pencil = root.querySelector('.pencil');
  const body = root.querySelector('.pencil-body');
  if (!line || !pencil || !body) return;
  const length = line.getTotalLength();
  line.style.strokeDasharray = String(length);
  const place = (progress) => {
    const pt = line.getPointAtLength(length * progress);
    pencil.setAttribute('transform', `translate(${pt.x.toFixed(1)} ${pt.y.toFixed(1)})`);
  };
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce) { line.style.strokeDashoffset = '0'; place(1); return; }

  const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
  const DRAW = 2400, HOLD = 900, BACK = 700, TOTAL = DRAW + HOLD + BACK;
  const start = performance.now();
  function frame(now) {
    if (!root.isConnected) return; // タイトル画面をはなれたら止める
    const t = (now - start) % TOTAL;
    if (t < DRAW) { // 描く：えんぴつの位置まで線を出す
      const progress = ease(t / DRAW);
      line.style.opacity = '1';
      line.style.strokeDashoffset = String(length * (1 - progress));
      place(progress);
      body.setAttribute('transform', `rotate(${(-38 + Math.sin(t / 90) * 5).toFixed(1)})`); // 書いている手のゆれ
    } else if (t < DRAW + HOLD) { // 描き終わって止まる
      line.style.strokeDashoffset = '0';
      place(1);
      body.setAttribute('transform', 'rotate(-38)');
    } else { // 線が消えて、えんぴつが最初へもどる
      const back = ease((t - DRAW - HOLD) / BACK);
      line.style.opacity = String(1 - back);
      place(1 - back);
      body.setAttribute('transform', `rotate(${(-38 - Math.sin(back * Math.PI) * 14).toFixed(1)})`);
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

// 席ごとの顔
const MOUTHS = ['M17 30 q7 6 14 0', 'M18 31 h12', 'M17 29 q7 9 14 0 Z', 'M18 32 q6 -5 12 0'];
function face(seat) {
  const el = document.createElement('span');
  el.className = 'face';
  el.setAttribute('aria-hidden', 'true');
  el.innerHTML = '<svg viewBox="0 0 48 48"><circle cx="24" cy="24" r="20" fill="var(--seat)" stroke="#0a0f2e" stroke-width="3.5"/>'
    + '<circle cx="17" cy="21" r="4.2" fill="#fff"/><circle cx="31" cy="21" r="4.2" fill="#fff"/>'
    + '<circle cx="17.8" cy="21.6" r="2.1" fill="#0a0f2e"/><circle cx="31.8" cy="21.6" r="2.1" fill="#0a0f2e"/>'
    + `<path d="${MOUTHS[seat % MOUTHS.length]}" fill="#0a0f2e" fill-opacity="${seat % MOUTHS.length === 2 ? 1 : 0}" stroke="#0a0f2e" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  return el;
}

// ---------- 小さな道具 ----------
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style') el.style.cssText = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    el.append(kid.nodeType ? kid : String(kid));
  }
  return el;
}
// 画面を入れかえる。画面の名前が変わったときだけ、登場のアニメーションをやり直す
function show(screen, ...nodes) {
  $app.replaceChildren(...nodes.filter((n) => n != null && n !== false));
  if ($app.dataset.screen !== screen) {
    $app.dataset.screen = screen;
    $app.classList.remove('enter');
    void $app.offsetWidth;
    $app.classList.add('enter');
    window.scrollTo(0, 0);
  }
}
const DEBUG = params.has('debug');
function log(text) { if (DEBUG) console.log('[oekaki] ' + text); }
function later(fn, ms) { const t = setTimeout(fn, ms); G.timers.push(t); return t; }
function every(fn, ms) { const t = setInterval(fn, ms); G.timers.push(t); return t; }
function clearTimers() { G.timers.forEach((t) => { clearTimeout(t); clearInterval(t); }); G.timers = []; }
function toast(text) {
  const el = h('div', { class: 'toast', role: 'status' }, text);
  document.body.append(el);
  setTimeout(() => el.remove(), 3500);
}
// なまえは、はじめは空白。空白のまま遊ぶと「プレイヤー12」のような仮のなまえになる（保存はしない）
const NAME_KEY = 'oekaki_name_v2';
const GUEST_NAME = 'プレイヤー' + Math.floor(10 + Math.random() * 90);
function loadName() {
  try { return localStorage.getItem(NAME_KEY) || ''; } catch (e) { return ''; }
}
function saveName(name) {
  me.typed = (name || '').trim().slice(0, 12);
  me.name = me.typed || GUEST_NAME;
  try { localStorage.setItem(NAME_KEY, me.typed); } catch (e) { /* なくてもよい */ }
}
const modeLabel = () => ({ single: 'シングル', online: '対戦', friend: 'フレンド', local: 'みんなで' }[G.mode]);
const backButton = (fn) => h('button', { class: 'btn ghost', onclick: () => { sfx('back'); fn(); } }, icon('back'), 'もどる');
const head = (title, sub) => h('header', { class: 'head' }, h('h2', { class: 'ribbon' }, title), sub ? h('p', { class: 'lead' }, sub) : null);
// 大きなメニューのカード（色、絵、タイトル、説明）
const card = (color, art, title, sub, onclick, extra) => h('button', { class: 'card', style: `--c:${color}`, onclick },
  h('span', { class: 'card-art' }, art), h('span', { class: 'card-text' }, h('b', {}, title), h('small', {}, sub)), extra || null);
// 動物のお題には、描く向き（正面・左向きなど）をそえる
const dirOf = (topic) => topicDir((parseTopic(topic) || { base: topic }).base);
const board = (topic, small) => h('div', { class: 'board' + (small ? ' small' : '') },
  h('small', {}, 'お題'), h('b', { id: 'topic', style: `--len:${Math.max(4, [...topic].length)}` }, topic),
  dirOf(topic) ? h('em', { class: 'dir', id: 'topic-dir' }, `向き：${dirOf(topic)}`) : null);

// ---------- 画面：タイトル ----------
function titleScreen() {
  clearTimers();
  G.phase = 'title';
  const name = h('input', { class: 'input', id: 'name', maxlength: 12, value: me.typed, placeholder: 'なまえを入れてね', autocomplete: 'off', onchange: (e) => saveName(e.target.value) });
  const go = (fn) => () => { saveName(name.value); fn(); };
  const mascot = h('div', { class: 'mascot' });
  mascot.innerHTML = MASCOT;
  show('title',
    h('h1', { class: 'logo', 'aria-label': 'お絵かき合体' },
      [...'お絵かき合体'].map((ch, i) => h('span', { style: `--i:${i}`, 'aria-hidden': 'true' }, ch))),
    mascot,
    h('p', { class: 'tagline' }, 'お題を分けて描いて、最後に1枚に合体！'),
    h('label', { class: 'nametag', for: 'name' }, h('span', {}, 'なまえ'), name),
    h('nav', { class: 'menu' },
      card('#ff5d8f', icon('pen'), 'シングル', 'CPUと合体する', go(() => levelScreen('single'))),
      card('#3ec5ff', icon('people'), '対戦', '難易度と人数を選ぶと部屋に入る', go(() => levelScreen('online'))),
      card('#3ddc84', icon('key'), 'フレンド', 'カギで集まる', go(friendScreen)),
      card('#ffc928', icon('people'), 'みんなで', '1台を順番に回して描く', go(() => levelScreen('local')))),
    h('p', { class: 'status ' + (net.online ? 'on' : 'off') }, h('i', {}),
      net.online ? 'オンライン：みんなとつながります' : 'お試しモード：同じブラウザの別タブ同士だけつながります'),
  );
  animateMascot(mascot);
}

// ---------- 画面：難易度 A/B/C ----------
// next：single = CPUと合体 ／ online = オンラインの部屋へ ／ friend = 部屋を作ってカギを発行 ／ local = 1台を順番に回して描く
const LEVEL_LOOK = { A: ['#3ddc84', 'rows', 1], B: ['#ff9a3c', 'diag', 2], C: ['#ff5252', 'diagR', 3], D: ['#b5179e', 'diagR', 4] };
function levelScreen(next) {
  const title = { single: 'シングル', online: '対戦', friend: '部屋を作る', local: 'みんなで' }[next];
  show('level-' + next,
    head(title, '難易度をえらぼう'),
    h('nav', { class: 'menu' }, Object.entries(LEVELS).map(([key, lv]) => {
      const [color, layout, stars] = LEVEL_LOOK[key];
      const art = h('canvas', { class: 'mini' });
      drawLayoutPreview(art, makeLayout(layout, 2), 0);
      return card(color, art, lv.label, lv.hint, () => chooseLevel(next, key),
        h('span', { class: 'stars', 'aria-label': `むずかしさ ${stars}` }, '★'.repeat(stars), h('i', {}, '★'.repeat(Math.max(0, 3 - stars)))));
    })),
    backButton(next === 'friend' ? friendScreen : titleScreen),
  );
}

function chooseLevel(next, level) {
  G.level = level;
  if (next === 'single') { G.mode = 'single'; startSolo(); return; }
  setupScreen(next, level);
}

// ---------- 画面：人数とカギを決める ----------
// 対戦：人数だけ決める（同じ難易度・同じ人数の部屋に入る）。フレンド：人数と、4けたのカギを自分で決める
function setupScreen(next, level, keep = {}) {
  // 人数は半角数字で入力する（全角で入れても、半角に直して読む）。入れた人数で、絵を分ける数が決まる
  const toHalf = (t) => t.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0));
  const sizeInput = h('input', { class: 'size-input', id: 'room-size', inputmode: 'numeric', maxlength: 1, autocomplete: 'off', 'aria-label': '人数', value: String(keep.size || 2) });
  const split = h('p', { class: 'note', id: 'split-note', role: 'status' }, '');
  const readSize = () => { const n = parseInt(toHalf(sizeInput.value).replace(/\D/g, ''), 10); return n >= 2 && n <= MAX_PLAYERS ? n : 0; };
  const paint = () => { const n = readSize(); split.textContent = n ? `絵を${n}つに分けます` : `2〜${MAX_PLAYERS}の数字を入れてね`; };
  sizeInput.addEventListener('input', paint);
  sizeInput.addEventListener('focus', () => sizeInput.select());
  paint();
  const row = h('div', { class: 'toolrow' }, sizeInput, h('span', { class: 'unit' }, '人'));
  const input = next === 'friend'
    ? h('input', { class: 'input key', id: 'new-key', inputmode: 'numeric', maxlength: 4, placeholder: '0000', autocomplete: 'off', 'aria-label': 'カギ', value: keep.code || '' }) : null;
  const msg = h('p', { class: 'note', role: 'status' }, keep.error
    || (input ? '好きな4けたの数字をカギにしてね。友だちには、この数字を教える' : next === 'local' ? '1台を、順番に回して描きます。ほかの人が描いている間は、画面を見ないでね' : '同じ人数をえらんだ人と、同じ部屋になります'));
  const go = () => {
    const size = readSize();
    if (!size) { sfx('error'); msg.textContent = `人数は2〜${MAX_PLAYERS}の半角数字で入れてね`; sizeInput.focus(); return; }
    let code = null;
    if (input) {
      code = input.value.replace(/\D/g, '');
      if (code.length !== KEY_LENGTH) { sfx('error'); msg.textContent = `カギは${KEY_LENGTH}けたの数字にしてね`; return; }
    }
    if (next === 'local') { G.level = level; G.mode = 'local'; startLocal(size); return; } // 1台で遊ぶ：部屋は作らない
    openRoom(next, level, size, code);
  };
  [sizeInput, input].forEach((el) => { if (el) el.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); }); });
  show('setup-' + next,
    head(next === 'friend' ? '部屋を作る' : next === 'local' ? 'みんなで' : '対戦', input ? '人数とカギを決めよう' : '人数を決めよう'),
    h('div', { class: 'tools' }, h('p', { class: 'lead' }, `何人で遊ぶ？（2〜${MAX_PLAYERS}の半角数字）`), row, split),
    input ? h('div', { class: 'ticket' }, h('small', {}, icon('key'), 'カギ（4けた）'), input,
      h('button', { class: 'tool', onclick: () => { input.value = String(Math.floor(Math.random() * 10000)).padStart(4, '0'); } }, 'おまかせ')) : null,
    msg,
    h('button', { class: 'btn primary', id: 'open-room', onclick: go }, input ? '部屋を作る' : next === 'local' ? '始める' : '部屋に入る'),
    backButton(() => levelScreen(next)),
  );
}

async function openRoom(next, level, size, code) {
  G.level = level;
  G.mode = next;
  show('loading', h('div', { class: 'loading' }, h('i', {}), h('i', {}), h('i', {})), h('p', { class: 'lead' }, next === 'online' ? '部屋をさがしています…' : '部屋を作っています…'));
  try {
    let room = next === 'online' ? await net.api.findRoom(level, size) : null;
    if (!room) {
      room = await net.api.createRoom({ code: next === 'friend' ? code : null, mode: next, difficulty: level, size, status: 'waiting', player_count: 1 });
    }
    if (!room.size) room.size = size;
    await enterRoom(room);
  } catch (err) {
    console.error(err);
    sfx('error');
    const text = String((err && err.message) || err);
    if (/key in use/.test(text)) { setupScreen(next, level, { size, code, error: 'そのカギは、いまほかの部屋で使われています。別の数字にしてね' }); return; }
    toast(level === 'D' ? '激辛の部屋は、まだ作れません（Supabase の設定の更新が必要です）' : '部屋に入れませんでした：' + text);
    titleScreen();
  }
}

// ---------- 画面：フレンド（カギ／部屋） ----------
// カギは4けた。Supabase の設定が古いあいだは10けたのカギが出るので、10けたも受けつける
const KEY_LENGTH = 4;
const formatKey = (code) => String(code).replace(/^(\d{3})(\d{3})(\d{4})$/, '$1-$2-$3');
function friendScreen() {
  show('friend',
    head('フレンド', '友だちと同じ部屋で遊ぼう'),
    h('nav', { class: 'menu' },
      card('#ffc928', icon('key'), 'カギを入力', '友だちの部屋に入る', keyScreen),
      card('#3ddc84', icon('door'), '部屋を作る', '人数とカギを自分で決める', () => levelScreen('friend'))),
    backButton(titleScreen),
  );
}

function keyScreen() {
  // 区切りが入っていてもよい（数字だけを使う）
  const input = h('input', { class: 'input key', inputmode: 'numeric', maxlength: 16, placeholder: '0000', autocomplete: 'off', 'aria-label': 'カギ' });
  const msg = h('p', { class: 'note', role: 'status' }, '友だちに教えてもらった4けたのカギを入れてね');
  const go = async () => {
    const code = input.value.replace(/\D/g, '');
    if (code.length !== KEY_LENGTH && code.length !== 10) { sfx('error'); msg.textContent = `カギは${KEY_LENGTH}けたの数字です`; return; }
    msg.textContent = 'さがしています…';
    try {
      const room = await net.api.roomByCode(code);
      if (room && room.error === 'locked') { sfx('error'); msg.textContent = 'まちがいが続いたので、1分ほど待ってからもう一度ためしてね'; return; }
      if (!room) { sfx('error'); msg.textContent = 'そのカギの部屋は見つかりませんでした'; return; }
      G.mode = 'friend';
      G.level = room.difficulty;
      await enterRoom(room);
    } catch (err) {
      console.error(err);
      sfx('error');
      msg.textContent = '部屋に入れませんでした：' + (err.message || err);
    }
  };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  show('key', head('カギを入力'), h('div', { class: 'ticket' }, h('small', {}, icon('key'), 'カギ'), input),
    h('button', { class: 'btn primary', onclick: go }, '入る'), msg, backButton(friendScreen));
  input.focus();
}

// ---------- 部屋（ロビー） ----------
// 自分の状態（部屋のみんなに知らせる）。phase は「部屋で待っている（lobby）」か「遊んでいる（play）」かだけを知らせる。
// 細かく分けて知らせると送る回数がふえ、Supabase に接続を切られる（net.js の join の説明）
const myState = () => ({ id: me.id, pub: me.pub, name: me.name, joinedAt: G.joinedAt, ready: G.ready, phase: G.phase === 'lobby' ? 'lobby' : 'play' });
// この部屋の人数（部屋を作った人が決めた数。分からないときは5人）
const cap = () => Math.min(MAX_PLAYERS, Math.max(2, (G.room && G.room.size) || MAX_PLAYERS));
// ラウンドを始める係：部屋にいる人の中で、id がいちばん小さい人。
// 席の順番は、入り直すと画面によって食いちがうことがある。id で決めれば、全員が同じ人をえらぶ
const isStarter = () => G.players.length > 0 && G.players.map((q) => q.id).sort()[0] === me.id;
const isHost = () => G.players.length > 0 && G.players[0].id === me.id;
function track() { if (G.chan) G.chan.update(myState()); }

async function enterRoom(room) {
  if (!me.sign) throw new Error('このブラウザでは安全な通信が使えません（https か localhost で開いてください）');
  G.room = room;
  G.ready = false; G.starting = false; G.busy = false;
  G.players = [];
  G.keys = new Map([[me.id, { pub: me.pub, key: await importKey(me.pub) }]]);
  G.pending = new Set(); G.lastList = []; G.orderIds = []; G.goneAt = {}; G.joinTimes = {}; G.admitted = false;
  // 入ってから3秒たったら、席の順番を確定させる（満員かどうかもここで決まる）
  setTimeout(() => { if (G.room === room) onPresence(G.lastList); }, 3200);
  G.seenRounds = new Set(); G.queue = Promise.resolve(); G.roomTopics = new Set();
  G.joinedAt = Date.now();
  G.phase = 'lobby';
  G.chan = await net.api.join(room.id, myState(), { presence: onPresence, event: onEvent });
  G.beat = setInterval(hostBeat, 15000);
  sfx('join');
  lobbyScreen();
}

function leaveRoom() {
  clearInterval(G.beat);
  clearTimeout(G.startTimer); G.startTimer = null;
  clearInterval(G.resend);
  if (G.chan) { try { G.chan.leave(); } catch (e) { /* もう切れている */ } }
  if (G.room && isHost() && G.players.length <= 1) net.api.deleteRoom(G.room);
  G.chan = null; G.room = null; G.players = [];
}

function hostBeat() {
  if (!G.room || !isHost()) return;
  const playing = G.players.some((p) => p.phase !== 'lobby');
  net.api.updateRoom(G.room, { player_count: G.players.length, status: playing ? 'playing' : 'waiting' });
}

// ---------- 在席の知らせ ----------
const PHASES = ['lobby', 'play', 'intro', 'draw', 'wait', 'reveal']; // intro〜reveal は、古い版の画面が送ってくる
const cleanPlayer = (p) => ({
  id: p.id, name: String(p.name == null ? '' : p.name).slice(0, 12) || '？',
  joinedAt: Number.isFinite(p.joinedAt) ? p.joinedAt : 0, ready: p.ready === true,
  phase: PHASES.includes(p.phase) ? p.phase : 'lobby',
});

// 公開する鍵から計算した id が、名のっている id と同じなら本物。確かめ終わったら、もう一度一覧を作り直す
async function checkKey(id, pub) {
  try {
    if ((await idOf(pub)) !== id) return;
    const key = await importKey(pub);
    if (!G.keys.has(id)) G.keys.set(id, { pub, key });
    if (G.room) onPresence(G.lastList);
  } catch (e) { /* こわれた鍵は相手にしない */ }
}

function onPresence(list) {
  if (!G.room || !Array.isArray(list)) return;
  G.lastList = list;
  // 1. 本物と確かめた人だけを残す（他人の id を名のる人は、鍵が合わないのでここで落ちる）
  const valid = new Map();
  for (const p of list) {
    if (!p || typeof p.id !== 'string' || typeof p.pub !== 'string' || p.id.length > 64 || p.pub.length > 200) continue;
    const known = G.keys.get(p.id);
    if (known) {
      if (known.pub === p.pub && !valid.has(p.id)) valid.set(p.id, cleanPlayer(p));
      continue;
    }
    const tag = p.id + '|' + p.pub;
    if (G.pending.has(tag) || G.pending.size > 200) continue;
    G.pending.add(tag);
    checkKey(p.id, p.pub);
  }
  // 2. 席は「この画面で見えた順」。あとから来た人が、前からいる人の席をうばうことはできない
  //    （一覧から消えても10秒は席を残す。Supabase は状態を更新した一瞬だけ一覧から消えることがある）
  const now = Date.now();
  for (const id of G.orderIds) {
    if (valid.has(id)) delete G.goneAt[id];
    else if (!G.goneAt[id]) G.goneAt[id] = now;
  }
  G.orderIds = G.orderIds.filter((id) => valid.has(id) || now - G.goneAt[id] < 10000);
  const fresh = [...valid.values()].filter((p) => !G.orderIds.includes(p.id))
    .sort((a, b) => (a.joinedAt - b.joinedAt) || (a.id < b.id ? -1 : 1));
  G.orderIds.push(...fresh.map((p) => p.id));
  // 部屋に入ってすぐの3秒間だけは、前からいた人の一覧が少しずつ届くので、入った時刻の順に並べ直す。
  // そのあとは並べ直さない（あとから来た人が、うその時刻で前に割りこめないようにする）
  for (const p of valid.values()) if (!(p.id in G.joinTimes)) G.joinTimes[p.id] = p.joinedAt;
  const settling = now - G.joinedAt < 3000;
  if (settling) G.orderIds.sort((a, b) => ((G.joinTimes[a] || 0) - (G.joinTimes[b] || 0)) || (a < b ? -1 : 1));
  const myIndex = G.orderIds.indexOf(me.id);
  if (myIndex >= cap() && !G.admitted && !settling) {
    leaveRoom();
    toast('この部屋は満員でした');
    titleScreen();
    return;
  }
  if (!settling && myIndex >= 0 && myIndex < cap()) G.admitted = true; // 一度すわったら、もう追い出されない

  const before = G.players.length;
  G.players = G.orderIds.slice(0, cap()).filter((id) => valid.has(id)).map((id) => valid.get(id));
  if (G.round && G.round.order) {
    for (const o of G.round.order) {
      if (G.players.some((p) => p.id === o.id)) delete G.seen[o.id];
      else if (!G.seen[o.id]) G.seen[o.id] = Date.now(); // seen[id] = その人が一覧から消えた時刻
    }
  }
  if (G.players.length !== before) hostBeat();
  if (G.phase === 'lobby') {
    if (G.players.length > before && before > 0) sfx('join');
    G.busy = G.players.some((p) => p.phase !== 'lobby');
    renderLobby();
  }
  if (G.phase === 'draw' || G.phase === 'wait') { updateWaitText(); checkAllParts(); }
  hostCheck();
}

// ---------- ラウンドを始める ----------
// 決めた人数がそろって、全員が「準備OK」なら始められる
const allReady = () => G.players.length === cap() && G.players.every((p) => p.ready && p.phase === 'lobby');

// 2人以上いて全員が「準備OK」なら、先頭の人がラウンドを始める。
// 先頭の人が始めないとき（席の順番が画面によってずれたとき）は、4〜6秒後にほかの人が始める。
// 「始める」が2つ飛んでも、全員が最初に届いた1つだけを使う。
function hostCheck() {
  if (G.starting || G.phase !== 'lobby' || !G.chan || !allReady()) {
    clearTimeout(G.startTimer);
    G.startTimer = null;
    return;
  }
  if (isStarter()) { startRound(); return; }
  if (!G.startTimer) {
    G.startTimer = setTimeout(() => {
      G.startTimer = null;
      if (!G.starting && G.phase === 'lobby' && G.chan && allReady()) startRound();
    }, 4000 + Math.random() * 2000);
  }
}

// パートと分け方は、毎回くじ引き（ランダム）で決める。ただし、同じものが3回続くことだけは防ぐ。
// LAST：前のラウンドの記録。layout・layoutRun = 分け方と、それが続いた回数。parts・runs = だれがどのパートで、それが何回続いたか
const LAST = { layout: '', layoutRun: 0, parts: {}, runs: {}, soloPart: -1, soloRun: 0 };
const MAX_RUN = 2; // 同じものが続いてよい回数

// 分け方をくじ引きでえらぶ。同じ分け方が2回続いたあとは、ちがう分け方にする（3人以上は、お題の形で決まるので変わらない）
function freshLayout(level, count, wide) {
  let layout = pickLayout(level, count, wide);
  for (let i = 0; i < 12 && layout === LAST.layout && LAST.layoutRun >= MAX_RUN; i++) layout = pickLayout(level, count, wide);
  return layout;
}
function noteLayout(layout) {
  LAST.layoutRun = layout === LAST.layout ? LAST.layoutRun + 1 : 1;
  LAST.layout = layout;
}

// パートをくじ引きで当てる：順番をでたらめにまぜる。同じ人が同じパートに3回続けて当たるときだけ、まぜ直す
function shuffleParts(players) {
  let list = players.slice();
  for (let t = 0; t < 40; t++) {
    list = players.slice();
    for (let i = list.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [list[i], list[j]] = [list[j], list[i]];
    }
    if (!list.some((p, i) => LAST.parts[p.id] === i && (LAST.runs[p.id] || 0) >= MAX_RUN)) break;
  }
  return list;
}

function startRound() {
  G.starting = true;
  const ps = shuffleParts(G.players);
  const topic = nextTopic(G.room.difficulty, G.roomTopics); // まだ出ていないお題からえらぶ
  sendSigned('start', {
    id: crypto.randomUUID(), topic, count: ps.length, seconds: DRAW_SECONDS,
    layout: freshLayout(G.room.difficulty, ps.length, WIDE_TOPICS.has(parseTopic(topic).base)),
    order: ps.map((p) => ({ id: p.id, name: p.name })),
  });
  net.api.updateRoom(G.room, { status: 'playing', player_count: ps.length });
}

// ---------- メッセージ（署名つき） ----------
// 送る：中身に部屋の番号を入れ、種類と中身をまとめて署名する
async function sendSigned(type, data) {
  if (!G.chan || !G.room) return null;
  const body = JSON.stringify({ ...data, room: G.room.id });
  const sig = await me.sign(type + '\n' + body);
  return G.chan ? G.chan.send(type, { from: me.id, body, sig }) : null;
}

// 受け取る：届いた順に1つずつ確かめる
function onEvent(type, msg) {
  G.queue = G.queue.then(() => handleEvent(type, msg)).catch((err) => log('event error: ' + err));
}

async function handleEvent(type, msg) {
  if (!G.room || !msg || typeof msg.from !== 'string' || typeof msg.body !== 'string' || typeof msg.sig !== 'string') return;
  if (msg.body.length > 600000) return;
  const sender = G.keys.get(msg.from); // 本物と確かめた人からのメッセージだけを見る
  if (!sender || !(await verify(sender.key, type + '\n' + msg.body, msg.sig))) { log('rejected: bad signature or unknown sender'); return; }
  let d;
  try { d = JSON.parse(msg.body); } catch (e) { return; }
  if (!G.room || !d || d.room !== G.room.id) return; // ほかの部屋のメッセージの使い回しは受けつけない
  if (type === 'start') handleStart(d, msg.from);
  if (type === 'part') handlePart(d, msg.from);
}

// 「始める」の中身を確かめる：お題と分け方は決まった一覧の中だけ、参加者は本物と確かめた人だけ
function validStart(d, from) {
  if (typeof d.id !== 'string' || d.id.length > 64 || G.seenRounds.has(d.id)) return false;
  if (!Array.isArray(d.order) || d.order.length < 2 || d.order.length > MAX_PLAYERS || d.count !== d.order.length) return false;
  const ids = d.order.map((o) => (o && typeof o.id === 'string' ? o.id : ''));
  if (new Set(ids).size !== ids.length || !ids.every((id) => G.keys.has(id)) || !ids.includes(from)) return false;
  const parsed = parseTopic(d.topic); // お題は、決まった一覧（と、決まったことばの組み合わせ）の中だけ
  if (!parsed || parsed.level !== (G.room.difficulty === 'D' ? 'C' : G.room.difficulty)) return false; // 激辛のお題は、上級と同じ
  if (!layoutsFor(d.count).includes(d.layout)) return false;
  if (G.room.size && d.count !== cap()) return false; // 決めた人数で分ける
  return Number.isInteger(d.seconds) && d.seconds >= 5 && d.seconds <= 600;
}

function handleStart(d, from) {
  // 「始める」が2つ重なったとき（2人がほぼ同時に始めたとき）：全員が、番号（id）の小さいほうのラウンドに合わせる。
  // これがないと、人によって別々のラウンドになり、相手の絵が届かないまま「1/2人」で合体してしまう
  const cur = G.round;
  const swap = G.phase === 'intro' && !!cur && !cur.solo && typeof d.id === 'string' && d.id < cur.id;
  if (G.phase !== 'lobby' && !swap) return;
  if (!validStart(d, from)) { log('rejected: invalid start'); return; }
  if (swap) log(`start collision: switch ${cur.id} -> ${d.id}`);
  G.seenRounds.add(d.id);
  G.roomTopics.add(parseTopic(d.topic).base); // この部屋で出たお題。次からは出さない
  // 今回の分け方と、だれがどのパートかをおぼえる（次のラウンドで、同じ場所ばかりにならないようにする）
  noteLayout(d.layout);
  LAST.runs = Object.fromEntries(d.order.map((o, i) => [o.id, LAST.parts[o.id] === i ? (LAST.runs[o.id] || 1) + 1 : 1]));
  LAST.parts = Object.fromEntries(d.order.map((o, i) => [o.id, i]));
  const index = d.order.findIndex((o) => o.id === me.id);
  // 自分が入っていない、または自分が「準備OK」を押していないラウンドには参加しない
  if (index < 0 || (!G.ready && !swap)) {
    if (swap) lobbyScreen(); // 合わせる先のラウンドに自分が入っていない：部屋の画面へもどる
    G.busy = true; G.lobbySig = ''; renderLobby();
    return;
  }
  markTopic(d.topic);
  const nameOf = (o) => (G.players.find((p) => p.id === o.id) || {}).name || String(o.name == null ? '？' : o.name).slice(0, 12);
  beginRound({
    id: d.id, topic: d.topic, count: d.count, seconds: d.seconds, layout: d.layout,
    order: d.order.map((o) => ({ id: o.id })), myPart: index, owners: d.order.map(nameOf),
  });
}

// パート：送り主本人のパートだけを受けつける。最初に届いた1つだけを使う（あとから書きかえられない）
function handlePart(d, from) {
  const r = G.round;
  if (!r || r.solo || d.round !== r.id) return;
  const index = r.order.findIndex((o) => o.id === from);
  if (index < 0 || d.id !== from || d.part !== index) { log('rejected: part from wrong sender'); return; }
  if (G.done.has(from)) return;
  log(`part received: part=${d.part} ops=${Array.isArray(d.ops) ? d.ops.length : 'none'} phase=${G.phase}`);
  G.parts[index] = cleanOps(d.ops);
  G.done.add(from);
  if (G.phase === 'reveal') { stopReveal(); G.phase = 'wait'; revealScreen(); return; }
  updateWaitText();
  checkAllParts();
}

function lobbyScreen() {
  clearTimers();
  clearInterval(G.resend);
  G.round = null;
  G.phase = 'lobby';
  G.starting = false;
  G.lobbySig = '';
  track();
  renderLobby();
}

function renderLobby() {
  if (G.phase !== 'lobby' || !G.room) return;
  // 中身が同じなら作り直さない（お試しモードは1秒ごとに在席の知らせが来る）
  const sig = JSON.stringify([G.players.map((p) => [p.id, p.name, p.ready, p.phase]), G.ready, G.busy, G.room.id]);
  if (sig === G.lobbySig && $app.dataset.screen === 'lobby') return;
  G.lobbySig = sig;

  const lv = LEVELS[G.room.difficulty] || LEVELS.A;
  const seats = [];
  for (let i = 0; i < cap(); i++) {
    const p = G.players[i];
    const state = !p ? 'あいています' : p.phase !== 'lobby' ? 'おえかき中' : p.ready ? '準備OK' : 'まだ';
    seats.push(h('li', { class: 'podium' + (p ? '' : ' empty') + (p && p.ready ? ' ready' : ''), style: `--seat:${SEATS[i].color}` },
      h('div', { class: 'avatar' }, p ? face(i) : h('span', { class: 'q' }, '?')),
      h('div', { class: 'pname' }, p ? p.name : `${SEATS[i].name}の席`),
      p && p.id === me.id ? h('span', { class: 'you' }, 'あなた') : null,
      h('div', { class: 'lamp' }, p && p.ready ? icon('check') : null, state)));
  }
  const info = G.busy ? 'いまゲーム中です。次のラウンドから参加できます'
    : G.players.length < cap() ? `あと${cap() - G.players.length}人そろうと始められます（${cap()}人の部屋）`
      : '全員が「準備OK」を押すと始まります';
  const copyKey = async () => {
    try { await navigator.clipboard.writeText(G.room.code); toast('カギをコピーしました'); } catch (e) { toast('カギ：' + G.room.code); }
  };
  show('lobby',
    head(modeLabel() + 'の部屋'),
    h('p', { class: 'chips' }, h('span', { class: 'chip' }, '難易度：' + lv.label), h('span', { class: 'chip' }, `${G.players.length} / ${cap()} 人`)),
    G.room.code ? h('div', { class: 'ticket' }, h('small', {}, icon('key'), 'カギ（友だちに教えてね）'), h('b', { id: 'room-key' }, formatKey(G.room.code)),
      h('button', { class: 'tool', onclick: copyKey }, icon('copy'), 'コピー')) : null,
    h('ul', { class: 'podiums', style: `--n:${cap()};--m:${Math.min(3, cap())}` }, seats),
    h('p', { class: 'note', id: 'lobby-info', role: 'status' }, info),
    h('button', {
      class: 'btn primary' + (G.ready ? ' on' : ''), id: 'ready-btn',
      onclick: () => { G.ready = !G.ready; sfx(G.ready ? 'ready' : 'unready'); track(); renderLobby(); hostCheck(); },
    }, G.ready ? icon('check') : null, G.ready ? '準備OK！（押すと取り消し）' : '準備OK'),
    backButton(() => { leaveRoom(); titleScreen(); }),
  );
}

// 絵をシルエット（黒い影）にする：外がわから白をたどって、とどかない所を全部ぬりつぶす（白いごはんのような、絵の中の白もぬる）
function silhouette(cv) {
  const w = cv.width, hh = cv.height, c = cv.getContext('2d'), img = c.getImageData(0, 0, w, hh), d = img.data;
  const white = (i) => d[i * 4 + 3] < 40 || (d[i * 4] > 240 && d[i * 4 + 1] > 240 && d[i * 4 + 2] > 240);
  const outside = new Uint8Array(w * hh), stack = [];
  for (let x = 0; x < w; x++) stack.push(x, (hh - 1) * w + x);
  for (let y = 0; y < hh; y++) stack.push(y * w, y * w + w - 1);
  while (stack.length) {
    const i = stack.pop();
    if (outside[i] || !white(i)) continue;
    outside[i] = 1;
    const x = i % w;
    if (x > 0) stack.push(i - 1);
    if (x < w - 1) stack.push(i + 1);
    if (i >= w) stack.push(i - w);
    if (i < w * hh - w) stack.push(i + w);
  }
  for (let i = 0; i < w * hh; i++) {
    const k = i * 4;
    if (outside[i]) { d[k] = d[k + 1] = d[k + 2] = 255; d[k + 3] = 255; } else { d[k] = 26; d[k + 1] = 31; d[k + 2] = 60; d[k + 3] = 255; }
  }
  c.putImageData(img, 0, 0);
}

// ---------- シングル（CPUと合体） ----------
// 2つのパートのうち、片方だけを描く。もう片方は CPU が自動で描く（見本の絵の、そのパートの部分）
function startSolo() {
  const topic = nextTopic(G.level);
  markTopic(topic);
  // 分け方もパートも、くじ引き（半々）。同じがわが2回続いたあとだけ、反対がわにする
  const layout = freshLayout(G.level, 2, WIDE_TOPICS.has(parseTopic(topic).base));
  let myPart = Math.random() < 0.5 ? 0 : 1;
  if (myPart === LAST.soloPart && LAST.soloRun >= MAX_RUN) myPart = 1 - myPart;
  LAST.soloRun = myPart === LAST.soloPart ? LAST.soloRun + 1 : 1;
  LAST.soloPart = myPart;
  noteLayout(layout);
  beginRound({
    id: crypto.randomUUID(), topic, count: 2, layout, seconds: DRAW_SECONDS, solo: true, myPart,
    owners: myPart === 0 ? [me.name, 'CPU'] : ['CPU', me.name],
  });
}

// ---------- みんなで（1台を順番に回して描く） ----------
// 通信は使わない。1人目から順番に、自分のパートだけを描く。全員が描いたら合体する
function startLocal(count) {
  const topic = nextTopic(G.level);
  markTopic(topic);
  const layout = freshLayout(G.level, count, WIDE_TOPICS.has(parseTopic(topic).base));
  noteLayout(layout);
  beginRound({
    id: crypto.randomUUID(), topic, count, layout, seconds: DRAW_SECONDS, local: true, myPart: 0,
    owners: Array.from({ length: count }, (_, i) => `${i + 1}人目`),
  });
}
// 次の人に機器をわたす画面。「じゅんびOK」を押すまで、お題のほかは何も見せない
function handoffScreen() {
  const r = G.round;
  clearTimers();
  G.phase = 'handoff';
  G.pad = null;
  sfx('topic');
  show('handoff-' + r.myPart,
    head(`${r.owners[r.myPart]}の番`, r.myPart ? '次の人に、画面をわたしてね' : '最初の人から、順番に描くよ'),
    h('p', { class: 'lead' }, `${r.myPart + 1} / ${r.count} 人目`),
    h('p', { class: 'note' }, 'ほかの人は、画面を見ないでね。前の人の絵は、合体まで見えません'),
    h('button', { class: 'btn primary go', id: 'handoff-ok', onclick: () => { sfx('go'); introScreen(); } }, icon('check'), 'じゅんびOK'),
    r.myPart ? null : backButton(titleScreen),
  );
}

// ---------- ラウンド：お題 → 描く → 合体 ----------
function beginRound(round) {
  clearTimers();
  clearInterval(G.resend);
  G.round = round;
  G.layout = makeLayout(round.layout, round.count);
  // 見本を読みこんで、パートごとの範囲を出しておく（描く画面で「描ける範囲」として使う）
  const topicParts = parseTopic(round.topic) || { base: round.topic, mod: '' };
  const layoutNow = G.layout;
  round.targets = loadSample(topicParts.base, sampleFile(topicParts.base), sampleFlip(topicParts.base), topicParts.mod, topicDir(topicParts.base) === '左向き')
    .then((ops) => (ops ? samplePartLayers(layoutNow, ops) : null)).catch(() => null);
  G.parts = {};
  G.done = new Set();
  G.submitted = false;
  G.ready = false;
  G.seen = {};
  if (round.local) handoffScreen(); else introScreen();
}

// お題と、自分が描くパートを見せる（シングルでは、2つ目のパートの前にも出る）
function introScreen() {
  const r = G.round, regs = G.layout.regions;
  clearTimers();
  G.phase = 'intro';
  track();
  const preview = h('canvas', { class: 'preview', id: 'preview' });
  drawLayoutPreview(preview, G.layout, r.myPart);
  // お手本：最初の2秒だけ、シルエット（黒い影）で見せる。組み合わせお題では、ことばに合った飾りつきの絵
  const parsed = parseTopic(r.topic) || { base: r.topic, mod: '' };
  const modelCv = h('canvas', { width: 10, height: 10 });
  const model = h('figure', { class: 'intro-sample', id: 'intro-sample', hidden: true }, modelCv, h('figcaption', {}, keepSample() ? 'おてほん' : 'おてほん（2秒で消えます）'));
  if (!noSample()) loadSample(parsed.base, sampleFile(parsed.base), sampleFlip(parsed.base), parsed.mod, topicDir(parsed.base) === '左向き').then((ops) => {
    if (!ops || G.round !== r || G.phase !== 'intro') return;
    drawSample(modelCv, ops, 360);
    if (!keepSample()) silhouette(modelCv);
    model.hidden = false;
    if (!keepSample()) later(() => { model.style.visibility = 'hidden'; }, SAMPLE_MS); // 場所はあけたままにする（画面がガタッと動かないように）
  });
  sfx('topic');
  show('intro-' + r.myPart,
    h('div', { class: 'spots', 'aria-hidden': 'true' }, h('i', {}), h('i', {})),
    board(r.topic, false),
    model,
    h('div', { class: 'brief' }, preview,
      h('div', {}, h('p', { class: 'lead' }, 'あなたが描くのは'), h('p', { class: 'part-name' }, `「${regs[r.myPart].label}」`),
        h('p', { class: 'note', id: 'layout-name' }, `分け方：${LAYOUT_NAMES[G.layout.id]}（${r.count}つに分ける）`))),
    h('div', { class: 'fuse', 'aria-hidden': 'true' }, h('i', { style: `animation-duration:${INTRO_MS}ms` })),
    h('p', { class: 'note' }, r.solo ? 'もう片方は、CPUが描きます（合体まで見えません）' : 'ほかのパートは、合体まで見えません'),
    h('p', { class: 'note tip' }, (keepSample() ? 'お手本は、描いている間も見られます。' : noSample() ? '激辛：お手本は出ません。' : 'お手本の形をよく見ておぼえよう。') + '絵のはしを、金色の点線の上の2つの〇に合わせると、となりの絵とつながります'),
  );
  later(drawScreen, INTRO_MS);
}

// キャンバスを入れるわく。形（横÷たて）に合わせて大きさが変わる
function easelFor(canvas, ratio, scroll) {
  return h('div', { class: 'easel' + (scroll && ratio < 0.75 ? ' tall' : ''), style: `--ratio:${ratio}` }, canvas);
}

function drawScreen() {
  const r = G.round, regs = G.layout.regions;
  G.phase = 'draw';
  track();
  sfx('go');
  const canvas = h('canvas', { class: 'pad', id: 'pad' });
  const timer = h('b', { id: 'timer' }, '');
  const bar = h('i', {});
  const clock = h('div', { class: 'clock' }, icon('clock'), timer, h('span', { class: 'timebar' }, bar));
  // つなぎめに出すひとこと（となりのパートの名前）
  const pad = new Pad(canvas, G.layout, r.myPart, {
    prev: r.myPart > 0 ? `「${regs[r.myPart - 1].label}」の絵とつながる線` : '',
    next: r.myPart < r.count - 1 ? `「${regs[r.myPart + 1].label}」の絵とつながる線` : '',
  });
  G.pad = pad;
  // 描ける範囲：見本の絵がある範囲（少し余白つき）だけに描ける。全員が同じ大きさ・位置で描けるようにする
  r.targets.then((t) => {
    const mine = t && t[r.myPart];
    if (USE_BOX && G.round === r && G.pad === pad && mine && mine.box) pad.setLimit(mine.box);
    if (USE_MARKS && G.round === r && G.pad === pad) pad.setMarks(seamMarks(G.layout, t)); // つなぎめの〇
  });

  function mark(el, group) {
    el.closest('.tools').querySelectorAll(group).forEach((x) => { x.classList.remove('on'); x.setAttribute('aria-pressed', 'false'); });
    el.classList.add('on');
    el.setAttribute('aria-pressed', 'true');
  }
  // 道具：ペン／ぬりつぶし／消しゴム
  const toolButtons = [['pen', 'pen', 'ペン'], ['fill', 'bucket', 'ぬりつぶし'], ['eraser', 'eraser', '消しゴム']].map(([id, ic, name]) => h('button', {
    class: 'tool t' + (id === pad.tool ? ' on' : ''), id: 'tool-' + id, 'aria-pressed': id === pad.tool ? 'true' : 'false',
    onclick: (e) => { pad.tool = id; mark(e.currentTarget, '.tool.t'); },
  }, icon(ic), name));
  const colorButtons = COLORS.map((c) => h('button', {
    class: 'swatch' + (c === pad.color ? ' on' : ''), style: `--sw:${c}`, 'aria-label': '色 ' + COLOR_NAMES[c], title: COLOR_NAMES[c], 'aria-pressed': c === pad.color ? 'true' : 'false',
    onclick: (e) => {
      pad.color = c;
      mark(e.currentTarget, '.swatch');
      if (pad.tool === 'eraser') { pad.tool = 'pen'; mark(toolButtons[0], '.tool.t'); } // 色をえらんだら、消しゴムをやめる
    },
  }));
  const widthButtons = WIDTHS.map(([name, w]) => h('button', {
    class: 'tool w' + (w === pad.width ? ' on' : ''), 'aria-label': 'ペンの太さ ' + name, 'aria-pressed': w === pad.width ? 'true' : 'false',
    onclick: (e) => { pad.width = w; mark(e.currentTarget, '.tool.w'); },
  }, h('i', { class: 'dot', style: `--d:${Math.round(6 + w * 0.7)}px` }), name));

  const endAt = Date.now() + r.seconds * 1000;
  G.endAt = endAt;
  let lastLeft = -1;
  const tick = () => {
    const ms = Math.max(0, endAt - Date.now());
    const left = Math.ceil(ms / 1000);
    timer.textContent = `のこり ${left} 秒`;
    bar.style.width = (ms / (r.seconds * 1000) * 100).toFixed(1) + '%';
    if (left !== lastLeft) {
      lastLeft = left;
      clock.classList.toggle('hurry', left <= 10);
      if (left <= 5 && left > 0) sfx('tick');
    }
    if (left <= 0) submitPart();
  };

  // 初級：お手本を、色つきのまま、ずっと出しておく（押すと大きくなる）
  let guide = null;
  if (keepSample()) {
    const guideCv = h('canvas', { width: 10, height: 10 });
    guide = h('figure', { class: 'sample', id: 'draw-sample', hidden: true, title: '押すと大きくなる', onclick: (e) => e.currentTarget.classList.toggle('big') }, guideCv, h('figcaption', {}, 'おてほん'));
    const parsed = parseTopic(r.topic) || { base: r.topic, mod: '' };
    loadSample(parsed.base, sampleFile(parsed.base), sampleFlip(parsed.base), parsed.mod, topicDir(parsed.base) === '左向き').then((ops) => {
      if (!ops || G.round !== r || G.pad !== pad) return;
      drawSample(guideCv, ops, 300);
      guide.hidden = false;
    });
  }
  const b = regs[r.myPart].bbox;
  show('draw-' + r.myPart,
    board(r.topic, true),
    h('div', { class: 'row' }, h('span', { class: 'chip gold' }, `あなたは「${regs[r.myPart].label}」`), clock),
    guide,
    easelFor(canvas, b.w / b.h),
    h('div', { class: 'tools' },
      h('div', { class: 'toolrow' }, toolButtons),
      h('div', { class: 'toolrow' }, colorButtons),
      h('div', { class: 'toolrow' }, widthButtons,
        h('button', { class: 'tool', onclick: () => pad.undo() }, icon('undo'), '1つもどす'),
        h('button', { class: 'tool', onclick: () => pad.clear() }, icon('trash'), '全部消す'))),
    h('p', { class: 'note', id: 'wait-text', role: 'status' }, (USE_BOX ? '明るい四角の中に描こう。' : '') + (USE_MARKS ? '金色の点線が、となりの絵とのつなぎめ。絵のはしを、2つの〇に合わせよう' : '金色の点線が、となりの絵とのつなぎめ。線を点線までのばそう')),
    h('button', { class: 'btn primary go', id: 'done-btn', onclick: submitPart }, icon('check'), 'できた！'),
  );
  tick();
  every(tick, 250);
}

function submitPart() {
  if (G.submitted || !G.pad) return;
  G.submitted = true;
  const r = G.round;
  const ops = cleanOps(G.pad.getOps());
  G.pad.enabled = false;
  clearTimers();
  sfx('done');
  G.parts[r.myPart] = ops;
  if (r.solo) { revealScreen(); return; } // シングル：すぐ合体へ（もう片方は CPU が描く）
  if (r.local) { // みんなで：次の人へ。最後の人が描き終わったら合体
    if (r.myPart < r.count - 1) { r.myPart++; G.submitted = false; handoffScreen(); } else revealScreen();
    return;
  }
  G.phase = 'wait';
  track();
  const btn = document.getElementById('done-btn');
  if (btn) btn.remove();
  G.done.add(me.id);
  const timerEl = document.getElementById('timer');
  if (timerEl) timerEl.textContent = '完成！';
  $app.classList.add('waiting');
  log(`part sent: part=${r.myPart} ops=${ops.length}`);
  // 1回だけの送信は、接続が一瞬切れていると届かない。3秒ごとに送り直す（最低8回、全員ぶんがそろうまで最大40回）
  let tries = 0;
  const sendPart = () => {
    // 自分は全員ぶんを持っていても、相手に届いていないことがある。最低8回は送る
    if (!G.chan || G.round !== r || tries >= 40 || (tries >= 8 && G.done.size >= r.order.length)) return;
    tries++;
    sendSigned('part', { round: r.id, id: me.id, part: r.myPart, ops })
      .then((res) => log(`part send #${tries}: ${JSON.stringify(res)}`), (err) => log('part send error: ' + err));
  };
  sendPart();
  G.resend = setInterval(sendPart, 3000);
  updateWaitText();
  every(checkAllParts, 1000);
  // 時間切れから6秒たっても全員ぶんがそろわなければ、あるぶんだけで合体する
  later(revealScreen, Math.max(0, G.endAt - Date.now()) + 6000);
  checkAllParts();
}

function updateWaitText() {
  const el = document.getElementById('wait-text');
  if (!el || !G.round || G.round.solo || !G.submitted) return;
  el.textContent = `ほかの人を待っています（${G.done.size} / ${G.round.order.length} 人が完成）`;
}

// 全員ぶんがそろったら合体へ。15秒以上いなくなった人のパートは待たない
// （Supabase の Presence は、状態を更新した一瞬だけ一覧から消えることがある）
function checkAllParts() {
  const r = G.round;
  if (!r || r.solo || !G.submitted || G.phase === 'reveal') return;
  const now = Date.now();
  const needed = r.order.filter((o) => G.done.has(o.id) || !G.seen[o.id] || now - G.seen[o.id] < 15000);
  if (needed.every((o) => G.done.has(o.id))) revealScreen();
}

// 点数（合体スコア）：合体した絵から4つの数値（接続 C・カラフル V・描きこみ D・バランス B）を出して、難易度ごとの重みで足す。
// 見本とはくらべない。重みは、合わせて 1 になるようにする。
//   初級：描きこみとバランス（がんばって描いたか）を重く。上級：接続（つなぎめが合っているか）を重く。激辛：描きこみとバランスを重く
const SCORE_WEIGHTS = {
  A: { C: 0.20, V: 0.20, D: 0.30, B: 0.30 },
  B: { C: 0.35, V: 0.25, D: 0.20, B: 0.20 },
  C: { C: 0.50, V: 0.20, D: 0.15, B: 0.15 },
  D: { C: 0.30, V: 0.10, D: 0.30, B: 0.30 }, // 激辛：描きこみとバランスを重く見る
};
const BEST_KEY = 'oekaki_best_score2';
function rankWord(score) {
  if (score >= 100) return 'パーフェクト！！';
  if (score >= 90) return 'すごい合体！！';
  if (score >= 80) return 'いい合体！';
  if (score >= 65) return 'なかなか！';
  if (score >= 45) return 'おしい！';
  if (score >= 25) return 'ふんいきは出てる！';
  return '新しい生き物が誕生！';
}

function revealScreen() {
  if (G.phase === 'reveal') return;
  const r = G.round, regs = G.layout.regions;
  log(`reveal: parts=${Object.keys(G.parts).map((k) => k + ':' + G.parts[k].length).join(',')} done=${G.done.size}`);
  clearTimers();
  $app.classList.remove('waiting');
  G.phase = 'reveal';
  track();
  const parts = [];
  for (let i = 0; i < r.count; i++) parts.push(G.parts[i] || []);
  const seatColor = (i) => (r.solo ? (r.owners[i] === 'CPU' ? '#b9c2e6' : SEATS[0].color) : SEATS[i % SEATS.length].color);
  const canvas = h('canvas', { class: 'pad', id: 'result' });
  const status = h('p', { class: 'merging', id: 'reveal-status', role: 'status' }, '合体中…');
  const caption = h('p', { class: 'chips', id: 'caption' },
    r.owners.map((name, i) => h('span', { class: 'chip', style: `--seat:${seatColor(i)}` }, h('i', { class: 'dot' }), `${regs[i].label}：${name}`)));
  // 点数（合体スコア）。合体が終わったら出す
  const scoreNum = h('b', { id: 'score' }, '0');
  const rank = h('em', { id: 'rank' }, '');
  const scoreNote = h('p', { class: 'note', id: 'score-note' }, '');
  const scoreBox = h('div', { class: 'scorebox', id: 'scorebox', hidden: true },
    h('small', { id: 'score-label' }, '合体スコア'), h('span', { class: 'points' }, scoreNum, '点'), rank);
  // 見本（おてほん）。合体が終わったら、絵の左上に出す
  // 絵のファイルは、ここで読みこむ（合体のアニメーションの間に読み終わる）。組み合わせお題では、ことばに合った飾りをつけた見本を出す
  const parsed = parseTopic(r.topic) || { base: r.topic, mod: '' };
  const base = parsed.base;
  const sampleCv = h('canvas', {});
  let sampleReady = false;
  let scoreLabel = '合体スコア', sampleOpsAll = null;
  const isLeft = topicDir(base) === '左向き';
  let alternates = []; // 見本のほかに「これでも正解」とする絵（リボンを首につけた絵、飾りなしの絵）
  let targets = null; // 見本の、パートごとの絵と範囲（合体で大きさを合わせる先。点数もパートごとにくらべる）
  const sampleLoaded = loadSample(base, sampleFile(base), sampleFlip(base), parsed.mod, isLeft).then(async (ops) => {
    if (ops) { drawSample(sampleCv, ops, 300); sampleReady = true; sampleOpsAll = ops; }
    if (ops && parsed.mod) alternates = await loadAlternates(base, sampleFile(base), sampleFlip(base), parsed.mod, isLeft);
    if (ops) targets = samplePartLayers(G.layout, ops); // 見本の、パートごとの絵と範囲
    return ops;
  });
  // 押すと大きくなる（もう一度押すと小さくなる）
  const sampleBox = h('figure', { class: 'sample', id: 'sample', hidden: true, title: '押すと大きくなる', onclick: (e) => e.currentTarget.classList.toggle('big') }, sampleCv, h('figcaption', {}, 'おてほん'));

  let finalScore = null;
  // Xでシェア：お題と点数とハッシュタグとサイトのURLを入れる（なまえは入れない）
  const shareText = () => `お題「${r.topic}」を分けて描いて合体したら、こうなった。${finalScore == null ? '' : `${scoreLabel} ${finalScore}点！`}\n#お絵かき合体`;
  const xPostUrl = () => 'https://x.com/intent/post?text=' + encodeURIComponent(shareText() + '\n') + '&url=' + encodeURIComponent(SITE_URL);
  let cardBlob = null; // シェア用の画像。合体が終わったら先に作っておく
  const buttons = h('div', { class: 'actions' },
    h('button', { class: 'btn', onclick: saveImage }, icon('save'), '画像を保存'),
    // スマホ：共有の一覧を出す（絵つき）。パソコン：手順の窓を出す（絵をコピー → X を開く → 貼りつけ）
    h('button', { class: 'btn share', id: 'share-btn', onclick: IS_PHONE ? sharePhone : openShareDialog }, icon('x'), 'Xでシェア'),
    h('button', { class: 'btn primary', id: 'again-btn', onclick: () => { stopReveal(); if (r.solo) startSolo(); else if (r.local) startLocal(r.count); else lobbyScreen(); } }, icon('again'), 'もう一回'),
    h('button', { class: 'btn ghost', onclick: () => { stopReveal(); if (!r.solo && !r.local) leaveRoom(); titleScreen(); } }, icon('home'), 'やめる'));
  const easel = easelFor(canvas, G.layout.w / G.layout.h, true);
  show('reveal', board(r.topic, true), status, scoreBox, scoreNote, easel, sampleBox, caption, buttons, DEBUG ? h('pre', { class: 'dbg', id: 'dbg' }, '') : null);
  sfx('merge');
  // 合体が終わったら：見本とくらべて点数を出す
  const finish = (result) => {
    if (G.round !== r || G.phase !== 'reveal' || !G.reveal) return;
    // 点数：見本にどれだけ近いか。見本がないときだけ、つながり度を点数にする
    // シングル：自分が描いたパートだけを、見本の同じパートとくらべる（CPU のパートは見本そのものなので、点数に入れない）
    // 組み合わせお題：飾りの場所は人によってちがう（リボンは耳にも首にも尻尾にもつける）ので、
    // 「これでも正解」の絵ともくらべて、いちばん高い点数を使う
    // 点数：合体した絵から4つの数値を出して、難易度ごとの重みで足す（見本とはくらべない）。
    // シングル：色と描きこみは、自分が描いたパートだけで数える（CPU のパートは見本そのものなので）。何も描いていなければ0点
    const parts4 = scoreCVDB(G.reveal.toCanvas(), G.reveal.partCanvases(), G.layout, r.solo ? [r.myPart] : null);
    const wts = SCORE_WEIGHTS[G.level] || SCORE_WEIGHTS.B;
    finalScore = parts4.empty ? 0 : Math.round(100 * (wts.C * parts4.C + wts.V * parts4.V + wts.D * parts4.D + wts.B * parts4.B));
    result.parts4 = parts4;
    status.textContent = '合体！';
    status.className = 'stamp';
    easel.classList.add('flash');
    sfx('fanfare');
    confetti();
    if (sampleReady) sampleBox.hidden = false;
    // 点数を 0 から数え上げる
    scoreBox.hidden = false;
    const began = Date.now();
    const count = setInterval(() => {
      const t = Math.min(1, (Date.now() - began) / 900);
      scoreNum.textContent = String(Math.round(finalScore * t));
      if (t >= 1) { clearInterval(count); celebrate(); }
    }, 30);
    G.timers.push(count);
    rank.textContent = rankWord(finalScore);
    let best = 0;
    try { best = parseInt(localStorage.getItem(BEST_KEY), 10) || 0; } catch (e) { /* なくてもよい */ }
    const pt = (x) => Math.round(100 * x);
    const joint = `つながり${pt(parts4.C)}・カラフル${pt(parts4.V)}・描きこみ${pt(parts4.D)}・バランス${pt(parts4.B)}　`;
    if (finalScore > best) {
      try { localStorage.setItem(BEST_KEY, String(finalScore)); } catch (e) { /* 保存できなくてもよい */ }
      scoreNote.textContent = joint + (best ? `自己ベスト更新！（前は ${best}点）` : 'これが最初の記録！');
    } else {
      scoreNote.textContent = joint + `自己ベスト：${best}点`;
    }
    makeBlob().then((blob) => { cardBlob = blob; }).catch(() => {});
    if (DEBUG) showDebug(result);
  };
  // 特別な演出：90点以上は花火と効果音。100点は全画面の演出（終わったら花火）。点数を数え終わってから出す
  // 確認用：アドレスに ?fx=90 や ?fx=100 をつけると、点数に関係なく演出だけを出せる（点数と記録は変わらない）
  let celebrated = false;
  const celebrate = () => {
    if (celebrated || G.round !== r || G.phase !== 'reveal' || !G.reveal) return;
    celebrated = true;
    const forced = parseInt(new URLSearchParams(location.search).get('fx'), 10);
    const level = Number.isFinite(forced) ? forced : finalScore;
    const boom = () => { if (G.round === r && G.phase === 'reveal') { sfx('fireworks'); fireworks(); } };
    if (level >= 100) { sfx('jackpot'); jackpot(G.reveal.toCanvas(), boom); }
    else if (level >= 90) boom();
  };
  // 確認用（アドレスに ?debug をつけたときだけ）：合体でどの方法を使ったかを、絵の下に文字で出す。
  // 「この回のデータを保存」で、描いた線のデータをファイルにできる（ずれの原因を、同じ絵で調べるため）
  const showDebug = (result) => {
    const ver = new URL(import.meta.url).searchParams.get('v') || '（なし）';
    const span = (x) => (x ? `${Math.round(x[0])}〜${Math.round(x[1])}` : 'なし');
    const q = result.parts4 || {};
    const lines = [`版：${ver}`, `点数：接続C=${(q.C || 0).toFixed(2)} カラフルV=${(q.V || 0).toFixed(2)}（色${q.kinds || 0}種類） 描きこみD=${(q.D || 0).toFixed(2)}（ぬった割合${Math.round(100 * (q.frac || 0))}%） バランスB=${(q.B || 0).toFixed(2)}／難易度=${G.level}`, `合体のしかた：${result.simple ? 'シンプル（描いたまま並べる）' : '見本に合わせる'}`, `お題：${r.topic}／分け方：${G.layout.id}／人数：${r.count}／自分のパート：${r.myPart}${r.solo ? '（シングル）' : ''}`, `見本の読みこみ：${result.hasTargets ? 'できた' : 'できていない'}`];
    (result.regInfo || []).forEach((g, i) => {
      if (!g) { lines.push(`パート${i}：動かしていない`); return; }
      lines.push(`パート${i}：方法＝${g.how}${g.idle ? '（もう合っていた）' : ''}　自分の体＝${span(g.ub)}　見本の体＝${span(g.tb)}　合わせた範囲＝${span(g.from)} → ${span(g.to)}　倍率＝横${g.su}・たて${g.sv}　すきま＝${g.gap || 0}`);
      lines.push(`　　絵の範囲＝${g.A.join(',')}　見本の範囲＝${g.T.join(',')}${g.P === undefined ? '' : `　つなぎめに届く範囲＝${span(g.P)}`}`);
    });
    (result.joints || []).forEach((j, k) => {
      lines.push(`つなぎめ${k}：手前＝${span([j.A.a, j.A.b])}　向こう＝${span([j.B.a, j.B.b])}　大きさを変えない＝${j.locked ? 'はい' : 'いいえ'}　細かい合わせ＝${j.warp || 'なし'}　目印＝${(j.mA || []).map(Math.round).join(',')}｜${(j.mB || []).map(Math.round).join(',')}`);
    });
    const box = document.getElementById('dbg');
    if (!box) return;
    box.textContent = lines.join('\n');
    const save = h('button', { class: 'btn ghost', onclick: () => {
      const data = { v: ver, topic: r.topic, layout: G.layout.id, count: r.count, myPart: r.myPart, solo: !!r.solo, parts };
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' }));
      a.download = `oekaki-round-${Date.now()}.json`;
      a.click();
    } }, 'この回のデータを保存');
    box.after(save);
  };
  const begin = () => {
    if (G.round !== r || G.phase !== 'reveal') return; // 読みこみの間に、ほかの画面へ行っていた
    G.reveal = startReveal(canvas, G.layout, parts, {
      simple: SIMPLE_MERGE,
      marks: USE_MARKS ? seamMarks(G.layout, targets) : null, // つなぎめの〇に、絵のはしを合わせる
      instant: true, // 描くところ（消しゴム・やり直し）は見せない。できあがった絵だけを合体する
      limit: USE_BOX, // 描いたときと同じにする（四角を使わないなら、合体でも使わない）
      targets,
      cpuPart: r.solo ? 1 - r.myPart : undefined, // シングル：CPU のパート（見本そのもの）
      onFit: () => { status.textContent = 'つなげています…'; },
      onDone: (result) => { sampleLoaded.then(() => finish(result), () => finish(result)); },
    });
  };
  if (r.solo) {
    // シングル：CPU のパートは、見本の絵のその部分（パートの範囲の外は、自動で切り取られる）
    sampleLoaded.then((ops) => { parts[1 - r.myPart] = ops || []; begin(); }, begin);
  } else sampleLoaded.then(begin, begin); // 見本を読みこんでから始める（大きさを合わせる先として使う）

  // スマホ・タブレット：絵の画像つきで共有する（出てきた一覧から X をえらぶ）
  async function sharePhone() {
    try {
      const blob = cardBlob || await makeBlob();
      const file = new File([blob], 'oekaki-gattai.png', { type: 'image/png' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], text: `${shareText()}\n${SITE_URL}` });
        return;
      }
    } catch (err) {
      if (err && err.name === 'AbortError') return; // 共有をやめた
    }
    window.open(xPostUrl(), '_blank', 'noopener,noreferrer'); // 共有の一覧が使えないときは X を開く
  }

  // パソコン：X の投稿用リンクには絵をつけられない（X の決まり）。
  // そこで、絵をクリップボードにコピーしてから X を開き、投稿画面で貼りつけてもらう。
  // 手順が分かるように、3つのステップを書いた窓を出す
  function openShareDialog() {
    const dlg = h('dialog', { class: 'share-dialog', 'aria-label': 'Xでシェア' });
    const state = h('p', { class: 'step-state', role: 'status' }, '絵をコピーしています…');
    const img = h('img', { class: 'share-preview', alt: 'シェアする絵' });
    const blobReady = cardBlob ? Promise.resolve(cardBlob) : makeBlob();
    blobReady.then((blob) => { img.src = URL.createObjectURL(blob); }).catch(() => {});

    const copy = async () => {
      try {
        if (!navigator.clipboard || !window.ClipboardItem) throw new Error('unsupported');
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': cardBlob || blobReady })]);
        state.textContent = '絵をコピーしました';
        state.className = 'step-state ok';
      } catch (err) {
        state.textContent = 'コピーできませんでした。「画像を保存」を押して、Xの投稿画面でその画像をえらんでください';
        state.className = 'step-state ng';
      }
    };
    const pasteKey = /Mac/i.test(navigator.userAgent) ? '⌘（コマンド）+ V' : 'Ctrl + V';

    dlg.append(
      h('h3', {}, 'Xでシェア'),
      img,
      h('ol', { class: 'steps' },
        h('li', {}, h('b', {}, '絵をコピーする'), state,
          h('span', { class: 'toolrow' },
            h('button', { class: 'tool', onclick: copy }, icon('copy'), 'もう一度コピー'),
            h('button', { class: 'tool', onclick: saveImage }, icon('save'), '画像を保存'))),
        h('li', {}, h('b', {}, 'Xの投稿画面を開く'),
          h('a', { class: 'btn share', id: 'open-x', href: xPostUrl(), target: '_blank', rel: 'noopener noreferrer' }, icon('x'), 'Xを開く')),
        h('li', {}, h('b', {}, `投稿画面で ${pasteKey} を押す`),
          h('p', { class: 'note' }, '絵が貼りつきます。そのまま投稿してください'))),
      h('button', { class: 'btn ghost', onclick: () => dlg.close() }, 'とじる'),
    );
    dlg.addEventListener('close', () => { if (img.src) URL.revokeObjectURL(img.src); dlg.remove(); });
    document.body.append(dlg);
    dlg.showModal();
    copy(); // 窓を開いたときに、まず1回コピーする
  }

  function makeBlob() {
    return resultCard().then((card) => new Promise((resolve) => card.toBlob(resolve, 'image/png')));
  }

  // 保存・シェアする画像：絵に、ゲームの背景・タイトル・お題・点数・見本・描いた人をつけたもの（card.js）
  function resultCard() {
    return makeCard(G.reveal.toCanvas(), r.topic,
      r.owners.map((name, i) => ({ text: `${regs[i].label}：${name}`, color: seatColor(i) })),
      { score: finalScore, scoreLabel, sample: sampleReady ? sampleCv : null });
  }

  async function saveImage() {
    const card = await resultCard();
    const a = h('a', { href: card.toDataURL('image/png'), download: `oekaki-gattai-${r.topic}.png` });
    document.body.append(a);
    a.click();
    a.remove();
  }
}

function stopReveal() { stopFx(); if (G.reveal) { G.reveal.stop(); G.reveal = null; } }

// 受け取った絵（線とぬりつぶし）を確かめる。形がおかしいものは捨てる
function cleanOps(ops) {
  if (!Array.isArray(ops)) return [];
  const out = [];
  let points = 0, fills = 0;
  for (const s of ops.slice(0, 3000)) {
    if (!s || typeof s.c !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(s.c)) continue;
    if (s.f) { // ぬりつぶし：1パートで60回まで（多すぎると合体が重くなる）
      if (!Number.isFinite(s.x) || !Number.isFinite(s.y) || fills >= 60) continue;
      fills++;
      out.push({ f: 1, c: s.c, x: Math.round(s.x), y: Math.round(s.y) });
      continue;
    }
    if (!Array.isArray(s.p) || s.p.length < 2 || s.p.length % 2 || s.p.length > 20000) continue;
    if (!s.p.every((v) => Number.isFinite(v))) continue;
    points += s.p.length / 2;
    if (points > 40000) break; // 大きすぎる絵で画面が固まらないようにする
    out.push({ c: s.c, w: Math.min(90, Math.max(1, Number(s.w) || 10)), e: s.e ? 1 : 0, p: s.p });
  }
  return out;
}

// ---------- はじめに1回だけ ----------
saveName(loadName());
// 音のオン／オフのボタン（右上にいつも出す）
const muteBtn = h('button', { class: 'mute', onclick: () => { setMuted(!isMuted()); paintMute(); sfx('tap'); } });
function paintMute() {
  muteBtn.replaceChildren(icon(isMuted() ? 'soundOff' : 'soundOn'));
  muteBtn.setAttribute('aria-label', isMuted() ? '音を出す' : '音を消す');
  muteBtn.setAttribute('aria-pressed', isMuted() ? 'true' : 'false');
}
paintMute();
document.body.append(muteBtn);
// ボタンを押したときの音（専用の音があるボタンは、その音が重なって鳴る）
document.addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (b && !b.classList.contains('mute') && !b.classList.contains('ghost') && b.id !== 'ready-btn' && b.id !== 'done-btn') sfx('tap');
});
startBackdrop();
net.warm();
window.addEventListener('pagehide', () => { if (G.chan) leaveRoom(); });
// 自分の鍵を作る（対戦とフレンドで使う）。作れないブラウザでも、シングルは遊べる
try {
  Object.assign(me, await createIdentity());
} catch (err) {
  console.warn('identity', err);
  me.id = crypto.randomUUID ? crypto.randomUUID() : String(Math.random());
}
titleScreen();
