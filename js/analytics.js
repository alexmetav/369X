/* =====================================================================
   OWNER ANALYTICS DASHBOARD  (#/analytics)
   Everything is computed in the browser from public blockchain events
   (trades, new markets, invites) plus a few current contract totals.
   Charts are plain SVG: thin marks, one hue per series, hover tooltips,
   and a table view with the same numbers.
   ===================================================================== */
const AN = { range: "30", data: null, table: false };
const DAY = 864e5;
const dayKey = (ts) => new Date(ts).toISOString().slice(0, 10);
const dayLabel = (k) => new Date(k + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

// bucket the event log into UTC days for the chosen range (and the period before it, for deltas)
function anCompute(data, range){
  const trades = data.events.filter(e => e.n === "Trade"), created = data.events.filter(e => e.n === "MarketCreated");
  const today = Date.parse(dayKey(data.now) + "T00:00:00Z");
  const first = Math.min(today, ...data.events.map(e => e.ts).filter(Boolean));
  const n = range === "all" ? Math.max(1, Math.round((today - Date.parse(dayKey(first) + "T00:00:00Z")) / DAY) + 1) : Number(range);
  const start = today - (n - 1) * DAY, prevStart = start - n * DAY;
  const firstTrade = new Map();
  trades.forEach(t => { if(!firstTrade.has(t.u)) firstTrade.set(t.u, t.ts); });
  const days = [...Array(n).keys()].map(i => ({ key: dayKey(start + i * DAY), vol: 0, trades: 0, fees: 0, active: new Set(), newT: 0, markets: 0, invites: 0 }));
  const idx = (ts) => Math.floor((ts - start) / DAY);
  trades.forEach(t => { const d = days[idx(t.ts)]; if(!d) return; d.vol += t.amt; d.trades++; d.fees += t.fee; d.active.add(t.u); });
  firstTrade.forEach(ts => { const d = days[idx(ts)]; if(d) d.newT++; });
  created.forEach(c => { const d = days[idx(c.ts)]; if(d) d.markets++; });
  data.invites.forEach(v => { const d = days[idx(v.ts)]; if(d) d.invites++; });
  const inRange = (ts) => ts >= start, inPrev = (ts) => ts >= prevStart && ts < start;
  const sum = (list, f, pick) => list.filter(e => pick(e.ts)).reduce((s, e) => s + f(e), 0);
  const uniq = (pick) => new Set(trades.filter(t => pick(t.ts)).map(t => t.u)).size;
  const kpi = (cur, prev) => ({ cur, prev: range === "all" ? null : prev });
  // fees: creator share is exact; the protocol share is split vault / stakers by the configured LP share
  const feeSum = sum(trades, t => t.fee, inRange), creatorShare = CONFIG.CREATOR_FEE / (CONFIG.CREATOR_FEE + CONFIG.PROTOCOL_FEE);
  const byMarket = new Map(), byTrader = new Map();
  trades.filter(t => inRange(t.ts)).forEach(t => {
    const m = byMarket.get(t.id) || { vol: 0, trades: 0, users: new Set() }; m.vol += t.amt; m.trades++; m.users.add(t.u); byMarket.set(t.id, m);
    const u = byTrader.get(t.u) || { vol: 0, trades: 0, buys: 0 }; u.vol += t.amt; u.trades++; if(t.buy) u.buys++; byTrader.set(t.u, u);
  });
  return {
    n, days: days.map(d => ({ ...d, active: d.active.size })),
    kpis: {
      volume: kpi(sum(trades, t => t.amt, inRange), sum(trades, t => t.amt, inPrev)),
      trades: kpi(trades.filter(t => inRange(t.ts)).length, trades.filter(t => inPrev(t.ts)).length),
      traders: kpi(uniq(inRange), uniq(inPrev)),
      newTraders: kpi([...firstTrade.values()].filter(inRange).length, [...firstTrade.values()].filter(inPrev).length),
      fees: kpi(feeSum, sum(trades, t => t.fee, inPrev)),
      markets: kpi(created.filter(c => inRange(c.ts)).length, created.filter(c => inPrev(c.ts)).length),
      invites: kpi(data.invites.filter(v => inRange(v.ts)).length, data.invites.filter(v => inPrev(v.ts)).length)
    },
    feeSplit: [
      ["Market creators", feeSum * creatorShare],
      ["Vault depositors", feeSum * (1 - creatorShare) * CONFIG.LP_SHARE],
      [`${T()} stakers`, feeSum * (1 - creatorShare) * (1 - CONFIG.LP_SHARE)]
    ],
    topMarkets: [...byMarket.entries()].map(([id, m]) => ({ m: data.markets.find(x => Number(x.id) === id), vol: m.vol, trades: m.trades, users: m.users.size }))
      .filter(x => x.m).sort((a, b) => b.vol - a.vol).slice(0, 8),
    topTraders: [...byTrader.entries()].map(([u, x]) => ({ u, ...x })).sort((a, b) => b.vol - a.vol).slice(0, 8),
    status: ["live", "resolving", "resolved"].map(s => [s, data.markets.filter(m => m.status === s).length])
  };
}

// ---------- page ----------
async function pageAnalytics(){
  if(!(CHAIN_ON && api.getAnalytics)) return chainSoon("Analytics", "Analytics reads the on-chain contracts.");
  if(!wallet.address) return connectPrompt("Connect the owner wallet to open analytics.");
  if(!ACC?.isAdmin) return connectPrompt("Only the owner wallet can open analytics.");
  AN.data = await api.getAnalytics();
  return `<section class="page-head"><div class="wrap">
    ${head("Analytics", "How 369X is being used, straight from the blockchain. Times are UTC.", `<a class="btn btn-ghost" href="#/admin">🛡 Safety panel</a>`)}
    <div class="an-filters" role="group" aria-label="Date range">${[["7", "7 days"], ["30", "30 days"], ["90", "90 days"], ["all", "All time"]].map(([v, l]) =>
      `<button class="chip ${AN.range === v ? "on" : ""}" data-act="anRange" data-v="${v}" aria-pressed="${AN.range === v}">${l}</button>`).join("")}</div>
    <div id="anBody"></div>
  </div></section>`;
}

const anDelta = (k) => {
  if(k.prev === null) return "";
  if(!k.prev) return k.cur ? `<em class="an-delta">new this period</em>` : `<em class="an-delta">no change</em>`;
  const ch = (k.cur - k.prev) / k.prev, up = ch >= 0;
  return `<em class="an-delta ${up ? "up" : "down"}">${up ? "▲" : "▼"} ${Math.abs(ch * 100).toFixed(0)}% <span>vs previous ${AN.range} days</span></em>`;
};

function renderAnalytics(){
  const box = $("#anBody"); if(!box || !AN.data) return;
  const c = anCompute(AN.data, AN.range), t = AN.data.totals, K = c.kpis;
  const tile = (label, value, k) => `<div class="panel stat"><small>${label}</small><b class="num">${value}</b>${k ? anDelta(k) : ""}</div>`;
  const feeTotal = c.feeSplit.reduce((s, f) => s + f[1], 0);
  box.innerHTML = `
    <div class="an-hero panel pad"><small class="muted">Volume traded · ${AN.range === "all" ? "all time" : "last " + AN.range + " days"}</small>
      <b class="an-hero-num">${money(K.volume.cur, 0)}</b>${anDelta(K.volume)}</div>
    <div class="stat-grid an-grid">
      ${tile("Trades", num(K.trades.cur), K.trades)}
      ${tile("Active traders", num(K.traders.cur), K.traders)}
      ${tile("New traders", num(K.newTraders.cur), K.newTraders)}
      ${tile("Trading fees", money(K.fees.cur, 2), K.fees)}
      ${tile("Markets created", num(K.markets.cur), K.markets)}
      ${tile("Invites accepted", num(K.invites.cur), K.invites)}
    </div>
    <div class="an-two">
      <div class="panel pad"><div class="an-head"><h2 class="h3">Daily volume</h2><span class="muted">${S()}</span></div><div class="an-chart" id="chVol"></div></div>
      <div class="panel pad"><div class="an-head"><h2 class="h3">Traders per day</h2>
        <span class="an-legend"><span><i class="ln" style="background:var(--s1)"></i>Active</span><span><i class="ln" style="background:var(--s2)"></i>New</span></span></div>
        <div class="an-chart" id="chUsers"></div></div>
    </div>
    <div class="an-two">
      <div class="panel pad"><h2 class="h3">Where the fees went</h2>
        <p class="muted" style="font-size:13px;margin-top:4px">${money(feeTotal, 2)} in this period. Creator share is exact; the vault / staker split uses the ${pct(CONFIG.LP_SHARE)} setting.</p>
        <div class="an-stack" role="img" aria-label="Fee split">${feeTotal > 0 ? c.feeSplit.map(([l, v], i) => `<i style="flex:${v};background:var(--s${i + 1})" data-tip="${esc(l)}" data-val="${esc(money(v, 2))}"></i>`).join("") : `<i style="flex:1;background:var(--line)"></i>`}</div>
        <div class="an-legend col">${c.feeSplit.map(([l, v], i) => `<span><i class="sw" style="background:var(--s${i + 1})"></i>${esc(l)}<b class="num">${money(v, 2)}</b><em>${feeTotal ? pct(v / feeTotal) : "0%"}</em></span>`).join("")}</div>
      </div>
      <div class="panel pad"><h2 class="h3">Right now</h2><div class="feed" style="margin-top:8px">
        ${c.status.map(([s, n]) => `<div><span>Markets ${s}</span><b class="num">${num(n)}</b></div>`).join("")}
        <div><span>Vault deposits</span><b class="num">${t.vaultTvl == null ? "—" : money(t.vaultTvl, 0)}</b></div>
        <div><span>Total ${T()} staked</span><b class="num">${t.staked == null ? "—" : num(t.staked)}</b></div>
        <div><span>Protocol reserve</span><b class="num">${t.reserve == null ? "—" : money(t.reserve, 0)}</b></div>
        <div><span>Referral rewards published / claimed</span><b class="num">${t.refPublished == null ? "—" : money(t.refPublished, 2) + " / " + money(t.refClaimed, 2)}</b></div>
      </div></div>
    </div>
    <div class="an-two">
      <div class="panel"><div class="pad" style="padding-bottom:0"><h2 class="h3">Top markets</h2></div><div class="scroll-x"><table class="table">
        <thead><tr><th>Market</th><th class="r">Volume</th><th class="r">Trades</th><th class="r">Traders</th></tr></thead>
        <tbody>${c.topMarkets.length ? c.topMarkets.map(x => `<tr><td style="white-space:normal;min-width:200px"><a href="${mHref(x.m.id)}">${esc(x.m.icon)} ${esc(x.m.q)}</a></td><td class="r num">${money(x.vol, 0)}</td><td class="r num">${num(x.trades)}</td><td class="r num">${num(x.users)}</td></tr>`).join("")
          : `<tr><td colspan="4" class="empty">No trades in this period.</td></tr>`}</tbody></table></div></div>
      <div class="panel"><div class="pad" style="padding-bottom:0"><h2 class="h3">Top traders</h2></div><div class="scroll-x"><table class="table">
        <thead><tr><th>Wallet</th><th class="r">Volume</th><th class="r">Trades</th><th class="r">Buys</th></tr></thead>
        <tbody>${c.topTraders.length ? c.topTraders.map(x => `<tr><td class="num"><a href="${CONFIG.CHAIN.blockExplorerUrls[0]}/address/${esc(x.u)}" target="_blank" rel="noopener">${esc(short(x.u))}</a></td><td class="r num">${money(x.vol, 0)}</td><td class="r num">${num(x.trades)}</td><td class="r num">${num(x.buys)}</td></tr>`).join("")
          : `<tr><td colspan="4" class="empty">No trades in this period.</td></tr>`}</tbody></table></div></div>
    </div>
    <div class="panel pad" style="margin-top:16px"><div class="an-head"><h2 class="h3">Daily numbers</h2><button class="btn btn-ghost btn-sm" data-act="anTable">${AN.table ? "Hide table" : "Show as table"}</button></div>
      ${AN.table ? `<div class="scroll-x"><table class="table"><thead><tr><th>Day (UTC)</th><th class="r">Volume</th><th class="r">Trades</th><th class="r">Active</th><th class="r">New</th><th class="r">Fees</th><th class="r">Markets</th><th class="r">Invites</th></tr></thead>
        <tbody>${c.days.slice().reverse().map(d => `<tr><td>${dayLabel(d.key)}</td><td class="r num">${money(d.vol, 2)}</td><td class="r num">${d.trades}</td><td class="r num">${d.active}</td><td class="r num">${d.newT}</td><td class="r num">${money(d.fees, 2)}</td><td class="r num">${d.markets}</td><td class="r num">${d.invites}</td></tr>`).join("")}</tbody></table></div>`
        : `<p class="muted" style="font-size:13px;margin-top:4px">Every number in the charts above, day by day.</p>`}
    </div>`;
  AN.calc = c;
  drawAnalytics();
}

// ---------- SVG charts ----------
function niceTicks(max, n = 4){
  if(max <= 0) return [0, 1];
  const raw = max / n, mag = 10 ** Math.floor(Math.log10(raw)), step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= raw);
  return [...Array(Math.ceil(max / step) + 1).keys()].map(i => i * step);
}
const tickFmt = (v, isMoney) => isMoney ? compact(v) : compactN(v).replace(/\.0(?=[KMB]?$)/, "");

function chartFrame(el, days, series, opts){
  const W = Math.max(280, el.clientWidth), H = 220, L = 46, R = opts.endLabels ? 38 : 10, T = 10, B = 24;
  const max = Math.max(1e-9, ...series.flatMap(s => s.values)), ticks = niceTicks(max), top = ticks[ticks.length - 1];
  const x = (i) => L + (days.length === 1 ? (W - L - R) / 2 : i * (W - L - R) / (days.length - 1));
  const y = (v) => T + (H - T - B) * (1 - v / top);
  const every = Math.max(1, Math.ceil(days.length / Math.max(2, Math.floor((W - L - R) / 70))));
  const grid = ticks.map(v => `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" class="an-grid-l"/><text x="${L - 8}" y="${y(v) + 4}" text-anchor="end" class="an-tick">${tickFmt(v, opts.money)}</text>`).join("");
  const xl = days.map((d, i) => i % every === 0 ? `<text x="${opts.band ? opts.band.cx(i) : x(i)}" y="${H - 6}" text-anchor="middle" class="an-tick">${dayLabel(d.key)}</text>` : "").join("");
  return { W, H, L, R, T, B, x, y, grid, xl };
}

function drawAnalytics(){
  const c = AN.calc; if(!c) return;
  // daily volume: columns, one hue, hover per column
  const ev = $("#chVol");
  if(ev){
    const days = c.days, W0 = Math.max(280, ev.clientWidth), L = 46, R = 10;
    const slot = (W0 - L - R) / days.length, bw = Math.max(2, Math.min(24, slot - 2));
    const band = { cx: (i) => L + slot * i + slot / 2 };
    const f = chartFrame(ev, days, [{ values: days.map(d => d.vol) }], { money: true, band });
    const base = f.y(0);
    const bars = days.map((d, i) => {
      const h = base - f.y(d.vol), x0 = band.cx(i) - bw / 2, r = Math.min(4, bw / 2, h);
      const path = h <= 0 ? "" : `M${x0},${base}V${base - h + r}Q${x0},${base - h} ${x0 + r},${base - h}H${x0 + bw - r}Q${x0 + bw},${base - h} ${x0 + bw},${base - h + r}V${base}Z`;
      return `<path d="${path}" class="an-bar" fill="var(--s1)" data-i="${i}"/>`;
    }).join("");
    ev.innerHTML = `<svg width="${f.W}" height="${f.H}" role="img" aria-label="Daily volume column chart" tabindex="0">${f.grid}<line x1="${L}" x2="${f.W - R}" y1="${base}" y2="${base}" class="an-base"/>${bars}${f.xl}<rect class="an-hit" x="${L}" y="0" width="${f.W - L - R}" height="${base}"/></svg>`;
    anHover(ev, days.length, (px) => Math.floor((px - L) / slot), (i) => band.cx(i), (i) => [[dayLabel(days[i].key)], [money(days[i].vol, 2), "Volume", "var(--s1)"], [num(days[i].trades), "Trades"]], { bars: true });
  }
  // traders per day: two 2px lines with a crosshair
  const eu = $("#chUsers");
  if(eu){
    const days = c.days, S1 = days.map(d => d.active), S2 = days.map(d => d.newT);
    const f = chartFrame(eu, days, [{ values: S1 }, { values: S2 }], { endLabels: true });
    const line = (vals, col) => vals.length === 1 ? `<circle cx="${f.x(0)}" cy="${f.y(vals[0])}" r="4" fill="${col}"/>`
      : `<polyline points="${vals.map((v, i) => f.x(i) + "," + f.y(v)).join(" ")}" fill="none" stroke="${col}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
    const last = days.length - 1, y1 = f.y(S1[last]), y2 = f.y(S2[last]);
    const ends = Math.abs(y1 - y2) >= 14 ? `<text x="${f.x(last) + 8}" y="${y1 + 4}" class="an-end">${S1[last]}</text><text x="${f.x(last) + 8}" y="${y2 + 4}" class="an-end">${S2[last]}</text>` : "";
    eu.innerHTML = `<svg width="${f.W}" height="${f.H}" role="img" aria-label="Active and new traders per day" tabindex="0">${f.grid}<line x1="${f.L}" x2="${f.W - f.R}" y1="${f.y(0)}" y2="${f.y(0)}" class="an-base"/>
      ${line(S1, "var(--s1)")}${line(S2, "var(--s2)")}${ends}${f.xl}<line class="an-cross" x1="0" x2="0" y1="${f.T}" y2="${f.y(0)}" visibility="hidden"/><rect class="an-hit" x="${f.L - 6}" y="0" width="${f.W - f.L - f.R + 12}" height="${f.y(0)}"/></svg>`;
    const step = days.length > 1 ? (f.W - f.L - f.R) / (days.length - 1) : 1;
    anHover(eu, days.length, (px) => Math.round((px - f.L) / step), f.x, (i) => [[dayLabel(days[i].key)], [num(S1[i]), "Active traders", "var(--s1)"], [num(S2[i]), "New traders", "var(--s2)"]], { cross: true });
  }
  // fee split segments
  $$(".an-stack i[data-tip]").forEach(seg => {
    const show = (e) => anTip([[seg.dataset.tip], [seg.dataset.val, "", getComputedStyle(seg).backgroundColor]], e.clientX, e.clientY);
    seg.addEventListener("pointermove", show); seg.addEventListener("pointerleave", () => anTip(null));
  });
}

// one tooltip element; content built with textContent (values come from data)
function anTip(rows, cx, cy){
  let tip = $("#anTip");
  if(!rows){ if(tip) tip.hidden = true; return; }
  if(!tip){ tip = document.createElement("div"); tip.id = "anTip"; tip.className = "an-tip"; document.body.appendChild(tip); }
  tip.replaceChildren(...rows.map(([v, label, col], i) => {
    const row = document.createElement("div");
    if(i === 0 && !label){ row.className = "an-tip-h"; row.textContent = v; return row; }
    if(col){ const k = document.createElement("i"); k.style.background = col; row.appendChild(k); }
    const b = document.createElement("b"); b.textContent = v; row.appendChild(b);
    if(label){ const s = document.createElement("span"); s.textContent = label; row.appendChild(s); }
    return row;
  }));
  tip.hidden = false;
  const w = tip.offsetWidth, h = tip.offsetHeight;
  tip.style.left = Math.min(innerWidth - w - 8, Math.max(8, cx + 14)) + "px";
  tip.style.top = Math.max(8, cy - h - 12) + "px";
}

function anHover(el, n, toIndex, xOf, rowsOf, opts){
  const svg = el.querySelector("svg"); let cur = -1;
  const set = (i, cx, cy) => {
    i = Math.max(0, Math.min(n - 1, i)); cur = i;
    if(opts.bars) svg.querySelectorAll(".an-bar").forEach(b => b.classList.toggle("hot", +b.dataset.i === i));
    if(opts.cross){ const l = svg.querySelector(".an-cross"); l.setAttribute("x1", xOf(i)); l.setAttribute("x2", xOf(i)); l.setAttribute("visibility", "visible"); }
    const r = svg.getBoundingClientRect();
    anTip(rowsOf(i), cx ?? r.left + xOf(i), cy ?? r.top + 40);
  };
  const clear = () => { cur = -1; anTip(null); svg.querySelectorAll(".an-bar.hot").forEach(b => b.classList.remove("hot")); svg.querySelector(".an-cross")?.setAttribute("visibility", "hidden"); };
  svg.addEventListener("pointermove", e => { const r = svg.getBoundingClientRect(); set(toIndex(e.clientX - r.left), e.clientX, e.clientY); });
  svg.addEventListener("pointerleave", clear);
  svg.addEventListener("blur", clear);
  svg.addEventListener("focus", () => set(n - 1));
  svg.addEventListener("keydown", e => { if(e.key === "ArrowLeft" || e.key === "ArrowRight"){ e.preventDefault(); set((cur < 0 ? n - 1 : cur) + (e.key === "ArrowLeft" ? -1 : 1)); } });
}

let anResizeT;
window.addEventListener("resize", () => { clearTimeout(anResizeT); anResizeT = setTimeout(() => { if($("#anBody")) drawAnalytics(); }, 150); });
