/* =====================================================================
   LMSR (Logarithmic Market Scoring Rule) pricing for YES/NO markets.

   State per market: qY (YES shares sold), qN (NO shares sold), b (liquidity).
     cost(qY,qN) = b * ln(e^(qY/b) + e^(qN/b))
     price(YES)  = e^(qY/b) / (e^(qY/b) + e^(qN/b))
   Buying X shares costs cost(after) - cost(before). Each share pays $1
   if its side wins. The market maker's worst-case loss is b * ln(2).
   ===================================================================== */
const LMSR = {
  // log(e^a + e^b) without overflow
  lse(a, b){ const m = Math.max(a, b); return m + Math.log(Math.exp(a - m) + Math.exp(b - m)); },
  cost(s){ return s.b * LMSR.lse(s.qY / s.b, s.qN / s.b); },
  priceYes(s){ return 1 / (1 + Math.exp((s.qN - s.qY) / s.b)); },
  price(s, side){ const p = LMSR.priceYes(s); return side === "YES" ? p : 1 - p; },

  // state that starts at probability p for a given b
  init(p, b){ return { qY: b * Math.log(p / (1 - p)), qN: 0, b }; },

  // how many shares does `amount` dollars buy?  (exact closed form)
  sharesFor(s, side, amount){
    if(amount <= 0) return 0;
    const own = side === "YES" ? s.qY : s.qN, other = side === "YES" ? s.qN : s.qY;
    const target = (LMSR.cost(s) + amount) / s.b, o = other / s.b;
    // e^(own'/b) = e^target - e^o   ->  own' = b * (target + ln(1 - e^(o - target)))
    const ownNew = s.b * (target + Math.log(1 - Math.exp(o - target)));
    return ownNew - own;
  },
  // dollars received for selling `shares` back to the market
  proceedsFor(s, side, shares){
    if(shares <= 0) return 0;
    const after = LMSR.apply(s, side, -shares);
    return LMSR.cost(s) - LMSR.cost(after);
  },
  apply(s, side, shares){
    return side === "YES" ? { ...s, qY: s.qY + shares } : { ...s, qN: s.qN + shares };
  },
  maxLoss(s){ return s.b * Math.LN2; }
};
