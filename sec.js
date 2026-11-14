// sec.js
// なりすまし対策：部屋の中のメッセージに「署名」をつける。
//
// しくみ：
//   1. ページを開くたびに、そのブラウザだけの鍵のペア（秘密の鍵と、公開する鍵）を作る
//   2. プレイヤーの id は「公開する鍵」から計算する。だから、他人の id を名のっても、その人の鍵は持てない
//   3. 送るメッセージには秘密の鍵で署名をつける。受け取った側は、送り主の公開する鍵で本物か確かめる
// 秘密の鍵はブラウザの外に出ない（取り出せない設定で作る）。

const enc = new TextEncoder();

const toB64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64 = (text) => Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
const toHex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

const ALGO = { name: 'ECDSA', namedCurve: 'P-256' };
const SIGN = { name: 'ECDSA', hash: 'SHA-256' };

// 公開する鍵（文字列）から id を計算する
export async function idOf(pub) {
  return toHex(await crypto.subtle.digest('SHA-256', fromB64(pub))).slice(0, 32);
}

// 自分の鍵を作る。戻り値：{ id, pub, sign(文字列) → 署名 }
export async function createIdentity() {
  const pair = await crypto.subtle.generateKey(ALGO, false, ['sign', 'verify']);
  const pub = toB64(await crypto.subtle.exportKey('raw', pair.publicKey));
  return {
    id: await idOf(pub),
    pub,
    sign: async (text) => toB64(await crypto.subtle.sign(SIGN, pair.privateKey, enc.encode(text))),
  };
}

// 相手の公開する鍵を、確かめに使える形にする
export function importKey(pub) {
  return crypto.subtle.importKey('raw', fromB64(pub), ALGO, false, ['verify']);
}

// 署名が本物なら true
export async function verify(key, text, signature) {
  try {
    return await crypto.subtle.verify(SIGN, key, fromB64(signature), enc.encode(text));
  } catch (e) {
    return false;
  }
}
