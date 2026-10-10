/* =====================================================================
   CHAIN EVENTS
   The contract events the site reads, and how each one is stored.
   Shared by the browser (js/api-chain.js) and the snapshot script
   (scripts/chain-snapshot.js), so both always store events the same way.
   ===================================================================== */
(function(root){
  const MARKET_EVENTS = [
    "event Trade(uint256 indexed id, address indexed user, bool yes, bool buy, uint256 shares, uint256 amount, uint256 fee, uint256 priceYes)",
    "event MarketCreated(uint256 indexed id, address indexed creator, string question, uint64 endTime, uint256 pYes, int256 b)",
    "event Resolved(uint256 indexed id, bool outcomeYes, bool bondSlashed)",
    "event Redeemed(uint256 indexed id, address indexed user, uint256 amount)"
  ];
  const REFERRAL_EVENTS = [
    "event CodeRegistered(address indexed user, string code)",
    "event ReferrerSet(address indexed user, address indexed referrer, string code)",
    "event RewardsPublished(bytes32 root, uint64 snapshotBlock, uint256 total)"
  ];
  const VERSION = "v3";              // bump when the stored shape changes (drops old caches and snapshots)

  // returns parse(log) -> compact event object, or null for events we don't keep
  function makeParser(ethers, referralAddr){
    const mi = new ethers.Interface(MARKET_EVENTS), ri = new ethers.Interface(REFERRAL_EVENTS);
    const ref = (referralAddr || "").toLowerCase();
    return (l) => {
      const isRef = ref && l.address.toLowerCase() === ref;
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
  }

  // getLogs over [from, to] in chunks. The first chunk finds the largest block range the RPC accepts
  // (using the limit named in its error when there is one); a later refusal splits that chunk in half.
  async function scanLogs(getLogs, from, to, opts = {}){
    const min = opts.min || 1000, par = opts.parallel || 4, out = [];
    let step = Math.max(min, opts.step || 50000), b = from;
    const emit = (got, last) => { if(opts.onBatch) opts.onBatch(got, last, step); else out.push(...got); };
    const limitIn = (e, span) => { const m = String(e?.error?.message || e?.shortMessage || e?.message || "").match(/\d{3,}/g); const n = m && m.map(Number).find(x => x >= min && x < span); return n || Math.floor(span / 2); };
    // probe
    while(b <= to){
      const t = Math.min(to, b + step - 1);
      try{ emit(await getLogs(b, t), t); b = t + 1; break; }
      catch(e){ if(t - b + 1 <= min) throw e; step = Math.max(min, limitIn(e, t - b + 1)); }
    }
    const one = async (f, t) => {
      try{ return await getLogs(f, t); }
      catch(e){ if(t - f + 1 <= min) throw e; const m = Math.floor((f + t) / 2); return (await one(f, m)).concat(await one(m + 1, t)); }
    };
    while(b <= to){
      const batch = [];
      for(let k = 0; k < par && b <= to; k++){ const t = Math.min(to, b + step - 1); batch.push([b, t]); b = t + 1; }
      emit((await Promise.all(batch.map(([f, t]) => one(f, t)))).flat(), batch[batch.length - 1][1]);
    }
    return { logs: out, step };
  }

  const api = { MARKET_EVENTS, REFERRAL_EVENTS, VERSION, makeParser, scanLogs };
  if(typeof module !== "undefined" && module.exports) module.exports = api; else root.CHAIN_EVENTS = api;
})(typeof window !== "undefined" ? window : globalThis);
