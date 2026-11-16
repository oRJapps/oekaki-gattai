// samples.js
// 見本の絵（おてほん）を描く道具と、読みこむ関数。合体した絵の左上に、小さく出す。
// 絵そのものは samples/ フォルダの中に、種類ごとのファイルで置いてある（全部で300こ）。
// 合体のときに、そのお題のファイル1つだけを読みこむ（最初の読みこみを軽くするため）。
// 実物に近い形と色で描く（食べ物には顔をつけない）。1000×1000 の座標。
// 絵の部品は2種類：
//   線      { c: 色, w: 太さ, e: 0, p: [x0, y0, x1, y1, ...] }（draw.js の線と同じ）
//   ぬった面 { g: 1, c: 色, p: [x0, y0, x1, y1, ...] }（点をつないだ形の中をぬる。draw.js の drawSample だけが使う）

const RED = '#e53935', DRED = '#9f1d1d', ORANGE = '#fb8c00', DORANGE = '#c25e00', YELLOW = '#fdd835', GOLD = '#f2a900', DGOLD = '#a87400';
const GREEN = '#4caf50', DGREEN = '#256b2a', LGREEN = '#a5d66f', BLUE = '#1e88e5', DBLUE = '#0d4f9e', SKY = '#9bdcf7', NAVY = '#263238';
const PINK = '#f8a5c2', DPINK = '#d6497f', BROWN = '#8d5a2b', DBROWN = '#4e2f14', TAN = '#e2b276', CREAM = '#fff3d6', WHITE = '#ffffff';
const GRAY = '#9aa5ab', LGRAY = '#dfe4e7', DGRAY = '#4f5b62', BLACK = '#1e1e1e', PURPLE = '#8e24aa', INK = '#3b2a1e';

const flat = (pts) => pts.flat().map(Math.round);
const fillOp = (c, pts) => ({ g: 1, c, p: flat(pts) });
const lineOp = (c, w, pts) => ({ c, w, e: 0, p: flat(pts) });

// だ円の上の点。a0〜a1 度（0度が右、90度が下）。rot：かたむき（度）
function ellPts(cx, cy, rx, ry, rot = 0, a0 = 0, a1 = 360, n = 40) {
  const r = rot * Math.PI / 180, cr = Math.cos(r), sr = Math.sin(r), out = [];
  for (let i = 0; i <= n; i++) {
    const a = (a0 + (a1 - a0) * i / n) * Math.PI / 180;
    const x = rx * Math.cos(a), y = ry * Math.sin(a);
    out.push([cx + x * cr - y * sr, cy + x * sr + y * cr]);
  }
  return out;
}

// 点をなめらかな曲線でつなぐ（closed：輪にする）
function smooth(pts, closed = false, seg = 8) {
  const n = pts.length, out = [];
  const at = (i) => (closed ? pts[(i + n) % n] : pts[Math.min(n - 1, Math.max(0, i))]);
  const last = closed ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
    for (let j = 0; j < seg; j++) {
      const t = j / seg, t2 = t * t, t3 = t2 * t;
      out.push([
        0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
        0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3),
      ]);
    }
  }
  if (!closed) out.push(pts[n - 1]);
  return out;
}

// 形：中をぬって、ふちに線を引く。fill か out を null にすると、その分は描かない
const shape = (pts, fill, out = INK, w = 10) => [fill ? fillOp(fill, pts) : null, out ? lineOp(out, w, [...pts, pts[0]]) : null].filter(Boolean);
const E = (cx, cy, rx, ry, fill, out = INK, w = 10, rot = 0) => shape(ellPts(cx, cy, rx, ry, rot).slice(0, -1), fill, out, w); // だ円
const C = (pts, fill, out = INK, w = 10) => shape(smooth(pts, true), fill, out, w);  // なめらかな形
const P = (pts, fill, out = INK, w = 10) => shape(pts, fill, out, w);                // 角のある形
const D = (x, y, r, c) => E(x, y, r, r, c, null);                                    // ぬった丸
const L = (pts, c = INK, w = 10) => [lineOp(c, w, pts)];                             // 折れ線
const Q = (pts, c = INK, w = 10) => [lineOp(c, w, smooth(pts))];                     // なめらかな線
const A = (cx, cy, rx, ry, a0, a1, c = INK, w = 10, rot = 0) => [lineOp(c, w, ellPts(cx, cy, rx, ry, rot, a0, a1))]; // 弧
const T = (pts, fill, out = INK, w = 40) => [lineOp(out, w + 18, smooth(pts)), lineOp(fill, w, smooth(pts))];       // 太い管（しっぽ、首など）

// 角の丸い四角
function R(x1, y1, x2, y2, fill, out = INK, w = 10, r = 0) {
  if (!r) return shape([[x1, y1], [x2, y1], [x2, y2], [x1, y2]], fill, out, w);
  const q = (cx, cy, a0) => ellPts(cx, cy, r, r, 0, a0, a0 + 90, 6);
  return shape([...q(x2 - r, y1 + r, 270), ...q(x2 - r, y2 - r, 0), ...q(x1 + r, y2 - r, 90), ...q(x1 + r, y1 + r, 180)], fill, out, w);
}

// だ円の上半分（下が平らな山の形）
const dome = (cx, cy, rx, ry, fill, out = INK, w = 10) => shape(ellPts(cx, cy, rx, ry, 0, 180, 360), fill, out, w);

// 中心から外へ出る線
const rays = (cx, cy, r0, r1, count, c, w, a0 = 0, a1 = 360) => Array.from({ length: count }, (_, i) => {
  const a = (a0 + (a1 - a0) * i / (a1 - a0 >= 360 ? count : count - 1)) * Math.PI / 180;
  return lineOp(c, w, [[cx + r0 * Math.cos(a), cy + r0 * Math.sin(a)], [cx + r1 * Math.cos(a), cy + r1 * Math.sin(a)]]);
});

// 車輪（タイヤとホイール）
const wheel = (x, y, r) => [E(x, y, r, r, '#2b2f33', BLACK, 8), E(x, y, r * 0.5, r * 0.5, LGRAY, DGRAY, 6), D(x, y, r * 0.14, DGRAY)];

// 花：花びら n まい。len = 花びらの長さ、wid = はば、cr = まんなかの丸の大きさ
const flower = (cx, cy, n, len, wid, fill, out, center, cr, rot0 = -90) => [
  Array.from({ length: n }, (_, i) => { const a = rot0 + i * 360 / n, r = a * Math.PI / 180; return E(cx + Math.cos(r) * len * 0.55, cy + Math.sin(r) * len * 0.55, len * 0.5, wid * 0.5, fill, out, 6, a); }),
  center ? E(cx, cy, cr, cr, center, out, 6) : null,
];
// 葉：2つの点の間に、葉の形を描く
const leaf = (x1, y1, x2, y2, fill = GREEN, out = DGREEN, fat = 0.28) => {
  const dx = x2 - x1, dy = y2 - y1, nx = -dy * fat, ny = dx * fat;
  return [C([[x1, y1], [x1 + dx * 0.45 + nx, y1 + dy * 0.45 + ny], [x2, y2], [x1 + dx * 0.45 - nx, y1 + dy * 0.45 - ny]], fill, out, 7), L([[x1, y1], [x2, y2]], out, 4)];
};
// 目（黒い丸と、白い光）
const eyes = (x1, x2, y, r = 16, c = BLACK) => [D(x1, y, r, c), D(x2, y, r, c), D(x1 + r * 0.35, y - r * 0.35, r * 0.33, WHITE), D(x2 + r * 0.35, y - r * 0.35, r * 0.33, WHITE)];
// すわった動物の体（前から見た形）。belly = おなかの色
const sitBody = (col, out, belly = null) => [
  C([[335, 870], [305, 660], [365, 500], [500, 460], [635, 500], [695, 660], [665, 870]], col, out, 12),
  belly ? C([[425, 600], [500, 575], [575, 600], [585, 790], [500, 840], [415, 790]], belly, null) : null,
  L([[440, 660], [440, 865]], out, 8), L([[560, 660], [560, 865]], out, 8),
  E(400, 868, 62, 28, belly || col, out, 8), E(600, 868, 62, 28, belly || col, out, 8),
];
// 鼻と口（前から見た動物）。y = 鼻の下の高さ
const muzzle = (y, out, nose = BLACK) => [E(500, y - 12, 30, 22, nose, null), L([[500, y + 8], [500, y + 30]], out, 6), Q([[460, y + 34], [500, y + 54], [540, y + 34]], out, 7)];
// 4本足の動物の体（横から見た形、左むき）。o：{ bx, by, rx, ry = 体のだ円、leg = 足の長さ、lw = 足の太さの半分、hoof = ひづめの色、shade = 向こうがわの足の色 }
const quad = (col, out, o = {}) => {
  const { bx = 560, by = 540, rx = 240, ry = 140, leg = 230, lw = 36, hoof = null, shade = col } = o;
  const top = by + ry * 0.5;
  return [
    [bx - rx * 0.62, bx - rx * 0.32, bx + rx * 0.36, bx + rx * 0.68].map((x, i) => [R(x - lw, top, x + lw, top + leg, i % 2 ? shade : col, out, 9, 14), hoof ? R(x - lw, top + leg - 34, x + lw, top + leg, hoof, out, 8, 8) : null]),
    E(bx, by, rx, ry, col, out, 12),
  ];
};

// 絵のファイルにわたす道具ひとそろい
const KIT = {
  RED, DRED, ORANGE, DORANGE, YELLOW, GOLD, DGOLD, GREEN, DGREEN, LGREEN, BLUE, DBLUE, SKY, NAVY, PINK, DPINK, BROWN, DBROWN, TAN, CREAM, WHITE, GRAY, LGRAY, DGRAY, BLACK, PURPLE, INK,
  fillOp, lineOp, ellPts, smooth, shape, E, C, P, D, L, Q, A, T, R, dome, rays, wheel, flower, leaf, eyes, sitBody, muzzle, quad,
};

// このファイルを読みこんだときの番号（?v=…）。絵のファイルにも同じ番号をつけて、古い版が残らないようにする
const VER = new URL(import.meta.url).search;
const loaded = {}; // ファイル名 → その中の絵（お題 → 絵を作る関数）

// お題の見本の絵（線とぬった面のならび）を読みこむ。file = samples/ の中のファイル名。見本がないときは null
// flip = true のときは、左右を逆にする（右向きに描いた絵を、左向きで出す）
export async function loadSample(topic, file, flip = false) {
  if (!file || !/^[a-z0-9]+$/.test(file)) return null;
  try {
    if (!loaded[file]) loaded[file] = (await import(`./samples/${file}.js${VER}`)).default(KIT);
    const make = loaded[file][topic];
    if (!make) return null;
    const ops = make().flat(Infinity).filter(Boolean);
    return flip ? ops.map((op) => ({ ...op, p: op.p.map((v, i) => (i % 2 ? v : 1000 - v)) })) : ops;
  } catch (err) {
    console.warn('sample', file, err);
    return null;
  }
}
