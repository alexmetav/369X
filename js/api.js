/* =====================================================================
   API LAYER
   Every page talks ONLY to the `api` object below. In demo mode
   (CONFIG.USE_MOCK = true) a small engine runs in the browser and saves
   to localStorage. To go live, implement these endpoints on your server
   (or swap each function for smart-contract calls) and set USE_MOCK=false.

   GET  /markets                         -> Market[]
   GET  /markets/:id                     -> Market (with history[], feed[])
   POST /markets {wallet, q, cat, ends, source, rules, p}   -> Market
   POST /trades  {wallet, marketId, side, margin, lev, ref} -> {position}
   POST /positions/:id/close {wallet}    -> {received}
   GET  /account/:wallet                 -> Account (balances, positions, vault, stake, points ...)
   POST /faucet {wallet}                 -> Account
   POST /vault/deposit {wallet, amount, lock}  /vault/withdraw {wallet, id}
   GET  /vault                           -> {tvl, borrowed, fees, apy}
   POST /stake {wallet, amount}  /unstake {wallet, amount}
   POST /markets/:id/vote {wallet, side}  /markets/:id/finalize {wallet}
   GET  /leaderboard?by=profit|volume|points -> Row[]
   GET  /affiliate/:wallet  POST /affiliate/code {wallet, code}  POST /affiliate/claim {wallet}
   POST /affiliate/click {code}
   ===================================================================== */

async function http(path, opts = {}){
  const r = await fetch(CONFIG.API_BASE + path, { headers: { "Content-Type": "application/json" }, ...opts });
  if(!r.ok){ let m = "Request failed (" + r.status + ")"; try{ m = (await r.json()).error || m; }catch(e){} throw new Error(m); }
  return r.json();
}
const post = (path, body) => http(path, { method: "POST", body: JSON.stringify(body) });

/* ---------------------------------------------------------------------
   DEMO ENGINE
   --------------------------------------------------------------------- */
const CATS = ["All", "Crypto", "Sports", "Politics", "Finance", "Culture", "World"];
const ICONS = { Crypto: "Crypto", Sports: "Sports", Politics: "Politics", Finance: "Finance", Culture: "Culture", World: "World" };   // drawn by catIcon()

function seedMarkets(){
  const raw = [
    ["btc-150k", "Will Bitcoin trade above $150K before Dec 31, 2026?", "Crypto", "Crypto", .41, 842300, 6120, "2026-12-31", "CoinGecko BTC/USD price"],
    ["fed-nov", "Will the Fed cut rates at the November 2026 meeting?", "Finance", "Finance", .62, 1204500, 9844, "2026-11-04", "federalreserve.gov FOMC statement"],
    ["eth-6k", "Will ETH close Q4 2026 above $6,000?", "Crypto", "Crypto", .33, 512900, 4210, "2026-12-31", "CoinGecko ETH/USD daily close"],
    ["ucl-rm", "Will Real Madrid reach the Champions League quarter-finals?", "Sports", "Sports", .71, 398400, 3380, "2027-04-15", "uefa.com official results"],
    ["house-26", "Will Democrats win the US House in the 2026 midterms?", "Politics", "Politics", .58, 2310700, 15402, "2026-11-03", "AP race calls"],
    ["bnb-ath", "Will BNB set a new all-time high before November?", "Crypto", "Crypto", .47, 286100, 2915, "2026-10-31", "CoinGecko BNB/USD price"],
    ["spx-7500", "Will the S&P 500 close 2026 above 7,500?", "Finance", "Finance", .55, 674800, 5230, "2026-12-31", "S&P Dow Jones Indices close"],
    ["lakers-po", "Will the Lakers make the 2027 NBA playoffs?", "Sports", "Sports", .64, 221600, 1994, "2027-04-12", "nba.com standings"],
    ["gta6", "Will GTA VI launch on its announced release date?", "Culture", "Culture", .72, 455200, 4876, "2026-11-19", "Rockstar Games official announcement"],
    ["ind-aus", "Will India win their next Test series against Australia?", "Sports", "Sports", .52, 318000, 3702, "2027-01-20", "ESPNcricinfo series result"],
    ["hot-2026", "Will 2026 be the hottest year on record globally?", "World", "World", .44, 143900, 1288, "2027-01-15", "NASA GISS annual report"],
    ["starship", "Will Starship complete a full booster and ship reuse in 2026?", "World", "World", .29, 201300, 2140, "2026-12-31", "SpaceX official statement"],
    ["btc-sep", "Did Bitcoin close September above $110K?", "Crypto", "Crypto", .66, 389000, 3011, addDays(-2), "CoinGecko BTC/USD monthly close"],
    ["sol-etf", "Was a spot SOL ETF approved in the US by Sept 20?", "Crypto", "Crypto", .81, 512000, 4402, addDays(-12), "SEC.gov filings"]
  ];
  return raw.map(([id, q, cat, icon, p, vol, traders, ends, source]) => {
    const b = Math.round(Math.min(20000, Math.max(2500, vol / 120)));
    const m = { id, q, cat, icon, ends, source, vol, traders, creator: "0x369x…Team", createdAt: Date.now() - 864e5 * 20,
      rules: `Resolves YES if the outcome is confirmed by ${source} by the end date. Otherwise resolves NO.`,
      ...LMSR.init(p, b), status: "live", outcome: null, votes: { YES: 0, NO: 0 }, creatorEarned: vol * CONFIG.CREATOR_FEE,
      history: seededHistory(id, p), feed: [] };
    if(id === "sol-etf"){ m.status = "resolved"; m.outcome = "YES"; m.votes = { YES: 4.1e6, NO: 2.2e5 }; }
    if(id === "btc-sep"){ m.votes = { YES: 1.8e6, NO: 6.4e5 }; }
    return m;
  });
}
function seededHistory(id, p){
  let s = [...id].reduce((a, c) => a + c.charCodeAt(0), 0);
  const rnd = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
  const pts = []; let v = Math.min(.9, Math.max(.1, p + (rnd() - .5) * .3)); const t0 = Date.now() - 48 * 36e5 * 6;
  for(let i = 0; i < 48; i++){ v += (p - v) * 0.06 + (rnd() - .5) * 0.05; v = Math.min(.97, Math.max(.03, v)); pts.push([t0 + i * 36e5 * 6, +v.toFixed(4)]); }
  pts[pts.length - 1][1] = p; return pts;
}

const Engine = {
  markets(){
    let ms = store.get("markets", null);
    if(!ms){ ms = seedMarkets(); store.set("markets", ms); }
    // markets past their end date move to "resolving"
    const t = today(); let changed = false;
    ms.forEach(m => { if(m.status === "live" && m.ends < t){ m.status = "resolving"; changed = true; } });
    if(changed) store.set("markets", ms);
    return ms;
  },
  saveMarkets(ms){ store.set("markets", ms); },
  market(id){ const m = Engine.markets().find(x => x.id === id); if(!m) throw new Error("Market not found"); return m; },
  updateMarket(id, fn){ const ms = Engine.markets(); const m = ms.find(x => x.id === id); fn(m); Engine.saveMarkets(ms); return m; },

  vault(){ return store.get("vault", { tvl: 1840000, borrowed: 612000, fees: 48210 }); },
  saveVault(v){ store.set("vault", v); },

  blankUser(){ return { stable: 0, token: 0, faucetAt: 0, positions: [], history: [], deposits: [], staked: 0, votes: {}, bonds: {},
    volume: 0, trades: 0, maxLev: 1, points: { trade: 0, bonus: 0 }, pnl: 0 }; },
  user(addr){ return { ...Engine.blankUser(), ...store.get("u:" + addr.toLowerCase(), {}) }; },
  saveUser(addr, u){ store.set("u:" + addr.toLowerCase(), u); },

  maxLeverage(m){ if(!CONFIG.LEVERAGE_ENABLED) return 1; let L = 1; CONFIG.LEVERAGE_TIERS.forEach(([lev, min]) => { if(m.vol >= min) L = lev; }); return L; },
  stakeTier(staked){ let t = CONFIG.STAKE_TIERS[0]; CONFIG.STAKE_TIERS.forEach(x => { if(staked >= x.min) t = x; }); return t; },
  feeRate(u, ref){
    const base = CONFIG.CREATOR_FEE + CONFIG.PROTOCOL_FEE;
    const d = 1 - Math.min(0.6, Engine.stakeTier(u.staked).discount + (ref ? CONFIG.REF_DISCOUNT : 0));
    return base * d;
  },
  // quote a buy: margin * lev worth of shares, fee taken from the size
  quote(m, u, side, margin, lev, ref){
    const size = margin * lev, rate = u.feeRate ?? Engine.feeRate(u, ref), fee = size * rate;
    const shares = LMSR.sharesFor(m, side, size - fee);
    const after = LMSR.apply(m, side, shares);
    const borrowed = size - margin;
    const liq = lev > 1 ? (borrowed + CONFIG.MAINTENANCE * size) / shares : 0;
    return { size, fee, rate, shares, borrowed, avg: shares ? (size - fee) / shares : 0, priceAfter: LMSR.price(after, side),
      payout: shares, liq, impact: LMSR.price(after, side) - LMSR.price(m, side) };
  },
  // value of an open position right now (mark-to-market at mid price)
  mark(m, pos){
    const price = LMSR.price(m, pos.side), value = pos.shares * price, equity = value - pos.borrowed;
    return { price, value, equity, pnl: equity - pos.margin, liq: pos.lev > 1 ? (pos.borrowed + CONFIG.MAINTENANCE * pos.size) / pos.shares : 0 };
  },
  // fees split: creator, vault LPs, treasury
  takeFee(m, fee){
    const total = CONFIG.CREATOR_FEE + CONFIG.PROTOCOL_FEE;
    m.creatorEarned = (m.creatorEarned || 0) + fee * CONFIG.CREATOR_FEE / total;
    const v = Engine.vault(); v.fees += fee * CONFIG.PROTOCOL_FEE / total * CONFIG.LP_SHARE; Engine.saveVault(v);
  },
  pushTick(m, addr, side, amount){
    const p = LMSR.priceYes(m);
    m.history.push([Date.now(), +p.toFixed(4)]); if(m.history.length > 300) m.history.splice(0, m.history.length - 300);
    m.feed.unshift({ ts: Date.now(), addr, side, amount, price: LMSR.price(m, side) }); m.feed.length = Math.min(m.feed.length, 30);
    m.vol += amount;
  },

  // simulated "other traders" so prices move while you watch (demo only)
  simulate(){
    const now = Date.now(), last = store.get("simTs", now - 6e5);
    const steps = Math.min(8, Math.floor((now - last) / 15000));
    if(steps < 1) return;
    const ms = Engine.markets();
    ms.forEach(m => {
      if(m.status !== "live") return;
      for(let i = 0; i < steps; i++){
        if(Math.random() < 0.45) continue;
        const p = LMSR.priceYes(m), anchor = m.history[0][1];
        const side = Math.random() < 0.5 + (anchor - p) * 0.8 ? "YES" : "NO";
        const amt = Math.round(20 + Math.random() ** 2 * 1800);
        const sh = LMSR.sharesFor(m, side, amt);
        Object.assign(m, LMSR.apply(m, side, sh));
        if(Math.random() < 0.3) m.traders++;
        Engine.pushTick(m, randAddr(), side, amt);
      }
    });
    Engine.saveMarkets(ms); store.set("simTs", now);
  },

  // settle anything that resolved, liquidate underwater positions
  housekeeping(addr){
    const u = Engine.user(addr), ms = Engine.markets(); let changed = false;
    u.positions = u.positions.filter(pos => {
      const m = ms.find(x => x.id === pos.marketId); if(!m) return true;
      if(m.status === "resolved"){
        const payout = pos.side === m.outcome ? pos.shares : 0, got = Math.max(0, payout - pos.borrowed);
        u.stable += got; u.pnl += got - pos.margin; changed = true;
        const v = Engine.vault(); v.borrowed = Math.max(0, v.borrowed - pos.borrowed); Engine.saveVault(v);
        u.history.unshift({ ...pos, closedAt: Date.now(), received: got, how: pos.side === m.outcome ? "Won" : "Lost" });
        return false;
      }
      if(pos.lev > 1 && m.status === "live"){
        const mk = Engine.mark(m, pos);
        if(mk.equity < CONFIG.MAINTENANCE * pos.size){
          // liquidation: shares are sold back, vault is repaid, margin is lost
          const proceeds = LMSR.proceedsFor(m, pos.side, pos.shares);
          Object.assign(m, LMSR.apply(m, pos.side, -pos.shares)); Engine.pushTick(m, addr, pos.side === "YES" ? "NO" : "YES", proceeds);
          const v = Engine.vault(); v.borrowed = Math.max(0, v.borrowed - pos.borrowed); Engine.saveVault(v);
          u.pnl -= pos.margin; changed = true;
          u.history.unshift({ ...pos, closedAt: Date.now(), received: 0, how: "Liquidated" });
          return false;
        }
      }
      return true;
    });
    // resolution rewards for voters + creation bonds back
    Object.entries(u.votes).forEach(([id, v]) => {
      const m = ms.find(x => x.id === id);
      if(m && m.status === "resolved" && !v.paid){ v.paid = true; changed = true; if(v.side === m.outcome){ v.reward = Math.round(v.weight * 0.01); u.token += v.reward; u.points.bonus += 250; } }
    });
    Object.entries(u.bonds).forEach(([id, b]) => {
      const m = ms.find(x => x.id === id);
      if(m && m.status === "resolved" && !b.returned){ b.returned = true; u.token += b.amount; changed = true; }
    });
    if(changed){ Engine.saveUser(addr, u); Engine.saveMarkets(ms); }
  },

  points(u){
    const now = Date.now();
    const vault = u.deposits.reduce((a, d) => a + d.amount * d.mult * (now - d.start) / 864e5, 0);
    const stake = u.staked * 0.1 * (now - (u.stakedAt || now)) / 864e5;
    const badges = Engine.badges(u).filter(b => b.got).length * 500;
    const refs = store.get("affReferrals", MOCK_REFERRALS).reduce((a, r) => a + r.volume, 0) * 0.1;
    const parts = { Trading: u.points.trade, Vault: vault, Staking: stake, Referrals: refs, Badges: badges, Bonus: u.points.bonus };
    return { parts, total: Object.values(parts).reduce((a, b) => a + b, 0) };
  },
  badges(u, hasCode = !!store.get("affCode:" + (wallet.address || "").toLowerCase(), null)){
    const created = Object.keys(u.bonds || {}).length;
    return [
      { ico: "target", name: "First call", desc: "Place your first trade", got: u.trades >= 1 },
      { ico: "flame", name: "On a roll", desc: "Place 10 trades", got: u.trades >= 10 },
      ...(CONFIG.LEVERAGE_ENABLED ? [
      { ico: "rocket", name: "Leverage up", desc: "Open a 5× position", got: u.maxLev >= 5 },
      { ico: "bolt", name: "Max power", desc: "Open a 10× position", got: u.maxLev >= 10 }] : []),
      { ico: "waves", name: "Whale", desc: "Trade $10K volume", got: u.volume >= 10000 },
      { ico: "blocks", name: "Market maker", desc: "Create a market", got: created >= 1 },
      { ico: "vault", name: "Liquidity provider", desc: "Deposit into the vault", got: u.deposits.length >= 1 },
      { ico: "diamond", name: "Diamond hands", desc: "Lock in the vault for 365 days", got: u.deposits.some(d => d.lock === "d365") },
      { ico: "shield", name: "Guardian", desc: "Stake and vote on a resolution", got: Object.keys(u.votes || {}).length >= 1 },
      { ico: "link", name: "Connector", desc: "Create your referral link", got: hasCode }
    ];
  }
};

const MOCK_LEADERS = [
  ["0xA4f1…3F1C", 48210, 71, 412, 1.92e6, 284000], ["0x91b2…7C04", 31940, 68, 388, 1.41e6, 231500], ["0x3E9d…B12a", 27420, 64, 301, 1.18e6, 198200],
  ["0x77c0…9AD2", 19830, 61, 276, 902000, 162400], ["0xC2e5…40Ef", 14120, 59, 233, 744000, 131900], ["0x08aa…7F21", 11360, 57, 190, 612000, 109300],
  ["0x5D1c…1A9b", 9640, 55, 164, 498000, 88100], ["0x2E7f…F80d", 7410, 53, 151, 402000, 70500], ["0x6B20…C3e4", 6020, 52, 139, 351000, 59800], ["0xF019…88aB", 5290, 51, 122, 288000, 49200]
];
const MOCK_REFERRALS = [
  { addr: "0x8c2a…41d0", joined: "2026-09-02", volume: 12400, earned: 74.4, tier: 1 },
  { addr: "0x1f9b…e7c3", joined: "2026-09-06", volume: 8350, earned: 50.1, tier: 1 },
  { addr: "0xd40e…2b91", joined: "2026-09-11", volume: 3120, earned: 18.72, tier: 1 },
  { addr: "0x55ac…90fe", joined: "2026-09-14", volume: 2600, earned: 2.6, tier: 2 },
  { addr: "0xab31…7d02", joined: "2026-09-17", volume: 940, earned: 5.64, tier: 1 }
];

function needWallet(w){ if(!w) throw new Error("Connect your wallet first"); }
function sortMarkets(list, sort){
  const by = {
    trending: (a, b) => (b.feed[0]?.ts || 0) - (a.feed[0]?.ts || 0) || b.vol - a.vol,
    volume: (a, b) => b.vol - a.vol,
    new: (a, b) => b.createdAt - a.createdAt,
    ending: (a, b) => a.ends.localeCompare(b.ends)
  };
  return [...list].sort(by[sort] || by.volume);
}

/* ---------------------------------------------------------------------
   PUBLIC API
   --------------------------------------------------------------------- */
const api = {
  async getMarkets({ category = "All", q = "", status = "live", sort = "volume" } = {}){
    if(!CONFIG.USE_MOCK) return http(`/markets?category=${encodeURIComponent(category)}&q=${encodeURIComponent(q)}&status=${status}&sort=${sort}`);
    Engine.simulate();
    const list = Engine.markets().filter(m => (category === "All" || m.cat === category) && (status === "all" || m.status === status) && m.q.toLowerCase().includes(q.toLowerCase()));
    return sortMarkets(list, sort).map(m => ({ ...m, p: LMSR.priceYes(m), maxLev: Engine.maxLeverage(m) }));
  },
  async getMarket(id){
    if(!CONFIG.USE_MOCK) return http(`/markets/${encodeURIComponent(id)}`);
    Engine.simulate();
    const m = Engine.market(id);
    return { ...m, p: LMSR.priceYes(m), maxLev: Engine.maxLeverage(m) };
  },
  async placeTrade({ marketId, side, margin, lev, wallet: w, ref }){
    if(!CONFIG.USE_MOCK) return post(`/trades`, { marketId, side, margin, lev, wallet: w, ref });
    needWallet(w); await delay(400);
    const u = Engine.user(w); let pos;
    Engine.updateMarket(marketId, m => {
      if(m.status !== "live") throw new Error("This market is closed for trading");
      if(lev > Engine.maxLeverage(m)) throw new Error("Max leverage on this market is " + Engine.maxLeverage(m) + "×");
      if(margin > u.stable + 1e-9) throw new Error("Not enough " + CONFIG.STABLE + ". Use the faucet to get test funds.");
      const qt = Engine.quote(m, u, side, margin, lev, ref);
      const v = Engine.vault();
      if(qt.borrowed > v.tvl - v.borrowed) throw new Error("Not enough vault liquidity for this leverage");
      v.borrowed += qt.borrowed; Engine.saveVault(v);
      Object.assign(m, LMSR.apply(m, side, qt.shares));
      Engine.takeFee(m, qt.fee);
      Engine.pushTick(m, w, side, qt.size);
      if(!u.positions.some(p => p.marketId === m.id) && !u.history.some(p => p.marketId === m.id)) m.traders++;
      pos = { id: uid(), marketId, q: m.q, icon: m.icon, side, shares: qt.shares, margin, size: qt.size, borrowed: qt.borrowed, lev, avg: qt.avg, fee: qt.fee, ts: Date.now() };
      u.stable -= margin; u.positions.unshift(pos); u.volume += qt.size; u.trades++; u.maxLev = Math.max(u.maxLev, lev); u.points.trade += qt.size;
    });
    Engine.saveUser(w, u);
    return { ok: true, position: pos };
  },
  async closePosition({ id, wallet: w }){
    if(!CONFIG.USE_MOCK) return post(`/positions/${encodeURIComponent(id)}/close`, { wallet: w });
    needWallet(w); await delay(350);
    const u = Engine.user(w), pos = u.positions.find(p => p.id === id); if(!pos) throw new Error("Position not found");
    let received = 0;
    Engine.updateMarket(pos.marketId, m => {
      if(m.status !== "live") throw new Error("Market is closed. It pays out when it resolves.");
      const proceeds = LMSR.proceedsFor(m, pos.side, pos.shares), fee = proceeds * Engine.feeRate(u, store.get("refBy", null));
      Object.assign(m, LMSR.apply(m, pos.side, -pos.shares));
      Engine.takeFee(m, fee); Engine.pushTick(m, w, pos.side === "YES" ? "NO" : "YES", proceeds);
      received = Math.max(0, proceeds - fee - pos.borrowed);
      const v = Engine.vault(); v.borrowed = Math.max(0, v.borrowed - pos.borrowed); Engine.saveVault(v);
    });
    u.positions = u.positions.filter(p => p.id !== id);
    u.stable += received; u.pnl += received - pos.margin; u.volume += pos.size; u.points.trade += pos.size * 0.5;
    u.history.unshift({ ...pos, closedAt: Date.now(), received, how: "Closed" });
    Engine.saveUser(w, u);
    return { ok: true, received };
  },
  async getAccount(w){
    if(!w) return null;
    if(!CONFIG.USE_MOCK) return http(`/account/${w}`);
    Engine.simulate(); Engine.housekeeping(w);
    const u = Engine.user(w), ms = Engine.markets();
    const positions = u.positions.map(p => { const m = ms.find(x => x.id === p.marketId); return { ...p, status: m.status, ...Engine.mark(m, p) }; });
    const created = Object.entries(u.bonds).map(([id, b]) => { const m = ms.find(x => x.id === id); return m && { ...m, bond: b, p: LMSR.priceYes(m) }; }).filter(Boolean);
    const pts = Engine.points(u);
    return { ...u, positions, created, points: pts, badges: Engine.badges(u), stakeTier: Engine.stakeTier(u.staked), feeRate: Engine.feeRate(u, store.get("refBy", null)) };
  },
  async faucet(w){
    if(!CONFIG.USE_MOCK) return post(`/faucet`, { wallet: w });
    needWallet(w); await delay(400);
    const u = Engine.user(w), wait = u.faucetAt + CONFIG.FAUCET_COOLDOWN_H * 36e5 - Date.now();
    if(wait > 0) throw new Error("Faucet available again in " + Math.ceil(wait / 36e5) + "h");
    u.stable += CONFIG.FAUCET_STABLE; u.token += CONFIG.FAUCET_TOKEN; u.faucetAt = Date.now();
    Engine.saveUser(w, u); return { ok: true };
  },
  async createMarket({ wallet: w, q, cat, ends, source, rules, p, liquidity }){
    if(!CONFIG.USE_MOCK) return post(`/markets`, { wallet: w, q, cat, ends, source, rules, p, liquidity });
    needWallet(w); await delay(500);
    const u = Engine.user(w);
    if(u.token < CONFIG.CREATE_BOND) throw new Error("You need " + tok(CONFIG.CREATE_BOND) + " for the bond. Use the faucet.");
    const ms = Engine.markets();
    if(ms.some(m => m.q.toLowerCase() === q.toLowerCase())) throw new Error("A market with this question already exists");
    const id = q.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) + "-" + Math.random().toString(36).slice(2, 6);
    const b = liquidity || CONFIG.DEFAULT_LIQUIDITY;
    const m = { id, q, cat, icon: ICONS[cat] || "World", ends, source, rules, vol: 0, traders: 0, creator: w, createdAt: Date.now(),
      ...LMSR.init(p, b), status: "live", outcome: null, votes: { YES: 0, NO: 0 }, creatorEarned: 0, history: [[Date.now(), p]], feed: [] };
    ms.unshift(m); Engine.saveMarkets(ms);
    u.token -= CONFIG.CREATE_BOND; u.bonds[id] = { amount: CONFIG.CREATE_BOND, returned: false }; u.points.bonus += 1000;
    Engine.saveUser(w, u);
    return m;
  },
  async getVault(){
    if(!CONFIG.USE_MOCK) return http(`/vault`);
    const v = Engine.vault(); return { ...v, apy: CONFIG.VAULT_APY_HINT, utilization: v.borrowed / v.tvl };
  },
  async deposit({ wallet: w, amount, lock }){
    if(!CONFIG.USE_MOCK) return post(`/vault/deposit`, { wallet: w, amount, lock });
    needWallet(w); await delay(400);
    const u = Engine.user(w), L = CONFIG.LOCKS.find(x => x.id === lock);
    if(amount > u.stable + 1e-9) throw new Error("Not enough " + CONFIG.STABLE);
    u.stable -= amount; u.deposits.unshift({ id: uid(), amount, lock, mult: L.mult, start: Date.now(), unlock: Date.now() + L.days * 864e5 });
    const v = Engine.vault(); v.tvl += amount; Engine.saveVault(v); Engine.saveUser(w, u); return { ok: true };
  },
  async withdraw({ wallet: w, id }){
    if(!CONFIG.USE_MOCK) return post(`/vault/withdraw`, { wallet: w, id });
    needWallet(w); await delay(400);
    const u = Engine.user(w), d = u.deposits.find(x => x.id === id); if(!d) throw new Error("Deposit not found");
    if(Date.now() < d.unlock) throw new Error("Locked until " + fmtDate(new Date(d.unlock).toISOString()));
    const v = Engine.vault();
    if(d.amount > v.tvl - v.borrowed) throw new Error("Vault liquidity is lent out right now. Try again later.");
    const yieldAmt = d.amount * CONFIG.VAULT_APY_HINT * (Date.now() - d.start) / (365 * 864e5);
    // keep the points already earned
    u.points.bonus += d.amount * d.mult * (Date.now() - d.start) / 864e5;
    u.stable += d.amount + yieldAmt; u.deposits = u.deposits.filter(x => x.id !== id);
    v.tvl -= d.amount; Engine.saveVault(v); Engine.saveUser(w, u); return { ok: true, amount: d.amount + yieldAmt };
  },
  async stake({ wallet: w, amount }){
    if(!CONFIG.USE_MOCK) return post(`/stake`, { wallet: w, amount });
    needWallet(w); await delay(350);
    const u = Engine.user(w); if(amount > u.token + 1e-9) throw new Error("Not enough $" + CONFIG.TOKEN);
    u.points.bonus += u.staked * 0.1 * (Date.now() - (u.stakedAt || Date.now())) / 864e5;
    u.token -= amount; u.staked += amount; u.stakedAt = Date.now(); Engine.saveUser(w, u); return { ok: true };
  },
  async unstake({ wallet: w, amount }){
    if(!CONFIG.USE_MOCK) return post(`/unstake`, { wallet: w, amount });
    needWallet(w); await delay(350);
    const u = Engine.user(w); if(amount > u.staked + 1e-9) throw new Error("You only have " + tok(u.staked) + " staked");
    u.points.bonus += u.staked * 0.1 * (Date.now() - (u.stakedAt || Date.now())) / 864e5;
    u.staked -= amount; u.token += amount; u.stakedAt = Date.now(); Engine.saveUser(w, u); return { ok: true };
  },
  async vote({ wallet: w, id, side }){
    if(!CONFIG.USE_MOCK) return post(`/markets/${encodeURIComponent(id)}/vote`, { wallet: w, side });
    needWallet(w); await delay(300);
    const u = Engine.user(w); if(u.staked <= 0) throw new Error("Stake $" + CONFIG.TOKEN + " to vote on resolutions");
    if(u.votes[id]) throw new Error("You already voted on this market");
    Engine.updateMarket(id, m => { if(m.status !== "resolving") throw new Error("This market isn't up for resolution"); m.votes[side] += u.staked; });
    u.votes[id] = { side, weight: u.staked, ts: Date.now() }; Engine.saveUser(w, u); return { ok: true };
  },
  async finalize({ id }){
    if(!CONFIG.USE_MOCK) return post(`/markets/${encodeURIComponent(id)}/finalize`, {});
    await delay(300);
    const m = Engine.updateMarket(id, m => {
      if(m.status !== "resolving") throw new Error("Not ready to finalize");
      m.status = "resolved"; m.outcome = m.votes.YES >= m.votes.NO ? "YES" : "NO";
      m.history.push([Date.now(), m.outcome === "YES" ? 1 : 0]);
    });
    return { ok: true, outcome: m.outcome };
  },
  async getLeaderboard(by = "profit"){
    if(!CONFIG.USE_MOCK) return http(`/leaderboard?by=${by}`);
    const rows = MOCK_LEADERS.map(([addr, pnl, win, trades, volume, points]) => ({ addr, pnl, win, trades, volume, points }));
    if(wallet.address){
      const u = Engine.user(wallet.address), closed = u.history.length, wins = u.history.filter(h => h.received > h.margin).length;
      rows.push({ addr: short(wallet.address), you: true, pnl: u.pnl, win: closed ? Math.round(wins / closed * 100) : 0, trades: u.trades, volume: u.volume, points: Engine.points(u).total });
    }
    const key = { profit: "pnl", volume: "volume", points: "points" }[by] || "pnl";
    return rows.sort((a, b) => b[key] - a[key]);
  },

  /* ---- affiliate ---- */
  async getAffiliate(w){
    if(!CONFIG.USE_MOCK) return http(`/affiliate/${w}`);
    const k = w.toLowerCase(), code = store.get("affCode:" + k, null);
    const referrals = store.get("affReferrals", MOCK_REFERRALS);
    const earned = referrals.reduce((a, r) => a + r.earned, 0), claimed = store.get("affClaimed:" + k, 0);
    return { code, referrals, earnings: [4.2, 6.8, 3.1, 9.5, 12.4, 8.8, 15.2, 11.1, 18.6, 14.3, 21.7, 19.9, 26.4, 24.8],
      stats: { clicks: 214, signups: referrals.length, volume: referrals.reduce((a, r) => a + r.volume, 0), earned, claimable: Math.max(0, earned - claimed) } };
  },
  async setAffiliateCode(w, code){
    if(!CONFIG.USE_MOCK) return post(`/affiliate/code`, { wallet: w, code });
    await delay(250);
    const taken = store.get("affCodes", {});
    if(["admin", "369x", "test"].includes(code) || (taken[code] && taken[code] !== w.toLowerCase())) throw new Error("That code is taken. Try another.");
    taken[code] = w.toLowerCase(); store.set("affCodes", taken); store.set("affCode:" + w.toLowerCase(), code); return { ok: true, code };
  },
  async claimAffiliate(w){
    if(!CONFIG.USE_MOCK) return post(`/affiliate/claim`, { wallet: w });
    await delay(400);
    const a = await api.getAffiliate(w); if(a.stats.claimable <= 0) throw new Error("Nothing to claim yet");
    store.set("affClaimed:" + w.toLowerCase(), a.stats.earned);
    const u = Engine.user(w); u.stable += a.stats.claimable; Engine.saveUser(w, u);
    return { ok: true, amount: a.stats.claimable };
  },
  async trackClick(code){
    if(!CONFIG.USE_MOCK) return post(`/affiliate/click`, { code }).catch(() => {});
  },

  // demo only: wipe local data
  resetDemo(){ Object.keys(localStorage).filter(k => k.startsWith(store.pre)).forEach(k => localStorage.removeItem(k)); }
};
