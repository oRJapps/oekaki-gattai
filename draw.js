// draw.js
// 線を描くキャンバス、分け方（レイアウト）、合体のアニメーション。
// 座標はすべて 1000×1000。線の形式：{ c: 色, w: 太さ, e: 消しゴムなら1, p: [x0, y0, x1, y1, ...] }
// パートの範囲（region）：{ path: Path2D, label: 名前, cx, cy: 名前を書く位置 }

export const SIZE = 1000;
const MAX_POINTS = 6000; // 1パートで送る点の上限（通信量をおさえる）

// ---------- 分け方 ----------
// 難易度ごとの分け方。初級はまっすぐ、中級はななめやマス目、上級はギザギザや放射状。
// レイアウトの名前（id）はホストが選んで全員に送る。同じ id と人数なら、だれの画面でも同じ形になる。
const POOLS = {
  A: { 2: ['rows', 'cols'], 3: ['rows', 'cols'], 4: ['rows', 'cols'] },
  B: { 2: ['diag', 'diagR'], 3: ['tee', 'ell', 'diag'], 4: ['grid', 'diag', 'diagR'] },
  C: { 2: ['zigRows', 'zigCols', 'ring'], 3: ['wye', 'zigRows', 'zigCols'], 4: ['cross', 'zigRows', 'zigCols'] },
};

export const LAYOUT_NAMES = {
  rows: '横に分ける（上から順）', cols: '縦に分ける（左から順）',
  diag: 'ななめに分ける', diagR: 'ななめに分ける（逆向き）',
  tee: '上と、下の左右', ell: '左と、右の上下', grid: '田の字',
  zigRows: 'ギザギザの横', zigCols: 'ギザギザの縦', ring: 'まんなかと外側',
  wye: 'Y字に3つ', cross: '×字に4つ',
};

export function pickLayout(level, count) {
  const pool = (POOLS[level] || POOLS.A)[Math.min(4, Math.max(2, count))];
  return pool[Math.floor(Math.random() * pool.length)];
}

const orderLabels = (n, first, last, unit) => {
  if (n === 2) return [first, last];
  if (n === 3) return [first, 'まんなか', last];
  return Array.from({ length: n }, (_, i) => `${unit}${i + 1}番目`);
};

function polyRegion(points, label) {
  const path = new Path2D();
  points.forEach(([x, y], i) => (i ? path.lineTo(x, y) : path.moveTo(x, y)));
  path.closePath();
  // 名前を書く位置：面積で見た重心（頂点の平均だと、ギザギザの側に寄ってしまう）
  let area = 0, cx = 0, cy = 0;
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i], [x2, y2] = points[(i + 1) % points.length];
    const k = x1 * y2 - x2 * y1;
    area += k;
    cx += (x1 + x2) * k;
    cy += (y1 + y2) * k;
  }
  return { path, label, cx: cx / (3 * area), cy: cy / (3 * area) };
}

// 多角形を、a*x + b*y <= c の側だけ残して切る
function cutPoly(points, a, b, c) {
  const out = [];
  for (let i = 0; i < points.length; i++) {
    const p = points[i], q = points[(i + 1) % points.length];
    const dp = a * p[0] + b * p[1] - c, dq = a * q[0] + b * q[1] - c;
    if (dp <= 0) out.push(p);
    if ((dp < 0 && dq > 0) || (dp > 0 && dq < 0)) {
      const t = dp / (dp - dq);
      out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
    }
  }
  return out;
}

const SQUARE = [[0, 0], [SIZE, 0], [SIZE, SIZE], [0, SIZE]];
const flipX = (points) => points.map(([x, y]) => [SIZE - x, y]).reverse();
const swapXY = (points) => points.map(([x, y]) => [y, x]).reverse();

// ななめの帯。どのパートも同じ広さになるように境目を決める
function diagBands(n) {
  const cut = (f) => (f <= 0.5 ? Math.sqrt(2 * f) * SIZE : 2 * SIZE - Math.sqrt(2 * (1 - f)) * SIZE);
  const bands = [];
  for (let i = 0; i < n; i++) {
    let poly = SQUARE;
    if (i > 0) poly = cutPoly(poly, -1, -1, -cut(i / n));
    if (i < n - 1) poly = cutPoly(poly, 1, 1, cut((i + 1) / n));
    bands.push(poly);
  }
  return bands;
}

// 横の帯。zig が true なら境目をギザギザにする
function rowBands(n, zig) {
  const edge = (i) => {
    const base = SIZE * i / n;
    if (!zig || i === 0 || i === n) return [[0, base], [SIZE, base]];
    const pts = [];
    for (let k = 0; k <= 10; k++) pts.push([k * 100, base + (k % 2 ? 45 : -45)]);
    return pts;
  };
  const bands = [];
  for (let i = 0; i < n; i++) bands.push([...edge(i), ...edge(i + 1).slice().reverse()]);
  return bands;
}

export function makeLayout(id, count) {
  const n = Math.min(4, Math.max(1, count));
  const named = (polys, labels) => polys.map((p, i) => polyRegion(p, labels[i]));
  if (n === 1) return named([SQUARE], ['全部']);
  const rowL = orderLabels(n, '上', '下', '上から'), colL = orderLabels(n, '左', '右', '左から');
  const C = [500, 500];
  switch (id) {
    case 'cols': return named(rowBands(n, false).map(swapXY), colL);
    case 'zigRows': return named(rowBands(n, true), rowL);
    case 'zigCols': return named(rowBands(n, true).map(swapXY), colL);
    case 'diag': return named(diagBands(n), orderLabels(n, '左上', '右下', '左上から'));
    case 'diagR': return named(diagBands(n).map(flipX), orderLabels(n, '右上', '左下', '右上から'));
    case 'tee': if (n === 3) return named([[[0, 0], [1000, 0], [1000, 400], [0, 400]], [[0, 400], [500, 400], [500, 1000], [0, 1000]], [[500, 400], [1000, 400], [1000, 1000], [500, 1000]]], ['上', '左下', '右下']); break;
    case 'ell': if (n === 3) return named([[[0, 0], [400, 0], [400, 1000], [0, 1000]], [[400, 0], [1000, 0], [1000, 500], [400, 500]], [[400, 500], [1000, 500], [1000, 1000], [400, 1000]]], ['左', '右上', '右下']); break;
    case 'grid': if (n === 4) return named([[[0, 0], [500, 0], [500, 500], [0, 500]], [[500, 0], [1000, 0], [1000, 500], [500, 500]], [[0, 500], [500, 500], [500, 1000], [0, 1000]], [[500, 500], [1000, 500], [1000, 1000], [500, 1000]]], ['左上', '右上', '左下', '右下']); break;
    case 'wye': if (n === 3) return named([[[0, 0], [1000, 0], [1000, 250], C, [0, 250]], [[0, 250], C, [500, 1000], [0, 1000]], [[1000, 250], [1000, 1000], [500, 1000], C]], ['上', '左下', '右下']); break;
    case 'cross': if (n === 4) return named([[[0, 0], [1000, 0], C], [[1000, 0], [1000, 1000], C], [[1000, 1000], [0, 1000], C], [[0, 1000], [0, 0], C]], ['上', '右', '下', '左']); break;
    case 'ring': if (n === 2) {
      const inner = new Path2D();
      inner.arc(500, 500, 400, 0, Math.PI * 2);
      const outer = new Path2D();
      outer.rect(0, 0, SIZE, SIZE);
      outer.moveTo(900, 500); // 四角から円へ余計な線が引かれないようにする
      outer.arc(500, 500, 400, 0, Math.PI * 2);
      return [{ path: inner, label: 'まんなか', cx: 500, cy: 500 }, { path: outer, label: '外側', cx: 500, cy: 50 }];
    } break;
    default: break;
  }
  return named(rowBands(n, false), rowL); // rows、または人数に合わない id のとき
}

// ---------- 線を描く ----------
function applyStyle(ctx, s) {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = s.w;
  ctx.strokeStyle = s.c;
  ctx.globalCompositeOperation = s.e ? 'destination-out' : 'source-over';
}

// 線のうち、i 番目の点までの1区間だけを描く
export function drawSegment(ctx, s, i) {
  const p = s.p;
  applyStyle(ctx, s);
  ctx.beginPath();
  if (i === 0) {
    ctx.moveTo(p[0], p[1]);
    ctx.lineTo(p[0] + 0.01, p[1]);
  } else {
    ctx.moveTo(p[2 * i - 2], p[2 * i - 1]);
    ctx.lineTo(p[2 * i], p[2 * i + 1]);
  }
  ctx.stroke();
}

export function drawStroke(ctx, s) {
  const p = s.p;
  applyStyle(ctx, s);
  ctx.beginPath();
  ctx.moveTo(p[0], p[1]);
  if (p.length === 2) ctx.lineTo(p[0] + 0.01, p[1]);
  for (let i = 2; i < p.length; i += 2) ctx.lineTo(p[i], p[i + 1]);
  ctx.stroke();
}

// パートの範囲の中だけに描く
export function withClip(ctx, region, fn) {
  ctx.save();
  ctx.clip(region.path, 'evenodd');
  fn();
  ctx.restore();
}

function newLayer() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = SIZE;
  return cv;
}

// 点が多すぎるときは、間の点を間引く
function limitPoints(strokes) {
  let out = strokes.map((s) => ({ c: s.c, w: s.w, e: s.e ? 1 : 0, p: s.p.slice() }));
  const total = () => out.reduce((n, s) => n + s.p.length / 2, 0);
  let guard = 0;
  while (total() > MAX_POINTS && guard++ < 6) {
    out = out.map((s) => {
      const n = s.p.length / 2;
      if (n <= 3) return s;
      const p = [s.p[0], s.p[1]];
      for (let i = 2; i < n - 1; i += 2) p.push(s.p[2 * i], s.p[2 * i + 1]);
      p.push(s.p[2 * n - 2], s.p[2 * n - 1]);
      return { ...s, p };
    });
  }
  return out;
}

// 自分のパートだけ描けるキャンバス
export class Pad {
  constructor(canvas, part, regions) {
    this.cv = canvas;
    canvas.width = canvas.height = SIZE;
    this.ctx = canvas.getContext('2d');
    this.layer = newLayer();
    this.lctx = this.layer.getContext('2d');
    this.part = part;
    this.regions = regions;
    this.region = regions[part];
    this.strokes = [];
    this.color = '#1e1e1e';
    this.width = 12;
    this.erase = false;
    this.enabled = true;
    this.cur = null;
    canvas.addEventListener('pointerdown', (e) => this.down(e));
    canvas.addEventListener('pointermove', (e) => this.move(e));
    canvas.addEventListener('pointerup', () => { this.cur = null; });
    canvas.addEventListener('pointercancel', () => { this.cur = null; });
    this.compose();
  }

  pos(e) {
    const b = this.cv.getBoundingClientRect();
    return [Math.round((e.clientX - b.left) / b.width * SIZE), Math.round((e.clientY - b.top) / b.height * SIZE)];
  }

  down(e) {
    if (!this.enabled) return;
    const [x, y] = this.pos(e);
    if (!this.lctx.isPointInPath(this.region.path, x, y, 'evenodd')) return;
    e.preventDefault();
    try { this.cv.setPointerCapture(e.pointerId); } catch (err) { /* 古いブラウザ */ }
    this.cur = { c: this.color, w: this.erase ? this.width * 3 : this.width, e: this.erase ? 1 : 0, p: [x, y] };
    this.strokes.push(this.cur);
    this.seg(0);
  }

  move(e) {
    if (!this.cur || !this.enabled) return;
    const [x, y] = this.pos(e);
    const p = this.cur.p;
    if (Math.hypot(x - p[p.length - 2], y - p[p.length - 1]) < 4) return;
    p.push(x, y);
    this.seg(p.length / 2 - 1);
  }

  seg(i) {
    withClip(this.lctx, this.region, () => drawSegment(this.lctx, this.cur, i));
    this.compose();
  }

  rebuild() {
    this.lctx.clearRect(0, 0, SIZE, SIZE);
    withClip(this.lctx, this.region, () => this.strokes.forEach((s) => drawStroke(this.lctx, s)));
    this.compose();
  }

  undo() { this.cur = null; this.strokes.pop(); this.rebuild(); }
  clear() { this.cur = null; this.strokes = []; this.rebuild(); }

  compose() {
    const c = this.ctx;
    c.globalCompositeOperation = 'source-over';
    c.fillStyle = '#fff';
    c.fillRect(0, 0, SIZE, SIZE);
    c.drawImage(this.layer, 0, 0);
    // ほかの人のパートは暗くして見えなくする
    c.font = 'bold 52px sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    this.regions.forEach((r, i) => {
      if (i === this.part) return;
      c.fillStyle = '#2b3252';
      c.fill(r.path, 'evenodd');
      c.fillStyle = 'rgba(255,255,255,.35)';
      c.fillText('ひみつ', r.cx, r.cy);
    });
    c.strokeStyle = '#ffc928';
    c.lineWidth = 10;
    c.lineJoin = 'round';
    c.stroke(this.region.path);
  }

  getStrokes() { return limitPoints(this.strokes); }
}

// 分け方の見本（お題の画面で見せる小さな図）。自分のパートを金色にする
export function drawLayoutPreview(canvas, regions, myPart) {
  canvas.width = canvas.height = SIZE;
  const ctx = canvas.getContext('2d');
  regions.forEach((r, i) => {
    ctx.fillStyle = i === myPart ? '#ffc928' : '#2b3252';
    ctx.fill(r.path, 'evenodd');
  });
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 14;
  ctx.lineJoin = 'round';
  regions.forEach((r) => ctx.stroke(r.path));
}

// 合体：パートごとの線を、少しずつ描いて1枚にする
export function animateReveal(canvas, parts, regions, onDone) {
  canvas.width = canvas.height = SIZE;
  const ctx = canvas.getContext('2d');
  const layers = parts.map(() => newLayer());
  const lctx = layers.map((l) => l.getContext('2d'));
  const tasks = [];
  parts.forEach((strokes, pi) => (strokes || []).forEach((s) => {
    for (let i = 0; i < s.p.length / 2; i++) tasks.push([pi, s, i]);
  }));
  const perFrame = Math.max(3, Math.ceil(tasks.length / 240)); // 全体で約4秒
  let k = 0, timer = null, stopped = false;

  function compose(dividers) {
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, SIZE, SIZE);
    layers.forEach((l) => ctx.drawImage(l, 0, 0));
    if (!dividers) return;
    ctx.save();
    ctx.setLineDash([14, 14]);
    ctx.strokeStyle = 'rgba(0,0,0,.18)';
    ctx.lineWidth = 3;
    regions.forEach((r) => ctx.stroke(r.path));
    ctx.restore();
  }

  function frame() {
    if (stopped) return;
    for (let n = 0; n < perFrame && k < tasks.length; n++) {
      const [pi, s, i] = tasks[k++];
      withClip(lctx[pi], regions[pi], () => drawSegment(lctx[pi], s, i));
    }
    compose(true);
    if (k < tasks.length) timer = setTimeout(frame, 16);
    else if (onDone) onDone();
  }
  frame();

  return {
    stop() { stopped = true; clearTimeout(timer); },
    // 保存用：区切り線なしの画像
    toPNG() { compose(false); const url = canvas.toDataURL('image/png'); compose(true); return url; },
  };
}
