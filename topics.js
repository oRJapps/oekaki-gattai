// topics.js
// お題と難易度。お題は全部で36こ（初級12、中級12、上級12）。どのお題にも、見本の絵（samples.js）がある。
// 難易度が上がると、お題がむずかしくなる。2人のときは、中級と上級で「ななめ」の分け方も出る（draw.js）。

export const LEVELS = {
  A: { label: '初級', hint: 'くだもの・かんたんな食べ物' },
  B: { label: '中級', hint: '動物・身近なもの' },
  C: { label: '上級', hint: '乗り物・建物など形が複雑なもの' },
};

export const TOPICS = {
  A: ['りんご', 'みかん', 'バナナ', 'いちご', 'おにぎり', 'ドーナツ', '魚', 'ヒヨコ', 'さくらんぼ', '目玉焼き', 'アイス', 'ヘビ'],
  B: ['ネコ', 'ウサギ', 'ハンバーガー', '家', 'イヌ', 'ケーキ', 'カエル', '自動車', 'ペンギン', 'ゾウ', '電車', '雪だるま'],
  C: ['自転車', 'お城', 'ロボット', '飛行機', 'キリン', '恐竜', 'ライオン', 'ピアノ', 'ドラゴン', '観覧車', '消防車', 'クジャク'],
};

// 横に長いお題。3人以上で遊ぶとき、これらは左右にならべ、ほかのお題は上下にならべる
export const WIDE_TOPICS = new Set(['バナナ', '魚', 'ヘビ', '自動車', '電車', '自転車', '飛行機', '恐竜', '消防車', 'ドラゴン', 'ピアノ']);

export function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

// ---------- お題がかぶらないようにする ----------
// この端末で出たお題をおぼえておく（ブラウザの中だけ）。その難易度のお題を全部使いきったら、最初からやり直す。
const SEEN_KEY = 'oekaki_seen_topics';
let seen = [];
try { seen = JSON.parse(localStorage.getItem(SEEN_KEY)) || []; } catch (e) { seen = []; }
if (!Array.isArray(seen)) seen = [];

// お題を「出た」と記録する
export function markTopic(topic) {
  if (!seen.includes(topic)) seen.push(topic);
  try { localStorage.setItem(SEEN_KEY, JSON.stringify(seen)); } catch (e) { /* 保存できなくてもよい */ }
}

// まだ出ていないお題から1つえらぶ。extra：この部屋で出たお題（ほかの人の端末で出たぶんもふくむ）
export function nextTopic(level, extra = new Set()) {
  const all = TOPICS[level] || TOPICS.A;
  let rest = all.filter((t) => !seen.includes(t) && !extra.has(t));
  if (!rest.length) {
    // 全部出た：この難易度のぶんだけ記録を消す。直前のお題だけは、つづけて出ないようにする
    const last = seen[seen.length - 1];
    seen = seen.filter((t) => !all.includes(t));
    rest = all.filter((t) => t !== last && !extra.has(t));
    if (!rest.length) rest = all.filter((t) => t !== last);
  }
  return pick(rest);
}

// いままでに出たお題の数（その難易度で）
export function topicProgress(level) {
  const all = TOPICS[level] || TOPICS.A;
  return { used: all.filter((t) => seen.includes(t)).length, total: all.length };
}
