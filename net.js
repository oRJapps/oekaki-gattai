// net.js
// 部屋の通信。2つの方式が同じ関数を持つ。
//   supa  : Supabase（窓口の関数 + Realtime の Presence / Broadcast）。rooms の表は直接さわらない
//   local : お試しモード（localStorage + BroadcastChannel。同じブラウザの別タブ同士だけ）
//
// 共通の関数：
//   findRoom(level, size)      対戦用：同じ難易度・同じ人数で待っている部屋を1つ返す（なければ null）
//   roomByCode(code)           フレンド用：カギから部屋を探す（なければ null）
//   createRoom(room)           部屋を作る
//   updateRoom(room, patch)    人数や状態を更新する（部屋を作った人だけができる）
//   deleteRoom(room)           自分が作った部屋を閉じる
//   join(roomId, state, on)    部屋に入る。on.presence(一覧) と on.event(種類, 中身) が呼ばれる
//                              戻り値：{ send(種類, 中身), update(自分の状態), leave() }

import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js?v=20261117174602';

// ?trial=1 をつけて開くと、Supabase を使わずにお試しモードで動く（動作の確認用）
const forceTrial = new URLSearchParams(location.search).has('trial');
export const online = !forceTrial && !!(SUPABASE_URL && SUPABASE_ANON_KEY);
// 先に通信の部品を読みこんでおく（部屋に入るときの待ち時間をへらす）
export function warm() { if (online) client().catch(() => {}); }

// ---------- Supabase ----------
let sb = null;
async function client() {
  if (!sb) {
    // ライブラリは自分のサイトに置いたもの（vendor/supabase.js = supabase-js 2.45.4）を使う。
    // よそのサーバーから毎回読みこむと、そのサーバーが書きかえられたときにゲームごと乗っ取られるため。
    if (!window.supabase) {
      await new Promise((resolve, reject) => {
        const tag = document.createElement('script');
        tag.src = 'vendor/supabase.js?v=20261117174602';
        tag.onload = resolve;
        tag.onerror = () => reject(new Error('通信の部品を読みこめませんでした'));
        document.head.append(tag);
      });
    }
    sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false }, realtime: { worker: true } });
  }
  return sb;
}

// rooms の表は直接さわれない。Supabase の中の「窓口」の関数（schema.sql）だけを呼ぶ
async function rpc(name, args) {
  const { data, error } = await (await client()).rpc(name, args);
  if (error) throw error;
  return data;
}

const missing = (err) => !!err && (err.code === 'PGRST202' || /Could not find the function/i.test(err.message || ''));

const supa = {
  // Supabase の設定が古い（v5 まで）と、新しい形の窓口がまだない。そのときは古い形で呼ぶ
  async findRoom(level, size) {
    try { return (await rpc('find_room', { p_difficulty: level, p_size: size })) || null; }
    catch (err) { if (!missing(err)) throw err; return (await rpc('find_room', { p_difficulty: level })) || null; }
  },
  // まちがいが続くと { error: 'locked' } が返る（総当たり対策）
  async roomByCode(code) { return (await rpc('room_by_code', { p_code: code })) || null; },
  // カギはサーバーが決める。返ってくる secret（合言葉）は、部屋を作った人だけが持つ
  // カギ（code）と人数（size）は、部屋を作る人が決める。カギが使われていたら 'key in use' のエラーになる
  async createRoom(room) {
    try { return await rpc('create_room', { p_mode: room.mode, p_difficulty: room.difficulty, p_code: room.code || null, p_size: room.size || 5 }); }
    catch (err) { if (!missing(err)) throw err; return rpc('create_room', { p_mode: room.mode, p_difficulty: room.difficulty }); }
  },
  // 合言葉を持っている人（部屋を作った人）だけが更新できる。持っていなければ何もしない
  async updateRoom(room, patch) {
    if (!room || !room.secret) return;
    try {
      await rpc('touch_room', { p_id: room.id, p_secret: room.secret, p_count: patch.player_count, p_status: patch.status });
    } catch (err) { console.warn('touch_room', err.message); }
  },
  async deleteRoom(room) {
    if (!room || !room.secret) return;
    try { await rpc('close_room', { p_id: room.id, p_secret: room.secret }); } catch (err) { console.warn('close_room', err.message); }
  },
  // 部屋につなぐ。
  // 注意：Supabase は、自分の状態（Presence）を短い間に何回も送ると、部屋との接続を切る
  //       （"Client presence rate limit exceeded"。手元の測定では、約7秒に6回で切られた）。
  //       切られると、相手から見えなくなり、絵も届かなくなる。そこで：
  //   1. 中身が同じ状態は送らない
  //   2. 送る間かくを 2秒以上あける。さらに、10秒に3回までにする（こえるぶんは、あとで最新の状態を1回だけ送る）
  //   3. それでも接続が切れたら、自動でつなぎ直して、状態を送り直す
  async join(roomId, state, on) {
    const c = await client();
    const dbg = new URLSearchParams(location.search).has('debug') ? (text) => console.log('[net] ' + text) : () => {};
    let ch = null, mine = state, live = false, left = false;
    let sentText = '', sentTimes = [], sendTimer = null, retryTimer = null;

    const flush = () => {
      sendTimer = null;
      if (!live || left) return;
      const text = JSON.stringify(mine);
      if (text === sentText) return; // 前に送ったものと同じ
      const now = Date.now();
      sentTimes = sentTimes.filter((t) => now - t < 10000);
      const wait = Math.max(sentTimes.length ? sentTimes[sentTimes.length - 1] + 2000 - now : 0, sentTimes.length >= 3 ? sentTimes[0] + 10000 - now : 0);
      if (wait > 0) { sendTimer = setTimeout(flush, wait + 20); return; }
      sentTimes.push(now);
      sentText = text;
      ch.track(mine).then((res) => dbg('track -> ' + JSON.stringify(res) + ' ready=' + mine.ready + ' phase=' + mine.phase), (err) => dbg('track error ' + err));
    };
    const push = () => { if (!sendTimer) flush(); };

    // つなぐ（切れたときは、もう一度これを呼ぶ）。first：最初の1回が成功したか失敗したかを知らせる
    const connect = (first) => {
      if (left) return;
      ch = c.channel('room:' + roomId, { config: { broadcast: { self: true }, presence: { key: state.id } } });
      const mineCh = ch;
      ch.on('presence', { event: 'sync' }, () => {
        if (mineCh !== ch) return;
        // 同じ名前で2つ以上の知らせがあっても全部わたす（どれが本物かは app.js が鍵で確かめる）
        const list = Object.values(mineCh.presenceState()).flat();
        dbg('presence sync: ' + list.map((q) => String(q.name) + '/' + q.ready + '/' + q.phase).join(', '));
        on.presence(list);
      });
      ch.on('broadcast', { event: 'ev' }, ({ payload }) => { if (mineCh === ch) on.event(payload.t, payload.d); });
      ch.on('system', {}, (m) => dbg('system ' + JSON.stringify(m).slice(0, 200)));
      const timer = first ? setTimeout(() => first.reject(new Error('接続がタイムアウトしました')), 10000) : null;
      ch.subscribe((status, err) => {
        if (mineCh !== ch || left) return;
        dbg('subscribe status ' + status + (err ? ' ' + err : ''));
        if (status === 'SUBSCRIBED') {
          // つながったら、すぐに部屋の画面へ進む（状態の送信が終わるのを待たない）
          clearTimeout(timer);
          live = true;
          sentText = ''; // つなぎ直したあとは、同じ中身でも送り直す
          push();
          if (first) { first.resolve(); first = null; }
          return;
        }
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          live = false;
          clearTimeout(timer);
          if (first) { const f = first; first = null; f.reject(new Error('部屋に接続できませんでした')); return; }
          // 部屋にいる間に切れた：古い接続を片づけて、2.5秒後につなぎ直す
          clearTimeout(retryTimer);
          retryTimer = setTimeout(() => {
            if (left || mineCh !== ch) return;
            dbg('reconnect');
            try { c.removeChannel(mineCh); } catch (e) { /* もう切れている */ }
            connect(null);
          }, 2500);
        }
      });
    };
    await new Promise((resolve, reject) => connect({ resolve, reject }));
    return {
      send: (t, d) => ch.send({ type: 'broadcast', event: 'ev', payload: { t, d } }),
      update: (next) => { mine = next; push(); },
      leave: () => { left = true; live = false; clearTimeout(sendTimer); clearTimeout(retryTimer); return c.removeChannel(ch); },
    };
  },
};

// ---------- お試しモード（同じブラウザの別タブ） ----------
const KEY = 'oekaki_rooms_v1';
function loadRooms() {
  try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; }
}
function saveRooms(rooms) {
  try { localStorage.setItem(KEY, JSON.stringify(rooms)); } catch (e) { /* 保存できなくても続ける */ }
}

const local = {
  async findRoom(level, size) {
    const now = Date.now();
    const list = Object.values(loadRooms()).filter((r) => r.mode === 'online' && r.difficulty === level && (r.size || 5) === size
      && r.status === 'waiting' && r.player_count < (r.size || 5) && now - r.updated < 45000);
    list.sort((a, b) => a.created - b.created);
    return list[0] || null;
  },
  async roomByCode(code) {
    const now = Date.now();
    const list = Object.values(loadRooms()).filter((r) => r.mode === 'friend' && r.code === code && now - r.updated < 1800000);
    list.sort((a, b) => b.updated - a.updated);
    return list[0] || null;
  },
  async createRoom(room) {
    const rooms = loadRooms();
    const now = Date.now();
    for (const id of Object.keys(rooms)) if (now - rooms[id].updated > 3600000) delete rooms[id];
    // 同じカギの部屋が、いま使われていたら作れない（2分より古い部屋は、使われていないと見て消す）
    for (const id of Object.keys(rooms)) {
      if (!room.code || rooms[id].code !== room.code) continue;
      if (now - rooms[id].updated < 120000) throw new Error('key in use');
      delete rooms[id];
    }
    const row = { ...room, id: crypto.randomUUID(), created: now, updated: now };
    rooms[row.id] = row;
    saveRooms(rooms);
    return row;
  },
  async updateRoom(room, patch) {
    const rooms = loadRooms();
    const id = room && room.id;
    if (!rooms[id]) return;
    rooms[id] = { ...rooms[id], ...patch, updated: Date.now() };
    saveRooms(rooms);
  },
  async deleteRoom(room) {
    const rooms = loadRooms();
    delete rooms[room && room.id];
    saveRooms(rooms);
  },
  async join(roomId, state, on) {
    const bc = new BroadcastChannel('oekaki_room_' + roomId);
    let mine = state;
    const members = new Map(); // id -> { state, seen }
    const emit = () => {
      const now = Date.now();
      for (const [id, m] of members) if (now - m.seen > 3500) members.delete(id);
      on.presence([mine, ...[...members.values()].map((m) => m.state)]);
    };
    bc.onmessage = (msg) => {
      const m = msg.data;
      if (!m || typeof m !== 'object') return;
      if (m.k === 'p') { members.set(m.state.id, { state: m.state, seen: Date.now() }); emit(); }
      if (m.k === 'bye') { members.delete(m.id); emit(); }
      if (m.k === 'e') on.event(m.t, m.d);
    };
    const ping = () => { bc.postMessage({ k: 'p', state: mine }); emit(); };
    const beat = setInterval(ping, 1000);
    ping();
    return {
      send: (t, d) => { bc.postMessage({ k: 'e', t, d }); on.event(t, d); },
      update: (next) => { mine = next; ping(); },
      leave: () => { clearInterval(beat); bc.postMessage({ k: 'bye', id: mine.id }); bc.close(); },
    };
  },
};

export const api = online ? supa : local;
