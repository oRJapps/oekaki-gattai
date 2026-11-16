// draw.js
// 絵を描く部分ぜんぶ：分け方（レイアウト）、描くキャンバス、ぬりつぶし、合体（自動でつなげる）、点数（見本に近いか）。
//
// 座標：1人ぶんのパネルは 1000×500（上下に分けるとき）か 500×1000（左右に分けるとき）。
//       ななめに分けるとき（2人だけ）は 1000×1000 を三角2つに分ける。
//       全体の絵は、パネルをならべた大きさになる（5人で上下なら 1000×2500 の、たてに長い絵）。
// 描いたもの（op）：線 { c: 色, w: 太さ, e: 消しゴムなら1, p: [x0, y0, x1, y1, ...] }
//                  ぬりつぶし { f: 1, c: 色, x, y }
// レイアウト：{ id, count, w, h, regions: [{ path, label, bbox, cx, cy }], frame, cuts, edgeLen }
//   frame：つなぎめに沿った向き（u）と、つなぎめをまたぐ向き（v）の座標。合体と点数はこの座標で計算する

const PANEL = 500;           // パネルの短いほうの辺
const MAX_POINTS = 6000;     // 1パートで送る点の上限（通信量をおさえる）
const R2 = Math.SQRT1_2;

export const LAYOUT_NAMES = {
  rows: '上から順に分ける', cols: '左から順に分ける',
  diag: 'ななめに分ける', diagR: 'ななめに分ける（逆向き）',
};

// 人数で使える分け方。2人：上下・左右・ななめ。3〜5人：上下か左右にならべる
export function layoutsFor(count) {
  return count === 2 ? ['rows', 'cols', 'diag', 'diagR'] : ['rows', 'cols'];
}

// 分け方をえらぶ。wide = 横に長いお題（3人以上のときは、横長のお題は左右に、それ以外は上下にならべる）
export function pickLayout(level, count, wide) {
  if (count !== 2) return wide ? 'cols' : 'rows';
  const pool = level === 'A' ? ['rows', 'cols'] : level === 'B' ? ['rows', 'cols', 'diag', 'diagR'] : ['diag', 'diagR', 'diag', 'diagR', 'rows', 'cols'];
  return pool[Math.floor(Math.random() * pool.length)];
}

const orderLabels = (n, first, last, unit) => {
  if (n === 1) return ['全部'];
  if (n === 2) return [first, last];
  if (n === 3) return [first, 'まんなか', last];
  return Array.from({ length: n }, (_, i) => `${unit}${i + 1}番目`);
};

function region(points, label) {
  const path = new Path2D();
  points.forEach(([x, y], i) => (i ? path.lineTo(x, y) : path.moveTo(x, y)));
  path.closePath();
  const xs = points.map((p) => p[0]), ys = points.map((p) => p[1]);
  const bbox = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
  let area = 0, cx = 0, cy = 0; // 面積で見た重心（名前を書く位置）
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i], [x2, y2] = points[(i + 1) % points.length];
    const k = x1 * y2 - x2 * y1;
    area += k; cx += (x1 + x2) * k; cy += (y1 + y2) * k;
  }
  // rect：範囲が四角ぴったりなら true（area は面積の2倍）
  return { path, label, bbox, cx: cx / (3 * area), cy: cy / (3 * area), rect: points.length === 4 && bbox.w * bbox.h === Math.abs(area) / 2 };
}

export function makeLayout(id, count) {
  const n = Math.min(5, Math.max(1, count | 0));
  const use = n >= 2 && layoutsFor(n).includes(id) ? id : 'rows';
  if (use === 'cols') {
    return {
      id: use, count: n, w: PANEL * n, h: 1000,
      regions: orderLabels(n, '左', '右', '左から').map((label, i) => region([[PANEL * i, 0], [PANEL * (i + 1), 0], [PANEL * (i + 1), 1000], [PANEL * i, 1000]], label)),
      frame: { ox: 0, oy: 0, tx: 0, ty: 1, nx: 1, ny: 0 }, cuts: Array.from({ length: n - 1 }, (_, i) => PANEL * (i + 1)), edgeLen: 1000, depth: PANEL,
    };
  }
  if (use === 'diag') { // 右上の角から左下の角へ切る。左上の三角と、右下の三角
    return {
      id: use, count: 2, w: 1000, h: 1000,
      regions: [region([[0, 0], [1000, 0], [0, 1000]], '左上'), region([[1000, 0], [1000, 1000], [0, 1000]], '右下')],
      frame: { ox: 1000, oy: 0, tx: -R2, ty: R2, nx: R2, ny: R2 }, cuts: [0], edgeLen: 1000 * Math.SQRT2, depth: 1000 * R2,
    };
  }
  if (use === 'diagR') { // 左上の角から右下の角へ切る。右上の三角と、左下の三角
    return {
      id: use, count: 2, w: 1000, h: 1000,
      regions: [region([[0, 0], [1000, 0], [1000, 1000]], '右上'), region([[0, 0], [1000, 1000], [0, 1000]], '左下')],
      frame: { ox: 0, oy: 0, tx: R2, ty: R2, nx: -R2, ny: R2 }, cuts: [0], edgeLen: 1000 * Math.SQRT2, depth: 1000 * R2,
    };
  }
  return {
    id: 'rows', count: n, w: 1000, h: PANEL * n,
    regions: orderLabels(n, '上', '下', '上から').map((label, i) => region([[0, PANEL * i], [1000, PANEL * i], [1000, PANEL * (i + 1)], [0, PANEL * (i + 1)]], label)),
    frame: { ox: 0, oy: 0, tx: 1, ty: 0, nx: 0, ny: 1 }, cuts: Array.from({ length: n - 1 }, (_, i) => PANEL * (i + 1)), edgeLen: 1000, depth: PANEL,
  };
}

// つなぎめに沿った座標（u, v）から、絵の座標（x, y）へ
const toWorld = (f, u, v) => [f.ox + f.tx * u + f.nx * v, f.oy + f.ty * u + f.ny * v];

function newCanvas(w, h) {
  const cv = document.createElement('canvas');
  cv.width = Math.round(w);
  cv.height = Math.round(h);
  return cv;
}

// ---------- 線とぬりつぶし ----------
function applyStyle(ctx, s) {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = s.w;
  ctx.strokeStyle = s.c;
  ctx.globalCompositeOperation = s.e ? 'destination-out' : 'source-over';
}

function drawSegment(ctx, s, i) {
  const p = s.p;
  applyStyle(ctx, s);
  ctx.beginPath();
  if (i === 0) { ctx.moveTo(p[0], p[1]); ctx.lineTo(p[0] + 0.01, p[1]); }
  else { ctx.moveTo(p[2 * i - 2], p[2 * i - 1]); ctx.lineTo(p[2 * i], p[2 * i + 1]); }
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

// ぬった面：点をつないだ形の中をぬる（見本の絵で使う）
function fillPolygon(c, s) {
  c.globalCompositeOperation = 'source-over';
  c.fillStyle = s.c;
  c.beginPath();
  c.moveTo(s.p[0], s.p[1]);
  for (let i = 2; i < s.p.length; i += 2) c.lineTo(s.p[i], s.p[i + 1]);
  c.closePath();
  c.fill();
}

// 1人ぶんの絵をのせる透明な紙（レイヤー）。大きさはそのパートの範囲ぴったり
class Layer {
  constructor(reg) {
    this.reg = reg;
    this.cv = newCanvas(reg.bbox.w, reg.bbox.h);
    this.ctx = this.cv.getContext('2d', { willReadFrequently: true });
    this.mask = null; // ぬりつぶしで「範囲の中かどうか」を見る表（三角の範囲のときだけ使う）
  }

  // 絵の座標で描けるようにして、範囲の外にはみ出さないようにする
  inside(fn) {
    const c = this.ctx, b = this.reg.bbox;
    c.save();
    c.setTransform(1, 0, 0, 1, -b.x, -b.y);
    c.clip(this.reg.path);
    fn(c);
    c.restore();
  }

  clear() { this.ctx.setTransform(1, 0, 0, 1, 0, 0); this.ctx.clearRect(0, 0, this.cv.width, this.cv.height); }

  segment(s, i) { this.inside((c) => drawSegment(c, s, i)); }

  apply(op) {
    if (op.f) this.fill(op.x, op.y, op.c);
    else if (op.g) this.inside((c) => fillPolygon(c, op)); // ぬった面（CPU が描く見本の絵で使う）
    else this.inside((c) => drawStroke(c, op));
  }

  getMask() {
    if (this.mask || this.reg.rect) return this.mask;
    const cv = newCanvas(this.cv.width, this.cv.height), c = cv.getContext('2d');
    c.setTransform(1, 0, 0, 1, -this.reg.bbox.x, -this.reg.bbox.y);
    c.fill(this.reg.path);
    const d = c.getImageData(0, 0, cv.width, cv.height).data;
    this.mask = new Uint8Array(cv.width * cv.height);
    for (let i = 0; i < this.mask.length; i++) this.mask[i] = d[i * 4 + 3] > 127 ? 1 : 0;
    return this.mask;
  }

  // ぬりつぶし：おした場所から、同じ色がつづいているところを全部その色にする（線でかこまれた中だけ）
  fill(x, y, hex) {
    const w = this.cv.width, h = this.cv.height, mask = this.getMask();
    const px = Math.floor(x - this.reg.bbox.x), py = Math.floor(y - this.reg.bbox.y);
    if (px < 0 || py < 0 || px >= w || py >= h || (mask && !mask[py * w + px])) return;
    const img = this.ctx.getImageData(0, 0, w, h), d = img.data;
    const fr = parseInt(hex.slice(1, 3), 16), fg = parseInt(hex.slice(3, 5), 16), fb = parseInt(hex.slice(5, 7), 16);
    const s = (py * w + px) * 4, sr = d[s], sg = d[s + 1], sb = d[s + 2], sa = d[s + 3];
    if (sa > 200 && Math.abs(sr - fr) + Math.abs(sg - fg) + Math.abs(sb - fb) < 12) return; // もうその色
    const blank = sa < 60;
    const same = (i) => {
      const a = d[i * 4 + 3];
      if (blank) return a < 110; // 何も描いていないところ（線のふちの、うすい部分までふくめる）
      return a > 140 && Math.abs(d[i * 4] - sr) + Math.abs(d[i * 4 + 1] - sg) + Math.abs(d[i * 4 + 2] - sb) < 96;
    };
    const filled = new Uint8Array(w * h);
    const stack = [py * w + px];
    while (stack.length) {
      let i = stack.pop();
      if (filled[i] || !same(i) || (mask && !mask[i])) continue;
      const row = Math.floor(i / w) * w;
      let left = i, right = i;
      while (left > row && !filled[left - 1] && same(left - 1) && (!mask || mask[left - 1])) left--;
      while (right < row + w - 1 && !filled[right + 1] && same(right + 1) && (!mask || mask[right + 1])) right++;
      for (i = left; i <= right; i++) {
        filled[i] = 1;
        if (i >= w && !filled[i - w]) stack.push(i - w);
        if (i < w * (h - 1) && !filled[i + w]) stack.push(i + w);
      }
    }
    // ぬる。線のふち（となりの2マス）は、線の下にも色を入れて、白いすきまが出ないようにする
    for (let i = 0; i < filled.length; i++) {
      if (filled[i]) { d[i * 4] = fr; d[i * 4 + 1] = fg; d[i * 4 + 2] = fb; d[i * 4 + 3] = 255; continue; }
      if (mask && !mask[i]) continue;
      const xx = i % w;
      const near = (xx > 0 && filled[i - 1]) || (xx < w - 1 && filled[i + 1]) || (i >= w && filled[i - w]) || (i < w * (h - 1) && filled[i + w])
        || (xx > 1 && filled[i - 2]) || (xx < w - 2 && filled[i + 2]) || (i >= 2 * w && filled[i - 2 * w]) || (i < w * (h - 2) && filled[i + 2 * w]);
      if (!near) continue;
      const a = d[i * 4 + 3] / 255;
      d[i * 4] = Math.round(d[i * 4] * a + fr * (1 - a));
      d[i * 4 + 1] = Math.round(d[i * 4 + 1] * a + fg * (1 - a));
      d[i * 4 + 2] = Math.round(d[i * 4 + 2] * a + fb * (1 - a));
      d[i * 4 + 3] = 255;
    }
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.putImageData(img, 0, 0);
  }
}

// 点が多すぎるときは、線の間の点を間引く（ぬりつぶしはそのまま）
function limitPoints(ops) {
  let out = ops.map((s) => (s.f ? { f: 1, c: s.c, x: Math.round(s.x), y: Math.round(s.y) } : { c: s.c, w: s.w, e: s.e ? 1 : 0, p: s.p.slice() }));
  const total = () => out.reduce((n, s) => n + (s.f ? 0 : s.p.length / 2), 0);
  let guard = 0;
  while (total() > MAX_POINTS && guard++ < 6) {
    out = out.map((s) => {
      if (s.f) return s;
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

// ---------- 描くキャンバス（自分のパートだけが大きく出る） ----------
export class Pad {
  // notes：つなぎめに出すひとこと { prev: '…', next: '…' }（前の人との境目／次の人との境目）
  constructor(canvas, layout, part, notes = {}) {
    this.cv = canvas;
    this.layout = layout;
    this.part = part;
    this.reg = layout.regions[part];
    this.notes = notes;
    const b = this.reg.bbox;
    canvas.width = b.w;
    canvas.height = b.h;
    canvas.style.setProperty('--ratio', String(b.w / b.h));
    this.ctx = canvas.getContext('2d');
    this.layer = new Layer(this.reg);
    this.ops = [];
    this.color = '#1e1e1e';
    this.width = 12;
    this.tool = 'pen'; // pen / eraser / fill
    this.enabled = true;
    this.cur = null;
    canvas.addEventListener('pointerdown', (e) => this.down(e));
    canvas.addEventListener('pointermove', (e) => this.move(e));
    canvas.addEventListener('pointerup', () => { this.cur = null; });
    canvas.addEventListener('pointercancel', () => { this.cur = null; });
    this.compose();
  }

  pos(e) {
    const r = this.cv.getBoundingClientRect(), b = this.reg.bbox;
    return [Math.round(b.x + (e.clientX - r.left) / r.width * b.w), Math.round(b.y + (e.clientY - r.top) / r.height * b.h)];
  }

  down(e) {
    if (!this.enabled) return;
    const [x, y] = this.pos(e);
    if (!this.ctx.isPointInPath(this.reg.path, x, y)) return;
    e.preventDefault();
    if (this.tool === 'fill') {
      const op = { f: 1, c: this.color, x, y };
      this.ops.push(op);
      this.layer.apply(op);
      this.compose();
      return;
    }
    try { this.cv.setPointerCapture(e.pointerId); } catch (err) { /* 古いブラウザ */ }
    const erase = this.tool === 'eraser';
    this.cur = { c: this.color, w: erase ? this.width * 3 : this.width, e: erase ? 1 : 0, p: [x, y] };
    this.ops.push(this.cur);
    this.layer.segment(this.cur, 0);
    this.compose();
  }

  move(e) {
    if (!this.cur || !this.enabled) return;
    const [x, y] = this.pos(e);
    const p = this.cur.p;
    if (Math.hypot(x - p[p.length - 2], y - p[p.length - 1]) < 4) return;
    p.push(x, y);
    this.layer.segment(this.cur, p.length / 2 - 1);
    this.compose();
  }

  rebuild() {
    this.layer.clear();
    this.ops.forEach((op) => this.layer.apply(op));
    this.compose();
  }

  undo() { this.cur = null; this.ops.pop(); this.rebuild(); }
  clear() { this.cur = null; this.ops = []; this.rebuild(); }

  compose() {
    const c = this.ctx, b = this.reg.bbox, L = this.layout, f = L.frame;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalCompositeOperation = 'source-over';
    c.fillStyle = '#fff';
    c.fillRect(0, 0, b.w, b.h);
    c.drawImage(this.layer.cv, 0, 0);
    c.setTransform(1, 0, 0, 1, -b.x, -b.y); // ここからは絵の座標で描く
    // ほかの人のパートが同じ四角の中にあるとき（ななめ）は、暗くして見えなくする
    L.regions.forEach((r, i) => {
      if (i === this.part) return;
      const o = r.bbox;
      if (o.x >= b.x + b.w || o.x + o.w <= b.x || o.y >= b.y + b.h || o.y + o.h <= b.y) return;
      c.fillStyle = '#2b3252';
      c.fill(r.path);
      c.fillStyle = 'rgba(255,255,255,.35)';
      c.font = 'bold 52px sans-serif';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText('ひみつ', r.cx, r.cy);
    });
    // つなぎめ（となりの人の絵とくっつく線）を、金色の点線で見せる
    c.lineWidth = 10;
    c.strokeStyle = '#ffb300';
    c.setLineDash([26, 18]);
    c.font = 'bold 30px sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    [[this.part - 1, 1, this.notes.prev], [this.part, -1, this.notes.next]].forEach(([k, side, note]) => {
      if (k < 0 || k >= L.cuts.length) return;
      const [x1, y1] = toWorld(f, 0, L.cuts[k]), [x2, y2] = toWorld(f, L.edgeLen, L.cuts[k]);
      c.beginPath();
      c.moveTo(x1, y1);
      c.lineTo(x2, y2);
      c.stroke();
      if (!note || (L.id !== 'rows' && L.id !== 'cols')) return; // ななめのときは、ひとことを出さない
      const [tx, ty] = toWorld(f, L.edgeLen / 2, L.cuts[k] + side * 36);
      c.save();
      c.translate(tx, ty);
      if (L.id === 'cols') c.rotate(-Math.PI / 2); // 左右に分けるときは、つなぎめに沿ってたて向きに書く
      c.fillStyle = 'rgba(170,110,0,.85)';
      c.fillText(note, 0, 0);
      c.restore();
    });
    c.setLineDash([]);
    c.setTransform(1, 0, 0, 1, 0, 0);
  }

  getOps() { return limitPoints(this.ops); }
}

// 分け方の見本（お題の画面などで見せる小さな図）。自分のパートを金色にする
export function drawLayoutPreview(canvas, layout, myPart) {
  canvas.width = layout.w;
  canvas.height = layout.h;
  canvas.style.setProperty('--ratio', String(layout.w / layout.h));
  const ctx = canvas.getContext('2d');
  layout.regions.forEach((r, i) => {
    ctx.fillStyle = i === myPart ? '#ffc928' : '#2b3252';
    ctx.fill(r.path);
  });
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = Math.max(layout.w, layout.h) / 70;
  ctx.lineJoin = 'round';
  layout.regions.forEach((r) => ctx.stroke(r.path));
}

// 小さな見本の絵（おてほん）を描く。ops は 1000×1000 の座標
export function drawSample(canvas, ops, size = 300) {
  canvas.width = canvas.height = size;
  const c = canvas.getContext('2d');
  c.fillStyle = '#fff';
  c.fillRect(0, 0, size, size);
  c.scale(size / 1000, size / 1000);
  ops.forEach((s) => {
    if (s.g) fillPolygon(c, s); else drawStroke(c, s);
  });
}

// ---------- つなぎめを調べる ----------
const DEPTHS = [3, 8, 14, 20, 27, 34]; // つなぎめから何ドット内側までを「つなぎめにとどいている」と見るか

// つなぎめに沿って、絵がある場所の集まり（run）をさがす。side = -1：つなぎめの手前の人、+1：向こうの人
function profile(layout, data, i, cut, side) {
  const f = layout.frame, b = layout.regions[i].bbox, img = data[i];
  const runs = [];
  let start = -1, last = -100;
  for (let u = 0; u <= layout.edgeLen; u += 2) {
    let ink = false;
    for (const depth of DEPTHS) {
      const [x, y] = toWorld(f, u, cut + side * depth);
      const px = Math.round(x - b.x), py = Math.round(y - b.y);
      if (px < 0 || py < 0 || px >= img.width || py >= img.height) continue;
      if (img.data[(py * img.width + px) * 4 + 3] > 60) { ink = true; break; }
    }
    if (!ink) continue;
    if (u - last > 14) { if (start >= 0) runs.push([start, last]); start = u; }
    last = u;
  }
  if (start >= 0) runs.push([start, last]);
  if (!runs.length) return { n: 0, len: 0, a: 0, b: 0, c: layout.edgeLen / 2 };
  const a = runs[0][0], z = runs[runs.length - 1][1];
  return { n: runs.length, len: Math.max(2, z - a), a, b: z, c: (a + z) / 2 };
}

// そのパートの絵が、つなぎめからどこまで広がっているか
function extent(layout, img, i, cut) {
  const f = layout.frame, b = layout.regions[i].bbox;
  let uMin = Infinity, uMax = -Infinity, far = 0;
  for (let py = 0; py < img.height; py += 3) {
    for (let px = 0; px < img.width; px += 3) {
      if (img.data[(py * img.width + px) * 4 + 3] <= 60) continue;
      const x = px + b.x - f.ox, y = py + b.y - f.oy;
      const u = x * f.tx + y * f.ty, v = x * f.nx + y * f.ny;
      if (u < uMin) uMin = u;
      if (u > uMax) uMax = u;
      far = Math.max(far, Math.abs(v - cut));
    }
  }
  return { uMin, uMax, far };
}

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

// つなぎめごとに、どれだけうまくつながっているかを調べて、合わせ方（拡大・縮小とずらし）と点数を決める
function analyze(layout, layers) {
  const data = layers.map((l) => l.ctx.getImageData(0, 0, l.cv.width, l.cv.height));
  const n = layout.count;
  // fit[i] = { lo, hi }：パート i の、手前のつなぎめ（lo）と向こうのつなぎめ（hi）での合わせ方
  //   { s: 倍率, P: もとの中心, Q: 合わせたあとの中心, cut: つなぎめの位置 }
  const fit = Array.from({ length: n }, () => ({ lo: null, hi: null, sv: 1 }));
  const joints = [];
  layout.cuts.forEach((cut, k) => {
    const A = profile(layout, data, k, cut, -1), B = profile(layout, data, k + 1, cut, 1);
    let sA = 1, sB = 1;
    // 大きいほうに合わせる：大きいほうの絵は動かさず、小さいほうの絵を大きくして、位置もそろえる（2倍まで）
    const Q = A.n && B.n ? (A.len >= B.len ? A.c : B.c) : null;
    if (A.n && B.n && A.len >= 40 && B.len >= 40) {
      const L = Math.max(A.len, B.len);
      sA = clamp(L / A.len, 1, 2);
      sB = clamp(L / B.len, 1, 2);
    }
    if (Q !== null) {
      fit[k].hi = { s: sA, P: A.c, Q, cut };
      fit[k + 1].lo = { s: sB, P: B.c, Q, cut };
    }
    joints.push({ A, B, sA, sB, Q });
  });

  // はしのパート（つなぎめが1つ）は、絵がわくの外に出ないように倍率をおさえる
  fit.forEach((ft, i) => {
    const one = ft.lo && !ft.hi ? ft.lo : ft.hi && !ft.lo ? ft.hi : null;
    if (!one) return;
    ft.sv = one.s;
    if (one.s <= 1) return;
    const ex = extent(layout, data[i], i, one.cut);
    if (ex.far > 1) ft.sv = clamp(layout.depth / ex.far, 1, one.s);
    const left = one.P - ex.uMin, right = ex.uMax - one.P;
    let s = one.s;
    if (left > 1) s = Math.min(s, (one.Q + 10) / left);
    if (right > 1) s = Math.min(s, (layout.edgeLen - one.Q + 10) / right);
    one.s = Math.max(1, s);
    ft.sv = Math.min(ft.sv, one.s);
  });

  // 小さいほうを大きくしきれなかったとき（わくの外に出てしまう、2倍をこえる）は、
  // 残りのぶんだけ大きいほうを小さくして、つなぎめのはばを近づける（7割まで）
  joints.forEach((j, k) => {
    const fa = fit[k].hi, fb = fit[k + 1].lo;
    if (!fa || !fb || j.A.len < 40 || j.B.len < 40) return;
    const lenA = j.A.len * fa.s, lenB = j.B.len * fb.s;
    const [big, bigIdx, ratio] = lenA > lenB ? [fa, k, lenB / lenA] : [fb, k + 1, lenA / lenB];
    if (ratio > 0.97) return;
    big.s = Math.max(0.7, big.s * ratio); // 小さくしすぎると、頭だけ小さい絵になるので、7割まで
    const ft = fit[bigIdx];
    if (!ft.lo || !ft.hi) ft.sv = big.s; // はしのパート：たても横も同じ倍率で小さくする（形をゆがめない）
  });

  // 点数：合わせる前の絵が、どれだけ合っていたか（はば・位置・線の本数）＋合わせたあとのずれ
  const scores = joints.map((j, k) => {
    const { A, B } = j;
    if (!A.n && !B.n) return 20;
    if (!A.n || !B.n) return 15;
    const thin = A.len < 40 && B.len < 40;
    const r = thin ? 1 : Math.min(A.len, B.len) / Math.max(A.len, B.len);
    const p = 1 - Math.min(1, Math.abs(A.c - B.c) / 300);
    const kk = Math.min(A.n, B.n) / Math.max(A.n, B.n);
    const fa = fit[k].hi, fb = fit[k + 1].lo;
    const mapA = (u) => fa.Q + fa.s * (u - fa.P), mapB = (u) => fb.Q + fb.s * (u - fb.P);
    const gap = (Math.abs(mapA(A.a) - mapB(B.a)) + Math.abs(mapA(A.b) - mapB(B.b))) / 2;
    const q = 1 - Math.min(1, gap / 150);
    return Math.round(100 * (0.4 * r + 0.3 * p + 0.2 * kk + 0.1 * q));
  });
  const score = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;
  return { fit, scores, score, joints };
}

// ---------- 合体 ----------
// 1. 全員の絵を少しずつ描く → 2. つなぎめが合うように、それぞれの絵を拡大・縮小してずらす → 3. 点数を出す
// hooks：{ onFit(), onDone(result) }。result = { score, scores }
export function startReveal(canvas, layout, partsOps, hooks = {}) {
  canvas.width = layout.w;
  canvas.height = layout.h;
  canvas.style.setProperty('--ratio', String(layout.w / layout.h));
  const ctx = canvas.getContext('2d');
  const layers = layout.regions.map((r) => new Layer(r));
  const tasks = [];
  partsOps.forEach((ops, pi) => (ops || []).forEach((op) => {
    if (op.f || op.g) tasks.push([pi, op, -1]);
    else for (let i = 0; i < op.p.length / 2; i++) tasks.push([pi, op, i]);
  }));
  const perFrame = Math.max(3, Math.ceil(tasks.length / 200)); // 描くところは全体で約3秒
  const f = layout.frame;
  let k = 0, timer = null, stopped = false, result = null, amount = 0;

  // 絵の座標での変形を、キャンバスにセットする。u' = Q + a(u - P)、v' = C + b(v - C)
  function setWarp(a, b, Q, P, C) {
    const m11 = f.tx * a * f.tx + f.nx * b * f.nx, m12 = f.tx * a * f.ty + f.nx * b * f.ny;
    const m21 = f.ty * a * f.tx + f.ny * b * f.nx, m22 = f.ty * a * f.ty + f.ny * b * f.ny;
    const du = Q - a * P, dv = C - b * C;
    const ex = f.ox + f.tx * du + f.nx * dv - (m11 * f.ox + m12 * f.oy);
    const ey = f.oy + f.ty * du + f.ny * dv - (m21 * f.ox + m22 * f.oy);
    ctx.setTransform(m11, m21, m12, m22, ex, ey);
  }

  // t = 0：描いたまま、t = 1：つなぎめを合わせた形
  function compose(t, dividers) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, layout.w, layout.h);
    layers.forEach((layer, i) => {
      const b = layer.reg.bbox, ft = result && t > 0 ? result.fit[i] : null;
      if (!ft || (!ft.lo && !ft.hi)) { ctx.drawImage(layer.cv, b.x, b.y); return; }
      const mix = (e) => ({ s: 1 + (e.s - 1) * t, P: e.P, Q: e.P + (e.Q - e.P) * t, cut: e.cut });
      ctx.save();
      ctx.clip(layer.reg.path);
      if (!ft.lo || !ft.hi) { // はしのパート：つなぎめを動かさずに、全体を同じ倍率で大きく（小さく）する
        const e = mix(ft.lo || ft.hi);
        setWarp(e.s, 1 + (ft.sv - 1) * t, e.Q, e.P, e.cut);
        ctx.drawImage(layer.cv, b.x, b.y);
      } else { // まんなかのパート：手前と向こうで合わせ方がちがうので、細い帯に分けて少しずつ変える
        const lo = mix(ft.lo), hi = mix(ft.hi), STRIPS = 24, step = (hi.cut - lo.cut) / STRIPS;
        for (let sIdx = 0; sIdx < STRIPS; sIdx++) {
          const v0 = lo.cut + step * sIdx, w = (sIdx + 0.5) / STRIPS;
          ctx.save();
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.beginPath();
          [[-4000, v0 - 0.6], [4000, v0 - 0.6], [4000, v0 + step + 0.6], [-4000, v0 + step + 0.6]].forEach(([u, v], idx) => {
            const [x, y] = toWorld(f, u, v);
            if (idx) ctx.lineTo(x, y); else ctx.moveTo(x, y);
          });
          ctx.clip();
          setWarp(lo.s + (hi.s - lo.s) * w, 1, lo.Q + (hi.Q - lo.Q) * w, lo.P + (hi.P - lo.P) * w, 0);
          ctx.drawImage(layer.cv, b.x, b.y);
          ctx.restore();
        }
      }
      ctx.restore();
    });
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (!dividers) return;
    ctx.save();
    ctx.setLineDash([14, 14]);
    ctx.strokeStyle = 'rgba(0,0,0,.2)';
    ctx.lineWidth = 3;
    layout.cuts.forEach((cut) => {
      const [x1, y1] = toWorld(f, 0, cut), [x2, y2] = toWorld(f, layout.edgeLen, cut);
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    });
    ctx.restore();
  }

  function drawFrame() {
    if (stopped) return;
    for (let n = 0; n < perFrame && k < tasks.length; n++) {
      const [pi, op, i] = tasks[k++];
      if (i < 0) layers[pi].apply(op); else layers[pi].segment(op, i);
    }
    compose(0, true);
    if (k < tasks.length) { timer = setTimeout(drawFrame, 16); return; }
    result = analyze(layout, layers);
    if (hooks.onFit) hooks.onFit();
    const began = Date.now();
    const fitFrame = () => {
      if (stopped) return;
      const raw = Math.min(1, (Date.now() - began) / 1300);
      amount = raw < 0.5 ? 2 * raw * raw : 1 - Math.pow(-2 * raw + 2, 2) / 2;
      compose(amount, raw < 1);
      if (raw < 1) { timer = setTimeout(fitFrame, 16); return; }
      if (hooks.onDone) hooks.onDone({ score: result.score, scores: result.scores, joints: result.joints, fit: result.fit });
    };
    timer = setTimeout(fitFrame, 500);
  }
  drawFrame();

  return {
    stop() { stopped = true; clearTimeout(timer); },
    // 保存・シェア用：できあがった絵を、別のキャンバスに写して返す
    toCanvas() {
      const copy = newCanvas(layout.w, layout.h);
      compose(result ? 1 : 0, false);
      copy.getContext('2d').drawImage(canvas, 0, 0);
      compose(amount, amount < 1);
      return copy;
    },
  };
}

// ---------- 点数：見本にどれだけ近いか ----------
// 絵の特ちょうを取り出す：形（絵がある場所。線でかこんだ中もふくむ）と、使っている色の割合。
// 絵の大きさや位置のちがいで損をしないように、絵がある範囲だけを切り出して、同じ大きさ（48×48 におさまる大きさ）に直してからくらべる。
const SIM = 48;
export const TOLS = { v: 1 }; // 線の場所のずれを、何マスまで「合っている」と見るか
function features(src) {
  // まず 200×200 に直す。たてや横に長い絵（3人以上で合体した絵）は、ここで正方形に引きのばされる
  const w = 200, h = 200;
  const mid = newCanvas(w, h), mc = mid.getContext('2d', { willReadFrequently: true });
  mc.fillStyle = '#fff';
  mc.fillRect(0, 0, w, h);
  mc.drawImage(src, 0, 0, w, h);
  const md = mc.getImageData(0, 0, w, h).data;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    if (md[i] < 235 || md[i + 1] < 235 || md[i + 2] < 235) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  if (x1 < x0 || y1 < y0) return null; // 何も描いていない
  const cv = newCanvas(SIM, SIM), c = cv.getContext('2d', { willReadFrequently: true });
  c.fillStyle = '#fff';
  c.fillRect(0, 0, SIM, SIM);
  // 絵がある範囲を、形（たてと横の比）を変えずに、48×48 のまんなかにおさめる
  const bw = x1 - x0 + 1, bh = y1 - y0 + 1, sc = SIM / Math.max(bw, bh);
  c.drawImage(mid, x0, y0, bw, bh, (SIM - bw * sc) / 2, (SIM - bh * sc) / 2, bw * sc, bh * sc);
  const p = c.getImageData(0, 0, SIM, SIM).data, n = SIM * SIM;
  const raw = new Uint8Array(n), hist = new Float32Array(14), kind = new Int8Array(n).fill(-1); // kind：そのマスの色の種類（-1 = 何もない）
  let inkCount = 0;
  for (let i = 0; i < n; i++) {
    const r = p[i * 4], g = p[i * 4 + 1], b = p[i * 4 + 2];
    if (r >= 238 && g >= 238 && b >= 238) continue;
    raw[i] = 1;
    inkCount++;
    // 色の種類：0〜11 = 色あい（30度ずつ）、12 = 黒っぽい、13 = 灰色・白っぽい
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let bucket = 13;
    if (max - min < 42) bucket = max < 120 ? 12 : 13;
    else {
      let hue = max === r ? ((g - b) / (max - min)) % 6 : max === g ? (b - r) / (max - min) + 2 : (r - g) / (max - min) + 4;
      if (hue < 0) hue += 6;
      bucket = Math.floor(hue * 2) % 12;
    }
    hist[bucket]++;
    kind[i] = bucket;
  }
  for (let i = 0; i < hist.length; i++) hist[i] /= Math.max(1, inkCount);
  // 線の小さなすきまをふさぐ（まわり1マスに広げる）。そのあと、外がわからたどれない所を「中」と見る
  const ink = new Uint8Array(n);
  for (let y = 0; y < SIM; y++) for (let x = 0; x < SIM; x++) {
    if (!raw[y * SIM + x]) continue;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx >= 0 && yy >= 0 && xx < SIM && yy < SIM) ink[yy * SIM + xx] = 1;
    }
  }
  const outside = new Uint8Array(n), stack = [];
  for (let i = 0; i < SIM; i++) stack.push(i, (SIM - 1) * SIM + i, i * SIM, i * SIM + SIM - 1);
  while (stack.length) {
    const i = stack.pop();
    if (outside[i] || ink[i]) continue;
    outside[i] = 1;
    const x = i % SIM;
    if (x > 0) stack.push(i - 1);
    if (x < SIM - 1) stack.push(i + 1);
    if (i >= SIM) stack.push(i - SIM);
    if (i < n - SIM) stack.push(i + SIM);
  }
  const sil = new Uint8Array(n);
  for (let i = 0; i < n; i++) sil[i] = outside[i] ? 0 : 1;
  // 絵を 12×12 のますに分けて、ますごとに「いちばん多い色の種類」を調べる（どこに何色があるか）
  //   -1 = 絵の外、14 = 線でかこんだ中だが、ぬっていない
  const G8 = 12, step = SIM / G8, cells = new Int8Array(G8 * G8);
  for (let cy = 0; cy < G8; cy++) for (let cx = 0; cx < G8; cx++) {
    const count = new Uint16Array(16);
    for (let y = cy * step; y < (cy + 1) * step; y++) for (let x = cx * step; x < (cx + 1) * step; x++) {
      const i = y * SIM + x;
      count[kind[i] >= 0 ? kind[i] : sil[i] ? 14 : 15]++;
    }
    let top = 15;
    for (let b = 0; b < 15; b++) if (count[b] > count[top] * (top === 15 ? 0.5 : 1)) top = b; // 外（15）は、半分より多いときだけ「外」
    cells[cy * G8 + cx] = top === 15 ? -1 : top;
  }
  // 線の場所：色の種類が変わる所（線そのもの、色と色のさかいめ、絵と外のさかいめ）。色をぬらない絵でも、これでくらべられる
  const lab = (i) => (kind[i] >= 0 ? kind[i] : sil[i] ? 14 : 15);
  const TOL = TOLS.v;
  const edge = new Uint8Array(n), near = new Uint8Array(n); // near：線のまわり2マスまで広げたもの（少しのずれは、合っていると見る）
  let edges = 0;
  for (let y = 0; y < SIM; y++) for (let x = 0; x < SIM; x++) {
    const i = y * SIM + x, v = lab(i);
    if ((x < SIM - 1 && lab(i + 1) !== v) || (y < SIM - 1 && lab(i + SIM) !== v)) { edge[i] = 1; edges++; }
  }
  for (let y = 0; y < SIM; y++) for (let x = 0; x < SIM; x++) {
    if (!edge[y * SIM + x]) continue;
    for (let dy = -TOL; dy <= TOL; dy++) for (let dx = -TOL; dx <= TOL; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx >= 0 && yy >= 0 && xx < SIM && yy < SIM) near[yy * SIM + xx] = 1;
    }
  }
  return { sil, hist, cells, edge, near, edges };
}

// 見本にどれだけ近いか（0〜100点）。形が3割、色の割合が2割、色の場所が5割（数字は下の SCORE）
//   形：2つの絵を重ねたとき、どちらにも絵がある所の割合（80%重なれば満点）
//   色の割合：使っている色の割合が、どれだけ同じか（60%同じなら満点。近い色あいも数える）
//   色の場所：12×12 のますごとに、同じ色の種類かどうか（近い色あい、線だけの所には部分点）
export function similarity(picture, sample) {
  const a = features(picture), b = features(sample);
  if (!a || !b) return 0;
  let both = 0, either = 0;
  for (let i = 0; i < a.sil.length; i++) { if (a.sil[i] || b.sil[i]) either++; if (a.sil[i] && b.sil[i]) both++; }
  const shape = either ? both / either : 0;
  let color = 0;
  // 色あいは、となりの色あいにも少し広げてからくらべる（赤とオレンジのような近い色で、0点にならないように）
  const soft = (hist) => Array.from(hist, (v, i) => (i < 12 ? 0.5 * v + 0.25 * hist[(i + 1) % 12] + 0.25 * hist[(i + 11) % 12] : v));
  const ha = soft(a.hist), hb = soft(b.hist);
  for (let i = 0; i < ha.length; i++) color += Math.min(ha[i], hb[i]);
  let used = 0, same = 0;
  for (let i = 0; i < a.cells.length; i++) {
    const x = a.cells[i], y = b.cells[i];
    if (x < 0 && y < 0) continue;
    used++;
    if (x === y) same += 1;
    else if (x < 0 || y < 0) continue; // 片方だけ絵がある：0点
    else if (x < 12 && y < 12) { // どちらも色つき：色あいが近いほど高い
      const d = Math.min(Math.abs(x - y), 12 - Math.abs(x - y));
      same += d === 1 ? SCORE.near1 : d === 2 ? SCORE.near2 : SCORE.far;
    } else if (x === 14 || y === 14) same += SCORE.inside; // 線でかこんだだけで、ぬっていない：場所は合っているので、部分点
    else same += SCORE.ink; // 黒や灰色の線と、色つきの所：少しだけ部分点
  }
  const place = used ? same / used : 0;
  const raw = SCORE.wShape * Math.min(1, shape / SCORE.shapeFull) + SCORE.wColor * Math.min(1, color / SCORE.colorFull) + SCORE.wPlace * place;
  const colored = Math.pow(Math.max(0, Math.min(1, (raw - SCORE.low) / (SCORE.full - SCORE.low))), SCORE.curve);
  // 線だけでくらべた点数（色は見ない）：形の重なりと、線の場所がどれだけ合っているか。
  // 色をぬらずに黒い線だけで描いた絵でも、似ていれば点数が出るように、色つきの点数と高いほうを使う
  let hitA = 0, hitB = 0;
  for (let i = 0; i < a.edge.length; i++) { if (a.edge[i] && b.near[i]) hitA++; if (b.edge[i] && a.near[i]) hitB++; }
  const pa = a.edges ? hitA / a.edges : 0, pb = b.edges ? hitB / b.edges : 0; // pa：描いた線が見本の線の近くにある割合、pb：見本の線が描かれている割合
  const lines = pa + pb ? (2 * pa * pb) / (pa + pb) : 0;
  const rawLine = SCORE.lineShape * Math.min(1, shape / SCORE.shapeFull) + (1 - SCORE.lineShape) * lines;
  const lined = Math.pow(Math.max(0, Math.min(1, (rawLine - SCORE.lineLow) / (SCORE.lineFull - SCORE.lineLow))), SCORE.curve);
  return Math.round(100 * Math.max(colored, lined));
}
// 点数のきびしさ。人が指で描いた絵でも点数が出るように、やさしめにしてある
//   shapeFull：形がこれだけ重なれば満点／colorFull：色の割合がこれだけ同じなら満点
//   near1・near2・far：色あいが 1つとなり・2つとなり・それより遠いときの部分点／inside：線だけ、ぬっていないときの部分点
//   ink：黒い線と色つきの所の部分点／low：合計がこれ以下なら0点（らくがきに点数を出さないため）
//   lineShape：線だけの点数のうち、形の重なりの割合／lineLow・lineFull：線だけの点数の 0点・100点の位置
//   full：合計がこれだけあれば100点／curve：1より小さいほど、まんなかの点数が上がる
export const SCORE = { wShape: 0.3, wColor: 0.2, wPlace: 0.5, shapeFull: 0.8, colorFull: 0.6, near1: 0.85, near2: 0.6, far: 0.15, inside: 0.3, ink: 0.15, low: 0.25, full: 0.9, curve: 0.7, lineShape: 0, lineLow: 0.3, lineFull: 0.85 };

// 1つのパートだけを描いた絵を作る（シングルで、自分のパートと見本の同じパートをくらべるときに使う）
export function partPicture(layout, part, ops) {
  const layer = new Layer(layout.regions[part]);
  (ops || []).forEach((op) => layer.apply(op));
  return layer.cv;
}
