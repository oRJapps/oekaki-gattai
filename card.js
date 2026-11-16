// card.js
// 「画像を保存」と「Xでシェア」で使う1枚の画像を作る。
// 合体した絵に、ゲームの背景・タイトル・お題・点数・見本（おてほん）・描いた人の名前・ハッシュタグをつけて、
// どこに貼られても「お絵かき合体」で描いた絵だと分かるようにする。
// 横はばは 1080。たての長さは、絵の形に合わせて変わる（2人なら 1080×1350、5人でたてに長い絵ならもっと長い）。

const W = 1080;
const INK = '#0a0f2e', GOLD = '#ffc928', PINK = '#ff5d8f', SKY = '#3ec5ff', GREEN = '#3ddc84', ORANGE = '#ff9a3c', RED = '#ff5252', PAPER = '#fffdf5';
const DISPLAY = '"Mochiy Pop One", "Hiragino Maru Gothic ProN", "Yu Gothic UI", "Meiryo", sans-serif';
const BODY = '"Zen Maru Gothic", "Hiragino Maru Gothic ProN", "Yu Gothic UI", "Meiryo", sans-serif';

function roundRect(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

// ふちどり＋下の影つきの文字
function sticker(c, text, x, y, size, color, outline = 14, drop = 9) {
  c.font = `${size}px ${DISPLAY}`;
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.lineJoin = 'round';
  c.lineWidth = outline;
  c.strokeStyle = INK;
  c.fillStyle = INK;
  c.strokeText(text, x, y + drop);
  c.fillText(text, x, y + drop);
  c.strokeText(text, x, y);
  c.fillStyle = color;
  c.fillText(text, x, y);
}

function background(c, H) {
  const g = c.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#1e2e84');
  g.addColorStop(0.55, '#101a4d');
  g.addColorStop(1, '#0a1038');
  c.fillStyle = g;
  c.fillRect(0, 0, W, H);
  c.fillStyle = 'rgba(255,255,255,.09)';
  for (let y = 13; y < H; y += 26) for (let x = 13; x < W; x += 26) { c.beginPath(); c.arc(x, y, 2, 0, 7); c.fill(); }
  // らくがき（いつも同じ場所に出るように、決まった数の列から位置を作る）
  let seed = 11;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const colors = [GOLD, PINK, SKY, GREEN, ORANGE];
  c.lineWidth = 6;
  c.lineCap = 'round';
  c.lineJoin = 'round';
  c.globalAlpha = 0.3;
  for (let i = 0; i < Math.round(H / 45); i++) {
    const x = rnd() * W, y = rnd() * H, r = 18 + rnd() * 22, rot = rnd() * 6;
    c.save();
    c.translate(x, y);
    c.rotate(rot);
    c.strokeStyle = colors[i % 5];
    c.beginPath();
    if (i % 4 === 0) { for (let k = 0; k < 5; k++) { const a = -Math.PI / 2 + k * Math.PI * 4 / 5; c[k ? 'lineTo' : 'moveTo'](Math.cos(a) * r, Math.sin(a) * r); } c.closePath(); }
    else if (i % 4 === 1) c.arc(0, 0, r * 0.8, 0, 7);
    else if (i % 4 === 2) { c.moveTo(-r, 0); c.bezierCurveTo(-r / 2, -r, -r / 2, r, 0, 0); c.bezierCurveTo(r / 2, -r, r / 2, r, r, 0); }
    else { c.moveTo(0, -r); c.lineTo(r * 0.9, r * 0.7); c.lineTo(-r * 0.9, r * 0.7); c.closePath(); }
    c.stroke();
    c.restore();
  }
  c.globalAlpha = 1;
}

// drawing：合体した絵のキャンバス（形は自由）、topic：お題、credits：[{ text: '上：なまえ', color }, ...]
// extra：{ score: 点数（数字）、sample: 見本の絵のキャンバス（なければ null） }
export async function makeCard(drawing, topic, credits, extra = {}) {
  // タイトルの丸い文字を、キャンバスに描く前に読みこんでおく（読みこめなくても、ほかの文字で描く）
  try {
    await Promise.all([
      document.fonts.load(`80px "Mochiy Pop One"`, 'お絵かき合体お題つながり度点おてほん#0123456789' + topic),
      document.fonts.load(`700 30px "Zen Maru Gothic"`, credits.map((k) => k.text).join('') + 'orjapps'),
    ]);
  } catch (e) { /* そのまま進む */ }

  // 絵をはる紙の大きさ：横は 860 まで、たては 1500 まで。絵の形はそのまま
  const scale = Math.min(860 / drawing.width, 1500 / drawing.height, 780 / Math.min(drawing.width, drawing.height));
  const pw = Math.round(drawing.width * scale), ph = Math.round(drawing.height * scale);
  const py = 420, px = (W - pw) / 2, pad = 16;
  const H = py + ph + 150;

  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const c = cv.getContext('2d');
  background(c, H);

  // タイトル：1文字ずつ色を変えて、少しかたむける
  const letters = [...'お絵かき合体'], colors = [GOLD, PINK, SKY, GREEN, ORANGE, GOLD];
  const step = 132, startX = W / 2 - step * (letters.length - 1) / 2;
  letters.forEach((ch, i) => {
    c.save();
    c.translate(startX + i * step, 112 + (i % 2 ? 8 : 0));
    c.rotate((i - 2.5) * 0.04);
    sticker(c, ch, 0, 0, 104, colors[i], 18, 11);
    c.restore();
  });

  // お題のパネル
  const bx = 90, by = 210, bw = W - 180, bh = 150;
  roundRect(c, bx, by + 12, bw, bh, 26); c.fillStyle = INK; c.fill();
  const bg = c.createLinearGradient(0, by, 0, by + bh);
  bg.addColorStop(0, '#1746d6');
  bg.addColorStop(1, '#0d2a8a');
  roundRect(c, bx, by, bw, bh, 26); c.fillStyle = bg; c.fill();
  c.lineWidth = 8; c.strokeStyle = GOLD; c.stroke();
  c.font = `26px ${DISPLAY}`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillStyle = GOLD;
  c.fillText('お 題', W / 2, by + 34);
  let size = 78;
  c.font = `${size}px ${DISPLAY}`;
  while (size > 36 && c.measureText(topic).width > bw - 80) { size -= 4; c.font = `${size}px ${DISPLAY}`; }
  sticker(c, topic, W / 2, by + 96, size, '#fff', 12, 6);

  // 絵をはった紙
  roundRect(c, px - pad, py - pad + 14, pw + pad * 2, ph + pad * 2, 30); c.fillStyle = INK; c.fill();
  roundRect(c, px - pad, py - pad, pw + pad * 2, ph + pad * 2, 30); c.fillStyle = PAPER; c.fill();
  c.lineWidth = 8; c.strokeStyle = INK; c.stroke();
  c.fillStyle = '#fff';
  c.fillRect(px, py, pw, ph);
  c.drawImage(drawing, px, py, pw, ph);
  roundRect(c, W / 2 - 62, py - pad - 20, 124, 34, 10); c.fillStyle = PINK; c.fill();
  c.lineWidth = 6; c.strokeStyle = INK; c.stroke();

  // 左上：見本（おてほん）。紙の角に、少しはみ出してはる
  if (extra.sample) {
    const ss = 160, sx = Math.max(14, px - pad - 30), sy = py - pad - 6;
    c.save();
    c.translate(sx + ss / 2, sy + ss / 2);
    c.rotate(-0.05);
    roundRect(c, -ss / 2 - 8, -ss / 2 - 8 + 8, ss + 16, ss + 52, 16); c.fillStyle = INK; c.fill();
    roundRect(c, -ss / 2 - 8, -ss / 2 - 8, ss + 16, ss + 52, 16); c.fillStyle = '#fff'; c.fill();
    c.lineWidth = 6; c.strokeStyle = INK; c.stroke();
    c.drawImage(extra.sample, -ss / 2, -ss / 2, ss, ss);
    c.font = `24px ${DISPLAY}`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillStyle = INK;
    c.fillText('おてほん', 0, ss / 2 + 20);
    c.restore();
  }

  // 右上：点数
  if (typeof extra.score === 'number') {
    c.save();
    c.translate(Math.min(W - 150, px + pw + pad - 110), py - pad + 24);
    c.rotate(0.07);
    roundRect(c, -150, -52 + 8, 300, 104, 22); c.fillStyle = INK; c.fill();
    roundRect(c, -150, -52, 300, 104, 22); c.fillStyle = GOLD; c.fill();
    c.lineWidth = 6; c.strokeStyle = INK; c.stroke();
    c.font = `22px ${DISPLAY}`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillStyle = INK;
    c.fillText('つながり度', 0, -26);
    sticker(c, `${extra.score}点`, 0, 16, 50, RED, 10, 5);
    c.restore();
  }

  // 描いた人（パート：なまえ）
  c.font = `700 30px ${BODY}`;
  c.textBaseline = 'middle';
  c.textAlign = 'left';
  const gap = 14, chipH = 54;
  const widths = credits.map((k) => c.measureText(k.text).width + 78);
  const rowW = widths.reduce((a, b) => a + b, 0) + gap * (credits.length - 1);
  const fit = Math.min(1, (W - 60) / rowW);
  c.save();
  c.translate(W / 2, py + ph + 58);
  c.scale(fit, fit);
  let cx = -rowW / 2;
  credits.forEach((k, i) => {
    roundRect(c, cx, -chipH / 2, widths[i], chipH, chipH / 2); c.fillStyle = '#1c2b6e'; c.fill();
    c.lineWidth = 5; c.strokeStyle = INK; c.stroke();
    c.beginPath(); c.arc(cx + 30, 0, 11, 0, 7); c.fillStyle = k.color; c.fill();
    c.lineWidth = 4; c.stroke();
    c.fillStyle = '#fff';
    c.fillText(k.text, cx + 52, 2);
    cx += widths[i] + gap;
  });
  c.restore();

  // いちばん下：ハッシュタグと場所
  c.textAlign = 'center';
  c.font = `28px ${DISPLAY}`;
  c.fillStyle = GOLD;
  c.fillText('#お絵かき合体', W / 2 - 250, py + ph + 118);
  c.font = `700 26px ${BODY}`;
  c.fillStyle = '#c3cbef';
  c.fillText('orjapps.github.io/oekaki-gattai', W / 2 + 150, py + ph + 118);
  return cv;
}
