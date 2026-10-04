/* =====================================================================
   LIVE BACKEND (Supabase)
   When CONFIG.USE_MOCK is false and SUPABASE_URL is set, this file
   replaces the demo engine in api.js with calls to the shared Supabase
   database. All money logic runs in the database (see supabase/migrations).
   Sign-in uses the wallet: the user signs a free message (no gas).
   ===================================================================== */
const SB = (!CONFIG.USE_MOCK && CONFIG.SUPABASE_URL && window.supabase)
  ? window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_KEY)
  : null;

const backend = {
  live: !!SB,
  // wallet address of the current Supabase session, if any
  async sessionAddress(){
    const { data: { session } } = await SB.auth.getSession();
    const meta = session?.user?.user_metadata || {};
    const a = meta.custom_claims?.address || meta.address || (String(meta.sub || "").startsWith("web3:") ? meta.sub.split(":")[2] : null);
    return a ? a.toLowerCase() : null;
  },
  // make sure the database session belongs to this wallet; ask for a signature if not
  async login(addr){
    if((await backend.sessionAddress()) !== addr.toLowerCase()){
      await SB.auth.signOut().catch(() => {});
      const { error } = await SB.auth.signInWithWeb3({
        chain: "ethereum",
        statement: `Sign in to ${CONFIG.SITE_NAME}. This is free and does not send a transaction.`,
        // sign for the site's base address (no #/page or ?ref part), which must be allowed in Supabase URL settings
        options: { url: location.origin + "/" }
      });
      if(error){
        if(/rejected|denied/i.test(error.message)) throw new Error("Signature cancelled");
        if(/URI which is not allowed/i.test(error.message)) throw new Error(`Sign-in is not set up for ${location.host} yet. Add it to Supabase > Authentication > URL Configuration.`);
        throw new Error(error.message);
      }
    }
    await rpc("ensure_profile", { p_ref: store.get("refBy", null) });
  },
  async logout(){ await SB.auth.signOut().catch(() => {}); }
};

async function rpc(fn, args = {}){
  const { data, error } = await SB.rpc(fn, args);
  if(error) throw new Error(cleanError(error.message));
  return data;
}
function cleanError(msg){
  if(/JWT|not authenticated|sign in with your wallet/i.test(msg)) return "Please connect your wallet and sign in again";
  return msg;
}
const n = (x) => Number(x || 0);

function mapMarket(r){
  return {
    id: r.id, q: r.q, cat: r.cat, icon: r.icon, ends: r.ends, source: r.source, rules: r.rules,
    creator: r.creator_label, createdAt: Date.parse(r.created_at), b: r.b, qY: r.q_y, qN: r.q_n,
    vol: n(r.vol), traders: r.traders, status: r.state, outcome: r.outcome,
    votes: { YES: n(r.votes_yes), NO: n(r.votes_no) }, creatorEarned: n(r.creator_earned),
    p: r.p, maxLev: Engine.maxLeverage({ vol: n(r.vol) }), history: [], feed: [], lastTradeAt: r.last_trade_at
  };
}

if(SB){
  Object.assign(api, {
    async getMarkets({ category = "All", q = "", status = "live", sort = "volume" } = {}){
      let qy = SB.from("markets_v").select("*");
      if(category !== "All") qy = qy.eq("cat", category);
      if(status !== "all") qy = qy.eq("state", status);
      if(q.trim()) qy = qy.ilike("q", "%" + q.trim().replace(/[%_\\]/g, "\\$&") + "%");
      const order = { volume: ["vol", false], trending: ["last_trade_at", false], new: ["created_at", false], ending: ["ends", true] }[sort] || ["vol", false];
      qy = qy.order(order[0], { ascending: order[1], nullsFirst: false }).limit(200);
      const { data, error } = await qy; if(error) throw new Error(error.message);
      return data.map(mapMarket);
    },
    async getMarket(id){
      const [m, ticks, trades] = await Promise.all([
        SB.from("markets_v").select("*").eq("id", id).maybeSingle(),
        SB.from("price_ticks").select("ts,p").eq("market_id", id).order("ts", { ascending: false }).limit(300),
        SB.from("trades").select("address,side,kind,amount,price,ts").eq("market_id", id).order("ts", { ascending: false }).limit(30)
      ]);
      if(m.error) throw new Error(m.error.message);
      if(!m.data) throw new Error("Market not found");
      const out = mapMarket(m.data);
      out.history = (ticks.data || []).reverse().map(t => [Date.parse(t.ts), t.p]);
      if(!out.history.length) out.history = [[Date.now(), out.p]];
      out.feed = (trades.data || []).filter(t => t.kind === "buy").map(t => ({ ts: Date.parse(t.ts), addr: t.address, side: t.side, amount: n(t.amount), price: t.price }));
      return out;
    },
    async placeTrade({ marketId, side, margin, lev, minShares = 0 }){
      return rpc("place_trade", { p_market: marketId, p_side: side, p_margin: margin, p_lev: lev, p_min_shares: minShares });
    },
    async closePosition({ id }){ return rpc("close_position", { p_id: id }); },
    async getAccount(w){
      if(!w) return null;
      const a = await rpc("get_account"); if(!a) return null;
      const positions = a.positions.map(p => {
        const pos = { id: p.id, marketId: p.market_id, q: p.q, icon: p.icon, side: p.side, shares: p.shares, margin: n(p.margin),
          size: n(p.size), borrowed: n(p.borrowed), lev: p.lev, avg: p.avg, fee: n(p.fee), ts: Date.parse(p.opened_at) };
        return { ...pos, status: p.state, ...Engine.mark({ qY: p.q_y, qN: p.q_n, b: p.b }, pos) };
      });
      const how = { closed: "Closed", won: "Won", lost: "Lost", liquidated: "Liquidated" };
      const u = {
        address: a.address, stable: n(a.stable), token: n(a.token), staked: n(a.staked), stakedAt: Date.parse(a.staked_at) || 0,
        faucetAt: Date.parse(a.faucet_at) || 0, volume: n(a.volume), trades: a.trades, maxLev: a.max_lev, pnl: n(a.pnl),
        refCode: a.ref_code, isAdmin: a.is_admin, feeRate: n(a.fee_rate), points: a.points, positions,
        history: a.history.map(h => ({ marketId: h.market_id, q: h.q, icon: h.icon, side: h.side, lev: h.lev, margin: n(h.margin),
          received: n(h.received), how: how[h.status] || h.status, closedAt: Date.parse(h.closed_at) })),
        deposits: a.deposits.map(d => ({ id: d.id, amount: n(d.amount), lock: d.lock, mult: d.mult, start: Date.parse(d.start_at),
          unlock: Date.parse(d.unlock_at), earned: n(d.earned) })),
        votes: Object.fromEntries(Object.entries(a.votes).map(([k, v]) => [k, { side: v.side, weight: n(v.weight), reward: n(v.reward) }])),
        created: a.created.map(m => ({ id: m.id, q: m.q, status: m.state, outcome: m.outcome, vol: n(m.vol), creatorEarned: n(m.creator_earned),
          bond: { amount: n(m.bond), returned: m.returned } }))
      };
      u.bonds = Object.fromEntries(u.created.map(m => [m.id, m.bond]));
      u.badges = Engine.badges(u, !!a.ref_code);
      u.stakeTier = Engine.stakeTier(u.staked);
      return u;
    },
    async faucet(){ return rpc("faucet"); },
    async createMarket({ q, cat, ends, source, rules, p }){
      return rpc("create_market", { p_q: q, p_cat: cat, p_ends: ends, p_source: source, p_rules: rules, p_p: p });
    },
    async getVault(){
      const [{ data: v, error }, { data: first }] = await Promise.all([
        SB.from("vault").select("tvl,borrowed,fees").eq("id", 1).single(),
        SB.from("markets").select("created_at").order("created_at", { ascending: true }).limit(1)
      ]);
      if(error) throw new Error(error.message);
      const days = Math.max(7, (Date.now() - Date.parse(first?.[0]?.created_at || Date.now())) / 864e5);
      const tvl = n(v.tvl), fees = n(v.fees);
      return { tvl, borrowed: n(v.borrowed), fees, utilization: tvl ? n(v.borrowed) / tvl : 0, apy: tvl ? fees / tvl * 365 / days : 0 };
    },
    async deposit({ amount, lock }){ return rpc("vault_deposit", { p_amount: amount, p_lock: lock }); },
    async withdraw({ id }){ return rpc("vault_withdraw", { p_id: id }); },
    async stake({ amount }){ return rpc("stake", { p_amount: amount }); },
    async unstake({ amount }){ return rpc("unstake", { p_amount: amount }); },
    async vote({ id, side }){ return rpc("vote", { p_market: id, p_side: side }); },
    async finalize({ id }){ return rpc("finalize", { p_market: id }); },
    async getLeaderboard(by = "profit"){
      const rows = await rpc("leaderboard", { p_by: by });
      const me = (wallet.address || "").toLowerCase();
      return rows.map(r => ({ addr: short(r.address), you: r.address === me, pnl: n(r.pnl), win: r.win, trades: r.trades, volume: n(r.volume), points: n(r.points) }));
    },
    async getAffiliate(){
      const a = await rpc("get_affiliate");
      const referrals = a.referrals.map(r => ({ addr: short(r.addr), joined: r.joined, volume: n(r.volume), earned: n(r.earned), tier: 1 }));
      return { code: a.code, referrals, earnings: (a.daily || []).map(n),
        stats: { clicks: a.clicks, signups: referrals.length, volume: referrals.reduce((s, r) => s + r.volume, 0), earned: n(a.earned), claimable: n(a.claimable) } };
    },
    async setAffiliateCode(w, code){ return rpc("set_ref_code", { p_code: code }); },
    async claimAffiliate(){ return rpc("claim_ref"); },
    async trackClick(code){ return SB.rpc("track_click", { p_code: code }).then(() => {}, () => {}); }
  });
}
