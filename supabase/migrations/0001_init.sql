-- =====================================================================
-- 369X backend (Supabase / Postgres)
-- Testnet version: balances are test money held in this database.
-- All money logic runs here in SECURITY DEFINER functions. The browser
-- can only READ public tables and CALL these functions; it can never
-- write balances directly.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Settings (one row). Edit in the Supabase table editor to retune.
-- ---------------------------------------------------------------------
create table public.settings (
  id int primary key default 1 check (id = 1),
  creator_fee numeric not null default 0.005,
  protocol_fee numeric not null default 0.01,
  lp_share numeric not null default 0.80,
  ref_discount numeric not null default 0.10,
  ref_level2 numeric not null default 0.05,
  max_discount numeric not null default 0.60,
  maintenance numeric not null default 0.05,
  create_bond numeric not null default 1000,
  default_b double precision not null default 5000,
  faucet_stable numeric not null default 1000,
  faucet_token numeric not null default 5000,
  faucet_cooldown interval not null default '24 hours',
  finalize_delay_days int not null default 2,
  lev_tiers jsonb not null default '[[2,0],[3,100000],[5,250000],[10,1000000]]',
  stake_tiers jsonb not null default '[[0,0],[10000,0.10],[50000,0.25],[200000,0.50]]',
  ref_tiers jsonb not null default '[[0,0.20],[25000,0.25],[100000,0.30],[500000,0.35]]',
  locks jsonb not null default '{"flex":[0,1],"d90":[90,2],"d180":[180,4],"d365":[365,8]}'
);
insert into public.settings (id) values (1);

-- ---------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  address text not null unique,
  stable numeric not null default 0 check (stable >= 0),
  token numeric not null default 0 check (token >= 0),
  staked numeric not null default 0 check (staked >= 0),
  staked_at timestamptz,
  faucet_at timestamptz,
  volume numeric not null default 0,
  trades int not null default 0,
  max_lev int not null default 1,
  pnl numeric not null default 0,
  pts_trade numeric not null default 0,
  pts_bonus numeric not null default 0,
  ref_code text unique check (ref_code ~ '^[a-z0-9_-]{3,20}$'),
  ref_by text,
  ref_clicks int not null default 0,
  ref_earned numeric not null default 0,
  ref_claimed numeric not null default 0,
  ref_generated numeric not null default 0,      -- commission this user generated for their referrer
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.markets (
  id text primary key,
  q text not null check (length(q) between 15 and 160),
  cat text not null,
  icon text not null default '❓',
  ends date not null,
  source text not null,
  rules text not null,
  creator uuid references public.profiles(id),
  creator_label text not null default '369X Team',
  created_at timestamptz not null default now(),
  b double precision not null check (b > 0),
  q_y double precision not null default 0,
  q_n double precision not null default 0,
  vol numeric not null default 0,
  traders int not null default 0,
  status text not null default 'live' check (status in ('live', 'resolved', 'void')),
  outcome text check (outcome in ('YES', 'NO')),
  votes_yes numeric not null default 0,
  votes_no numeric not null default 0,
  creator_earned numeric not null default 0,
  last_trade_at timestamptz
);

create table public.price_ticks (
  id bigserial primary key,
  market_id text not null references public.markets(id) on delete cascade,
  ts timestamptz not null default now(),
  p double precision not null
);
create index on public.price_ticks (market_id, ts desc);

create table public.trades (
  id bigserial primary key,
  market_id text not null references public.markets(id) on delete cascade,
  user_id uuid not null references public.profiles(id),
  address text not null,
  side text not null check (side in ('YES', 'NO')),
  kind text not null check (kind in ('buy', 'sell', 'liq')),
  amount numeric not null,
  price double precision not null,
  ts timestamptz not null default now()
);
create index on public.trades (market_id, ts desc);
create index on public.trades (user_id);

create table public.positions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id),
  market_id text not null references public.markets(id),
  side text not null check (side in ('YES', 'NO')),
  shares double precision not null,
  margin numeric not null,
  size numeric not null,
  borrowed numeric not null,
  lev int not null,
  avg double precision not null,
  fee numeric not null,
  status text not null default 'open' check (status in ('open', 'closed', 'won', 'lost', 'liquidated')),
  received numeric,
  opened_at timestamptz not null default now(),
  closed_at timestamptz
);
create index on public.positions (user_id, status);
create index on public.positions (market_id, status);

create table public.vault (
  id int primary key default 1 check (id = 1),
  tvl numeric not null default 0,
  borrowed numeric not null default 0,
  fees numeric not null default 0,
  acc double precision not null default 0     -- LP fees earned per 1 unit deposited
);
-- protocol seed liquidity so leverage works from day one
insert into public.vault (id, tvl) values (1, 1000000);

create table public.deposits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id),
  amount numeric not null check (amount > 0),
  lock text not null,
  mult int not null,
  entry_acc double precision not null,
  start_at timestamptz not null default now(),
  unlock_at timestamptz not null,
  withdrawn_at timestamptz,
  received numeric
);
create index on public.deposits (user_id);

create table public.votes (
  market_id text not null references public.markets(id),
  user_id uuid not null references public.profiles(id),
  side text not null check (side in ('YES', 'NO')),
  weight numeric not null,
  paid boolean not null default false,
  reward numeric not null default 0,
  ts timestamptz not null default now(),
  primary key (market_id, user_id)
);

create table public.bonds (
  market_id text primary key references public.markets(id),
  user_id uuid not null references public.profiles(id),
  amount numeric not null,
  returned boolean not null default false
);

create table public.ref_daily (
  referrer uuid not null references public.profiles(id),
  day date not null,
  amount numeric not null default 0,
  primary key (referrer, day)
);

-- ---------------------------------------------------------------------
-- Security: RLS on everything. Public read only where it is public data.
-- No insert/update/delete policies: writes go through functions only.
-- ---------------------------------------------------------------------
alter table public.settings enable row level security;
alter table public.profiles enable row level security;
alter table public.markets enable row level security;
alter table public.price_ticks enable row level security;
alter table public.trades enable row level security;
alter table public.positions enable row level security;
alter table public.vault enable row level security;
alter table public.deposits enable row level security;
alter table public.votes enable row level security;
alter table public.bonds enable row level security;
alter table public.ref_daily enable row level security;

revoke all on all tables in schema public from anon, authenticated;
grant select on public.settings, public.markets, public.price_ticks, public.vault to anon, authenticated;
grant select (id, market_id, address, side, kind, amount, price, ts) on public.trades to anon, authenticated;

create policy "public read" on public.settings for select to anon, authenticated using (true);
create policy "public read" on public.markets for select to anon, authenticated using (true);
create policy "public read" on public.price_ticks for select to anon, authenticated using (true);
create policy "public read" on public.trades for select to anon, authenticated using (true);
create policy "public read" on public.vault for select to anon, authenticated using (true);

-- ---------------------------------------------------------------------
-- LMSR math (pure functions)
-- ---------------------------------------------------------------------
create function public.lmsr_cost(qy double precision, qn double precision, b double precision)
returns double precision language sql immutable set search_path = '' as $$
  select b * (greatest(qy, qn) / b + ln(exp(qy / b - greatest(qy, qn) / b) + exp(qn / b - greatest(qy, qn) / b)))
$$;

create function public.lmsr_price_yes(qy double precision, qn double precision, b double precision)
returns double precision language sql immutable set search_path = '' as $$
  select 1 / (1 + exp((qn - qy) / b))
$$;

create function public.lmsr_shares_for(qy double precision, qn double precision, b double precision, side text, amount double precision)
returns double precision language plpgsql immutable set search_path = '' as $$
declare own double precision; other double precision; target double precision; o double precision;
begin
  if amount <= 0 then return 0; end if;
  if side = 'YES' then own := qy; other := qn; else own := qn; other := qy; end if;
  target := (public.lmsr_cost(qy, qn, b) + amount) / b;
  o := other / b;
  return b * (target + ln(1 - exp(o - target))) - own;
end $$;

create function public.lmsr_proceeds(qy double precision, qn double precision, b double precision, side text, shares double precision)
returns double precision language sql immutable set search_path = '' as $$
  select case when shares <= 0 then 0 else
    public.lmsr_cost(qy, qn, b) - public.lmsr_cost(
      case when side = 'YES' then qy - shares else qy end,
      case when side = 'NO' then qn - shares else qn end, b) end
$$;

-- ---------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------
create view public.markets_v with (security_invoker = true) as
  select m.*,
    case when m.status <> 'live' then m.status when m.ends < current_date then 'resolving' else 'live' end as state,
    public.lmsr_price_yes(m.q_y, m.q_n, m.b) as p
  from public.markets m;
grant select on public.markets_v to anon, authenticated;

create function public.max_leverage(vol numeric)
returns int language sql stable set search_path = '' as $$
  select coalesce(max((t->>0)::int), 1) from public.settings s, jsonb_array_elements(s.lev_tiers) t where vol >= (t->>1)::numeric
$$;

create function public.stake_discount(staked numeric)
returns numeric language sql stable set search_path = '' as $$
  select coalesce(max((t->>1)::numeric), 0) from public.settings s, jsonb_array_elements(s.stake_tiers) t where staked >= (t->>0)::numeric
$$;

create function public.ref_rate(referred_volume numeric)
returns numeric language sql stable set search_path = '' as $$
  select coalesce(max((t->>1)::numeric), 0) from public.settings s, jsonb_array_elements(s.ref_tiers) t where referred_volume >= (t->>0)::numeric
$$;

create function public.fee_rate(p_staked numeric, p_has_ref boolean)
returns numeric language sql stable set search_path = '' as $$
  select (s.creator_fee + s.protocol_fee) * (1 - least(s.max_discount, public.stake_discount(p_staked) + case when p_has_ref then s.ref_discount else 0 end))
  from public.settings s
$$;

-- wallet address of the signed-in user (from the Sign-In-With-Ethereum session)
create function public.me_address()
returns text language plpgsql stable security definer set search_path = '' as $$
declare j jsonb := auth.jwt(); meta jsonb; a text;
begin
  meta := coalesce(j->'user_metadata', '{}'::jsonb);
  a := coalesce(meta->'custom_claims'->>'address', meta->>'address', meta->>'wallet_address');
  if a is null and meta->>'sub' like 'web3:%' then a := split_part(meta->>'sub', ':', 3); end if;
  if a is null then
    select coalesce(u.raw_user_meta_data->'custom_claims'->>'address', u.raw_user_meta_data->>'address',
                    nullif(split_part(u.raw_user_meta_data->>'sub', ':', 3), ''))
      into a from auth.users u where u.id = auth.uid();
  end if;
  return lower(a);
end $$;

create function public.require_uid()
returns uuid language plpgsql stable set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Please connect and sign in with your wallet'; end if;
  return auth.uid();
end $$;

create function public._tick(p_market text)
returns void language sql security definer set search_path = '' as $$
  insert into public.price_ticks (market_id, p) select id, public.lmsr_price_yes(q_y, q_n, b) from public.markets where id = p_market
$$;

-- split a trading fee: creator, referrers, vault depositors
create function public._distribute_fee(p_market text, p_trader uuid, p_fee numeric)
returns void language plpgsql security definer set search_path = '' as $$
declare s public.settings; tr public.profiles; r1 public.profiles; r2 public.profiles; m public.markets;
  creator_part numeric; protocol numeric; c1 numeric := 0; c2 numeric := 0; lp numeric; v public.vault; referred numeric;
begin
  if p_fee <= 0 then return; end if;
  select * into s from public.settings where id = 1;
  select * into m from public.markets where id = p_market;
  creator_part := p_fee * s.creator_fee / (s.creator_fee + s.protocol_fee);
  protocol := p_fee - creator_part;
  update public.markets set creator_earned = creator_earned + creator_part where id = p_market;
  if m.creator is not null then update public.profiles set stable = stable + creator_part where id = m.creator; end if;

  select * into tr from public.profiles where id = p_trader;
  if tr.ref_by is not null then
    select * into r1 from public.profiles where ref_code = tr.ref_by;
    if found and r1.id <> p_trader then
      select coalesce(sum(volume), 0) into referred from public.profiles where ref_by = r1.ref_code;
      c1 := protocol * public.ref_rate(referred);
      update public.profiles set ref_earned = ref_earned + c1 where id = r1.id;
      update public.profiles set ref_generated = ref_generated + c1 where id = p_trader;
      insert into public.ref_daily (referrer, day, amount) values (r1.id, current_date, c1)
        on conflict (referrer, day) do update set amount = public.ref_daily.amount + excluded.amount;
      if r1.ref_by is not null then
        select * into r2 from public.profiles where ref_code = r1.ref_by;
        if found and r2.id <> p_trader and r2.id <> r1.id then
          c2 := protocol * s.ref_level2;
          update public.profiles set ref_earned = ref_earned + c2 where id = r2.id;
          insert into public.ref_daily (referrer, day, amount) values (r2.id, current_date, c2)
            on conflict (referrer, day) do update set amount = public.ref_daily.amount + excluded.amount;
        end if;
      end if;
    end if;
  end if;

  lp := (protocol - c1 - c2) * s.lp_share;
  select * into v from public.vault where id = 1 for update;
  update public.vault set fees = fees + lp, acc = acc + case when v.tvl > 0 then (lp / v.tvl)::double precision else 0 end where id = 1;
end $$;

-- liquidate leveraged positions that fell below maintenance (price only moves on trades)
create function public._liquidate(p_market text)
returns int language plpgsql security definer set search_path = '' as $$
declare s public.settings; m public.markets; pos public.positions; n int := 0; proceeds double precision; addr text;
begin
  select * into s from public.settings where id = 1;
  loop
    select * into m from public.markets where id = p_market;
    select * into pos from public.positions p
      where p.market_id = p_market and p.status = 'open' and p.lev > 1
        and p.shares * public.lmsr_price_yes(case when p.side = 'YES' then m.q_y else m.q_n end, case when p.side = 'YES' then m.q_n else m.q_y end, m.b)
            - p.borrowed < s.maintenance * p.size
      order by p.opened_at limit 1 for update;
    exit when not found or n >= 50;
    proceeds := public.lmsr_proceeds(m.q_y, m.q_n, m.b, pos.side, pos.shares);
    update public.markets set
      q_y = case when pos.side = 'YES' then q_y - pos.shares else q_y end,
      q_n = case when pos.side = 'NO' then q_n - pos.shares else q_n end,
      vol = vol + proceeds::numeric, last_trade_at = now()
      where id = p_market;
    -- vault is repaid first; anything left over goes to vault depositors
    update public.vault set borrowed = greatest(0, borrowed - pos.borrowed),
      fees = fees + greatest(0, proceeds::numeric - pos.borrowed),
      acc = acc + case when tvl > 0 then (greatest(0, proceeds::numeric - pos.borrowed) / tvl)::double precision else 0 end where id = 1;
    update public.positions set status = 'liquidated', received = 0, closed_at = now() where id = pos.id;
    update public.profiles set pnl = pnl - pos.margin where id = pos.user_id returning address into addr;
    insert into public.trades (market_id, user_id, address, side, kind, amount, price)
      values (p_market, pos.user_id, addr, pos.side, 'liq', round(proceeds::numeric, 6), proceeds / pos.shares);
    perform public._tick(p_market);
    n := n + 1;
  end loop;
  return n;
end $$;

-- points breakdown for one user
create function public.points_of(p_uid uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare pr public.profiles; vault_pts numeric; stake_pts numeric; refs numeric; badges int; total numeric;
begin
  select * into pr from public.profiles where id = p_uid;
  if not found then return null; end if;
  select coalesce(sum(amount * mult * extract(epoch from (now() - start_at)) / 86400), 0) into vault_pts
    from public.deposits where user_id = p_uid and withdrawn_at is null;
  stake_pts := pr.staked * 0.1 * coalesce(extract(epoch from (now() - pr.staked_at)) / 86400, 0);
  select coalesce(sum(volume), 0) * 0.1 into refs from public.profiles where pr.ref_code is not null and ref_by = pr.ref_code;
  badges := (pr.trades >= 1)::int + (pr.trades >= 10)::int + (pr.max_lev >= 5)::int + (pr.max_lev >= 10)::int + (pr.volume >= 10000)::int
    + (exists (select 1 from public.bonds where user_id = p_uid))::int
    + (exists (select 1 from public.deposits where user_id = p_uid))::int
    + (exists (select 1 from public.deposits where user_id = p_uid and lock = 'd365'))::int
    + (exists (select 1 from public.votes where user_id = p_uid))::int
    + (pr.ref_code is not null)::int;
  total := pr.pts_trade + vault_pts + stake_pts + refs + badges * 500 + pr.pts_bonus;
  return jsonb_build_object('total', round(total), 'parts', jsonb_build_object(
    'Trading', round(pr.pts_trade), 'Vault', round(vault_pts), 'Staking', round(stake_pts),
    'Referrals', round(refs), 'Badges', badges * 500, 'Bonus', round(pr.pts_bonus)));
end $$;

-- ---------------------------------------------------------------------
-- Public API (called from the website with supabase.rpc)
-- ---------------------------------------------------------------------

-- create the profile on first sign-in; optional referral code
create function public.ensure_profile(p_ref text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare uid uuid := public.require_uid(); addr text := public.me_address(); created boolean := false;
begin
  if addr is null then raise exception 'Could not read your wallet address. Please sign in again.'; end if;
  insert into public.profiles (id, address) values (uid, addr) on conflict (id) do nothing;
  get diagnostics created = row_count;
  if created and p_ref is not null and p_ref ~ '^[A-Za-z0-9_-]{2,24}$' then
    update public.profiles set ref_by = lower(p_ref)
      where id = uid and exists (select 1 from public.profiles r where r.ref_code = lower(p_ref) and r.id <> uid);
  end if;
  return jsonb_build_object('ok', true, 'created', created, 'address', addr);
end $$;

create function public.get_account()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare uid uuid := public.require_uid(); pr public.profiles; out jsonb;
begin
  select * into pr from public.profiles where id = uid;
  if not found then return null; end if;
  select jsonb_build_object(
    'address', pr.address, 'stable', pr.stable, 'token', pr.token, 'staked', pr.staked, 'staked_at', pr.staked_at,
    'faucet_at', pr.faucet_at, 'volume', pr.volume, 'trades', pr.trades, 'max_lev', pr.max_lev, 'pnl', pr.pnl,
    'ref_code', pr.ref_code, 'ref_by', pr.ref_by, 'is_admin', pr.is_admin,
    'fee_rate', public.fee_rate(pr.staked, pr.ref_by is not null),
    'points', public.points_of(uid),
    'positions', coalesce((select jsonb_agg(jsonb_build_object(
        'id', p.id, 'market_id', p.market_id, 'side', p.side, 'shares', p.shares, 'margin', p.margin, 'size', p.size,
        'borrowed', p.borrowed, 'lev', p.lev, 'avg', p.avg, 'fee', p.fee, 'opened_at', p.opened_at,
        'q', m.q, 'icon', m.icon, 'q_y', m.q_y, 'q_n', m.q_n, 'b', m.b, 'state', m.state) order by p.opened_at desc)
      from public.positions p join public.markets_v m on m.id = p.market_id where p.user_id = uid and p.status = 'open'), '[]'::jsonb),
    'history', coalesce((select jsonb_agg(h order by h.closed_at desc) from (
        select p.market_id, p.side, p.lev, p.margin, p.received, p.status, p.closed_at, m.q, m.icon
        from public.positions p join public.markets m on m.id = p.market_id
        where p.user_id = uid and p.status <> 'open' order by p.closed_at desc limit 50) h), '[]'::jsonb),
    'deposits', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'amount', d.amount, 'lock', d.lock, 'mult', d.mult,
        'start_at', d.start_at, 'unlock_at', d.unlock_at,
        'earned', greatest(0, d.amount * ((select acc from public.vault where id = 1) - d.entry_acc)::numeric)) order by d.start_at desc)
      from public.deposits d where d.user_id = uid and d.withdrawn_at is null), '[]'::jsonb),
    'votes', coalesce((select jsonb_object_agg(v.market_id, jsonb_build_object('side', v.side, 'weight', v.weight, 'reward', v.reward, 'paid', v.paid))
      from public.votes v where v.user_id = uid), '{}'::jsonb),
    'created', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'q', m.q, 'state', m.state, 'outcome', m.outcome, 'vol', m.vol,
        'creator_earned', m.creator_earned, 'bond', b.amount, 'returned', b.returned) order by m.created_at desc)
      from public.bonds b join public.markets_v m on m.id = b.market_id where b.user_id = uid), '[]'::jsonb)
  ) into out;
  return out;
end $$;

create function public.faucet()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare uid uuid := public.require_uid(); s public.settings; pr public.profiles;
begin
  select * into s from public.settings where id = 1;
  select * into pr from public.profiles where id = uid for update;
  if not found then raise exception 'Profile missing. Please sign in again.'; end if;
  if pr.faucet_at is not null and pr.faucet_at + s.faucet_cooldown > now() then
    raise exception 'Faucet available again in %h', ceil(extract(epoch from (pr.faucet_at + s.faucet_cooldown - now())) / 3600);
  end if;
  update public.profiles set stable = stable + s.faucet_stable, token = token + s.faucet_token, faucet_at = now() where id = uid;
  return jsonb_build_object('ok', true, 'stable', s.faucet_stable, 'token', s.faucet_token);
end $$;

create function public.place_trade(p_market text, p_side text, p_margin numeric, p_lev int, p_min_shares double precision default 0)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare uid uuid := public.require_uid(); s public.settings; pr public.profiles; m public.markets_v; v public.vault;
  v_size numeric; v_fee numeric; v_shares double precision; v_borrow numeric; v_price double precision; pos_id uuid; maxlev int; first_time boolean;
begin
  if p_side not in ('YES', 'NO') then raise exception 'Invalid side'; end if;
  if p_margin is null or p_margin < 1 then raise exception 'Minimum trade is $1'; end if;
  if p_lev not in (1, 2, 3, 5, 10) then raise exception 'Invalid leverage'; end if;
  select * into s from public.settings where id = 1;
  select * into pr from public.profiles where id = uid for update;
  if not found then raise exception 'Profile missing. Please sign in again.'; end if;
  perform 1 from public.markets where id = p_market for update;
  select * into m from public.markets_v where id = p_market;
  if not found then raise exception 'Market not found'; end if;
  if m.state <> 'live' then raise exception 'This market is closed for trading'; end if;
  maxlev := public.max_leverage(m.vol);
  if p_lev > maxlev then raise exception 'Max leverage on this market is %x', maxlev; end if;
  if pr.stable < p_margin then raise exception 'Not enough balance. Use the faucet to get test funds.'; end if;

  v_size := p_margin * p_lev;
  v_fee := round(v_size * public.fee_rate(pr.staked, pr.ref_by is not null), 6);
  v_shares := public.lmsr_shares_for(m.q_y, m.q_n, m.b, p_side, (v_size - v_fee)::double precision);
  if v_shares <= 0 or v_shares < p_min_shares then raise exception 'Price moved. Please check the new price and try again.'; end if;
  v_borrow := v_size - p_margin;

  select * into v from public.vault where id = 1 for update;
  if v_borrow > v.tvl - v.borrowed then raise exception 'Not enough vault liquidity for this leverage'; end if;
  update public.vault set borrowed = borrowed + v_borrow where id = 1;

  first_time := not exists (select 1 from public.positions where user_id = uid and market_id = p_market);
  update public.markets set
    q_y = case when p_side = 'YES' then q_y + v_shares else q_y end,
    q_n = case when p_side = 'NO' then q_n + v_shares else q_n end,
    vol = vol + v_size, traders = traders + first_time::int, last_trade_at = now()
    where id = p_market;
  select case when p_side = 'YES' then public.lmsr_price_yes(q_y, q_n, b) else 1 - public.lmsr_price_yes(q_y, q_n, b) end
    into v_price from public.markets where id = p_market;

  insert into public.positions (user_id, market_id, side, shares, margin, size, borrowed, lev, avg, fee)
    values (uid, p_market, p_side, v_shares, p_margin, v_size, v_borrow, p_lev, ((v_size - v_fee) / v_shares::numeric)::double precision, v_fee)
    returning id into pos_id;
  insert into public.trades (market_id, user_id, address, side, kind, amount, price) values (p_market, uid, pr.address, p_side, 'buy', v_size, v_price);
  update public.profiles set stable = stable - p_margin, volume = volume + v_size, trades = trades + 1,
    max_lev = greatest(max_lev, p_lev), pts_trade = pts_trade + v_size where id = uid;
  perform public._tick(p_market);
  perform public._distribute_fee(p_market, uid, v_fee);
  perform public._liquidate(p_market);
  return jsonb_build_object('ok', true, 'position_id', pos_id, 'shares', v_shares);
end $$;

create function public.close_position(p_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare uid uuid := public.require_uid(); pr public.profiles; pos public.positions; m public.markets_v;
  proceeds numeric; v_fee numeric; v_recv numeric; v_price double precision;
begin
  select * into pr from public.profiles where id = uid for update;
  select * into pos from public.positions where id = p_id and user_id = uid and status = 'open' for update;
  if not found then raise exception 'Position not found'; end if;
  perform 1 from public.markets where id = pos.market_id for update;
  select * into m from public.markets_v where id = pos.market_id;
  if m.state <> 'live' then raise exception 'Market is closed. Your position pays out when it resolves.'; end if;

  proceeds := public.lmsr_proceeds(m.q_y, m.q_n, m.b, pos.side, pos.shares)::numeric;
  v_fee := round(proceeds * public.fee_rate(pr.staked, pr.ref_by is not null), 6);
  v_recv := greatest(0, proceeds - v_fee - pos.borrowed);
  update public.markets set
    q_y = case when pos.side = 'YES' then q_y - pos.shares else q_y end,
    q_n = case when pos.side = 'NO' then q_n - pos.shares else q_n end,
    vol = vol + proceeds, last_trade_at = now() where id = pos.market_id;
  select case when pos.side = 'YES' then public.lmsr_price_yes(q_y, q_n, b) else 1 - public.lmsr_price_yes(q_y, q_n, b) end
    into v_price from public.markets where id = pos.market_id;
  update public.vault set borrowed = greatest(0, borrowed - pos.borrowed) where id = 1;
  update public.positions set status = 'closed', received = v_recv, closed_at = now() where id = pos.id;
  update public.profiles set stable = stable + v_recv, pnl = pnl + v_recv - pos.margin,
    volume = volume + proceeds, pts_trade = pts_trade + proceeds * 0.5 where id = uid;
  insert into public.trades (market_id, user_id, address, side, kind, amount, price) values (pos.market_id, uid, pr.address, pos.side, 'sell', proceeds, v_price);
  perform public._tick(pos.market_id);
  perform public._distribute_fee(pos.market_id, uid, v_fee);
  perform public._liquidate(pos.market_id);
  return jsonb_build_object('ok', true, 'received', v_recv);
end $$;

create function public.create_market(p_q text, p_cat text, p_ends date, p_source text, p_rules text, p_p double precision)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare uid uuid := public.require_uid(); s public.settings; pr public.profiles; v_id text; v_q text := btrim(regexp_replace(p_q, '\s+', ' ', 'g'));
  icons jsonb := '{"Crypto":"₿","Sports":"⚽","Politics":"🗳","Finance":"📈","Culture":"🎬","World":"🌍"}';
begin
  select * into s from public.settings where id = 1;
  select * into pr from public.profiles where id = uid for update;
  if not found then raise exception 'Profile missing. Please sign in again.'; end if;
  if length(v_q) < 15 or length(v_q) > 140 or right(v_q, 1) <> '?' then raise exception 'Write a full question (15-140 characters) that ends with a question mark.'; end if;
  if not icons ? p_cat then raise exception 'Pick a category'; end if;
  if p_ends <= current_date or p_ends > current_date + 730 then raise exception 'Pick an end date within the next 2 years'; end if;
  if length(btrim(coalesce(p_source, ''))) < 4 or length(p_source) > 200 then raise exception 'Add a resolution source people can check'; end if;
  if p_p is null or p_p < 0.05 or p_p > 0.95 then raise exception 'Starting chance must be between 5%% and 95%%'; end if;
  if pr.token < s.create_bond then raise exception 'You need % tokens for the bond. Use the faucet.', s.create_bond; end if;
  if (select count(*) from public.markets where creator = uid and created_at > now() - interval '1 day') >= 5 then
    raise exception 'You can create up to 5 markets per day'; end if;
  if exists (select 1 from public.markets where lower(q) = lower(v_q)) then raise exception 'A market with this question already exists'; end if;

  v_id := left(trim(both '-' from regexp_replace(lower(v_q), '[^a-z0-9]+', '-', 'g')), 40) || '-' || substr(md5(random()::text), 1, 4);
  insert into public.markets (id, q, cat, icon, ends, source, rules, creator, creator_label, b, q_y, q_n)
    values (v_id, v_q, p_cat, icons->>p_cat, p_ends, btrim(p_source),
      left(coalesce(nullif(btrim(p_rules), ''), 'Resolves YES if this happens by ' || p_ends || ' according to ' || btrim(p_source) || '. Otherwise resolves NO.'), 1000),
      uid, pr.address, s.default_b, s.default_b * ln(p_p / (1 - p_p)), 0);
  perform public._tick(v_id);
  insert into public.bonds (market_id, user_id, amount) values (v_id, uid, s.create_bond);
  update public.profiles set token = token - s.create_bond, pts_bonus = pts_bonus + 1000 where id = uid;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

create function public.vault_deposit(p_amount numeric, p_lock text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare uid uuid := public.require_uid(); s public.settings; pr public.profiles; lk jsonb; v public.vault;
begin
  select * into s from public.settings where id = 1;
  lk := s.locks->p_lock;
  if lk is null then raise exception 'Invalid lock period'; end if;
  if p_amount is null or p_amount < 1 then raise exception 'Minimum deposit is $1'; end if;
  select * into pr from public.profiles where id = uid for update;
  if pr.stable < p_amount then raise exception 'Not enough balance'; end if;
  select * into v from public.vault where id = 1 for update;
  insert into public.deposits (user_id, amount, lock, mult, entry_acc, unlock_at)
    values (uid, p_amount, p_lock, (lk->>1)::int, v.acc, now() + make_interval(days => (lk->>0)::int));
  update public.profiles set stable = stable - p_amount where id = uid;
  update public.vault set tvl = tvl + p_amount where id = 1;
  return jsonb_build_object('ok', true);
end $$;

create function public.vault_withdraw(p_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare uid uuid := public.require_uid(); d public.deposits; v public.vault; reward numeric;
begin
  perform 1 from public.profiles where id = uid for update;
  select * into d from public.deposits where id = p_id and user_id = uid and withdrawn_at is null for update;
  if not found then raise exception 'Deposit not found'; end if;
  if d.unlock_at > now() then raise exception 'Locked until %', to_char(d.unlock_at, 'Mon DD, YYYY'); end if;
  select * into v from public.vault where id = 1 for update;
  if d.amount > v.tvl - v.borrowed then raise exception 'Vault liquidity is lent out right now. Try again later.'; end if;
  reward := greatest(0, d.amount * (v.acc - d.entry_acc)::numeric);
  update public.deposits set withdrawn_at = now(), received = d.amount + reward where id = d.id;
  update public.vault set tvl = tvl - d.amount where id = 1;
  update public.profiles set stable = stable + d.amount + reward,
    pts_bonus = pts_bonus + d.amount * d.mult * extract(epoch from (now() - d.start_at)) / 86400 where id = uid;
  return jsonb_build_object('ok', true, 'amount', d.amount + reward);
end $$;

create function public.stake(p_amount numeric)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare uid uuid := public.require_uid(); pr public.profiles;
begin
  if p_amount is null or p_amount <= 0 then raise exception 'Enter an amount'; end if;
  select * into pr from public.profiles where id = uid for update;
  if pr.token < p_amount then raise exception 'Not enough tokens'; end if;
  update public.profiles set token = token - p_amount, staked = staked + p_amount, staked_at = now(),
    pts_bonus = pts_bonus + staked * 0.1 * coalesce(extract(epoch from (now() - staked_at)) / 86400, 0) where id = uid;
  return jsonb_build_object('ok', true);
end $$;

create function public.unstake(p_amount numeric)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare uid uuid := public.require_uid(); pr public.profiles;
begin
  if p_amount is null or p_amount <= 0 then raise exception 'Enter an amount'; end if;
  select * into pr from public.profiles where id = uid for update;
  if pr.staked < p_amount then raise exception 'You only have % staked', pr.staked; end if;
  update public.profiles set token = token + p_amount, staked = staked - p_amount, staked_at = now(),
    pts_bonus = pts_bonus + staked * 0.1 * coalesce(extract(epoch from (now() - staked_at)) / 86400, 0) where id = uid;
  return jsonb_build_object('ok', true);
end $$;

create function public.vote(p_market text, p_side text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare uid uuid := public.require_uid(); pr public.profiles; m public.markets_v;
begin
  if p_side not in ('YES', 'NO') then raise exception 'Invalid side'; end if;
  select * into pr from public.profiles where id = uid for update;
  if pr.staked <= 0 then raise exception 'Stake tokens to vote on resolutions'; end if;
  perform 1 from public.markets where id = p_market for update;
  select * into m from public.markets_v where id = p_market;
  if not found or m.state <> 'resolving' then raise exception 'This market is not up for resolution'; end if;
  if exists (select 1 from public.votes where market_id = p_market and user_id = uid) then raise exception 'You already voted on this market'; end if;
  insert into public.votes (market_id, user_id, side, weight) values (p_market, uid, p_side, pr.staked);
  update public.markets set votes_yes = votes_yes + case when p_side = 'YES' then pr.staked else 0 end,
    votes_no = votes_no + case when p_side = 'NO' then pr.staked else 0 end where id = p_market;
  return jsonb_build_object('ok', true);
end $$;

-- settle a market: admins any time after it ends; anyone after the voting window
create function public.finalize(p_market text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare uid uuid := public.require_uid(); s public.settings; pr public.profiles; m public.markets_v; v_out text; pos public.positions; payout numeric; got numeric; n int := 0;
begin
  select * into s from public.settings where id = 1;
  select * into pr from public.profiles where id = uid;
  perform 1 from public.markets where id = p_market for update;
  select * into m from public.markets_v where id = p_market;
  if not found or m.state <> 'resolving' then raise exception 'This market is not ready to finalize'; end if;
  if m.votes_yes + m.votes_no <= 0 then raise exception 'No votes yet'; end if;
  if not coalesce(pr.is_admin, false) and current_date < m.ends + s.finalize_delay_days + 1 then
    raise exception 'Voting is open until %', to_char(m.ends + s.finalize_delay_days + 1, 'Mon DD, YYYY'); end if;
  v_out := case when m.votes_yes >= m.votes_no then 'YES' else 'NO' end;

  update public.markets set status = 'resolved', outcome = v_out where id = p_market;
  insert into public.price_ticks (market_id, p) values (p_market, case when v_out = 'YES' then 1 else 0 end);

  for pos in select * from public.positions where market_id = p_market and status = 'open' for update loop
    payout := case when pos.side = v_out then pos.shares::numeric else 0 end;
    got := greatest(0, payout - pos.borrowed);
    update public.vault set borrowed = greatest(0, borrowed - pos.borrowed) where id = 1;
    update public.positions set status = case when pos.side = v_out then 'won' else 'lost' end, received = got, closed_at = now() where id = pos.id;
    update public.profiles set stable = stable + got, pnl = pnl + got - pos.margin where id = pos.user_id;
    n := n + 1;
  end loop;

  update public.profiles p set token = token + round(v.weight * 0.01), pts_bonus = pts_bonus + 250
    from public.votes v where v.market_id = p_market and v.side = v_out and v.user_id = p.id;
  update public.votes set paid = true, reward = case when side = v_out then round(weight * 0.01) else 0 end where market_id = p_market;
  update public.profiles p set token = token + b.amount from public.bonds b where b.market_id = p_market and not b.returned and b.user_id = p.id;
  update public.bonds set returned = true where market_id = p_market;
  return jsonb_build_object('ok', true, 'outcome', v_out, 'settled', n);
end $$;

create function public.set_ref_code(p_code text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare uid uuid := public.require_uid(); c text := lower(btrim(p_code));
begin
  if c !~ '^[a-z0-9_-]{3,20}$' then raise exception 'Use 3 to 20 letters, numbers, dashes or underscores.'; end if;
  if c in ('admin', '369x', 'test', 'support', 'official') then raise exception 'That code is taken. Try another.'; end if;
  if exists (select 1 from public.profiles where ref_code = c and id <> uid) then raise exception 'That code is taken. Try another.'; end if;
  if exists (select 1 from public.profiles where ref_by = (select ref_code from public.profiles where id = uid)) then
    raise exception 'You already have referrals, so your code can''t change.'; end if;
  update public.profiles set ref_code = c where id = uid;
  return jsonb_build_object('ok', true, 'code', c);
end $$;

create function public.claim_ref()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare uid uuid := public.require_uid(); pr public.profiles; amt numeric;
begin
  select * into pr from public.profiles where id = uid for update;
  amt := pr.ref_earned - pr.ref_claimed;
  if amt <= 0 then raise exception 'Nothing to claim yet'; end if;
  update public.profiles set stable = stable + amt, ref_claimed = ref_earned where id = uid;
  return jsonb_build_object('ok', true, 'amount', amt);
end $$;

create function public.get_affiliate()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare uid uuid := public.require_uid(); pr public.profiles;
begin
  select * into pr from public.profiles where id = uid;
  return jsonb_build_object(
    'code', pr.ref_code, 'clicks', pr.ref_clicks, 'earned', pr.ref_earned, 'claimable', pr.ref_earned - pr.ref_claimed,
    'referrals', coalesce((select jsonb_agg(jsonb_build_object('addr', r.address, 'joined', r.created_at::date, 'volume', r.volume, 'earned', r.ref_generated) order by r.created_at desc)
      from public.profiles r where pr.ref_code is not null and r.ref_by = pr.ref_code), '[]'::jsonb),
    'daily', (select jsonb_agg(coalesce(d.amount, 0) order by g.day) from generate_series(current_date - 13, current_date, '1 day') g(day)
      left join public.ref_daily d on d.referrer = uid and d.day = g.day::date));
end $$;

create function public.track_click(p_code text)
returns void language sql security definer set search_path = '' as $$
  update public.profiles set ref_clicks = ref_clicks + 1 where ref_code = lower(p_code)
$$;

create function public.leaderboard(p_by text default 'profit')
returns table (address text, pnl numeric, win int, trades int, volume numeric, points numeric)
language sql stable security definer set search_path = '' as $$
  select x.* from (
    select p.address, p.pnl,
      coalesce((select round(100.0 * count(*) filter (where q.received > q.margin) / nullif(count(*), 0))::int
        from public.positions q where q.user_id = p.id and q.status <> 'open'), 0) as win,
      p.trades, p.volume, (public.points_of(p.id)->>'total')::numeric as points
    from public.profiles p where p.trades > 0 or p.pts_bonus > 0) x
  order by case p_by when 'volume' then x.volume when 'points' then x.points else x.pnl end desc
  limit 50
$$;

-- ---------------------------------------------------------------------
-- Function permissions: internal helpers are not callable from the web
-- ---------------------------------------------------------------------
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function public.lmsr_cost, public.lmsr_price_yes, public.lmsr_shares_for, public.lmsr_proceeds,
  public.max_leverage, public.stake_discount, public.ref_rate, public.fee_rate,
  public.leaderboard, public.track_click to anon, authenticated;
grant execute on function public.ensure_profile, public.get_account, public.faucet, public.place_trade, public.close_position,
  public.create_market, public.vault_deposit, public.vault_withdraw, public.stake, public.unstake, public.vote,
  public.finalize, public.set_ref_code, public.claim_ref, public.get_affiliate, public.points_of, public.require_uid, public.me_address
  to authenticated;
-- points_of exposes only point totals; restrict it to the caller in practice via get_account
revoke execute on function public.points_of from authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
