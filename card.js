// card.js
// 「画像を保存」と「Xでシェア」で使う1枚の画像を作る。
// 合体した絵に、ゲームの背景・タイトル・お題・描いた人の名前・ハッシュタグをつけて、
// どこに貼られても「お絵かき合体」で描いた絵だと分かるようにする。
// 大きさは 1080×1350（X やスマホで大きく表示される、たて長の 4:5）。

const W = 1080, H = 1350;
const INK = '#0a0f2e', GOLD = '#ffc928', PINK = '#ff5d8f', SKY = '#3ec5ff', GREEN = '#3ddc84', ORANGE = '#ff9a3c', PAPER = '#fffdf5';
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

function background(c) {
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
  for (let i = 0; i < 30; i++) {
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

// drawing：合体した絵（正方形のキャンバス）、topic：お題、credits：[{ text: '上：なまえ', color: '#ff5252' }, ...]
export async function makeCard(drawing, topic, credits) {
  // タイトルの丸い文字を、キャンバスに描く前に読みこんでおく（読みこめなくても、ほかの文字で描く）
  try {
    await Promise.all([
      document.fonts.load(`80px "Mochiy Pop One"`, 'お絵かき合体お題#' + topic),
      document.fonts.load(`700 30px "Zen Maru Gothic"`, credits.map((k) => k.text).join('') + 'orjapps'),
    ]);
  } catch (e) { /* そのまま進む */ }

  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const c = cv.getContext('2d');
  background(c);

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
  const ps = 780, px = (W - ps) / 2, py = 420, pad = 16;
  roundRect(c, px - pad, py - pad + 14, ps + pad * 2, ps + pad * 2, 30); c.fillStyle = INK; c.fill();
  roundRect(c, px - pad, py - pad, ps + pad * 2, ps + pad * 2, 30); c.fillStyle = PAPER; c.fill();
  c.lineWidth = 8; c.strokeStyle = INK; c.stroke();
  c.fillStyle = '#fff';
  c.fillRect(px, py, ps, ps);
  c.drawImage(drawing, px, py, ps, ps);
  roundRect(c, W / 2 - 62, py - pad - 20, 124, 34, 10); c.fillStyle = PINK; c.fill();
  c.lineWidth = 6; c.strokeStyle = INK; c.stroke();

  // 描いた人（パート：なまえ）
  c.font = `700 30px ${BODY}`;
  c.textBaseline = 'middle';
  c.textAlign = 'left';
  const gap = 14, chipH = 54;
  const widths = credits.map((k) => c.measureText(k.text).width + 78);
  let rowW = widths.reduce((a, b) => a + b, 0) + gap * (credits.length - 1);
  const scale = Math.min(1, (W - 80) / rowW);
  c.save();
  c.translate(W / 2, 1258);
  c.scale(scale, scale);
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
  c.fillText('#お絵かき合体', W / 2 - 250, 1318);
  c.font = `700 26px ${BODY}`;
  c.fillStyle = '#c3cbef';
  c.fillText('orjapps.github.io/oekaki-gattai', W / 2 + 150, 1318);
  return cv;
}
