/* =====================================================================
   ON-CHAIN MODE (BNB Smart Chain Testnet)
   When CONFIG.CHAIN_ON is true this replaces the database for markets,
   trading, balances, the faucet, market creation, settlement and payouts.
   Reads go through a public RPC; every write is a MetaMask transaction.
   ===================================================================== */
const CHAIN_ON = !!(CONFIG.CHAIN_ON && CONFIG.CONTRACTS?.market && window.ethers);

const TOKEN_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
  "function faucet()",
  "function lastFaucet(address) view returns (uint256)"
];
const MARKET_ABI = [
  "function marketCount() view returns (uint256)",
  "function getMarket(uint256) view returns (tuple(address creator,uint64 endTime,uint8 status,bool outcomeYes,bool bondSlashed,int256 b,int256 qYes,int256 qNo,int256 q0Yes,int256 q0No,uint256 pool,uint256 volume,uint256 creatorFees,uint256 bond,string question,string source) m, uint256 priceYes)",
  "function quoteBuy(uint256,bool,uint256) view returns (uint256 shares, uint256 fee)",
  "function quoteSell(uint256,bool,uint256) view returns (uint256 out, uint256 fee)",
  "function sharesOf(uint256,address) view returns (uint256 yes, uint256 no)",
  "function buy(uint256,bool,uint256,uint256) returns (uint256)",
  "function sell(uint256,bool,uint256,uint256) returns (uint256)",
  "function createMarket(string,string,uint64,uint256) returns (uint256)",
  "function resolve(uint256,bool,bool)",
  "function redeem(uint256) returns (uint256)",
  "function claimCreatorFees(uint256)",
  "function owner() view returns (address)",
  "function resolver() view returns (address)",
  "function bondAmount() view returns (uint256)",
  "function reserve() view returns (uint256)",
  "event Trade(uint256 indexed id, address indexed user, bool yes, bool buy, uint256 shares, uint256 amount, uint256 fee, uint256 priceYes)",
  "event MarketCreated(uint256 indexed id, address indexed creator, string question, uint64 endTime, uint256 pYes, int256 b)",
  "event Resolved(uint256 indexed id, bool outcomeYes, bool bondSlashed)",
  "event Redeemed(uint256 indexed id, address indexed user, uint256 amount)"
];

const Chain = {
  read: null, iface: null, logs: null,
  fmt: (x) => Number(ethers.formatEther(x)),
  clock: null,
  now: () => Chain.clock ? Chain.clock.chain + (Date.now() - Chain.clock.local) : Date.now(),
  wei: (n) => ethers.parseEther((Math.floor(Number(n) * 1e6) / 1e6).toFixed(6)),

  async readProvider(){
    if(Chain.read) return Chain.read;
    for(const url of CONFIG.READ_RPCS){
      try{
        const p = new ethers.JsonRpcProvider(url, Number(CONFIG.CHAIN.chainId), { staticNetwork: true, batchMaxCount: 1 });
        await p.getBlockNumber();
        return (Chain.read = p);
      }catch(e){ /* try next */ }
    }
    throw new Error("Can't reach the BNB testnet right now. Please try again in a minute.");
  },
  async market(){ return new ethers.Contract(CONFIG.CONTRACTS.market, MARKET_ABI, await Chain.readProvider()); },
  async token(addr){ return new ethers.Contract(addr, TOKEN_ABI, await Chain.readProvider()); },

  // signer from the picked wallet (MetaMask first), on the right network
  async signer(){
    const eth = wallet.provider(); if(!eth) throw new Error("Connect your wallet first");
    if(BigInt(await eth.request({ method: "eth_chainId" })) !== BigInt(CONFIG.CHAIN.chainId)) await wallet.switchChain();
    if(BigInt(await eth.request({ method: "eth_chainId" })) !== BigInt(CONFIG.CHAIN.chainId)) throw new Error("Switch your wallet to " + CONFIG.CHAIN.chainName);
    return new ethers.BrowserProvider(eth).getSigner();
  },
  async write(addr, abi, fn, args){
    const c = new ethers.Contract(addr, abi, await Chain.signer());
    try{
      const tx = await c[fn](...args);
      toast("Transaction sent. Waiting for the blockchain…");
      const rc = await tx.wait();
      Chain.logs = null;                      // refresh cached history next time
      return rc;
    }catch(e){ throw new Error(Chain.niceError(e)); }
  },
  niceError(e){
    if(e?.code === "ACTION_REJECTED" || e?.code === 4001 || e?.info?.error?.code === 4001) return "Transaction cancelled";
    const m = e?.reason || e?.shortMessage || e?.info?.error?.message || e?.message || "Transaction failed";
    if(/insufficient funds/i.test(m)) return "Not enough tBNB to pay the network fee. Get free tBNB from the BNB testnet faucet.";
    return m.replace(/^execution reverted:?\s*/i, "").replace(/^Faucet: /, "");
  },
  async ensureAllowance(tokenAddr, amountWei){
    const me = wallet.address, t = await Chain.token(tokenAddr);
    if((await t.allowance(me, CONFIG.CONTRACTS.market)) >= amountWei) return;
    toast("Approve the token in your wallet (one time)");
    await Chain.write(tokenAddr, TOKEN_ABI, "approve", [CONFIG.CONTRACTS.market, ethers.MaxUint256]);
  },

  // ---- event history (cached in the browser, scanned in chunks) ----
  async deployBlock(p){
    const key = "chain:deployBlock:" + CONFIG.CONTRACTS.market;
    const saved = store.get(key, null); if(saved) return saved;
    let lo = 0, hi = await p.getBlockNumber();
    while(lo < hi){ const mid = Math.floor((lo + hi) / 2); if((await p.getCode(CONFIG.CONTRACTS.market, mid)) === "0x") lo = mid + 1; else hi = mid; }
    store.set(key, lo); return lo;
  },
  async history(){
    if(Chain.logs && Date.now() - Chain.logs.at < 15000) return Chain.logs;
    const p = await Chain.readProvider(), iface = Chain.iface || (Chain.iface = new ethers.Interface(MARKET_ABI));
    const key = "chain:logs:" + CONFIG.CONTRACTS.market;
    const cache = store.get(key, null) || { from: await Chain.deployBlock(p), events: [] };
    const latest = await p.getBlockNumber();
    const STEP = 5000, ranges = [];
    for(let b = cache.from; b <= latest; b += STEP) ranges.push([b, Math.min(latest, b + STEP - 1)]);
    for(let i = 0; i < ranges.length; i += 4){
      const got = await Promise.all(ranges.slice(i, i + 4).map(([f, t]) => p.getLogs({ address: CONFIG.CONTRACTS.market, fromBlock: f, toBlock: t })));
      got.flat().forEach(l => {
        let ev; try{ ev = iface.parseLog(l); }catch(e){ return; }
        if(!ev) return;                     // events we don't track (ownership, reserve changes)
        const a = ev.args, base = { n: ev.name, bk: l.blockNumber, id: Number(a.id) };
        if(ev.name === "Trade") cache.events.push({ ...base, u: a.user.toLowerCase(), yes: a.yes, buy: a.buy, sh: Chain.fmt(a.shares), amt: Chain.fmt(a.amount), fee: Chain.fmt(a.fee), p: Chain.fmt(a.priceYes) });
        else if(ev.name === "MarketCreated") cache.events.push({ ...base, u: a.creator.toLowerCase(), p: Chain.fmt(a.pYes) });
        else if(ev.name === "Resolved") cache.events.push({ ...base, yes: a.outcomeYes });
        else if(ev.name === "Redeemed") cache.events.push({ ...base, u: a.user.toLowerCase(), amt: Chain.fmt(a.amount) });
      });
    }
    cache.from = latest + 1;
    store.set(key, cache);
    // estimate timestamps from block numbers (one block lookup instead of one per event)
    const [bl, b0] = await Promise.all([p.getBlock(latest), p.getBlock(Math.max(0, latest - 2000))]);
    const spb = (bl.timestamp - b0.timestamp) / Math.max(1, latest - Math.max(0, latest - 2000));
    const ts = (bk) => (bl.timestamp - (latest - bk) * spb) * 1000;
    Chain.clock = { chain: bl.timestamp * 1000, local: Date.now() };     // markets end by blockchain time, not this computer's clock
    cache.events.forEach(e => e.ts = ts(e.bk));
    return (Chain.logs = { events: cache.events, at: Date.now() });
  }
};

// category: "[Crypto] source" on new markets; keyword guess for older ones
function chainCategory(q, source){
  const m = /^\[(\w+)\]\s*/.exec(source || "");
  if(m && ICONS[m[1]]) return m[1];
  const t = (q + " " + source).toLowerCase();
  if(/bitcoin|btc|eth\b|ether|bnb|solana|crypto|token|coin/.test(t)) return "Crypto";
  if(/fed\b|rate|s&p|nasdaq|stock|inflation|gdp|dow\b/.test(t)) return "Finance";
  if(/election|house|senate|president|vote|minister|party/.test(t)) return "Politics";
  if(/nba|nfl|league|cup|playoff|test series|match|madrid|lakers|football|cricket/.test(t)) return "Sports";
  if(/gta|movie|film|album|music|game|oscar|netflix/.test(t)) return "Culture";
  return "World";
}
const CAT_ICONS = { Crypto: "₿", Sports: "⚽", Politics: "🗳", Finance: "📈", Culture: "🎮", World: "🌍" };

function mapChainMarket(id, m, priceYes, ev){
  const endMs = Number(m.endTime) * 1000, cat = chainCategory(m.question, m.source);
  const trades = ev.filter(e => e.n === "Trade" && e.id === id);
  const source = m.source.replace(/^\[\w+\]\s*/, "");
  const created = ev.find(e => e.n === "MarketCreated" && e.id === id);
  return {
    id: String(id), q: m.question, cat, icon: CAT_ICONS[cat], source,
    ends: new Date(endMs).toISOString().slice(0, 10), endMs,
    rules: `Resolves YES if this is confirmed by ${source} by ${new Date(endMs).toUTCString().slice(5, 16)}. Otherwise resolves NO.`,
    creator: m.creator, createdAt: created?.ts || 0,
    b: Chain.fmt(m.b), qY: Chain.fmt(m.qYes), qN: Chain.fmt(m.qNo),
    vol: Chain.fmt(m.volume), traders: new Set(trades.map(t => t.u)).size,
    status: Number(m.status) === 1 ? "resolved" : Chain.now() >= endMs ? "resolving" : "live",
    outcome: Number(m.status) === 1 ? (m.outcomeYes ? "YES" : "NO") : null,
    votes: { YES: 0, NO: 0 }, creatorEarned: trades.reduce((s, t) => s + t.fee / 3, 0), creatorFeesUnclaimed: Chain.fmt(m.creatorFees),
    p: Chain.fmt(priceYes), maxLev: 1,
    history: [[created?.ts || Date.now(), created?.p ?? Chain.fmt(priceYes)], ...trades.map(t => [t.ts, t.p])],
    feed: trades.slice().reverse().map(t => ({ ts: t.ts, addr: t.u, side: t.yes ? "YES" : "NO", amount: t.amt, price: t.yes ? t.p : 1 - t.p, buy: t.buy })),
    lastTradeAt: trades.length ? trades[trades.length - 1].ts : 0, chain: true
  };
}

async function loadChainMarkets(){
  const mk = await Chain.market(), [count, h] = await Promise.all([mk.marketCount(), Chain.history()]);
  const rows = await Promise.all([...Array(Number(count)).keys()].map(i => mk.getMarket(i)));
  return rows.map(([m, p], i) => mapChainMarket(i, m, p, h.events));
}

if(CHAIN_ON){
  backend.live = false;            // the database sign-in is not needed for on-chain trading
  const sortBy = { volume: (a, b) => b.vol - a.vol, trending: (a, b) => b.lastTradeAt - a.lastTradeAt || b.vol - a.vol, new: (a, b) => b.createdAt - a.createdAt, ending: (a, b) => a.endMs - b.endMs };

  Object.assign(api, {
    async getMarkets({ category = "All", q = "", status = "live", sort = "volume" } = {}){
      const all = await loadChainMarkets();
      return all.filter(m => (category === "All" || m.cat === category) && (status === "all" || m.status === status) && m.q.toLowerCase().includes(q.toLowerCase()))
        .sort(sortBy[sort] || sortBy.volume);
    },
    async getMarket(id){
      const i = Number(id);
      const mk = await Chain.market();
      if(!(i >= 0 && i < Number(await mk.marketCount()))) throw new Error("Market not found");
      const [[m, p], h] = await Promise.all([mk.getMarket(i), Chain.history()]);
      return mapChainMarket(i, m, p, h.events);
    },
    async placeTrade({ marketId, side, margin }){
      const amt = Chain.wei(margin), yes = side === "YES", mk = await Chain.market();
      if((await (await Chain.token(CONFIG.CONTRACTS.usdt)).balanceOf(wallet.address)) < amt) throw new Error("Not enough test USDT. Use Get test funds.");
      await Chain.ensureAllowance(CONFIG.CONTRACTS.usdt, amt);
      const [shares] = await mk.quoteBuy(Number(marketId), yes, amt);
      await Chain.write(CONFIG.CONTRACTS.market, MARKET_ABI, "buy", [Number(marketId), yes, amt, shares * 97n / 100n]);
      return { ok: true };
    },
    async closePosition({ id }){
      const [mid, side] = id.split(":"), yes = side === "YES", mk = await Chain.market();
      const [sy, sn] = await mk.sharesOf(Number(mid), wallet.address), shares = yes ? sy : sn;
      if(shares === 0n) throw new Error("No shares to sell");
      const [out] = await mk.quoteSell(Number(mid), yes, shares);
      await Chain.write(CONFIG.CONTRACTS.market, MARKET_ABI, "sell", [Number(mid), yes, shares, out * 97n / 100n]);
      return { ok: true, received: Chain.fmt(out) };
    },
    async redeem({ id }){
      const rc = await Chain.write(CONFIG.CONTRACTS.market, MARKET_ABI, "redeem", [Number(id)]);
      return { ok: true, rc };
    },
    async claimCreatorFees({ id }){ await Chain.write(CONFIG.CONTRACTS.market, MARKET_ABI, "claimCreatorFees", [Number(id)]); return { ok: true }; },
    async getAccount(w){
      if(!w) return null;
      const me = w.toLowerCase(), mk = await Chain.market();
      const [usdt, tok] = [await Chain.token(CONFIG.CONTRACTS.usdt), await Chain.token(CONFIG.CONTRACTS.token)];
      const [stable, token, lastF, markets, owner, resolver] = await Promise.all([
        usdt.balanceOf(w), tok.balanceOf(w), usdt.lastFaucet(w), loadChainMarkets(), mk.owner(), mk.resolver()]);
      const h = await Chain.history(), mine = h.events.filter(e => e.u === me);
      const holdings = await Promise.all(markets.map(m => mk.sharesOf(Number(m.id), w)));
      // average cost per market+side from my trades
      const cost = {}, history = [];
      mine.forEach(e => {
        if(e.n !== "Trade") return;
        const k = e.id + ":" + (e.yes ? "YES" : "NO"), c = cost[k] || (cost[k] = { sh: 0, spent: 0 });
        if(e.buy){ c.sh += e.sh; c.spent += e.amt; }
        else { const part = c.sh ? c.spent * Math.min(1, e.sh / c.sh) : 0; c.sh -= e.sh; c.spent -= part;
          const m = markets[e.id]; history.push({ marketId: String(e.id), q: m?.q, icon: m?.icon, side: e.yes ? "YES" : "NO", lev: 1, margin: part, received: e.amt, how: "Sold", closedAt: e.ts }); }
      });
      mine.filter(e => e.n === "Redeemed").forEach(e => { const m = markets[e.id], side = m?.outcome || "YES", c = cost[e.id + ":" + side];
        history.push({ marketId: String(e.id), q: m?.q, icon: m?.icon, side, lev: 1, margin: c?.spent || 0, received: e.amt, how: "Won", closedAt: e.ts }); if(c) c.spent = 0; });
      const positions = [];
      markets.forEach((m, i) => [["YES", holdings[i][0]], ["NO", holdings[i][1]]].forEach(([side, raw]) => {
        const shares = Chain.fmt(raw); if(shares < 1e-6) return;
        const c = cost[m.id + ":" + side] || { spent: 0 }, margin = Math.max(0, c.spent);
        if(m.status === "resolved" && m.outcome !== side){ history.push({ marketId: m.id, q: m.q, icon: m.icon, side, lev: 1, margin, received: 0, how: "Lost", closedAt: m.endMs }); return; }
        const pos = { id: m.id + ":" + side, marketId: m.id, q: m.q, icon: m.icon, side, shares, margin, size: margin, borrowed: 0, lev: 1, avg: margin / shares, fee: 0 };
        let mark;
        if(m.status === "resolved"){ const v = m.outcome === side ? shares : 0; mark = { price: m.outcome === side ? 1 : 0, value: v, equity: v, pnl: v - margin, liq: 0 }; }
        else mark = Engine.mark(m, pos);
        positions.push({ ...pos, status: m.status, outcome: m.outcome, ...mark });
      }));
      const trades = mine.filter(e => e.n === "Trade"), volume = trades.reduce((s, e) => s + e.amt, 0);
      const created = markets.filter(m => m.creator.toLowerCase() === me).map(m => ({ ...m, bond: { amount: CONFIG.CREATE_BOND, returned: m.status === "resolved" } }));
      const u = {
        address: w, stable: Chain.fmt(stable), token: Chain.fmt(token), staked: 0, faucetAt: Number(lastF) * 1000,
        volume, trades: trades.length, maxLev: 1, pnl: history.reduce((s, x) => s + x.received - x.margin, 0),
        positions, history: history.sort((a, b) => b.closedAt - a.closedAt), deposits: [], votes: {}, created,
        bonds: Object.fromEntries(created.map(m => [m.id, m.bond])), feeRate: CONFIG.CREATOR_FEE + CONFIG.PROTOCOL_FEE,
        isAdmin: [owner, resolver].some(a => a.toLowerCase() === me)
      };
      u.points = { total: Math.round(volume), parts: { Trading: Math.round(volume) } };
      u.badges = Engine.badges(u, false); u.stakeTier = Engine.stakeTier(0);
      return u;
    },
    async faucet(w){
      const [usdt, tok] = [await Chain.token(CONFIG.CONTRACTS.usdt), await Chain.token(CONFIG.CONTRACTS.token)];
      const now = Date.now() / 1000, ready = async (t) => now >= Number(await t.lastFaucet(w)) + 86400;
      const [a, b] = await Promise.all([ready(usdt), ready(tok)]);
      if(!a && !b) throw new Error("Faucet used. Come back in 24 hours.");
      if(a) await Chain.write(CONFIG.CONTRACTS.usdt, TOKEN_ABI, "faucet", []);
      if(b) await Chain.write(CONFIG.CONTRACTS.token, TOKEN_ABI, "faucet", []);
      return { ok: true };
    },
    async createMarket({ q, cat, ends, source, p }){
      const mk = await Chain.market(), bond = await mk.bondAmount();
      if((await (await Chain.token(CONFIG.CONTRACTS.token)).balanceOf(wallet.address)) < bond) throw new Error(`You need ${tok(Chain.fmt(bond))} for the bond. Use Get test funds.`);
      await Chain.ensureAllowance(CONFIG.CONTRACTS.token, bond);
      const end = Math.floor(Date.parse(ends + "T23:59:59Z") / 1000);
      const rc = await Chain.write(CONFIG.CONTRACTS.market, MARKET_ABI, "createMarket", [q, `[${cat}] ${source}`, end, Chain.wei(p)]);
      const ev = rc.logs.map(l => { try{ return mk.interface.parseLog(l); }catch(e){ return null; } }).find(e => e?.name === "MarketCreated");
      return { ok: true, id: ev ? String(ev.args.id) : "0" };
    },
    // admin settles a market on-chain
    async finalize({ id, outcome }){
      if(!outcome) throw new Error("Choose YES or NO");
      await Chain.write(CONFIG.CONTRACTS.market, MARKET_ABI, "resolve", [Number(id), outcome === "YES", false]);
      return { ok: true, outcome };
    },
    async getVault(){
      const mk = await Chain.market(), r = Chain.fmt(await mk.reserve());
      return { tvl: r, borrowed: 0, fees: 0, utilization: 0, apy: 0 };
    },
    async getLeaderboard(by = "profit"){
      const h = await Chain.history(), users = {}, cost = {}, outcome = {};
      h.events.forEach(e => {
        if(e.n === "Resolved"){ outcome[e.id] = e.yes; return; }
        if(e.n !== "Trade" && e.n !== "Redeemed") return;
        const u = users[e.u] || (users[e.u] = { addr: e.u, pnl: 0, volume: 0, trades: 0, wins: 0, closed: 0 });
        const yes = e.n === "Redeemed" ? outcome[e.id] : e.yes;          // a payout is always on the winning side
        const k = e.u + ":" + e.id + ":" + (yes ? "Y" : "N"), c = cost[k] || (cost[k] = { sh: 0, spent: 0 });
        if(e.n === "Trade"){ u.trades++; u.volume += e.amt;
          if(e.buy){ c.sh += e.sh; c.spent += e.amt; }
          else { const part = c.sh ? c.spent * Math.min(1, e.sh / c.sh) : 0; c.sh -= e.sh; c.spent -= part; u.pnl += e.amt - part; u.closed++; if(e.amt > part) u.wins++; } }
        else { u.pnl += e.amt - c.spent; c.spent = 0; c.sh = 0; u.closed++; u.wins++; }
      });
      const me = (wallet.address || "").toLowerCase(), key = { profit: "pnl", volume: "volume", points: "volume" }[by] || "pnl";
      return Object.values(users).map(u => ({ addr: short(u.addr), you: u.addr === me, pnl: u.pnl, win: u.closed ? Math.round(u.wins / u.closed * 100) : 0, trades: u.trades, volume: u.volume, points: Math.round(u.volume) }))
        .sort((a, b) => b[key] - a[key]).slice(0, 50);
    }
  });
}
