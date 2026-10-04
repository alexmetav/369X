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

const VAULT_ABI = [
  "function deposit(uint256,uint8) returns (uint256)",
  "function claim(uint256)",
  "function withdraw(uint256)",
  "function harvest()",
  "function depositsOf(address) view returns (tuple(uint128 amount,uint64 start,uint64 unlock,uint8 lock,bool closed,uint256 debt)[] list, uint256[] pending)",
  "function pointsOf(address) view returns (uint256)",
  "function totalDeposits() view returns (uint256)",
  "function totalFeesToLps() view returns (uint256)",
  "function pendingFees() view returns (uint256)",
  "function lpShareBps() view returns (uint256)",
  "function startTime() view returns (uint256)"
];
const STAKE_ABI = [
  "function stake(uint256)",
  "function unstake(uint256)",
  "function claimFees()",
  "function vote(uint256,bool)",
  "function finalize(uint256)",
  "function claimVoteReward(uint256)",
  "function staked(address) view returns (uint256)",
  "function totalStaked() view returns (uint256)",
  "function lockedUntil(address) view returns (uint256)",
  "function pendingFees(address) view returns (uint256)",
  "function votingPeriod() view returns (uint256)",
  "function voteRewardBps() view returns (uint256)",
  "function rewardPool() view returns (uint256)",
  "function tallies(uint256) view returns (uint256 yes, uint256 no, bool finalized, bool outcomeYes)",
  "function voteOf(uint256,address) view returns (tuple(bool voted,bool yes,bool claimed,uint256 weight))"
];
const REFERRAL_ABI = [
  "function registerCode(string)",
  "function setReferrer(string)",
  "function claim(uint256,bytes32[]) returns (uint256)",
  "function publish(bytes32,uint64,uint256)",
  "function codeOf(address) view returns (string)",
  "function referrerOf(address) view returns (address)",
  "function ownerOfCode(string) view returns (address)",
  "function claimed(address) view returns (uint256)",
  "function snapshotBlock() view returns (uint64)",
  "function totalPublished() view returns (uint256)",
  "function totalClaimed() view returns (uint256)",
  "function pool() view returns (uint256)",
  "event CodeRegistered(address indexed user, string code)",
  "event ReferrerSet(address indexed user, address indexed referrer, string code)"
];
const HAS_VAULT = () => !!CONFIG.CONTRACTS?.vault, HAS_STAKING = () => !!CONFIG.CONTRACTS?.staking, HAS_REFERRAL = () => !!CONFIG.CONTRACTS?.referral;
const LOCK_IDS = ["flex", "d90", "d180", "d365"];

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
  async vault(){ return new ethers.Contract(CONFIG.CONTRACTS.vault, VAULT_ABI, await Chain.readProvider()); },
  async staking(){ return new ethers.Contract(CONFIG.CONTRACTS.staking, STAKE_ABI, await Chain.readProvider()); },
  votingPeriod: null,
  async referral(){ return new ethers.Contract(CONFIG.CONTRACTS.referral, REFERRAL_ABI, await Chain.readProvider()); },

  // raw trades + invites (exact wei values) for the referral formula, cached and scanned in chunks
  async referralEvents(){
    if(Chain.raw && Date.now() - Chain.raw.at < 15000) return Chain.raw;
    const p = await Chain.readProvider(), C = CONFIG.CONTRACTS;
    const mi = new ethers.Interface(MARKET_ABI), ri = new ethers.Interface(REFERRAL_ABI);
    const key = "chain:refraw1:" + C.market + ":" + C.referral;
    const cache = store.get(key, null) || { from: await Chain.deployBlock(p), ev: [] };
    const latest = await p.getBlockNumber(), STEP = 5000, ranges = [];
    for(let b = cache.from; b <= latest; b += STEP) ranges.push([b, Math.min(latest, b + STEP - 1)]);
    for(let i = 0; i < ranges.length; i += 4){
      const got = await Promise.all(ranges.slice(i, i + 4).map(([f, t]) => p.getLogs({ address: [C.market, C.referral], fromBlock: f, toBlock: t })));
      got.flat().forEach(l => {
        const isRef = l.address.toLowerCase() === C.referral.toLowerCase();
        let ev = null; try{ ev = (isRef ? ri : mi).parseLog(l); }catch(e){}
        if(!ev) return;
        if(ev.name === "Trade") cache.ev.push({ k: "t", b: l.blockNumber, i: l.index, u: ev.args.user, f: ev.args.fee.toString(), a: ev.args.amount.toString() });
        else if(ev.name === "ReferrerSet") cache.ev.push({ k: "r", b: l.blockNumber, i: l.index, u: ev.args.user, r: ev.args.referrer });
      });
    }
    cache.from = latest + 1; store.set(key, cache);
    const [bl, b0] = await Promise.all([p.getBlock(latest), p.getBlock(Math.max(0, latest - 2000))]);
    const spb = (bl.timestamp - b0.timestamp) / Math.max(1, latest - Math.max(0, latest - 2000));
    const ts = (bk) => (bl.timestamp - (latest - bk) * spb) * 1000;
    const events = cache.ev.map(e => e.k === "t"
      ? { kind: "trade", block: e.b, logIndex: e.i, user: e.u, fee: BigInt(e.f), amount: BigInt(e.a), ts: ts(e.b) }
      : { kind: "ref", block: e.b, logIndex: e.i, user: e.u, referrer: e.r, ts: ts(e.b) });
    return (Chain.raw = { events, latest, at: Date.now() });
  },

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
  async ensureAllowance(tokenAddr, amountWei, spender = CONFIG.CONTRACTS.market){
    const me = wallet.address, t = await Chain.token(tokenAddr);
    if((await t.allowance(me, spender)) >= amountWei) return;
    toast("Approve the token in your wallet (one time)");
    await Chain.write(tokenAddr, TOKEN_ABI, "approve", [spender, ethers.MaxUint256]);
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
  const ids = [...Array(Number(count)).keys()];
  const rows = await Promise.all(ids.map(i => mk.getMarket(i)));
  const list = rows.map(([m, p], i) => mapChainMarket(i, m, p, h.events));
  if(HAS_STAKING()){
    const st = await Chain.staking();
    if(Chain.votingPeriod === null) Chain.votingPeriod = Number(await st.votingPeriod()) * 1000;
    const ended = list.filter(m => m.status !== "live");
    const tallies = await Promise.all(ended.map(m => st.tallies(Number(m.id))));
    ended.forEach((m, i) => { const t = tallies[i]; m.votes = { YES: Chain.fmt(t.yes), NO: Chain.fmt(t.no) }; m.finalized = t.finalized; m.voteEnds = m.endMs + Chain.votingPeriod; });
  }
  return list;
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
      const out = mapChainMarket(i, m, p, h.events);
      if(HAS_STAKING() && out.status !== "live"){
        const st = await Chain.staking();
        if(Chain.votingPeriod === null) Chain.votingPeriod = Number(await st.votingPeriod()) * 1000;
        const t = await st.tallies(i);
        out.votes = { YES: Chain.fmt(t.yes), NO: Chain.fmt(t.no) }; out.finalized = t.finalized; out.voteEnds = out.endMs + Chain.votingPeriod;
      }
      return out;
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
      let vaultPts = 0;
      if(HAS_VAULT()){
        const v = await Chain.vault(), [[list, pending], pts] = await Promise.all([v.depositsOf(w), v.pointsOf(w)]);
        u.deposits = list.map((d, i) => ({ id: String(i), amount: Chain.fmt(d.amount), lock: LOCK_IDS[Number(d.lock)], mult: [1, 2, 4, 8][Number(d.lock)],
          start: Number(d.start) * 1000, unlock: Number(d.unlock) * 1000, earned: Chain.fmt(pending[i]), closed: d.closed })).filter(d => !d.closed);
        vaultPts = Chain.fmt(pts);
      }
      if(HAS_STAKING()){
        const st = await Chain.staking();
        const [s, lock, fees] = await Promise.all([st.staked(w), st.lockedUntil(w), st.pendingFees(w)]);
        u.staked = Chain.fmt(s); u.lockedUntil = Number(lock) * 1000; u.stakeFees = Chain.fmt(fees);
        const ended = markets.filter(m => m.status !== "live");
        const vs = await Promise.all(ended.map(m => st.voteOf(Number(m.id), w)));
        ended.forEach((m, i) => { if(vs[i].voted) u.votes[m.id] = { side: vs[i].yes ? "YES" : "NO", weight: Chain.fmt(vs[i].weight), claimed: vs[i].claimed }; });
      }
      u.points = { parts: { Trading: Math.round(volume), Vault: Math.round(vaultPts) } };
      u.badges = Engine.badges(u, false); u.stakeTier = Engine.stakeTier(0);
      u.points.parts.Badges = u.badges.filter(b => b.got).length * 500;
      u.points.total = Object.values(u.points.parts).reduce((a, b) => a + b, 0);
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
    // with an outcome: admin settles directly on the market. Without: stakers' vote result is written (anyone can do this).
    async finalize({ id, outcome }){
      if(outcome){
        await Chain.write(CONFIG.CONTRACTS.market, MARKET_ABI, "resolve", [Number(id), outcome === "YES", false]);
        return { ok: true, outcome };
      }
      if(!HAS_STAKING()) throw new Error("Choose YES or NO");
      await Chain.write(CONFIG.CONTRACTS.staking, STAKE_ABI, "finalize", [Number(id)]);
      const t = await (await Chain.staking()).tallies(Number(id));
      return { ok: true, outcome: t.outcomeYes ? "YES" : "NO" };
    },
    async vote({ id, side }){
      await Chain.write(CONFIG.CONTRACTS.staking, STAKE_ABI, "vote", [Number(id), side === "YES"]);
      return { ok: true };
    },
    async claimVoteReward({ id }){ await Chain.write(CONFIG.CONTRACTS.staking, STAKE_ABI, "claimVoteReward", [Number(id)]); return { ok: true }; },
    async getVault(){
      if(!HAS_VAULT()){ const mk = await Chain.market(); return { tvl: Chain.fmt(await mk.reserve()), borrowed: 0, fees: 0, utilization: 0, apy: 0 }; }
      const v = await Chain.vault();
      const [tvl, paid, pend, share, start] = await Promise.all([v.totalDeposits(), v.totalFeesToLps(), v.pendingFees(), v.lpShareBps(), v.startTime()]);
      const fees = Chain.fmt(paid) + Chain.fmt(pend) * Number(share) / 10000, t = Chain.fmt(tvl);
      const days = Math.max(1, (Chain.now() - Number(start) * 1000) / 864e5);
      return { tvl: t, borrowed: 0, fees, utilization: 0, apy: t > 0 ? fees / t * 365 / days : 0 };
    },
    async deposit({ amount, lock }){
      const amt = Chain.wei(amount);
      if((await (await Chain.token(CONFIG.CONTRACTS.usdt)).balanceOf(wallet.address)) < amt) throw new Error("Not enough test USDT");
      await Chain.ensureAllowance(CONFIG.CONTRACTS.usdt, amt, CONFIG.CONTRACTS.vault);
      await Chain.write(CONFIG.CONTRACTS.vault, VAULT_ABI, "deposit", [amt, LOCK_IDS.indexOf(lock)]);
      return { ok: true };
    },
    async withdraw({ id }){
      const d = (await api.getAccount(wallet.address)).deposits.find(x => x.id === String(id));
      await Chain.write(CONFIG.CONTRACTS.vault, VAULT_ABI, "withdraw", [Number(id)]);
      return { ok: true, amount: d ? d.amount + d.earned : 0 };
    },
    async claimVault({ id }){ await Chain.write(CONFIG.CONTRACTS.vault, VAULT_ABI, "claim", [Number(id)]); return { ok: true }; },
    async stake({ amount }){
      const amt = Chain.wei(amount);
      if((await (await Chain.token(CONFIG.CONTRACTS.token)).balanceOf(wallet.address)) < amt) throw new Error("Not enough $" + CONFIG.TOKEN);
      await Chain.ensureAllowance(CONFIG.CONTRACTS.token, amt, CONFIG.CONTRACTS.staking);
      await Chain.write(CONFIG.CONTRACTS.staking, STAKE_ABI, "stake", [amt]);
      return { ok: true };
    },
    async unstake({ amount }){ await Chain.write(CONFIG.CONTRACTS.staking, STAKE_ABI, "unstake", [Chain.wei(amount)]); return { ok: true }; },
    async getAffiliate(w){
      const me = w.toLowerCase(), rf = await Chain.referral();
      const [code, referrer, claimedW, snap, published, pool] = await Promise.all([rf.codeOf(w), rf.referrerOf(w), rf.claimed(w), rf.snapshotBlock(), rf.totalPublished(), rf.pool()]);
      const { events, latest } = await Chain.referralEvents();
      const live = Referral.compute(events, CONFIG);
      // what's claimable now = my amount in the published tree minus what I already claimed
      let publishedMine = 0n;
      if(Number(snap) > 0){ const pub = Referral.compute(events.filter(e => e.block <= Number(snap)), CONFIG); publishedMine = pub.owed.get(me) || 0n; }
      const rows = [...(live.referrals.get(me) || new Map()).entries()].map(([u, r]) => ({ addr: short(u), joined: new Date(r.ts || Date.now()).toISOString().slice(0, 10), volume: Chain.fmt(r.volume), earned: Chain.fmt(r.earned), tier: 1 }));
      const d = live.daily.get(me) || new Map();
      const earnings = [...Array(14).keys()].map(i => { const day = new Date(Chain.now() - (13 - i) * 864e5).toISOString().slice(0, 10); return Chain.fmt(d.get(day) || 0n); });
      const earned = live.owed.get(me) || 0n;
      const out = { code: code || null, referrer: referrer === ethers.ZeroAddress ? null : referrer, referrals: rows, earnings,
        stats: { clicks: null, signups: rows.length, volume: Chain.fmt(live.refVolume.get(me) || 0n), earned: Chain.fmt(earned),
          claimable: Chain.fmt(publishedMine > claimedW ? publishedMine - claimedW : 0n), unpublished: Chain.fmt(earned > publishedMine ? earned - publishedMine : 0n),
          rebates: Chain.fmt(live.rebates.get(me) || 0n), level2: Chain.fmt(live.l2.get(me) || 0n) } };
      if(ACC?.isAdmin){
        const total = [...live.owed.values()].reduce((s, v) => s + v, 0n);
        out.admin = { pool: Chain.fmt(pool), totalLive: Chain.fmt(total), published: Chain.fmt(published), snap: Number(snap), latest, claimedAll: Chain.fmt(await rf.totalClaimed()) };
      }
      return out;
    },
    async setAffiliateCode(w, code){ await Chain.write(CONFIG.CONTRACTS.referral, REFERRAL_ABI, "registerCode", [code]); return { ok: true, code }; },
    async acceptInvite(code){
      const rf = await Chain.referral(), owner = await rf.ownerOfCode(code);
      if(owner === ethers.ZeroAddress) throw new Error("This invite code doesn't exist");
      await Chain.write(CONFIG.CONTRACTS.referral, REFERRAL_ABI, "setReferrer", [code]);
      return { ok: true };
    },
    async inviteStatus(w, code){
      if(!code || !w) return null;
      const rf = await Chain.referral();
      const [owner, referrer] = await Promise.all([rf.ownerOfCode(code), rf.referrerOf(w)]);
      return { valid: owner !== ethers.ZeroAddress && owner.toLowerCase() !== w.toLowerCase(), accepted: referrer !== ethers.ZeroAddress, owner };
    },
    async claimAffiliate(w){
      const rf = await Chain.referral(), snap = Number(await rf.snapshotBlock());
      if(!snap) throw new Error("No rewards have been published yet");
      const { events } = await Chain.referralEvents();
      const t = Referral.tree(Referral.compute(events.filter(e => e.block <= snap), CONFIG).owed), me = w.toLowerCase();
      const amt = t.amounts.get(me); if(!amt) throw new Error("Nothing to claim yet");
      const before = await rf.claimed(w);
      await Chain.write(CONFIG.CONTRACTS.referral, REFERRAL_ABI, "claim", [amt, t.proofs.get(me)]);
      return { ok: true, amount: Chain.fmt(amt - before) };
    },
    // admin: publish everyone's rewards up to the latest block; tops up the pool first if needed
    async publishReferralRewards(){
      Chain.raw = null;                                   // always publish from fresh data
      const rf = await Chain.referral(), { events, latest } = await Chain.referralEvents(), snap = latest;
      const t = Referral.tree(Referral.compute(events.filter(e => e.block <= snap), CONFIG).owed);
      const [pool, claimedAll] = await Promise.all([rf.pool(), rf.totalClaimed()]);
      if(pool + claimedAll < t.total){
        const need = t.total - pool - claimedAll + ethers.parseEther("1000");
        toast("Topping up the reward pool first");
        await Chain.write(CONFIG.CONTRACTS.usdt, TOKEN_ABI.concat(["function transfer(address,uint256) returns (bool)"]), "transfer", [CONFIG.CONTRACTS.referral, need]);
      }
      await Chain.write(CONFIG.CONTRACTS.referral, REFERRAL_ABI, "publish", [t.root, snap, t.total]);
      return { ok: true, total: Chain.fmt(t.total), people: t.amounts.size };
    },
    async fundReferralPool(amount){
      await Chain.write(CONFIG.CONTRACTS.usdt, TOKEN_ABI.concat(["function transfer(address,uint256) returns (bool)"]), "transfer", [CONFIG.CONTRACTS.referral, Chain.wei(amount)]);
      return { ok: true };
    },
    async trackClick(){},
    async claimStakeFees(){ await Chain.write(CONFIG.CONTRACTS.staking, STAKE_ABI, "claimFees", []); return { ok: true }; },
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
