/* =====================================================================
   369X REFERRAL REWARDS: the published formula
   Everyone (the admin publishing rewards, users claiming, and the tests)
   runs this exact code on public blockchain data, so anyone can check
   that the published rewards are correct. All math is integer (wei).

   Rules "v2" (current). For every BUY by a user who accepted an invite
   (only trades after they accepted count; sells earn nothing; trades in a
   market created by the trader, their referrer or their referrer's
   referrer earn nothing, so wash trading can't farm the pool):
     protocol part = fee x PROTOCOL / (PROTOCOL + CREATOR)        (1% of the 1.5%)
     referrer      += protocol part x tier rate (20/25/30/35%, by the
                      referrer's total referred volume before this trade)
     referrer's referrer += protocol part x 5%
     trader        += fee x 10% (the invited user's fee rebate)

   Rules "v1" (the first version) also paid on sells and on own markets.
   Amounts already published under v1 are kept as a floor, so nobody's
   published total ever goes down (see finalOwed).
   ===================================================================== */
(function(root){
  const E = (typeof ethers !== "undefined") ? ethers : require("ethers");
  const cfg = (typeof CONFIG !== "undefined") ? CONFIG : null;

  function params(c = cfg){
    const bps = (x) => BigInt(Math.round(x * 10000));
    return {
      protocolBps: bps(c.PROTOCOL_FEE), creatorBps: bps(c.CREATOR_FEE),
      level2Bps: 500n, rebateBps: bps(c.REF_DISCOUNT),
      tiers: c.REF_TIERS.map(t => [E.parseEther(String(t.min)), bps(t.rate)])
    };
  }

  // events: { kind: "ref", block, logIndex, user, referrer }
  //       | { kind: "trade", block, logIndex, user, id, buy, fee, amount, ts? }
  //       | { kind: "created", block, logIndex, id, user }          (market creator)
  //       | { kind: "published", block, logIndex, root, snap }      (RewardsPublished)
  function compute(events, c = cfg, opts = {}){
    const v2 = (opts.rules || "v2") === "v2", creators = new Map();
    const P = params(c), owed = new Map(), add = (a, v) => { if(v > 0n) owed.set(a, (owed.get(a) || 0n) + v); };
    const ref = new Map(), refVolume = new Map(), referrals = new Map(), daily = new Map(), l2 = new Map(), rebates = new Map();
    const sorted = [...events].sort((a, b) => a.block - b.block || a.logIndex - b.logIndex);
    for(const e of sorted){
      if(e.kind === "created"){ creators.set(Number(e.id), e.user.toLowerCase()); continue; }
      if(e.kind !== "ref" && e.kind !== "trade") continue;
      const u = e.user.toLowerCase();
      if(e.kind === "ref"){
        const r = e.referrer.toLowerCase(); ref.set(u, r);
        if(!referrals.has(r)) referrals.set(r, new Map());
        referrals.get(r).set(u, { volume: 0n, earned: 0n, block: e.block, ts: e.ts || 0 });
        continue;
      }
      const r = ref.get(u); if(!r) continue;
      if(v2){
        if(e.buy === false) continue;                                     // sells earn nothing
        const cr = creators.get(Number(e.id));
        if(cr && (cr === u || cr === r || cr === ref.get(r))) continue;   // own / referrer's market
      }
      const fee = BigInt(e.fee), amount = BigInt(e.amount);
      const protocolPart = fee * P.protocolBps / (P.protocolBps + P.creatorBps);
      const vol = refVolume.get(r) || 0n;
      let rate = P.tiers[0][1]; for(const [min, bps] of P.tiers) if(vol >= min) rate = bps;
      const c1 = protocolPart * rate / 10000n;
      add(r, c1); refVolume.set(r, vol + amount);
      const row = referrals.get(r).get(u); row.volume += amount; row.earned += c1;
      if(e.ts){ const day = new Date(e.ts).toISOString().slice(0, 10), d = daily.get(r) || new Map(); d.set(day, (d.get(day) || 0n) + c1); daily.set(r, d); }
      const r2 = ref.get(r);
      if(r2 && r2 !== u){ const c2 = protocolPart * P.level2Bps / 10000n; add(r2, c2); l2.set(r2, (l2.get(r2) || 0n) + c2); }
      const reb = fee * P.rebateBps / 10000n; add(u, reb); rebates.set(u, (rebates.get(u) || 0n) + reb);
    }
    return { owed, ref, refVolume, referrals, daily, l2, rebates };
  }

  // ---- Merkle tree compatible with OpenZeppelin MerkleProof (sorted pairs, double-hashed leaves)
  const leaf = (account, amount) => E.keccak256(E.keccak256(E.AbiCoder.defaultAbiCoder().encode(["address", "uint256"], [account, amount])));
  const hashPair = (a, b) => (BigInt(a) < BigInt(b)) ? E.keccak256(E.concat([a, b])) : E.keccak256(E.concat([b, a]));

  function tree(owed){
    const entries = [...owed.entries()].filter(([, v]) => v > 0n).sort((a, b) => a[0].localeCompare(b[0]));
    if(!entries.length) return { root: E.ZeroHash, total: 0n, proofs: new Map(), amounts: new Map() };
    const leaves = entries.map(([a, v]) => leaf(E.getAddress(a), v));
    const layers = [leaves];
    while(layers[layers.length - 1].length > 1){
      const prev = layers[layers.length - 1], next = [];
      for(let i = 0; i < prev.length; i += 2) next.push(i + 1 < prev.length ? hashPair(prev[i], prev[i + 1]) : prev[i]);
      layers.push(next);
    }
    const proofs = new Map(), amounts = new Map();
    entries.forEach(([a, v], idx) => {
      const proof = []; let i = idx;
      for(let l = 0; l < layers.length - 1; l++){ const sib = i ^ 1; if(sib < layers[l].length) proof.push(layers[l][sib]); i = Math.floor(i / 2); }
      proofs.set(a, proof); amounts.set(a, v);
    });
    return { root: layers[layers.length - 1][0], total: entries.reduce((s, [, v]) => s + v, 0n), proofs, amounts };
  }

  // What everyone is owed: v2 rules, but never less than what a v1 publish already granted.
  // The v1 floor comes from the last published root that matches the v1 formula exactly,
  // so every browser derives the same numbers from the same blockchain data.
  function finalOwed(events, c = cfg){
    const pubs = events.filter(e => e.kind === "published").sort((a, b) => a.block - b.block || a.logIndex - b.logIndex);
    let floor = new Map();
    for(const p of pubs){
      const t1 = tree(compute(events.filter(e => e.block <= Number(p.snap)), c, { rules: "v1" }).owed);
      if(t1.root === p.root) floor = t1.amounts;
    }
    const res = compute(events, c, { rules: "v2" });
    for(const [a, v] of floor) if(v > (res.owed.get(a) || 0n)) res.owed.set(a, v);
    return res;
  }

  const api = { params, compute, finalOwed, tree, leaf };
  if(typeof module !== "undefined" && module.exports) module.exports = api; else root.Referral = api;
})(typeof window !== "undefined" ? window : globalThis);
