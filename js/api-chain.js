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
  "function protocolFees() view returns (uint256)",
  "function feeRecipient() view returns (address)",
  "function defaultB() view returns (int256)",
  "function fundReserve(uint256)",
  "function setBondAmount(uint256)",
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
  "function totalFeesToStakers() view returns (uint256)",
  "function pendingFees() view returns (uint256)",
  "function lpShareBps() view returns (uint256)",
  "function startTime() view returns (uint256)",
  "function accounted() view returns (uint256)",
  "function sweepOther(address,address,uint256)"
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
  "function setVoteReward(uint256)",
  "function quorum() view returns (uint256)",
  "function turnoutMet(uint256) view returns (bool)",
  "function unallocated() view returns (uint256)",
  "function sweepUnallocated(address)",
  "function withdrawRewardPool(uint256,address)",
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
  "function merkleRoot() view returns (bytes32)",
  "function totalPublished() view returns (uint256)",
  "function totalClaimed() view returns (uint256)",
  "function pool() view returns (uint256)",
  "event CodeRegistered(address indexed user, string code)",
  "event ReferrerSet(address indexed user, address indexed referrer, string code)"
];
// vault + staking from before the v2 upgrade: people can still withdraw from them
const OLD = () => CONFIG.CONTRACTS_OLD || {};
const HAS_VAULT = () => !!CONFIG.CONTRACTS?.vault, HAS_STAKING = () => !!CONFIG.CONTRACTS?.staking, HAS_REFERRAL = () => !!CONFIG.CONTRACTS?.referral;
const LOCK_IDS = ["flex", "d90", "d180", "d365"];
const MULTICALL = "0xcA11bde05977b3631167028862bE2a173976CA11";   // Multicall3: same address on almost every EVM chain
const MC_ABI = ["function aggregate3((address target,bool allowFailure,bytes callData)[] calls) payable returns ((bool success,bytes returnData)[] returnData)"];
const CONFIRMATIONS = CONFIG.CONFIRMATIONS || 12;                   // blocks before an event is saved for good
const EVENTS_CACHE = "v3";
REFERRAL_ABI.push("event RewardsPublished(bytes32 root, uint64 snapshotBlock, uint256 total)");

// run async tasks a few at a time (public RPCs rate-limit bursts)
async function pool(tasks, n = 6){
  const out = new Array(tasks.length); let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, tasks.length) }, async () => { while(next < tasks.length){ const k = next++; out[k] = await tasks[k](); } }));
  return out;
}

const Chain = {
  read: null, rpcIdx: 0, mcOk: null, data: null, scanning: null, mkCache: null, mkLoading: null,
  clock: null, votingPeriod: null, voteRewardBps: null, quorum: undefined, cacheFull: false,
  fmt: (x) => Number(ethers.formatEther(x)),
  now: () => Chain.clock ? Chain.clock.chain + (Date.now() - Chain.clock.local) : Date.now(),
  wei: (n) => ethers.parseEther((Math.floor(Number(n) * 1e6) / 1e6).toFixed(6)),

  // ---- read provider with failover across CONFIG.READ_RPCS ----
  async readProvider(){
    if(Chain.read) return Chain.read;
    const urls = CONFIG.READ_RPCS;
    for(let n = 0; n < urls.length; n++){
      const i = (Chain.rpcIdx + n) % urls.length;
      try{
        const p = new ethers.JsonRpcProvider(urls[i], Number(CONFIG.CHAIN.chainId), { staticNetwork: true, batchMaxCount: 1 });
        await p.getBlockNumber();
        Chain.rpcIdx = i; return (Chain.read = p);
      }catch(e){ /* try the next one */ }
    }
    throw new Error("Can't reach the BNB testnet right now. Please try again in a minute.");
  },
  rotate(){ Chain.read = null; Chain.mcOk = null; Chain.rpcIdx = (Chain.rpcIdx + 1) % CONFIG.READ_RPCS.length; },
  isRevert: (e) => e?.code === "CALL_EXCEPTION" || /revert/i.test(e?.shortMessage || ""),
  // retry a read on the next RPC if the network call fails (contract reverts are real answers: no retry)
  async retry(fn, tries = Math.max(2, CONFIG.READ_RPCS.length)){
    let last;
    for(let i = 0; i < tries; i++){
      try{ return await fn(); }catch(e){ last = e; if(Chain.isRevert(e)) throw e; Chain.rotate(); await delay(300 * (i + 1)); }
    }
    throw last;
  },
  // many reads in one request via Multicall3; falls back to a few parallel calls where it isn't deployed
  async multi(calls){
    if(!calls.length) return [];
    const p = await Chain.readProvider();
    if(Chain.mcOk === null) Chain.mcOk = (await p.getCode(MULTICALL)) !== "0x";
    const norm = (r) => (r && r.length === 1) ? r[0] : r;
    if(Chain.mcOk){
      const mc = new ethers.Contract(MULTICALL, MC_ABI, p), out = [];
      for(let i = 0; i < calls.length; i += 120){
        const part = calls.slice(i, i + 120);
        const res = await mc.aggregate3.staticCall(part.map(x => ({ target: x.c.target, allowFailure: true, callData: x.c.interface.encodeFunctionData(x.fn, x.args || []) })));
        res.forEach((r, j) => { try{ out.push(r.success ? norm(part[j].c.interface.decodeFunctionResult(part[j].fn, r.returnData)) : null); }catch(e){ out.push(null); } });
      }
      return out;
    }
    return pool(calls.map(x => () => x.c[x.fn](...(x.args || [])).catch(() => null)), 6);
  },
  async market(){ return new ethers.Contract(CONFIG.CONTRACTS.market, MARKET_ABI, await Chain.readProvider()); },
  async token(addr){ return new ethers.Contract(addr, TOKEN_ABI, await Chain.readProvider()); },
  async vault(){ return new ethers.Contract(CONFIG.CONTRACTS.vault, VAULT_ABI, await Chain.readProvider()); },
  async staking(){ return new ethers.Contract(CONFIG.CONTRACTS.staking, STAKE_ABI, await Chain.readProvider()); },
  async referral(){ return new ethers.Contract(CONFIG.CONTRACTS.referral, REFERRAL_ABI, await Chain.readProvider()); },

  // ---- writes go through the user's wallet ----
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
      Chain.data = null; Chain.mkCache = null;      // fresh reads after every transaction
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
    const t = await Chain.token(tokenAddr);
    if((await Chain.retry(() => t.allowance(wallet.address, spender))) >= amountWei) return;
    toast("Approve the token in your wallet (one time)");
    await Chain.write(tokenAddr, TOKEN_ABI, "approve", [spender, ethers.MaxUint256]);
  },

  // ---- event history: one scanner for the market + referral contracts ----
  async deployBlock(p){
    if(Number.isInteger(CONFIG.DEPLOY_BLOCK)) return CONFIG.DEPLOY_BLOCK;
    const key = "chain:deployBlock:" + CONFIG.CONTRACTS.market;
    const saved = store.get(key, null); if(Number.isInteger(saved)) return saved;
    let lo = 0, hi = await p.getBlockNumber();
    while(lo < hi){ const mid = Math.floor((lo + hi) / 2); if((await p.getCode(CONFIG.CONTRACTS.market, mid)) === "0x") lo = mid + 1; else hi = mid; }
    store.set(key, lo); return lo;
  },
  async scan(){
    if(Chain.data && Date.now() - Chain.data.at < 12000) return Chain.data;
    if(!Chain.scanning) Chain.scanning = Chain._scan().then(d => (Chain.data = d)).finally(() => { Chain.scanning = null; });
    return Chain.scanning;
  },
  async _scan(){
    const C = CONFIG.CONTRACTS, addrs = [C.market, C.referral].filter(Boolean);
    const key = `chain:ev:${EVENTS_CACHE}:${C.market}:${C.referral || "-"}`;
    // drop caches from older app versions or old contracts
    try{ Object.keys(localStorage).filter(k => k.startsWith(store.pre + "chain:") && !k.includes("deployBlock") && k !== store.pre + key).forEach(k => localStorage.removeItem(k)); }catch(e){}
    let cache = store.get(key, null);
    if(!cache || !Number.isInteger(cache.from) || !Array.isArray(cache.ev)) cache = { from: await Chain.retry(async () => Chain.deployBlock(await Chain.readProvider())), ev: [] };
    const mi = new ethers.Interface(MARKET_ABI), ri = new ethers.Interface(REFERRAL_ABI);
    const parse = (l) => {
      const isRef = C.referral && l.address.toLowerCase() === C.referral.toLowerCase();
      let ev = null; try{ ev = (isRef ? ri : mi).parseLog(l); }catch(e){}
      if(!ev) return null;
      const a = ev.args, base = { b: l.blockNumber, i: l.index };
      switch(ev.name){
        case "Trade": return { ...base, k: "t", id: Number(a.id), u: a.user.toLowerCase(), y: a.yes ? 1 : 0, by: a.buy ? 1 : 0, s: a.shares.toString(), a: a.amount.toString(), f: a.fee.toString(), p: a.priceYes.toString() };
        case "MarketCreated": return { ...base, k: "c", id: Number(a.id), u: a.creator.toLowerCase(), p: a.pYes.toString() };
        case "Resolved": return { ...base, k: "s", id: Number(a.id), y: a.outcomeYes ? 1 : 0 };
        case "Redeemed": return { ...base, k: "d", id: Number(a.id), u: a.user.toLowerCase(), a: a.amount.toString() };
        case "ReferrerSet": return { ...base, k: "r", u: a.user.toLowerCase(), r: a.referrer.toLowerCase() };
        case "RewardsPublished": return { ...base, k: "p", root: a.root, snap: Number(a.snapshotBlock) };
      }
      return null;
    };
    const getLogs = (f, t) => Chain.retry(async () => (await Chain.readProvider()).getLogs({ address: addrs, fromBlock: f, toBlock: t }));
    const latest = await Chain.retry(async () => (await Chain.readProvider()).getBlockNumber());
    const confirmed = Math.max(cache.from - 1, latest - CONFIRMATIONS);
    const STEP = 5000, ranges = [];
    for(let b = cache.from; b <= confirmed; b += STEP) ranges.push([b, Math.min(confirmed, b + STEP - 1)]);
    for(let i = 0; i < ranges.length; i += 4){
      const batch = ranges.slice(i, i + 4);
      (await Promise.all(batch.map(([f, t]) => getLogs(f, t)))).flat().forEach(l => { const e = parse(l); if(e) cache.ev.push(e); });
      cache.from = batch[batch.length - 1][1] + 1;
      if(!store.set(key, cache)) Chain.cacheFull = true;     // keeps working, just rescans more next visit
    }
    if(!ranges.length) store.set(key, cache);
    // the newest few blocks are fetched fresh every time and never saved (they could still change)
    const tail = confirmed < latest ? (await getLogs(confirmed + 1, latest)).map(parse).filter(Boolean) : [];
    // block -> time: exact at the first scanned block and at the latest one, linear in between
    if(!cache.t0 || !Number.isInteger(cache.t0.b)){
      const b0 = await Chain.retry(async () => (await Chain.readProvider()).getBlock(cache.ev.length ? Math.min(cache.ev[0].b, confirmed) : confirmed));
      if(b0) cache.t0 = { b: b0.number, t: b0.timestamp };
      store.set(key, cache);
    }
    const back = Math.max(0, latest - 2000);
    const [bl, bb] = await Chain.retry(async () => { const p = await Chain.readProvider(); return Promise.all([p.getBlock(latest), p.getBlock(back)]); });
    const t0 = cache.t0 && cache.t0.b < latest ? cache.t0 : { b: back, t: bb.timestamp };
    const spb = (bl.timestamp - t0.t) / Math.max(1, latest - t0.b);
    Chain.clock = { chain: bl.timestamp * 1000, local: Date.now() };     // markets end by blockchain time, not this computer's clock
    const ev = cache.ev.concat(tail).sort((x, y) => x.b - y.b || x.i - y.i);
    return { ev, confirmed, latest, ts: (bk) => (bl.timestamp - (latest - bk) * spb) * 1000, at: Date.now() };
  },
  // display-friendly events (numbers, timestamps)
  async history(){
    const d = await Chain.scan(), F = (w) => Number(ethers.formatEther(w));
    if(d.hist) return d.hist;
    const names = { t: "Trade", c: "MarketCreated", s: "Resolved", d: "Redeemed" };
    const events = d.ev.filter(e => names[e.k]).map(e => {
      const o = { n: names[e.k], bk: e.b, id: e.id, u: e.u, ts: d.ts(e.b) };
      if(e.k === "t") Object.assign(o, { yes: !!e.y, buy: !!e.by, sh: F(e.s), amt: F(e.a), fee: F(e.f), p: F(e.p) });
      if(e.k === "c") o.p = F(e.p);
      if(e.k === "s") o.yes = !!e.y;
      if(e.k === "d") o.amt = F(e.a);
      return o;
    });
    return (d.hist = { events, at: d.at });
  },
  // exact (wei) events for the referral formula. Publishing uses confirmed blocks only (all = false), so
  // every browser computes the same tree; live stats may include the newest blocks.
  async referralEvents(all = false){
    const d = await Chain.scan();
    const events = d.ev.filter(e => all || e.b <= d.confirmed).map(e => {
      const base = { block: e.b, logIndex: e.i, ts: d.ts(e.b) };
      if(e.k === "t") return { ...base, kind: "trade", user: e.u, id: e.id, buy: !!e.by, fee: BigInt(e.f), amount: BigInt(e.a) };
      if(e.k === "c") return { ...base, kind: "created", id: e.id, user: e.u };
      if(e.k === "r") return { ...base, kind: "ref", user: e.u, referrer: e.r };
      if(e.k === "p") return { ...base, kind: "published", root: e.root, snap: e.snap };
      return null;
    }).filter(Boolean);
    return { events, latest: d.confirmed, head: d.latest };
  }
};

// category: "[Crypto] source" on new markets; keyword guess for older ones
function chainCategory(q, source){
  const m = /^\[(\w+)\]\s*/.exec(source || "");
  if(m && Object.prototype.hasOwnProperty.call(CAT_ICONS, m[1])) return m[1];
  const t = (q + " " + source).toLowerCase();
  if(/bitcoin|btc|eth\b|ether|bnb|solana|crypto|token|coin/.test(t)) return "Crypto";
  if(/fed\b|rate|s&p|nasdaq|stock|inflation|gdp|dow\b/.test(t)) return "Finance";
  if(/election|house|senate|president|vote|minister|party/.test(t)) return "Politics";
  if(/nba|nfl|league|cup|playoff|test series|match|madrid|lakers|football|cricket/.test(t)) return "Sports";
  if(/gta|movie|film|album|music|game|oscar|netflix/.test(t)) return "Culture";
  return "World";
}
const CAT_ICONS = { Crypto: "Crypto", Sports: "Sports", Politics: "Politics", Finance: "Finance", Culture: "Culture", World: "World" };   // drawn by catIcon()
const CREATOR_SHARE = CONFIG.CREATOR_FEE / (CONFIG.CREATOR_FEE + CONFIG.PROTOCOL_FEE);

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
    votes: { YES: 0, NO: 0 }, creatorEarned: trades.reduce((s, t) => s + t.fee * CREATOR_SHARE, 0), creatorFeesUnclaimed: Chain.fmt(m.creatorFees),
    p: Chain.fmt(priceYes), maxLev: 1,
    history: [[created?.ts || Date.now(), created?.p ?? Chain.fmt(priceYes)], ...trades.map(t => [t.ts, t.p])],
    feed: trades.slice().reverse().map(t => ({ ts: t.ts, addr: t.u, side: t.yes ? "YES" : "NO", amount: t.amt, price: t.yes ? t.p : 1 - t.p, buy: t.buy })),
    lastTradeAt: trades.length ? trades[trades.length - 1].ts : 0, chain: true
  };
}

async function stakingParams(st){
  if(Chain.votingPeriod === null){
    const [vp, rb, q] = await Chain.multi([{ c: st, fn: "votingPeriod" }, { c: st, fn: "voteRewardBps" }, { c: st, fn: "quorum" }]);
    if(vp === null || rb === null) throw new Error("Couldn't read staking settings");
    Chain.votingPeriod = Number(vp) * 1000; Chain.voteRewardBps = Number(rb);
    Chain.quorum = q === null ? null : Chain.fmt(q);          // null: staking v1 (no minimum turnout)
  }
}

// all markets, cached for 10 s and shared between callers on the same page
async function loadChainMarkets(){
  if(Chain.mkCache && Date.now() - Chain.mkCache.at < 10000) return Chain.mkCache.list;
  if(!Chain.mkLoading) Chain.mkLoading = Chain.retry(async () => {
    const mk = await Chain.market(), [count, h] = await Promise.all([mk.marketCount(), Chain.history()]);
    const ids = [...Array(Number(count)).keys()];
    const rows = await Chain.multi(ids.map(i => ({ c: mk, fn: "getMarket", args: [i] })));
    if(rows.some(r => !r)) throw new Error("Couldn't read all markets");
    const list = rows.map((r, i) => mapChainMarket(i, r[0], r[1], h.events));
    if(HAS_STAKING()){
      const st = await Chain.staking(); await stakingParams(st);
      const ended = list.filter(m => m.status !== "live");
      const res = await Chain.multi(ended.flatMap(m => [{ c: st, fn: "tallies", args: [Number(m.id)] }, { c: st, fn: "turnoutMet", args: [Number(m.id)] }]));
      ended.forEach((m, i) => { const t = res[2 * i]; if(!t) return; m.votes = { YES: Chain.fmt(t[0]), NO: Chain.fmt(t[1]) }; m.finalized = t[2]; m.turnoutMet = res[2 * i + 1]; m.voteEnds = m.endMs + Chain.votingPeriod; });
    }
    Chain.mkCache = { list, at: Date.now() };
    return list;
  }).finally(() => { Chain.mkLoading = null; });
  return Chain.mkLoading;
}

// the tree behind the currently published root: today's formula, or the first version's
// for a root published before the formula changed
function publishedTree(events, snap, root){
  const upto = events.filter(e => e.block <= snap);
  const t = Referral.tree(Referral.finalOwed(upto, CONFIG).owed);
  if(!root || t.root === root) return t;
  const t1 = Referral.tree(Referral.compute(upto, CONFIG, { rules: "v1" }).owed);
  return t1.root === root ? t1 : t;
}

// everything about one wallet, read in as few RPC requests as possible (Multicall3)
async function chainAccount(w){
  const me = w.toLowerCase(), C = CONFIG.CONTRACTS, mk = await Chain.market();
  const [usdt, tk, markets, h] = await Promise.all([Chain.token(C.usdt), Chain.token(C.token), loadChainMarkets(), Chain.history()]);
  const ended = markets.filter(m => m.status !== "live");
  const v = HAS_VAULT() ? await Chain.vault() : null, st = HAS_STAKING() ? await Chain.staking() : null, rf = HAS_REFERRAL() ? await Chain.referral() : null;
  const calls = [
    { c: usdt, fn: "balanceOf", args: [w] }, { c: tk, fn: "balanceOf", args: [w] },
    { c: usdt, fn: "lastFaucet", args: [w] }, { c: tk, fn: "lastFaucet", args: [w] },
    { c: mk, fn: "owner" }, { c: mk, fn: "resolver" },
    ...markets.map(m => ({ c: mk, fn: "sharesOf", args: [Number(m.id), w] }))
  ];
  const extra = {};
  const push = (name, list) => { extra[name] = calls.length; calls.push(...list); };
  if(v) push("vault", [{ c: v, fn: "depositsOf", args: [w] }, { c: v, fn: "pointsOf", args: [w] }]);
  if(st) push("stake", [{ c: st, fn: "staked", args: [w] }, { c: st, fn: "lockedUntil", args: [w] }, { c: st, fn: "pendingFees", args: [w] },
    ...ended.map(m => ({ c: st, fn: "voteOf", args: [Number(m.id), w] }))]);
  if(rf) push("ref", [{ c: rf, fn: "codeOf", args: [w] }]);
  const r = await Chain.multi(calls);
  if(r.slice(0, 6 + markets.length).some(x => x === null)) throw new Error("Couldn't read your account");
  const [stable, token, lfU, lfT, owner, resolver] = r, holdings = r.slice(6, 6 + markets.length);
  const byId = Object.fromEntries(markets.map(m => [m.id, m]));
  const mine = h.events.filter(e => e.u === me);
  // average cost per market+side from my trades
  const cost = {}, history = [];
  mine.forEach(e => {
    if(e.n !== "Trade") return;
    const k = e.id + ":" + (e.yes ? "YES" : "NO"), c = cost[k] || (cost[k] = { sh: 0, spent: 0 });
    if(e.buy){ c.sh += e.sh; c.spent += e.amt; }
    else { const part = c.sh ? c.spent * Math.min(1, e.sh / c.sh) : 0; c.sh -= e.sh; c.spent -= part;
      const m = byId[e.id]; history.push({ marketId: String(e.id), q: m?.q, icon: m?.icon, side: e.yes ? "YES" : "NO", lev: 1, margin: part, received: e.amt, how: "Sold", closedAt: e.ts }); }
  });
  mine.filter(e => e.n === "Redeemed").forEach(e => { const m = byId[e.id], side = m?.outcome || "YES", c = cost[e.id + ":" + side];
    history.push({ marketId: String(e.id), q: m?.q, icon: m?.icon, side, lev: 1, margin: c?.spent || 0, received: e.amt, how: "Won", closedAt: e.ts }); if(c) c.spent = 0; });
  const positions = [];
  markets.forEach((m, i) => [["YES", holdings[i][0]], ["NO", holdings[i][1]]].forEach(([side, raw]) => {
    const shares = Chain.fmt(raw); if(shares < 1e-6) return;
    const c = cost[m.id + ":" + side] || { spent: 0 }, margin = Math.max(0, c.spent);
    if(m.status === "resolved" && m.outcome !== side){ history.push({ marketId: m.id, q: m.q, icon: m.icon, side, lev: 1, margin, received: 0, how: "Lost", closedAt: m.endMs }); return; }
    const pos = { id: m.id + ":" + side, marketId: m.id, q: m.q, icon: m.icon, side, shares, margin, size: margin, borrowed: 0, lev: 1, avg: margin / shares, fee: 0 };
    let mark;
    if(m.status === "resolved"){ const val = m.outcome === side ? shares : 0; mark = { price: m.outcome === side ? 1 : 0, value: val, equity: val, pnl: val - margin, liq: 0 }; }
    else mark = Engine.mark(m, pos);
    positions.push({ ...pos, status: m.status, outcome: m.outcome, ...mark });
  }));
  const trades = mine.filter(e => e.n === "Trade"), volume = trades.reduce((s, e) => s + e.amt, 0);
  const created = markets.filter(m => m.creator.toLowerCase() === me).map(m => ({ ...m, bond: { amount: CONFIG.CREATE_BOND, returned: m.status === "resolved" } }));
  // the faucet is ready again once either token can be claimed
  const faucetAt = Math.min(Number(lfU), Number(lfT)) * 1000;
  const u = {
    address: w, stable: Chain.fmt(stable), token: Chain.fmt(token), staked: 0, faucetAt, faucetEach: { stable: Number(lfU) * 1000, token: Number(lfT) * 1000 },
    volume, trades: trades.length, maxLev: 1, pnl: history.reduce((s, x) => s + x.received - x.margin, 0),
    positions, history: history.sort((a, b) => b.closedAt - a.closedAt), deposits: [], votes: {}, created,
    bonds: Object.fromEntries(created.map(m => [m.id, m.bond])), feeRate: CONFIG.CREATOR_FEE + CONFIG.PROTOCOL_FEE,
    isAdmin: [owner, resolver].some(a => a.toLowerCase() === me)
  };
  let vaultPts = 0;
  if(v){
    const i = extra.vault, dep = r[i], pts = r[i + 1];
    if(dep){ const [list, pending] = dep;
      u.deposits = list.map((d, k) => ({ id: String(k), amount: Chain.fmt(d.amount), lock: LOCK_IDS[Number(d.lock)], mult: [1, 2, 4, 8][Number(d.lock)],
        start: Number(d.start) * 1000, unlock: Number(d.unlock) * 1000, earned: Chain.fmt(pending[k]), closed: d.closed })).filter(d => !d.closed); }
    vaultPts = pts ? Chain.fmt(pts) : 0;
  }
  if(st){
    const i = extra.stake;
    u.staked = Chain.fmt(r[i] || 0n); u.lockedUntil = Number(r[i + 1] || 0n) * 1000; u.stakeFees = Chain.fmt(r[i + 2] || 0n);
    ended.forEach((m, k) => { const vo = r[i + 3 + k]; if(vo?.voted) u.votes[m.id] = { side: vo.yes ? "YES" : "NO", weight: Chain.fmt(vo.weight), claimed: vo.claimed }; });
  }
  const hasCode = rf ? !!r[extra.ref] : false;
  u.refCode = rf && r[extra.ref] ? String(r[extra.ref]) : null;
  u.points = { parts: { Trading: Math.round(volume), Vault: Math.round(vaultPts) } };
  u.badges = Engine.badges(u, hasCode); u.stakeTier = Engine.stakeTier(0);
  u.points.parts.Badges = u.badges.filter(b => b.got).length * 500;
  u.points.total = Object.values(u.points.parts).reduce((a, b) => a + b, 0);
  return u;
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
      if(!Number.isInteger(i) || i < 0) throw new Error("Market not found");
      return Chain.retry(async () => {
        const mk = await Chain.market();
        if(i >= Number(await mk.marketCount())) throw new Error("Market not found");
        const [[m, p], h] = await Promise.all([mk.getMarket(i), Chain.history()]);
        const out = mapChainMarket(i, m, p, h.events);
        if(HAS_STAKING() && out.status !== "live"){
          const st = await Chain.staking(); await stakingParams(st);
          const [t, tm] = await Chain.multi([{ c: st, fn: "tallies", args: [i] }, { c: st, fn: "turnoutMet", args: [i] }]);
          if(!t) throw new Error("Couldn't read the vote");
          out.votes = { YES: Chain.fmt(t[0]), NO: Chain.fmt(t[1]) }; out.finalized = t[2]; out.turnoutMet = tm; out.voteEnds = out.endMs + Chain.votingPeriod;
        }
        return out;
      });
    },
    async placeTrade({ marketId, side, margin, minShares }){
      const amt = Chain.wei(margin), yes = side === "YES", mk = await Chain.market();
      if((await Chain.retry(async () => (await Chain.token(CONFIG.CONTRACTS.usdt)).balanceOf(wallet.address))) < amt) throw new Error("Not enough test USDT. Use Get test funds.");
      await Chain.ensureAllowance(CONFIG.CONTRACTS.usdt, amt);
      // slippage guard: the price the user saw (minus 3%), or 97% of a fresh quote
      const min = minShares > 0 ? Chain.wei(minShares) : ((await Chain.retry(() => mk.quoteBuy(Number(marketId), yes, amt)))[0] * 97n / 100n);
      await Chain.write(CONFIG.CONTRACTS.market, MARKET_ABI, "buy", [Number(marketId), yes, amt, min]);
      return { ok: true };
    },
    // what selling a whole position would pay right now (shown before the user confirms)
    async quoteSell({ id }){
      const [mid, side] = id.split(":"), yes = side === "YES", mk = await Chain.market();
      return Chain.retry(async () => {
        const [sy, sn] = await mk.sharesOf(Number(mid), wallet.address), shares = yes ? sy : sn;
        if(shares === 0n) return { shares: 0, out: 0, fee: 0 };
        const [out, fee] = await mk.quoteSell(Number(mid), yes, shares);
        return { shares: Chain.fmt(shares), out: Chain.fmt(out), fee: Chain.fmt(fee) };
      });
    },
    async closePosition({ id }){
      const [mid, side] = id.split(":"), yes = side === "YES", mk = await Chain.market();
      const [sy, sn] = await Chain.retry(() => mk.sharesOf(Number(mid), wallet.address)), shares = yes ? sy : sn;
      if(shares === 0n) throw new Error("No shares to sell");
      const [out] = await Chain.retry(() => mk.quoteSell(Number(mid), yes, shares));
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
      return Chain.retry(() => chainAccount(w));
    },
    async faucet(w){
      const [usdt, tok] = [await Chain.token(CONFIG.CONTRACTS.usdt), await Chain.token(CONFIG.CONTRACTS.token)];
      await Chain.scan().catch(() => {});                 // sets the blockchain clock
      const now = Chain.now() / 1000, ready = async (t) => now >= Number(await Chain.retry(() => t.lastFaucet(w))) + 86400;
      const [a, b] = await Promise.all([ready(usdt), ready(tok)]);
      if(!a && !b) throw new Error("Faucet used. Come back in 24 hours.");
      const got = { stable: 0, token: 0 };
      if(a){ await Chain.write(CONFIG.CONTRACTS.usdt, TOKEN_ABI, "faucet", []); got.stable = CONFIG.FAUCET_STABLE; }
      if(b){ await Chain.write(CONFIG.CONTRACTS.token, TOKEN_ABI, "faucet", []); got.token = CONFIG.FAUCET_TOKEN; }
      return { ok: true, ...got };
    },
    async createMarket({ q, cat, ends, source, p }){
      const mk = await Chain.market(), bond = await mk.bondAmount();
      if((await (await Chain.token(CONFIG.CONTRACTS.token)).balanceOf(wallet.address)) < bond) throw new Error(`You need ${tok(Chain.fmt(bond))} for the bond. Use Get test funds.`);
      await Chain.ensureAllowance(CONFIG.CONTRACTS.token, bond);
      const end = Math.floor(Date.parse(ends + "T23:59:59Z") / 1000);
      const rc = await Chain.write(CONFIG.CONTRACTS.market, MARKET_ABI, "createMarket", [q, `[${cat}] ${source}`, end, Chain.wei(p)]);
      const ev = rc.logs.map(l => { try{ return mk.interface.parseLog(l); }catch(e){ return null; } }).find(e => e?.name === "MarketCreated");
      return { ok: true, id: ev ? String(ev.args.id) : null };      // null: couldn't read the id, show the market list
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
      const [code, referrer, claimedW, snap, published, pool, root] = await Chain.retry(() => Promise.all([rf.codeOf(w), rf.referrerOf(w), rf.claimed(w), rf.snapshotBlock(), rf.totalPublished(), rf.pool(), rf.merkleRoot()]));
      const { events, latest } = await Chain.referralEvents(true);
      const live = Referral.finalOwed(events, CONFIG);
      // what's claimable now = my amount in the published tree minus what I already claimed
      let publishedMine = 0n;
      if(Number(snap) > 0){ const t = publishedTree(events, Number(snap), root); publishedMine = t.amounts.get(me) || 0n; }
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
      const { events } = await Chain.referralEvents(true);
      const root = await rf.merkleRoot(), t = publishedTree(events, snap, root), me = w.toLowerCase();
      if(t.root !== root) throw new Error("Rewards are still syncing. Please try again in a minute.");
      const amt = t.amounts.get(me); if(!amt) throw new Error("Nothing to claim yet");
      const before = await rf.claimed(w);
      await Chain.write(CONFIG.CONTRACTS.referral, REFERRAL_ABI, "claim", [amt, t.proofs.get(me)]);
      return { ok: true, amount: Chain.fmt(amt - before) };
    },
    // admin: publish everyone's rewards up to the last confirmed block; tops up the pool first if needed
    async publishReferralRewards(){
      Chain.data = null;                                  // always publish from fresh data
      const rf = await Chain.referral(), { events, latest } = await Chain.referralEvents(), snap = latest;
      if(snap <= Number(await rf.snapshotBlock())) throw new Error("Nothing new to publish yet. Try again in a minute.");
      const t = Referral.tree(Referral.finalOwed(events.filter(e => e.block <= snap), CONFIG).owed);
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
    // ---- owner safety panel: current settings, risks and what needs attention ----
    async getSafety(){
      const C = CONFIG.CONTRACTS, mk = await Chain.market(), st = await Chain.staking(), tk = await Chain.token(C.token);
      const owner = await Chain.retry(() => mk.owner());
      const [r, markets] = await Promise.all([Chain.multi([
        { c: mk, fn: "reserve" }, { c: mk, fn: "bondAmount" }, { c: mk, fn: "protocolFees" }, { c: mk, fn: "defaultB" }, { c: mk, fn: "resolver" },
        { c: st, fn: "voteRewardBps" }, { c: st, fn: "votingPeriod" }, { c: st, fn: "totalStaked" }, { c: st, fn: "staked", args: [owner] },
        { c: st, fn: "rewardPool" }, { c: tk, fn: "balanceOf", args: [owner] }, { c: st, fn: "lockedUntil", args: [owner] },
        { c: st, fn: "quorum" }, { c: st, fn: "unallocated" }, { c: tk, fn: "balanceOf", args: [C.vault] }
      ]), loadChainMarkets()]);
      if(r.slice(0, 12).some(x => x === null)) throw new Error("Couldn't read the contract settings");
      const [reserve, bond, fees, b, resolver, rewardBps, period, total, ownerStake, rewardPool, ownerTokens, ownerLock, quorum, unalloc, slashed] = r;
      const pending = markets.filter(m => m.status === "resolving" && !m.finalized);
      const ownerVotes = await Chain.multi(pending.map(m => ({ c: st, fn: "voteOf", args: [Number(m.id), owner] })));
      const now = Chain.now(), F = Chain.fmt;
      return {
        owner, resolverIsStaking: resolver.toLowerCase() === C.staking.toLowerCase(),
        v2: quorum !== null, quorum: quorum === null ? 0 : F(quorum), unallocated: unalloc === null ? 0 : F(unalloc), slashedBonds: slashed === null ? 0 : F(slashed),
        reserve: F(reserve), bond: F(bond), unharvested: F(fees), b: F(b),
        // worst-case reserve one new market can lock: b * ln(1 / 0.05) at a 5% / 95% start price
        perMarketMax: F(b) * Math.log(20),
        voteRewardBps: Number(rewardBps), votingPeriodH: Number(period) / 3600, rewardPool: F(rewardPool),
        totalStaked: F(total), ownerStake: F(ownerStake), ownerTokens: F(ownerTokens), ownerLockedUntil: Number(ownerLock) * 1000,
        resolving: pending.map((m, i) => ({ id: m.id, q: m.q, icon: m.icon, votes: m.votes, voteEnds: m.voteEnds, open: now < m.voteEnds,
          ownerVote: ownerVotes[i]?.voted ? (ownerVotes[i].yes ? "YES" : "NO") : null }))
      };
    },
    async sweepUnallocated(){ await Chain.write(CONFIG.CONTRACTS.staking, STAKE_ABI, "sweepUnallocated", [wallet.address]); return { ok: true }; },
    async sweepSlashedBonds(){
      const tk = await Chain.token(CONFIG.CONTRACTS.token), amt = await Chain.retry(() => tk.balanceOf(CONFIG.CONTRACTS.vault));
      if(amt === 0n) throw new Error("No bonds to recover");
      await Chain.write(CONFIG.CONTRACTS.vault, VAULT_ABI, "sweepOther", [CONFIG.CONTRACTS.token, wallet.address, amt]);
      return { ok: true, amount: Chain.fmt(amt) };
    },
    // ---- owner analytics: every trade / market / invite event plus current totals ----
    async getAnalytics(){
      const C = CONFIG.CONTRACTS, [h, d, markets] = await Promise.all([Chain.history(), Chain.scan(), loadChainMarkets()]);
      const mk = await Chain.market(), calls = [{ c: mk, fn: "reserve" }, { c: mk, fn: "protocolFees" }];
      const v = HAS_VAULT() ? await Chain.vault() : null, st = HAS_STAKING() ? await Chain.staking() : null, rf = HAS_REFERRAL() ? await Chain.referral() : null;
      if(v) calls.push({ c: v, fn: "totalDeposits" }, { c: v, fn: "totalFeesToLps" }, { c: v, fn: "totalFeesToStakers" });
      if(st) calls.push({ c: st, fn: "totalStaked" });
      if(rf) calls.push({ c: rf, fn: "totalPublished" }, { c: rf, fn: "totalClaimed" }, { c: rf, fn: "pool" });
      const r = (await Chain.retry(() => Chain.multi(calls))).map(x => x === null ? null : Chain.fmt(x));
      let i = 2; const t = { reserve: r[0], unharvested: r[1] };
      if(v){ t.vaultTvl = r[i++]; t.feesToLps = r[i++]; t.feesToStakers = r[i++]; }
      if(st) t.staked = r[i++];
      if(rf){ t.refPublished = r[i++]; t.refClaimed = r[i++]; t.refPool = r[i++]; }
      return { events: h.events, invites: d.ev.filter(e => e.k === "r").map(e => ({ ts: d.ts(e.b), u: e.u, r: e.r })), markets, totals: t, now: Chain.now() };
    },
    // ---- money left in the pre-v2 vault / staking contracts ----
    async getOld(w){
      const O = OLD(); if(!w || !(O.vault || O.staking)) return null;
      const calls = [];
      const v = O.vault ? new ethers.Contract(O.vault, VAULT_ABI, await Chain.readProvider()) : null;
      const st = O.staking ? new ethers.Contract(O.staking, STAKE_ABI, await Chain.readProvider()) : null;
      if(v) calls.push({ c: v, fn: "depositsOf", args: [w] });
      if(st) calls.push({ c: st, fn: "staked", args: [w] }, { c: st, fn: "pendingFees", args: [w] }, { c: st, fn: "lockedUntil", args: [w] });
      const r = await Chain.retry(() => Chain.multi(calls));
      const out = { deposits: [], staked: 0, fees: 0, lockedUntil: 0 };
      let i = 0;
      if(v){ const dep = r[i++]; if(dep){ const [list, pending] = dep;
        out.deposits = list.map((d, k) => ({ id: String(k), amount: Chain.fmt(d.amount), earned: Chain.fmt(pending[k]), unlock: Number(d.unlock) * 1000, closed: d.closed })).filter(d => !d.closed); } }
      if(st){ out.staked = Chain.fmt(r[i] || 0n); out.fees = Chain.fmt(r[i + 1] || 0n); out.lockedUntil = Number(r[i + 2] || 0n) * 1000; }
      out.any = out.deposits.length > 0 || out.staked > 0 || out.fees > 0.000001;
      return out;
    },
    async oldWithdraw({ id }){ await Chain.write(OLD().vault, VAULT_ABI, "withdraw", [Number(id)]); return { ok: true }; },
    async oldUnstake(){
      const st = new ethers.Contract(OLD().staking, STAKE_ABI, await Chain.readProvider());
      const amt = await Chain.retry(() => st.staked(wallet.address)); if(amt === 0n) throw new Error("Nothing staked in the old contract");
      await Chain.write(OLD().staking, STAKE_ABI, "unstake", [amt]); return { ok: true, amount: Chain.fmt(amt) };
    },
    async oldClaimStakeFees(){ await Chain.write(OLD().staking, STAKE_ABI, "claimFees", []); return { ok: true }; },
    async setVoteReward(bps){ await Chain.write(CONFIG.CONTRACTS.staking, STAKE_ABI, "setVoteReward", [bps]); Chain.voteRewardBps = null; Chain.votingPeriod = null; return { ok: true }; },
    async setBond(amount){ await Chain.write(CONFIG.CONTRACTS.market, MARKET_ABI, "setBondAmount", [Chain.wei(amount)]); return { ok: true }; },
    async fundReserve(amount){
      const amt = Chain.wei(amount);
      if((await Chain.retry(async () => (await Chain.token(CONFIG.CONTRACTS.usdt)).balanceOf(wallet.address))) < amt) throw new Error("Not enough test USDT in your wallet");
      await Chain.ensureAllowance(CONFIG.CONTRACTS.usdt, amt);
      await Chain.write(CONFIG.CONTRACTS.market, MARKET_ABI, "fundReserve", [amt]);
      return { ok: true };
    },
    // tBNB (gas) balance of a wallet, for the testnet tour
    async gasBalance(w){ return Chain.fmt(await Chain.retry(async () => (await Chain.readProvider()).getBalance(w))); },
    async trackClick(){},
    async claimStakeFees(){ await Chain.write(CONFIG.CONTRACTS.staking, STAKE_ABI, "claimFees", []); return { ok: true }; },
    async getLeaderboard(by = "profit"){
      const h = await Chain.history(), users = {}, cost = {}, outcome = {};
      h.events.forEach(e => {
        if(e.n === "Resolved"){
          outcome[e.id] = e.yes;
          // everything still held on the losing side is a loss
          const lose = ":" + e.id + ":" + (e.yes ? "N" : "Y");
          Object.keys(cost).filter(k => k.endsWith(lose)).forEach(k => { const c = cost[k]; if(c.spent > 1e-9 && c.sh > 1e-9){ const u = users[k.split(":")[0]]; u.pnl -= c.spent; u.closed++; } c.spent = 0; c.sh = 0; });
          return;
        }
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
