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
    this.mask = null; // ぬりつぶしで「範囲の中かどうか」を見る表（三角の範囲のとき、描ける範囲を決めたときに使う）
    this.limit = null; // 描ける範囲（四角）。{ x, y, w, h }。null = パートの範囲ぜんぶ
  }

  // 描ける範囲を決める（見本の絵がある範囲）。この外には、線もぬりつぶしも入らない
  setLimit(box) { this.limit = box || null; this.mask = null; }

  // 絵の座標で描けるようにして、範囲の外にはみ出さないようにする
  inside(fn) {
    const c = this.ctx, b = this.reg.bbox;
    c.save();
    c.setTransform(1, 0, 0, 1, -b.x, -b.y);
    c.clip(this.reg.path);
    if (this.limit) { c.beginPath(); c.rect(this.limit.x, this.limit.y, this.limit.w, this.limit.h); c.clip(); }
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
    if (this.mask || (this.reg.rect && !this.limit)) return this.mask;
    const cv = newCanvas(this.cv.width, this.cv.height), c = cv.getContext('2d');
    c.setTransform(1, 0, 0, 1, -this.reg.bbox.x, -this.reg.bbox.y);
    if (this.limit) { c.clip(this.reg.path); c.fillRect(this.limit.x, this.limit.y, this.limit.w, this.limit.h); }
    else c.fill(this.reg.path);
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
      const m = this.limit;
      if (m && (x < m.x || y < m.y || x > m.x + m.w || y > m.y + m.h)) return; // 描ける範囲の外は、ぬれない
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

  // 描ける範囲（四角）を決める。外はうすく暗くなり、描けなくなる
  setLimit(box) {
    this.limit = box || null;
    this.layer.setLimit(this.limit);
    this.rebuild();
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
    // 描ける範囲（四角）の外を、うすく暗くする。四角のふちに、点線を引く
    if (this.limit) {
      const m = this.limit;
      c.save();
      c.clip(this.reg.path);
      c.beginPath();
      c.rect(b.x, b.y, b.w, b.h);
      c.rect(m.x, m.y, m.w, m.h);
      c.fillStyle = 'rgba(27, 32, 64, .2)';
      c.fill('evenodd');
      c.lineWidth = 4;
      c.strokeStyle = 'rgba(43, 50, 82, .55)';
      c.setLineDash([14, 12]);
      c.strokeRect(m.x, m.y, m.w, m.h);
      c.setLineDash([]);
      c.restore();
    }
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

// ---------- 見本の、パートごとの範囲 ----------
// 絵がある範囲を、つなぎめに沿った座標（u, v）で測る。絵がなければ null
function frameBox(layout, img, i) {
  const f = layout.frame, b = layout.regions[i].bbox;
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  for (let py = 0; py < img.height; py += 2) {
    for (let px = 0; px < img.width; px += 2) {
      if (img.data[(py * img.width + px) * 4 + 3] <= 60) continue;
      const x = px + b.x - f.ox, y = py + b.y - f.oy;
      const u = x * f.tx + y * f.ty, v = x * f.nx + y * f.ny;
      if (u < u0) u0 = u;
      if (u > u1) u1 = u;
      if (v < v0) v0 = v;
      if (v > v1) v1 = v;
    }
  }
  return u1 < u0 ? null : { u0, u1, v0, v1 };
}

// 見本の絵（1000×1000 の座標）を、分け方に合わせて引きのばし、パートごとに切り分ける。
// 返す値：パートごとに { cv: そのパートの見本の絵, box: 描ける範囲（四角。少し余白つき）, fbox: 絵がある範囲（u, v） }
//   box は、描く画面で「ここに描く」と見せる範囲。fbox は、合体のときに各自の絵を合わせる先
export function samplePartLayers(layout, ops) {
  const sx = layout.w / 1000, sy = layout.h / 1000, sw = Math.sqrt(sx * sy);
  const scaled = (ops || []).map((s) => ({ ...s, w: s.w ? s.w * sw : s.w, p: s.p.map((val, k) => val * (k % 2 ? sy : sx)) }));
  const out = layout.regions.map((reg, i) => {
    const layer = new Layer(reg);
    scaled.forEach((op) => layer.apply(op));
    const img = layer.ctx.getImageData(0, 0, layer.cv.width, layer.cv.height), rb = reg.bbox;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let py = 0; py < img.height; py += 2) {
      for (let px = 0; px < img.width; px += 2) {
        if (img.data[(py * img.width + px) * 4 + 3] <= 60) continue;
        if (px < x0) x0 = px;
        if (px > x1) x1 = px;
        if (py < y0) y0 = py;
        if (py > y1) y1 = py;
      }
    }
    if (x1 < x0) return { cv: layer.cv, box: null, fbox: null };
    // 余白：四角の大きいほうの辺の8%（24ドット以上）。パートのふちに近いとき（30ドット以内）は、ふちまで広げる
    const m = Math.max(24, 0.08 * Math.max(x1 - x0, y1 - y0));
    let bx0 = x0 - m, by0 = y0 - m, bx1 = x1 + m, by1 = y1 + m;
    if (bx0 < 30) bx0 = 0;
    if (by0 < 30) by0 = 0;
    if (bx1 > rb.w - 30) bx1 = rb.w;
    if (by1 > rb.h - 30) by1 = rb.h;
    const box = { x: rb.x + Math.round(bx0), y: rb.y + Math.round(by0), w: Math.round(bx1 - bx0), h: Math.round(by1 - by0) };
    return { cv: layer.cv, box, fbox: frameBox(layout, img, i) };
  });
  out.mains = mainSpans(layout, scaled);
  return out;
}

// 見本の「体」が、つなぎめを通る範囲。つなぎめごとに [u0, u1]（なければ null）。
// 体 = つなぎめを通る面（ぬった形）のうち、いちばん広いもの。魚なら、ヒレではなく胴体。
// 人は体の輪かくを描くことが多いので、ヒレや葉まで入れた「絵ぜんぶのはば」ではなく、この範囲に合わせる
function mainSpans(layout, scaledOps) {
  const f = layout.frame;
  return layout.cuts.map((cut) => {
    let best = null, bestArea = 0;
    for (const op of scaledOps) {
      if (!op.g || op.p.length < 6) continue;
      const n = op.p.length / 2, us = [];
      let area = 0;
      for (let k = 0; k < n; k++) {
        const x1 = op.p[2 * k], y1 = op.p[2 * k + 1], x2 = op.p[2 * ((k + 1) % n)], y2 = op.p[2 * ((k + 1) % n) + 1];
        area += x1 * y2 - x2 * y1;
        const v1 = (x1 - f.ox) * f.nx + (y1 - f.oy) * f.ny - cut, v2 = (x2 - f.ox) * f.nx + (y2 - f.oy) * f.ny - cut;
        if ((v1 < 0) === (v2 < 0)) continue; // この辺は、つなぎめを通らない
        const t = v1 / (v1 - v2), x = x1 + (x2 - x1) * t, y = y1 + (y2 - y1) * t;
        us.push((x - f.ox) * f.tx + (y - f.oy) * f.ty);
      }
      area = Math.abs(area) / 2;
      if (us.length < 2) continue;
      const u0 = Math.max(0, Math.min(...us)), u1 = Math.min(layout.edgeLen, Math.max(...us));
      if (u1 - u0 < 40 || area <= bestArea) continue;
      best = [u0, u1]; bestArea = area;
    }
    return best;
  });
}

// 各自の絵を、見本の同じパートの範囲に合わせる方法を決める（大きく描いた人も、小さく描いた人も、同じ大きさと位置にそろえる）。
// 返す値：パートごとに { su, sv, uA, uT, vA, vT }（u' = uT + su(u - uA)、v' = vT + sv(v - vA)）。動かさないパートは null
function registration(layout, layers, targets) {
  const n = layout.count;
  return layers.map((l, i) => {
    const T = targets && targets[i] && targets[i].fbox;
    if (!T) return null;
    const A = frameBox(layout, l.ctx.getImageData(0, 0, l.cv.width, l.cv.height), i);
    if (!A) return null;
    const Au = A.u1 - A.u0, Av = A.v1 - A.v0, Tu = T.u1 - T.u0, Tv = T.v1 - T.v0;
    if (Au < 30 || Av < 30 || Tu < 30 || Tv < 30) return null;
    // 基本は、たても横も同じ倍率（0.8〜2.5倍）。足りない向きだけ、さらに3割まで伸ばす
    const s = clamp(Math.min(Tu / Au, Tv / Av), 0.8, 2.5);
    const su = clamp(Tu / Au, s, s * 1.3);
    let sv = clamp(Tv / Av, s, s * 1.3);
    let uA = (A.u0 + A.u1) / 2, uT = (T.u0 + T.u1) / 2, su2 = su;
    // はしのパート：自分の絵がつなぎめに届いている範囲（輪かくの端から端）を、見本の「体」がつなぎめを通る範囲に合わせる。
    // 魚のように、つなぎめに体とヒレの両方がある絵で、輪かくがヒレのほうへ合ってしまうのを防ぐ
    const seam = n >= 2 && i === 0 ? 0 : n >= 2 && i === n - 1 ? n - 2 : -1;
    const main = seam >= 0 && targets.mains ? targets.mains[seam] : null;
    let byMain = false;
    if (main) {
      const side = i === 0 ? -1 : 1, img = l.ctx.getImageData(0, 0, l.cv.width, l.cv.height), data = [];
      data[i] = img;
      const P = profile(layout, data, i, layout.cuts[seam] + side * gapOf(layout, img, i, layout.cuts[seam], side), side);
      if (P.n && P.len >= 40) {
        su2 = clamp((main[1] - main[0]) / P.len, 0.6, 2.5);
        uA = P.c; uT = (main[0] + main[1]) / 2;
        sv = clamp(su2, 0.6, Math.max(0.6, layout.depth / Av)); // たても同じ倍率。パートの奥行きをこえない
        byMain = true;
      }
    }
    let vA, vT;
    if (n < 2) { vA = (A.v0 + A.v1) / 2; vT = (T.v0 + T.v1) / 2; }
    else if (i === 0) { vA = A.v1; vT = T.v1; } // 最初のパート：つなぎめがわのはしを合わせる
    else if (i === n - 1) { vA = A.v0; vT = T.v0; } // 最後のパート：つなぎめがわのはしを合わせる
    else { sv = clamp(Tv / Av, 0.7, 2.5); vA = (A.v0 + A.v1) / 2; vT = (T.v0 + T.v1) / 2; } // まんなか：両がわのつなぎめに届くように
    if (byMain) { // つなぎめがわのはしを、つなぎめそのものに合わせる（すきまもつめる）
      if (i === 0) vT = layout.cuts[seam]; else vT = layout.cuts[seam];
    }
    if (Math.abs(su2 - 1) < 0.03 && Math.abs(sv - 1) < 0.03 && Math.abs(uT - uA) < 4 && Math.abs(vT - vA) < 4) return null;
    return { su: su2, sv, uA, uT, vA, vT };
  });
}

// ---------- つなぎめを調べる ----------
const WARP_FADE = 260, WARP_STRIPS = 16; // 細かい所を合わせるとき：つなぎめから何ドットまで伸び縮みさせるか、何本の帯に分けるか
const DEPTHS = [3, 8, 14, 20, 27, 34]; // つなぎめから何ドット内側までを「つなぎめにとどいている」と見るか

// 絵が、つなぎめからどれだけ離れているか（すきま）。6ドットより小さいとき、150ドットより大きいときは 0（動かさない）
function gapOf(layout, img, i, cut, side) {
  const f = layout.frame, b = layout.regions[i].bbox, hist = new Uint16Array(152);
  for (let py = 0; py < img.height; py += 2) {
    for (let px = 0; px < img.width; px += 2) {
      if (img.data[(py * img.width + px) * 4 + 3] <= 60) continue;
      const x = px + b.x - f.ox, y = py + b.y - f.oy;
      const d = Math.round(side * (x * f.nx + y * f.ny - cut));
      if (d >= 0 && d <= 151) hist[d]++;
    }
  }
  let sum = 0;
  for (let d = 0; d <= 150; d++) {
    sum += hist[d];
    if (sum >= 8) return d < 6 ? 0 : d;
  }
  return 0;
}

// つなぎめに沿って、絵がある場所の集まり（run）をさがす。side = -1：つなぎめの手前の人、+1：向こうの人
// 絵は「シルエット」で見る：線でかこんだ中も、絵があると数える（線だけで描いた体も、ぬった体と同じはばになる）。
// 細い線（足、ひげ、触角）は、太い所（体）があるときは、はばの計算から外す
const CELL = 4, THIN_RUN = 24, BODY_RUN = 40;
function profile(layout, data, i, cut, side) {
  const f = layout.frame, b = layout.regions[i].bbox, img = data[i];
  const cols = Math.floor(layout.edgeLen / CELL) + 1, rows = Math.max(10, Math.floor(layout.depth / CELL));
  const inkAt = (u, d) => {
    const [x, y] = toWorld(f, u, cut + side * d);
    const px = Math.round(x - b.x), py = Math.round(y - b.y);
    return px >= 0 && py >= 0 && px < img.width && py < img.height && img.data[(py * img.width + px) * 4 + 3] > 60;
  };
  const ink = new Uint8Array(cols * rows);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const u = c * CELL, d = 1 + r * CELL;
    if (inkAt(u, d) || inkAt(u + 2, d) || inkAt(u, d + 2) || inkAt(u + 2, d + 2)) ink[r * cols + c] = 1;
  }
  // 外がわ：つなぎめの反対がわと、左右のはしからたどれる所（つなぎめは「かべ」と見る）
  const outside = new Uint8Array(cols * rows), stack = [];
  for (let c = 0; c < cols; c++) stack.push((rows - 1) * cols + c);
  for (let r = 0; r < rows; r++) stack.push(r * cols, r * cols + cols - 1);
  while (stack.length) {
    const k = stack.pop();
    if (outside[k] || ink[k]) continue;
    outside[k] = 1;
    const c = k % cols;
    if (c > 0) stack.push(k - 1);
    if (c < cols - 1) stack.push(k + 1);
    if (k >= cols) stack.push(k - cols);
    if (k < cols * (rows - 1)) stack.push(k + cols);
  }
  const near = Math.min(rows, Math.ceil(34 / CELL)); // つなぎめから34ドットまでに絵があれば「とどいている」
  // run = [始まり, 終わり, 絵があるますの数, 列の数]
  let runs = [];
  let cur = null, last = -100;
  for (let c = 0; c < cols; c++) {
    let cnt = 0;
    for (let r = 0; r < near; r++) if (!outside[r * cols + c]) cnt++;
    if (!cnt) continue;
    const u = c * CELL;
    if (!cur || u - last > 14) { cur = [u, u, 0, 0]; runs.push(cur); }
    cur[1] = u; cur[2] += cnt; cur[3]++;
    last = u;
  }
  if (!runs.length) return { n: 0, len: 0, a: 0, b: 0, c: layout.edgeLen / 2 };
  // 太い所（体）：はばが40以上で、つなぎめの近くがほぼ全部うまっている。体があるときは、細い線（はばがせまい、または、ななめの線ですかすか）を外す
  const solid = (r) => r[2] / (r[3] * near) >= 0.6;
  if (runs.some((r) => r[1] - r[0] >= BODY_RUN && solid(r))) runs = runs.filter((r) => r[1] - r[0] >= THIN_RUN && solid(r));
  const a = runs[0][0], z = runs[runs.length - 1][1];
  return { n: runs.length, len: Math.max(2, z - a), a, b: z, c: (a + z) / 2 };
}

// 目印どうしを組にする（数がちがってもよい）：近い目印どうしを、順番を入れかえずに組にする
function pairMarks(src, dst, tol) {
  const pairs = [];
  let i = 0, j = 0;
  while (i < src.length && j < dst.length) {
    const diff = Math.abs(src[i] - dst[j]);
    if (diff <= tol) {
      if (j + 1 < dst.length && Math.abs(src[i] - dst[j + 1]) < diff) { j++; continue; }
      if (i + 1 < src.length && Math.abs(src[i + 1] - dst[j]) < diff) { i++; continue; }
      pairs.push([i, j]);
      i++; j++;
    } else if (src[i] < dst[j]) i++;
    else j++;
  }
  return pairs;
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

// つなぎめの「目印」をさがす：つなぎめに沿って見たときに、色が変わる所と、線が通っている所。
// 例：せんべいなら「輪かくの左端、ノリの左端、ノリの右端、輪かくの右端」の4つ。
// つなぎめのすぐ近く（20ドットより手前）は見ない（つなぎめに沿ってなぞった線にじゃまされないように）
const MARK_DEPTHS = [20, 28, 36], THICK = 24;
function marks(layout, data, i, cut, side) {
  const f = layout.frame, b = layout.regions[i].bbox, img = data[i];
  // 色の種類：0 = 何もない、1 = 黒っぽい、2〜7 = 色あい（60度ずつ）、8 = 灰色・白っぽい
  const cls = (u, depth) => {
    const [x, y] = toWorld(f, u, cut + side * depth);
    const px = Math.round(x - b.x), py = Math.round(y - b.y);
    if (px < 0 || py < 0 || px >= img.width || py >= img.height) return 0;
    const k = (py * img.width + px) * 4;
    if (img.data[k + 3] <= 60) return 0;
    const r = img.data[k], g = img.data[k + 1], bl = img.data[k + 2];
    if (0.3 * r + 0.59 * g + 0.11 * bl < 75) return 1;
    const max = Math.max(r, g, bl), min = Math.min(r, g, bl);
    if (max - min < 40) return 8;
    let hue = max === r ? ((g - bl) / (max - min)) % 6 : max === g ? (bl - r) / (max - min) + 2 : (r - g) / (max - min) + 4;
    if (hue < 0) hue += 6;
    return 2 + (Math.floor(hue) % 6);
  };
  // つなぎめに沿って、同じ色の種類が続く区間（run）に分ける
  const runs = [];
  for (let u = 0; u <= layout.edgeLen; u += 2) {
    const c3 = MARK_DEPTHS.map((d) => cls(u, d));
    const c = c3[0] === c3[1] || c3[0] === c3[2] ? c3[0] : c3[1]; // 3か所のうち、多いほう
    const last = runs[runs.length - 1];
    if (last && last.c === c) last.z = u; else runs.push({ c, a: u, z: u });
  }
  // 太い区間どうしのさかいめ＝目印。間にある細い区間（線）は、そのまんなかを目印にする
  const out = [];
  let prev = null, inkA = null, inkZ = null;
  for (const r of runs) {
    if (r.z - r.a < THICK - 2) { // 細い区間
      if (r.c !== 0) { if (inkA === null) inkA = r.a; inkZ = r.z; }
      continue;
    }
    if (prev && (prev.c !== r.c || inkA !== null)) out.push(inkA !== null ? (inkA + inkZ) / 2 : (prev.z + r.a) / 2);
    prev = r; inkA = null; inkZ = null;
  }
  // 近すぎる目印は、1つにまとめる
  const merged = [];
  for (const u of out) {
    if (merged.length && u - merged[merged.length - 1] < THICK) merged[merged.length - 1] = (merged[merged.length - 1] + u) / 2;
    else merged.push(u);
  }
  return merged;
}

// つなぎめごとに、どれだけうまくつながっているかを調べて、合わせ方（拡大・縮小とずらし）と点数を決める
// tight：先に見本の範囲へ合わせてあるとき。つなぎめ合わせの拡大・縮小を、ひかえめにする（1.25倍まで、0.85倍まで）
// mains・fixed：見本の「体」がつなぎめを通る範囲と、見本そのものを描いたパート（シングルの CPU）の番号。
//   CPU のパートのはばは、ヒレなどをふくめず、体の範囲と見る
function analyze(layout, layers, tight = false, mains = null, fixed = -1) {
  const data = layers.map((l) => l.ctx.getImageData(0, 0, l.cv.width, l.cv.height));
  const n = layout.count;
  // fit[i] = { lo, hi }：パート i の、手前のつなぎめ（lo）と向こうのつなぎめ（hi）での合わせ方
  //   { s: 倍率, P: もとの中心, Q: 合わせたあとの中心, cut: つなぎめの位置 }
  const fit = Array.from({ length: n }, () => ({ lo: null, hi: null, sv: 1 }));
  const joints = [];
  // はしのパート（つなぎめが1つ）で、絵がつなぎめまで届いていないときは、すきまをつめる。
  // gaps[i]：パート i の絵が、つなぎめから離れている長さ（まんなかのパートは 0）
  const gaps = Array.from({ length: n }, (_, i) => {
    if (n < 2 || (i > 0 && i < n - 1)) return 0;
    return i === 0 ? gapOf(layout, data[0], 0, layout.cuts[0], -1) : gapOf(layout, data[i], i, layout.cuts[i - 1], 1);
  });
  layout.cuts.forEach((cut, k) => {
    let A = profile(layout, data, k, cut - gaps[k], -1), B = profile(layout, data, k + 1, cut + gaps[k + 1], 1);
    const main = mains && mains[k];
    const asMain = (P) => (main && P.n ? { n: P.n, len: main[1] - main[0], a: main[0], b: main[1], c: (main[0] + main[1]) / 2 } : P);
    if (fixed === k) A = asMain(A);
    if (fixed === k + 1) B = asMain(B);
    let sA = 1, sB = 1;
    // 大きいほうに合わせる：大きいほうの絵は動かさず、小さいほうの絵を大きくして、位置もそろえる（2倍まで）
    const Q = A.n && B.n ? (A.len >= B.len ? A.c : B.c) : null;
    if (A.n && B.n && A.len >= 40 && B.len >= 40) {
      const L = Math.max(A.len, B.len);
      sA = clamp(L / A.len, 1, tight ? 1.25 : 2);
      sB = clamp(L / B.len, 1, tight ? 1.25 : 2);
    }
    if (Q !== null) {
      fit[k].hi = { s: sA, P: A.c, Q, cut, gap: gaps[k] };
      fit[k + 1].lo = { s: sB, P: B.c, Q, cut, gap: gaps[k + 1] };
    }
    joints.push({ A, B, sA, sB, Q, gapA: gaps[k], gapB: gaps[k + 1] });
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
    big.s = Math.max(tight ? 0.85 : 0.7, big.s * ratio); // 小さくしすぎると、頭だけ小さい絵になるので、7割まで
    const ft = fit[bigIdx];
    if (!ft.lo || !ft.hi) ft.sv = big.s; // はしのパート：たても横も同じ倍率で小さくする（形をゆがめない）
  });

  // 細かい所を合わせる：両方の絵で、近い目印どうしの組が3つ以上できたら、目印どうしが重なるように、
  // 片方の絵をつなぎめの近くだけ、場所ごとに伸び縮みさせる（せんべいの輪かくとノリを、両方合わせる）。
  // 動かすのは、はしのパート。2人のときは、小さいほうの絵（大きいほうは動かさない）
  joints.forEach((j, k) => {
    const fa = fit[k].hi, fb = fit[k + 1].lo;
    if (!fa || !fb) return;
    const endA = !fit[k].lo, endB = !fit[k + 1].hi;
    if (!endA && !endB) return; // まんなかのパートどうし：今までどおり
    const moveB = endA && endB ? j.A.len >= j.B.len : endB;
    const cut = layout.cuts[k];
    const mA = marks(layout, data, k, cut - gaps[k], -1), mB = marks(layout, data, k + 1, cut + gaps[k + 1], 1);
    j.mA = mA; j.mB = mB;
    if (mA.length < 3 || mB.length < 3) return;
    const [srcAll, e, refMarks, ref] = moveB ? [mB, fb, mA, fa] : [mA, fa, mB, fb];
    const dstAll = refMarks.map((u) => ref.Q + ref.s * (u - ref.P));
    const spanAll = dstAll[dstAll.length - 1] - dstAll[0];
    if (spanAll < 60) return;
    // 目印どうしを組にする。遠すぎる目印（ちがう物どうしを合わせてしまいそうなもの）は、組にしない
    const pairs = pairMarks(srcAll.map((u) => e.Q + e.s * (u - e.P)), dstAll, Math.max(30, 0.1 * spanAll));
    const src = [], dst = [];
    for (const [a, b] of pairs) {
      if (src.length && (srcAll[a] - src[src.length - 1] < 8 || dstAll[b] - dst[dst.length - 1] < 8)) continue;
      src.push(srcAll[a]); dst.push(dstAll[b]);
    }
    if (src.length < 3 || dst[dst.length - 1] - dst[0] < 60) return;
    e.warp = { src, dst };
    j.warp = moveB ? 'B' : 'A';
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
// hooks：{ onFit(), onDone(result), targets, cpuPart }。result = { score, scores }
//   cpuPart：見本そのものを描いたパートの番号（シングルの CPU）。なければ入れない
//   targets：見本のパートごとの範囲（samplePartLayers の返す値）。あれば、先に各自の絵を見本の範囲に合わせてから、つなぎめを合わせる
export function startReveal(canvas, layout, partsOps, hooks = {}) {
  canvas.width = layout.w;
  canvas.height = layout.h;
  canvas.style.setProperty('--ratio', String(layout.w / layout.h));
  const ctx = canvas.getContext('2d');
  let layers = layout.regions.map((r) => new Layer(r));
  const targets = hooks.targets || null;
  if (targets) layers.forEach((l, i) => { if (targets[i] && targets[i].box) l.setLimit(targets[i].box); }); // 描いたときと同じ「描ける範囲」にする（ぬりつぶしが同じ結果になるように）
  const tasks = [];
  partsOps.forEach((ops, pi) => (ops || []).forEach((op) => {
    if (op.f || op.g) tasks.push([pi, op, -1]);
    else for (let i = 0; i < op.p.length / 2; i++) tasks.push([pi, op, i]);
  }));
  const perFrame = Math.max(3, Math.ceil(tasks.length / 200)); // 描くところは全体で約3秒
  const f = layout.frame;
  let k = 0, timer = null, stopped = false, result = null, amount = 0;

  // 絵の座標での変形を、キャンバスにセットする。u' = Q + a(u - P)、v' = C + b(v - C)
  // Ct：C の行き先（すきまをつめるとき、つなぎめのほうへ動かす）
  function warpMatrix(a, b, Q, P, C, Ct = C) {
    const m11 = f.tx * a * f.tx + f.nx * b * f.nx, m12 = f.tx * a * f.ty + f.nx * b * f.ny;
    const m21 = f.ty * a * f.tx + f.ny * b * f.nx, m22 = f.ty * a * f.ty + f.ny * b * f.ny;
    const du = Q - a * P, dv = Ct - b * C;
    const ex = f.ox + f.tx * du + f.nx * dv - (m11 * f.ox + m12 * f.oy);
    const ey = f.oy + f.ty * du + f.ny * dv - (m21 * f.ox + m22 * f.oy);
    return [m11, m21, m12, m22, ex, ey];
  }
  function setWarp(a, b, Q, P, C, Ct = C) { ctx.setTransform(...warpMatrix(a, b, Q, P, C, Ct)); }

  // つなぎめの点線
  function drawDividers() {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
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

  // 第1段階：各自の絵を、見本の同じパートの範囲に合わせる。t = 0：描いたまま、t = 1：合わせた形
  let regs = null;
  function composeReg(t) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, layout.w, layout.h);
    layers.forEach((layer, i) => {
      const b = layer.reg.bbox, g = regs && regs[i];
      if (!g) { ctx.drawImage(layer.cv, b.x, b.y); return; }
      ctx.save();
      ctx.clip(layer.reg.path);
      setWarp(1 + (g.su - 1) * t, 1 + (g.sv - 1) * t, g.uA + (g.uT - g.uA) * t, g.uA, g.vA, g.vA + (g.vT - g.vA) * t);
      ctx.drawImage(layer.cv, b.x, b.y);
      ctx.restore();
    });
    drawDividers();
  }
  // 第1段階の結果を、新しい紙（レイヤー）に写す。このあとのつなぎめ合わせは、この紙を使う
  function bake() {
    layers = layers.map((layer, i) => {
      const g = regs && regs[i];
      if (!g) return layer;
      const b = layer.reg.bbox, cv = newCanvas(layer.cv.width, layer.cv.height), c = cv.getContext('2d', { willReadFrequently: true });
      const m = warpMatrix(g.su, g.sv, g.uT, g.uA, g.vA, g.vT);
      c.setTransform(1, 0, 0, 1, -b.x, -b.y);
      c.clip(layer.reg.path);
      c.setTransform(m[0], m[1], m[2], m[3], m[4] - b.x, m[5] - b.y);
      c.drawImage(layer.cv, b.x, b.y);
      c.setTransform(1, 0, 0, 1, 0, 0);
      return { reg: layer.reg, cv, ctx: c };
    });
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
      const e0 = ft.lo || ft.hi;
      if ((!ft.lo || !ft.hi) && e0.warp) {
        // はしのパート（細かい所も合わせる）：絵をます目に分けて、つなぎめに近いますほど、目印が重なるように伸び縮みさせる
        const dir = ft.lo ? 1 : -1, bt = 1 + (ft.sv - 1) * t, W = e0.warp, K = W.src.length, gap = e0.gap || 0;
        const C0 = e0.cut + dir * gap, C1 = C0 - dir * gap * t; // 絵のいちばん手前（C0）を、つなぎめ（cut）へ動かす
        const uni = (u) => e0.Q + e0.s * (u - e0.P); // 今までの合わせ方（全体を同じ倍率で）
        const g = (u) => { // 目印を重ねる合わせ方
          if (u <= W.src[0]) return W.dst[0] + e0.s * (u - W.src[0]);
          if (u >= W.src[K - 1]) return W.dst[K - 1] + e0.s * (u - W.src[K - 1]);
          let m = 1;
          while (W.src[m] < u) m++;
          return W.dst[m - 1] + (W.dst[m] - W.dst[m - 1]) * (u - W.src[m - 1]) / (W.src[m] - W.src[m - 1]);
        };
        const breaks = [-300, ...W.src, layout.edgeLen + 300];
        for (let sIdx = 0; sIdx <= WARP_STRIPS; sIdx++) {
          const d0 = sIdx ? sIdx * WARP_FADE / WARP_STRIPS : -(gap + 8), d1 = sIdx < WARP_STRIPS ? (sIdx + 1) * WARP_FADE / WARP_STRIPS : 4000;
          const w = sIdx < WARP_STRIPS ? 1 - (sIdx + 0.5) / WARP_STRIPS : 0; // つなぎめから離れるほど、弱くする
          const F = (u) => u + t * (uni(u) + w * (g(u) - uni(u)) - u);
          const V = (d) => C1 + dir * d * bt;
          for (let c = 0; c < breaks.length - 1; c++) {
            const u0 = breaks[c], u1 = breaks[c + 1], U0 = F(u0), U1 = F(u1);
            if (U1 - U0 < 0.01) continue;
            ctx.save();
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.beginPath();
            [[U0 - 0.6, V(d0) - dir * 0.6], [U1 + 0.6, V(d0) - dir * 0.6], [U1 + 0.6, V(d1) + dir * 0.6], [U0 - 0.6, V(d1) + dir * 0.6]].forEach(([u, v], idx) => {
              const [x, y] = toWorld(f, u, v);
              if (idx) ctx.lineTo(x, y); else ctx.moveTo(x, y);
            });
            ctx.clip();
            setWarp((U1 - U0) / (u1 - u0), bt, U0, u0, C0, C1);
            ctx.drawImage(layer.cv, b.x, b.y);
            ctx.restore();
          }
        }
      } else if (!ft.lo || !ft.hi) { // はしのパート：つなぎめを動かさずに、全体を同じ倍率で大きく（小さく）する
        const e = mix(ft.lo || ft.hi), gap = e0.gap || 0, C0 = e.cut + (ft.lo ? 1 : -1) * gap;
        setWarp(e.s, 1 + (ft.sv - 1) * t, e.Q, e.P, C0, C0 - (ft.lo ? 1 : -1) * gap * t); // すきまがあれば、つなぎめのほうへつめる
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
    if (hooks.onFit) hooks.onFit();
    // 第1段階：見本の範囲に合わせる（見本があるときだけ）
    regs = targets ? registration(layout, layers, targets) : null;
    if (regs && regs.some(Boolean)) {
      const began1 = Date.now();
      const regFrame = () => {
        if (stopped) return;
        const raw = Math.min(1, (Date.now() - began1) / 1000);
        composeReg(raw < 0.5 ? 2 * raw * raw : 1 - Math.pow(-2 * raw + 2, 2) / 2);
        if (raw < 1) { timer = setTimeout(regFrame, 16); return; }
        bake();
        regs = null;
        seamStage(200);
      };
      timer = setTimeout(regFrame, 400);
      return;
    }
    seamStage(500);
  }

  // 第2段階：つなぎめを合わせる
  function seamStage(wait) {
    result = analyze(layout, layers, !!targets, targets && targets.mains, Number.isInteger(hooks.cpuPart) ? hooks.cpuPart : -1);
    const began = Date.now();
    const fitFrame = () => {
      if (stopped) return;
      const raw = Math.min(1, (Date.now() - began) / 1300);
      amount = raw < 0.5 ? 2 * raw * raw : 1 - Math.pow(-2 * raw + 2, 2) / 2;
      compose(amount, raw < 1);
      if (raw < 1) { timer = setTimeout(fitFrame, 16); return; }
      if (hooks.onDone) hooks.onDone({ score: result.score, scores: result.scores, joints: result.joints, fit: result.fit });
    };
    timer = setTimeout(fitFrame, wait);
  }
  drawFrame();

  return {
    stop() { stopped = true; clearTimeout(timer); },
    // パートごとの絵（見本の範囲に合わせたあとのもの）。点数をパートごとにつけるときに使う
    partCanvases() { return layers.map((l) => l.cv); },
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
  const easy = Math.max(colored, lined);
  if (easy <= SCORE.topFrom) return Math.round(100 * easy);
  // 高い点数（60点より上）は、きびしく見る：見本にかなり近くないと 90点以上にならない。100点は、ほぼ見本どおりのときだけ
  const lin = (x, lo, hi) => Math.max(0, Math.min(1, (x - lo) / (hi - lo)));
  const strict = Math.max(lin(raw, SCORE.low, SCORE.topFull), lin(rawLine, SCORE.lineLow, SCORE.topLineFull));
  const top = SCORE.topFrom + (1 - SCORE.topFrom) * lin(strict, SCORE.strictLow, SCORE.strictHigh);
  return Math.round(100 * Math.max(SCORE.topFrom, Math.min(easy, top)));
}
// 点数のきびしさ。人が指で描いた絵でも点数が出るように、やさしめにしてある
//   shapeFull：形がこれだけ重なれば満点／colorFull：色の割合がこれだけ同じなら満点
//   near1・near2・far：色あいが 1つとなり・2つとなり・それより遠いときの部分点／inside：線だけ、ぬっていないときの部分点
//   ink：黒い線と色つきの所の部分点／low：合計がこれ以下なら0点（らくがきに点数を出さないため）
//   lineShape：線だけの点数のうち、形の重なりの割合／lineLow・lineFull：線だけの点数の 0点・100点の位置
//   topFrom：この点数より上は、きびしく見る／topFull・topLineFull：きびしく見るときの100点の位置／strictLow・strictHigh：きびしい点数を topFrom〜100点 に直すときの両はし
//   full：合計がこれだけあれば100点／curve：1より小さいほど、まんなかの点数が上がる
export const SCORE = { wShape: 0.3, wColor: 0.2, wPlace: 0.5, shapeFull: 0.8, colorFull: 0.6, near1: 0.85, near2: 0.6, far: 0.15, inside: 0.3, ink: 0.15, low: 0.25, full: 0.9, curve: 0.7, lineShape: 0, lineLow: 0.3, lineFull: 0.85,
  topFrom: 0.6, topFull: 1, topLineFull: 0.98, strictLow: 0.5, strictHigh: 0.97 };

// 1つのパートだけを描いた絵を作る（シングルで、自分のパートと見本の同じパートをくらべるときに使う）
export function partPicture(layout, part, ops) {
  const layer = new Layer(layout.regions[part]);
  (ops || []).forEach((op) => layer.apply(op));
  return layer.cv;
}
