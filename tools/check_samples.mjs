// tools/check_samples.mjs
// 全部のお題に見本の絵があるか、絵の数字がこわれていないかを調べる。
// 使い方（oekaki-web フォルダで）: node tools/check_samples.mjs
globalThis.localStorage = { getItem() { return null; }, setItem() {} };
const { TOPICS, sampleFile, parseTopic } = await import('../topics.js');
const { loadSample } = await import('../samples.js');

const all = [...TOPICS.A, ...TOPICS.B, ...TOPICS.C];
const missing = [], bad = [];
for (const topic of all) {
  const ops = await loadSample(topic, sampleFile(topic));
  if (!ops) { missing.push(`${topic}(${sampleFile(topic)})`); continue; }
  for (const s of ops) {
    if (typeof s.c !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(s.c) || !Array.isArray(s.p) || s.p.length < 2 || s.p.length % 2 || s.p.some((v) => !Number.isFinite(v))) { bad.push(topic); break; }
  }
  if (!parseTopic(topic)) bad.push(topic + ':parse');
}
// 組み合わせお題：全部のことば × 全部のお題で、絵が作れるか
const { MODS_FOR, sampleFlip, topicDir } = await import('../topics.js');
let combos = 0;
for (const topic of all) {
  for (const mod of MODS_FOR(topic)) {
    const ops = await loadSample(topic, sampleFile(topic), sampleFlip(topic), mod, topicDir(topic) === '左向き');
    combos++;
    if (!ops || ops.some((s) => !Array.isArray(s.p) || s.p.length < 2 || s.p.length % 2 || s.p.some((v) => !Number.isFinite(v)) || !/^#[0-9a-fA-F]{6}$/.test(s.c) || (!s.g && !Number.isFinite(s.w)))) bad.push(mod + topic);
  }
}
console.log(`組み合わせお題 ${combos}通り`);
console.log(`お題 ${all.length}こ（初級${TOPICS.A.length}・中級${TOPICS.B.length}・上級${TOPICS.C.length}）／見本あり ${all.length - missing.length}こ`);
if (missing.length) console.log('見本がない：' + missing.join('、'));
if (bad.length) console.log('こわれている：' + bad.join('、'));
