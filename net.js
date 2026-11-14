// net.js
// 部屋の通信。2つの方式が同じ関数を持つ。
//   supa  : Supabase（窓口の関数 + Realtime の Presence / Broadcast）。rooms の表は直接さわらない
//   local : お試しモード（localStorage + BroadcastChannel。同じブラウザの別タブ同士だけ）
//
// 共通の関数：
//   findRoom(level)            対戦用：同じ難易度で待っている部屋を1つ返す（なければ null）
//   roomByCode(code)           フレンド用：カギから部屋を探す（なければ null）
//   createRoom(room)           部屋を作る
//   updateRoom(room, patch)    人数や状態を更新する（部屋を作った人だけができる）
//   deleteRoom(room)           自分が作った部屋を閉じる
//   join(roomId, state, on)    部屋に入る。on.presence(一覧) と on.event(種類, 中身) が呼ばれる
//                              戻り値：{ send(種類, 中身), update(自分の状態), leave() }

import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js?v=20261114135104';

export const online = !!(SUPABASE_URL && SUPABASE_ANON_KEY);

// ---------- Supabase ----------
let sb = null;
async function client() {
  if (!sb) {
    // ライブラリは自分のサイトに置いたもの（vendor/supabase.js = supabase-js 2.45.4）を使う。
    // よそのサーバーから毎回読みこむと、そのサーバーが書きかえられたときにゲームごと乗っ取られるため。
    if (!window.supabase) {
      await new Promise((resolve, reject) => {
        const tag = document.createElement('script');
        tag.src = 'vendor/supabase.js?v=20261114135104';
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

const supa = {
  async findRoom(level) { return (await rpc('find_room', { p_difficulty: level })) || null; },
  // まちがいが続くと { error: 'locked' } が返る（総当たり対策）
  async roomByCode(code) { return (await rpc('room_by_code', { p_code: code })) || null; },
  // カギはサーバーが決める。返ってくる secret（合言葉）は、部屋を作った人だけが持つ
  async createRoom(room) { return rpc('create_room', { p_mode: room.mode, p_difficulty: room.difficulty }); },
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
  async join(roomId, state, on) {
    const c = await client();
    const ch = c.channel('room:' + roomId, { config: { broadcast: { self: true }, presence: { key: state.id } } });
    ch.on('presence', { event: 'sync' }, () => {
      // 同じ名前で2つ以上の知らせがあっても全部わたす（どれが本物かは app.js が鍵で確かめる）
      const list = Object.values(ch.presenceState()).flat();
      on.presence(list);
    });
    ch.on('broadcast', { event: 'ev' }, ({ payload }) => on.event(payload.t, payload.d));
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('接続がタイムアウトしました')), 10000);
      ch.subscribe(async (status) => {
        if (status === 'SUBSCRIBED') { clearTimeout(timer); await ch.track(state); resolve(); }
        if (status === 'CHANNEL_ERROR') { clearTimeout(timer); reject(new Error('部屋に接続できませんでした')); }
      });
    });
    return {
      send: (t, d) => ch.send({ type: 'broadcast', event: 'ev', payload: { t, d } }),
      update: (next) => ch.track(next),
      leave: () => c.removeChannel(ch),
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
  async findRoom(level) {
    const now = Date.now();
    const list = Object.values(loadRooms()).filter((r) => r.mode === 'online' && r.difficulty === level
      && r.status === 'waiting' && r.player_count < 4 && now - r.updated < 45000);
    list.sort((a, b) => a.created - b.created);
    return list[0] || null;
  },
  async roomByCode(code) {
    const now = Date.now();
    const list = Object.values(loadRooms()).filter((r) => r.mode === 'friend' && r.code === code && now - r.updated < 120000);
    list.sort((a, b) => b.updated - a.updated);
    return list[0] || null;
  },
  async createRoom(room) {
    const rooms = loadRooms();
    const now = Date.now();
    for (const id of Object.keys(rooms)) if (now - rooms[id].updated > 3600000) delete rooms[id];
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
