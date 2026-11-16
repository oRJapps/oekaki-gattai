-- schema.sql（v6：カギと人数を、部屋を作る人が決める）
-- お絵かき合体：Supabase の SQL Editor に全部貼って、Run を1回押す。何回実行してもよい。
--
-- しくみ：
--   1. rooms の表は、外から直接さわれない（読む・書く・消すを全部禁止）
--   2. 決まった操作だけができる「窓口」の関数を5つ用意する
--        create_room   部屋を作る（合言葉 secret を1回だけ返す）。同じ接続元から10分に20部屋まで
--        find_room     対戦：同じ難易度で待っている部屋を1つ探す
--        room_by_code  フレンド：カギから部屋を1つ探す。まちがいが1分に10回で、しばらく受けつけない
--        touch_room    人数と状態を更新する（部屋を作った人の合言葉が必要）
--        close_room    自分の部屋を閉じる（合言葉が必要）
--   3. 絵そのものは保存しない（Realtime の Broadcast で部屋の中だけに送る）

create table if not exists public.rooms (
  id uuid primary key default gen_random_uuid(),
  code text,                                  -- フレンド用のカギ（4けた）。対戦の部屋は null
  mode text not null check (mode in ('online', 'friend')),
  difficulty text not null check (difficulty in ('A', 'B', 'C')),   -- A=初級 B=中級 C=上級
  status text not null default 'waiting' check (status in ('waiting', 'playing')),
  player_count int not null default 1,
  host_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.rooms add column if not exists size int not null default 5;      -- この部屋の人数（2〜5）
alter table public.rooms add column if not exists host_secret text;   -- 部屋を作った人だけが知る合言葉
alter table public.rooms alter column host_id drop not null;          -- v1 の列。もう使わない

create index if not exists rooms_match_idx on public.rooms (mode, difficulty, status, updated_at);
create index if not exists rooms_code_idx on public.rooms (code);

-- 更新のたびに updated_at をサーバーの時刻にする
create or replace function public.rooms_touch() returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists rooms_touch on public.rooms;
create trigger rooms_touch before update on public.rooms
  for each row execute function public.rooms_touch();

-- 回数を数える表（接続元ごと）。kind = 'key'：まちがったカギ、'room'：部屋を作った。10分より古い記録は自動で消す
create table if not exists public.key_attempts (
  ip text not null,
  tried_at timestamptz not null default now()
);
alter table public.key_attempts add column if not exists kind text not null default 'key';
create index if not exists key_attempts_idx on public.key_attempts (ip, tried_at);

-- ---------- 表を閉じる ----------
alter table public.key_attempts enable row level security;
revoke all on table public.key_attempts from anon, authenticated;
alter table public.rooms enable row level security;
drop policy if exists rooms_select on public.rooms;
drop policy if exists rooms_insert on public.rooms;
drop policy if exists rooms_update on public.rooms;
drop policy if exists rooms_delete on public.rooms;
revoke all on table public.rooms from anon, authenticated;

-- v1 の関数は返す形がちがうので、作り直す
drop function if exists public.find_room(text);
drop function if exists public.find_room(text, int);
drop function if exists public.create_room(text, text);
drop function if exists public.room_by_code(text);

-- ---------- 窓口の中だけで使う道具 ----------
-- 呼び出した人の接続元（IPアドレス）。分からないときは 'unknown'
create or replace function public.client_ip() returns text language plpgsql stable as $$
declare
  v_headers json;
begin
  begin
    v_headers := nullif(current_setting('request.headers', true), '')::json;
  exception when others then
    v_headers := null;
  end;
  return coalesce(
    nullif(trim(v_headers ->> 'cf-connecting-ip'), ''),
    nullif(trim(v_headers ->> 'x-real-ip'), ''),
    nullif(trim(split_part(coalesce(v_headers ->> 'x-forwarded-for', ''), ',', 1)), ''),
    'unknown');
end $$;
revoke all on function public.client_ip() from public, anon, authenticated;

-- ---------- 窓口 ----------
-- 部屋を作る。カギ（4けた）と人数（2〜5）は、部屋を作る人が決める。カギを省くと、サーバーが決める。
-- 同じカギの部屋が、いま使われていたら 'key in use' で断る。
--   「いま使われている」= 2分以内に更新された部屋。2分より古い同じカギの部屋は、使われていないと見て消す
-- いたずら対策：同じ接続元から10分に20部屋まで。使われている部屋が全体で500を超えたら断る
create or replace function public.create_room(p_mode text, p_difficulty text, p_code text default null, p_size int default 5)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_code text;
  v_secret text := gen_random_uuid()::text;
  v_id uuid;
  v_tries int := 0;
  v_ip text := client_ip();
  v_limit int := 20;
  v_size int := least(5, greatest(2, coalesce(p_size, 5)));
begin
  if p_mode is null or p_difficulty is null
     or p_mode not in ('online', 'friend') or p_difficulty not in ('A', 'B', 'C') then
    raise exception 'bad arguments';
  end if;
  if v_ip = 'unknown' then v_limit := 300; end if;
  delete from key_attempts where tried_at < now() - interval '10 minutes';
  if (select count(*) from key_attempts a where a.ip = v_ip and a.kind = 'room') >= v_limit then
    raise exception 'too many rooms from this connection';
  end if;
  delete from rooms where updated_at < now() - interval '1 day';
  if (select count(*) from rooms where updated_at > now() - interval '10 minutes') >= 500 then
    raise exception 'too many rooms';
  end if;
  if p_mode = 'friend' and p_code is not null then
    if p_code !~ '^[0-9]{4}$' then raise exception 'bad key'; end if;
    if exists (select 1 from rooms r where r.code = p_code and r.updated_at > now() - interval '2 minutes') then
      raise exception 'key in use';
    end if;
    delete from rooms r where r.code = p_code;
    v_code := p_code;
  elsif p_mode = 'friend' then
    loop
      -- 4けた（1000〜9999）。予測できない乱数（gen_random_uuid）から作る。いま使われているカギとは重ならない
      v_code := (1000 + (('x' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 15))::bit(60)::bigint % 9000))::text;
      exit when not exists (
        select 1 from rooms r where r.code = v_code and r.updated_at > now() - interval '30 minutes');
      v_tries := v_tries + 1;
      if v_tries > 60 then raise exception 'no free key'; end if;
    end loop;
  end if;
  insert into rooms (code, mode, difficulty, status, player_count, host_secret, size)
    values (v_code, p_mode, p_difficulty, 'waiting', 1, v_secret, v_size)
    returning id into v_id;
  insert into key_attempts (ip, kind) values (v_ip, 'room');
  return jsonb_build_object('id', v_id, 'code', v_code, 'mode', p_mode, 'difficulty', p_difficulty, 'size', v_size, 'secret', v_secret);
end $$;

-- 対戦：同じ難易度・同じ人数で待っている部屋を1つ返す（なければ null）。合言葉は返さない
create or replace function public.find_room(p_difficulty text, p_size int default null)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', r.id, 'code', r.code, 'mode', r.mode, 'difficulty', r.difficulty, 'size', r.size)
  from rooms r
  where r.mode = 'online' and r.difficulty = p_difficulty and r.status = 'waiting'
    and (p_size is null or r.size = p_size)
    and r.player_count < r.size and r.updated_at > now() - interval '45 seconds'
  order by r.created_at asc
  limit 1;
$$;

-- フレンド：カギから部屋を1つ返す（30分以内に更新された部屋だけ。なければ null）。
-- （部屋を作った人がスマホで別のアプリに切りかえると更新が止まるので、長めに待つ）
-- 総当たり対策：同じ接続元から、まちがったカギが1分に10回きたら {"error":"locked"} を返す。
-- 接続元が分からないときは、全体で1分に300回までにする。
create or replace function public.room_by_code(p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_ip text := client_ip();
  v_limit int := 10;
  v_room jsonb;
begin
  if v_ip = 'unknown' then v_limit := 300; end if;
  delete from key_attempts where tried_at < now() - interval '10 minutes';
  if (select count(*) from key_attempts a
      where a.ip = v_ip and a.kind = 'key' and a.tried_at > now() - interval '1 minute') >= v_limit then
    return jsonb_build_object('error', 'locked');
  end if;

  if p_code is not null and p_code ~ '^[0-9]{4}$' then
    select jsonb_build_object('id', r.id, 'code', r.code, 'mode', r.mode, 'difficulty', r.difficulty, 'size', r.size)
      into v_room
      from rooms r
      where r.mode = 'friend' and r.code = p_code and r.updated_at > now() - interval '30 minutes'
      order by r.updated_at desc
      limit 1;
  end if;
  if v_room is null then
    insert into key_attempts (ip, kind) values (v_ip, 'key');   -- まちがいを1回数える
  end if;
  return v_room;
end $$;

-- 人数と状態を更新する。合言葉が合う部屋だけ（部屋を作った人が15秒ごとに呼ぶ）
create or replace function public.touch_room(p_id uuid, p_secret text, p_count int, p_status text)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  update rooms
    set player_count = least(5, greatest(1, coalesce(p_count, 1))),
        status = case when p_status = 'playing' then 'playing' else 'waiting' end
    where id = p_id and host_secret is not null and host_secret = p_secret;
  return found;
end $$;

-- 自分の部屋を閉じる。合言葉が合う部屋だけ
create or replace function public.close_room(p_id uuid, p_secret text)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  delete from rooms where id = p_id and host_secret is not null and host_secret = p_secret;
  return found;
end $$;

-- 窓口を使えるのは、ゲームのページ（anon）とログインした人（authenticated）だけ
revoke all on function public.create_room(text, text, text, int) from public;
revoke all on function public.find_room(text, int) from public;
revoke all on function public.room_by_code(text) from public;
revoke all on function public.touch_room(uuid, text, int, text) from public;
revoke all on function public.close_room(uuid, text) from public;
grant execute on function public.create_room(text, text, text, int) to anon, authenticated;
grant execute on function public.find_room(text, int) to anon, authenticated;
grant execute on function public.room_by_code(text) to anon, authenticated;
grant execute on function public.touch_room(uuid, text, int, text) to anon, authenticated;
grant execute on function public.close_room(uuid, text) to anon, authenticated;
