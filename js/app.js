/* =====================================================================
   369X APP: pages, router and button actions.
   Pages are plain functions that return HTML strings. Buttons use
   data-act="name" and are handled in ACTIONS at the bottom.
   ===================================================================== */
let ACC = null;                                   // current account (balances etc.)
const mState = { cat: "All", q: "", status: "live", sort: "volume" };
const tState = { side: "YES", margin: 50, lev: 1, m: null };
const vState = { lock: "flex", stakeTab: "stake", lb: "profit" };
let pollT;

const refBy = () => store.get("refBy", null);
const S = () => CONFIG.STABLE, T = () => "$" + CONFIG.TOKEN;

/* ---------- shared pieces ---------- */
function connectPrompt(msg){
  return `<section class="page-head"><div class="wrap"><div class="panel empty" style="margin-top:12px">${esc(msg)}<br><button class="btn btn-grad" data-act="connect">Connect wallet</button></div></div></section>`;
}
function head(title, lede, right = ""){
  return `<div class="sec-head" style="margin-bottom:22px"><div><h1 class="h2">${title}</h1>${lede ? `<p class="lede">${lede}</p>` : ""}</div>${right}</div>`;
}
function statusTag(m){ return `<span class="status ${esc(m.status)}">${m.status === "resolved" ? "Resolved " + esc(m.outcome) : esc(m.status)}</span>`; }
const mHref = (id, q = "") => "#/market/" + encodeURIComponent(id) + q;

function marketCard(m){
  const id = m.id, p = m.p;
  const action = m.status === "live"
    ? `<div class="yn"><a class="yes" href="${mHref(id, "?side=YES")}"><span>Yes</span><span class="num">${cents(p)}</span></a><a class="no" href="${mHref(id, "?side=NO")}"><span>No</span><span class="num">${cents(1 - p)}</span></a></div>`
    : `<div style="margin-top:16px">${statusTag(m)}</div>`;
  return `<article class="mcard">
    <div class="mhead"><div class="micon" aria-hidden="true">${esc(m.icon)}</div><div><a class="mq stretch" href="${mHref(id)}">${esc(m.q)}</a><div class="mcat">${esc(m.cat)} · ${m.status === "live" ? "Ends" : "Ended"} ${fmtDate(m.ends)}${m.status === "live" && m.maxLev > 1 ? `<span class="lev-badge">${m.maxLev}×</span>` : ""}</div></div></div>
    <div class="mprob"><b class="num">${pct(p)}</b><span>chance of YES</span></div>
    <div class="bar"><i style="width:${(p * 100).toFixed(1)}%"></i></div>
    ${action}
    <div class="mfoot"><span class="num">${compact(m.vol)} volume</span><span class="num">${num(m.traders)} traders</span></div>
  </article>`;
}
function lineChart(hist){
  const pts = hist.map(h => h[1]); if(pts.length < 2) pts.unshift(pts[0] ?? .5);
  const W = 600, H = 200, pad = 6, n = pts.length;
  const x = i => pad + (i / (n - 1)) * (W - pad * 2), y = v => H - pad - v * (H - pad * 2);
  const d = pts.map((v, i) => (i ? "L" : "M") + x(i).toFixed(1) + " " + y(v).toFixed(1)).join(" ");
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="YES price history">
    <defs><linearGradient id="lg" x1="0" x2="1"><stop offset="0" stop-color="#7cf26a"/><stop offset="1" stop-color="#5fd6f2"/></linearGradient>
    <linearGradient id="la" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#6fe6c0" stop-opacity=".22"/><stop offset="1" stop-color="#6fe6c0" stop-opacity="0"/></linearGradient></defs>
    ${[.25, .5, .75].map(g => `<line x1="0" x2="${W}" y1="${y(g)}" y2="${y(g)}" stroke="rgba(255,255,255,.06)" stroke-dasharray="3 5"/><text x="${W - 4}" y="${y(g) - 4}" fill="rgba(255,255,255,.3)" font-size="14" text-anchor="end">${g * 100}%</text>`).join("")}
    <path d="${d} L${x(n - 1)} ${H} L${x(0)} ${H} Z" fill="url(#la)"/><path d="${d}" fill="none" stroke="url(#lg)" stroke-width="2.5" stroke-linejoin="round"/>
    <circle cx="${x(n - 1)}" cy="${y(pts[n - 1])}" r="5" fill="#5fd6f2"/></svg>`;
}
function tierRows(vol){
  let cur = CONFIG.REF_TIERS[0]; CONFIG.REF_TIERS.forEach(t => { if(vol !== null && vol >= t.min) cur = t; });
  return CONFIG.REF_TIERS.map(t => `<div class="tier ${vol !== null && t === cur ? "cur" : ""}"><div><strong>${t.name}</strong><small>${t.min ? compact(t.min) + "+ referred volume" : "Everyone starts here"}</small></div><b class="num">${pct(t.rate)}</b></div>`).join("");
}

/* ---------- header / wallet ---------- */
function renderNav(){
  const a = wallet.address, slot = $("#walletSlot");
  if(!a){ slot.innerHTML = `<button class="btn btn-grad btn-sm" data-act="connect">Connect wallet</button>`; return; }
  const bal = ACC ? `<a class="bal-pill" href="#/portfolio"><b class="num">${num(ACC.stable, 2)}</b> ${S()}</a>` : "";
  const net = wallet.wrongChain ? `<button class="btn btn-sm net-warn" data-act="switchChain">Wrong network</button>` : "";
  slot.innerHTML = `${net}${bal}
    <details class="wallet-menu"><summary class="btn btn-ghost btn-sm addr-pill"><span class="addr-dot"></span><span class="num">${short(a)}</span></summary>
      <div class="menu right">
        <div class="bal-row"><span>${S()}</span><b class="num">${ACC ? num(ACC.stable, 2) : "…"}</b></div>
        <div class="bal-row"><span>${T()}</span><b class="num">${ACC ? num(ACC.token) : "…"}</b></div>
        <div class="bal-row"><span>Network</span><b>${wallet.kind === "demo" ? "Demo wallet" : esc(CONFIG.CHAIN.chainName)}</b></div>
        ${wallet.kind === "injected" ? `<div class="bal-row"><span>Wallet app</span><b>${esc(wallet.name)}</b></div>` : ""}
        <div class="sep"></div>
        <button data-act="faucet">💧 Get test funds</button>
        <a href="#/portfolio">📊 Portfolio</a>
        <button data-act="copyAddr">📋 Copy address</button>
        ${CHAIN_ON ? `<a href="${CONFIG.CHAIN.blockExplorerUrls[0]}/address/${esc(a)}" target="_blank" rel="noopener">🔎 View on BscScan</a>` : ""}
        <button data-act="disconnect">⏏ Disconnect</button>
      </div></details>`;
}
async function refreshAccount(){ ACC = wallet.address ? await api.getAccount(wallet.address).catch(() => null) : null; renderNav(); }
async function onWalletChange(){ await refreshAccount(); route(); }

function captureRef(){
  const read = (s) => { const m = s.match(/[?&]ref=([A-Za-z0-9_-]{2,24})/); return m ? m[1] : null; };
  const ref = read(location.search) || read(location.hash);
  if(ref && !refBy()){ store.set("refBy", ref); api.trackClick(ref); }
  const by = refBy();
  $("#refBanner").innerHTML = by ? `<div class="ref-banner"><div class="wrap"><span class="addr-dot"></span><span>Invited by <b>${esc(by)}</b>. You pay ${pct(CONFIG.REF_DISCOUNT)} less in trading fees.</span></div></div>` : "";
  $("#demoBanner").innerHTML = CONFIG.USE_MOCK
    ? `<div class="demo-banner"><div class="wrap"><b>Testnet demo</b><span>Prices, balances and payouts use test money and are saved only in this browser.</span><button data-act="resetDemo">Reset demo</button></div></div>`
    : CHAIN_ON
      ? `<div class="demo-banner"><div class="wrap"><b>BNB Smart Chain Testnet</b><span>Trades are real on-chain transactions using free test tokens. You need a little free tBNB for network fees.</span><a href="https://www.bnbchain.org/en/testnet-faucet" target="_blank" rel="noopener" style="color:var(--lime);font-weight:600">Get tBNB</a></div></div>`
      : `<div class="demo-banner"><div class="wrap"><b>Testnet</b><span>Balances are free test money with no real value. Get some from the faucet in the wallet menu.</span></div></div>`;
}


/* features that aren't on-chain yet */
function chainSoon(title, text){
  return `<section class="page-head"><div class="wrap">${head(title, "")}
    <div class="panel pad" style="max-width:720px"><div class="eyebrow">Coming to testnet soon</div>
    <p class="lede" style="margin-top:14px">${text}</p>
    <div class="hero-cta"><a class="btn btn-grad" href="#/markets">Trade live markets</a><a class="btn btn-ghost" href="#/docs">How it will work</a></div></div>
  </div></section>`;
}

/* =====================================================================
   PAGES
   ===================================================================== */
async function pageHome(){
  const all = await api.getMarkets({ status: "all" }), live = all.filter(m => m.status === "live");
  const trending = await api.getMarkets({ sort: "trending" });
  const f = [...live].sort((a, b) => b.vol - a.vol)[0] || all[0];
  const vault = await api.getVault();
  return `
  <section class="hero"><div class="wrap hero-grid">
    <div>
      <h1><span id="scr1">Predict.</span><span id="scr2">Participate.</span><span class="g">Prosper.</span></h1>
      <p class="lede">Trade YES or NO on crypto, sports, politics and world events. Create your own markets and earn from every trade, or put your ${S()} to work in the vault.</p>
      <div class="hero-cta"><a class="btn btn-grad" href="#/markets">Start trading</a><a class="btn btn-ghost" href="#/create">Create a market</a></div>
      <div class="hero-stats">
        <div><b class="num">${compact(all.reduce((a, m) => a + m.vol, 0))}</b><small>Volume traded</small></div>
        <div><b class="num">${compact(vault.tvl)}</b><small>${CHAIN_ON && !CONFIG.CONTRACTS.vault ? "Protocol reserve" : "Vault liquidity"}</small></div>
        <div><b class="num">${live.length}</b><small>Live markets</small></div>
      </div>
    </div>
    <div class="stage" aria-label="Featured market">
      <div class="ring r1"></div><div class="ring r2"></div><div class="ring r3"></div>
      <div class="float-chip fc1"><span class="av"></span><span>${f.feed[0] ? short(f.feed[0].addr).slice(0, 6) + " bought <b>" + esc(f.feed[0].side) + "</b>" : "Create a market, earn <b>0.5%</b>"}</span></div>
      <div class="float-chip fc2">Creator earned <b class="num">+${money(f.creatorEarned)}</b></div>
      <div class="dial-card">
        <div class="dial-top"><span class="live">Live</span><span class="num">${compact(f.vol)} vol</span></div>
        <a class="dial-q" style="display:block" href="${mHref(f.id)}">${esc(f.q)}</a>
        <div class="dial">
          <svg viewBox="0 0 120 120"><defs><linearGradient id="dg" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stop-color="#7cf26a"/><stop offset="1" stop-color="#5fd6f2"/></linearGradient></defs>
            <circle cx="60" cy="60" r="50" fill="none" stroke="rgba(255,122,136,.22)" stroke-width="9"/>
            <circle id="dialArc" class="dial-arc" cx="60" cy="60" r="50" fill="none" stroke="url(#dg)" stroke-width="9" stroke-linecap="round" stroke-dasharray="314.16" stroke-dashoffset="314.16"/></svg>
          <div class="dial-center"><div><b id="dialVal" class="num">0%</b><small>chance of YES</small></div></div>
        </div>
        <div class="yn"><a class="yes" href="${mHref(f.id, "?side=YES")}"><span>Yes</span><span class="num" id="dialYes">${cents(f.p)}</span></a><a class="no" href="${mHref(f.id, "?side=NO")}"><span>No</span><span class="num" id="dialNo">${cents(1 - f.p)}</span></a></div>
      </div>
    </div>
  </div></section>

  <section class="section" style="padding-top:0"><div class="wrap">
    <div class="sec-head"><div><h2 class="h2">Trending now</h2><p class="lede">Where the money is moving right now.</p></div><a class="btn btn-ghost" href="#/markets">All markets</a></div>
    <div class="grid">${trending.slice(0, 6).map(marketCard).join("")}</div>
  </div></section>

  <section class="section"><div class="wrap">
    <div class="sec-head"><div><h2 class="h2">Four ways to earn</h2><p class="lede">One protocol, four roles. Pick one or do them all.</p></div></div>
    <div class="steps">
      <a class="step" href="#/markets"><span class="n">TRADE</span><h3>Call outcomes</h3><p>Buy YES or NO on any live market. Sell any time before the end. Leverage up to 10× is coming soon.</p></a>
      <a class="step" href="#/create"><span class="n">CREATE</span><h3>Launch a market, earn 0.5%</h3><p>Ask a clear question. We seed the liquidity, you keep 0.5% of every trade on it for life.</p></a>
      <a class="step" href="#/vault"><span class="n">PROVIDE</span><h3>Fund the vault</h3><p>Deposit ${S()} into the protocol vault. Earn ${pct(CONFIG.LP_SHARE)} of protocol fees and up to 8× points.</p></a>
      <a class="step" href="#/stake"><span class="n">STAKE</span><h3>Stake ${T()}</h3><p>Cut your fees by up to 50%, vote on outcomes and earn resolution rewards.</p></a>
    </div>
  </div></section>

  <section class="section" style="padding-top:0"><div class="wrap">
    <div class="sec-head"><div><h2 class="h2">How a trade works</h2><p class="lede">Every share pays $1 if your side is right and $0 if it isn't. The price is the crowd's odds.</p></div><a class="btn btn-ghost" href="#/docs">Read the docs</a></div>
    <div class="steps">
      <div class="step"><span class="n">1</span><h3>Pick a question</h3><p>Choose any live market across crypto, sports, politics and more.</p></div>
      <div class="step"><span class="n">2</span><h3>Buy YES or NO</h3><p>A 64¢ YES means the crowd sees a 64% chance. Your buy moves the price.</p></div>
      <div class="step"><span class="n">3</span><h3>Sell or hold</h3><p>Close early as odds move, or hold until the result is in.</p></div>
      <div class="step"><span class="n">4</span><h3>Get paid</h3><p>${T()} stakers confirm the result. Each winning share pays $1.</p></div>
    </div>
  </div></section>

  <section class="section" style="padding-top:0"><div class="wrap">
    <div class="panel aff-tease">
      <div>
        <h2 class="h2">Earn from every trade your friends make</h2>
        <p class="lede">Share your link. You earn a share of the fees on everything your referrals trade, for as long as they trade, and they pay ${pct(CONFIG.REF_DISCOUNT)} less in fees.</p>
        <div class="hero-cta"><a class="btn btn-grad" href="#/affiliate">Open affiliate dashboard</a></div>
      </div>
      <div class="tiers">${tierRows(null)}</div>
    </div>
  </div></section>`;
}

/* ---------- markets list ---------- */
async function pageMarkets(){
  const sel = (k, opts) => opts.map(([v, l]) => `<option value="${v}" ${mState[k] === v ? "selected" : ""}>${l}</option>`).join("");
  return `<section class="page-head"><div class="wrap">
    ${head("Markets", "Every price is the crowd's current odds. Tap a market to trade.", `<a class="btn btn-grad" href="#/create">+ Create market</a>`)}
    <div class="toolbar">
      <div class="chips" role="tablist">${CATS.map(c => `<button class="chip ${c === mState.cat ? "on" : ""}" data-act="setCat" data-v="${c}">${c}</button>`).join("")}</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <select class="input" id="fStatus" style="height:42px;flex:none;border-radius:999px" aria-label="Status">${sel("status", [["live", "Live"], ["resolving", "Resolving"], ["resolved", "Resolved"], ["all", "All"]])}</select>
        <select class="input" id="fSort" style="height:42px;flex:none;border-radius:999px" aria-label="Sort">${sel("sort", [["volume", "Top volume"], ["trending", "Trending"], ["new", "Newest"], ["ending", "Ending soon"]])}</select>
        <label class="search"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><input id="q" placeholder="Search markets" value="${esc(mState.q)}" aria-label="Search markets"></label>
      </div>
    </div>
    <div class="grid" id="mgrid"></div>
  </div></section>`;
}
async function fillMarkets(){
  const list = await api.getMarkets({ category: mState.cat, q: mState.q, status: mState.status, sort: mState.sort });
  const g = $("#mgrid"); if(!g) return;
  g.innerHTML = list.length ? list.map(marketCard).join("") : `<div class="empty" style="grid-column:1/-1">No markets match. Try a different word, category or status.<br><a class="btn btn-ghost" href="#/create">Create this market</a></div>`;
}

/* ---------- single market ---------- */
async function pageMarket(id, query){
  let m; try{ m = await api.getMarket(id); }catch(e){ return `<section class="page-head"><div class="wrap"><div class="panel empty">That market doesn't exist.<br><a class="btn btn-ghost" href="#/markets">Back to markets</a></div></div></section>`; }
  tState.m = m; tState.side = query.get("side") === "NO" ? "NO" : (query.get("side") === "YES" ? "YES" : tState.side);
  tState.lev = Math.min(tState.lev, m.maxLev);
  const mine = (ACC?.positions || []).filter(p => p.marketId === m.id);
  const day = m.history.filter(h => h[0] > Date.now() - 864e5)[0]?.[1] ?? m.history[0][1];
  const ch = m.p - day;
  return `<section class="page-head"><div class="wrap">
    <div class="crumbs"><a href="#/markets">Markets</a> / ${esc(m.cat)}</div>
    <div class="mk-grid">
      <div>
        <div class="panel pad">
          <div class="mk-title"><div class="micon">${esc(m.icon)}</div><div><h1>${esc(m.q)}</h1>
            <div class="mk-meta">${statusTag(m)}<span>${esc(m.cat)}</span>·<span>${m.status === "live" ? "Ends" : "Ended"} ${fmtDate(m.ends)}</span>${m.maxLev > 1 ? `<span class="lev-badge">Up to ${m.maxLev}×</span>` : ""}</div></div></div>
          <div class="mprob"><b class="num" id="mkPrice">${pct(m.p)}</b><span class="num ${ch >= 0 ? "pos" : "neg"}" id="mkChange">${ch >= 0 ? "▲" : "▼"} ${(Math.abs(ch) * 100).toFixed(1)} pts today</span></div>
          <div class="chart" id="mkChart">${lineChart(m.history)}</div>
          <div class="kv4">
            <div><small>Volume</small><b class="num" id="mkVol">${compact(m.vol)}</b></div>
            <div title="Protocol-funded liquidity: the most the market maker can lose on this market"><small>Liquidity</small><b class="num">${compact(m.b * Math.LN2)}</b></div>
            <div><small>Traders</small><b class="num">${num(m.traders)}</b></div>
            <div><small>Creator</small><b class="num">${esc(m.creator.length > 14 ? short(m.creator) : m.creator)}</b></div>
          </div>
        </div>
        ${mine.length ? `<div class="panel pad" style="margin-top:16px"><h2 class="h3">Your positions</h2><div class="scroll-x">${positionsTable(mine, true)}</div></div>` : ""}
        <div class="panel pad rules" style="margin-top:16px">
          <h2 class="h3">Rules</h2>
          <p>${esc(m.rules)}</p>
          <p><b style="color:var(--text)">Resolution source:</b> ${esc(m.source)}</p>
          <p>After the end date, ${T()} stakers vote on the outcome. Winning shares pay $1. The creator earns ${pct(CONFIG.CREATOR_FEE, 1)} of every trade on this market.</p>
        </div>
        <div class="panel pad" style="margin-top:16px"><h2 class="h3">Activity</h2><div class="feed" id="mkFeed">${feedRows(m)}</div></div>
      </div>
      <div class="mk-side">${m.status === "live" ? `<div class="panel pad" id="tradeBox"></div>` : resolveBox(m)}</div>
    </div>
  </div></section>`;
}
function feedRows(m){
  return m.feed.length ? m.feed.slice(0, 12).map(f => `<div><span><span class="num">${esc(short(f.addr))}</span> ${f.buy === false ? "sold" : "bought"} <b class="${f.side === "YES" ? "y" : "n"}">${esc(f.side)}</b> at ${cents(f.price)}</span><span class="num">${money(f.amount)} · ${ago(f.ts)}</span></div>`).join("")
    : `<div><span>No trades yet. Be the first.</span></div>`;
}
// blockchain time when on-chain (contracts decide by block time), else this computer's clock
const nowMs = () => (typeof CHAIN_ON !== "undefined" && CHAIN_ON) ? Chain.now() : Date.now();
function chainVoteBox(m){
  const tot = m.votes.YES + m.votes.NO, my = ACC?.votes?.[m.id], open = nowMs() < (m.voteEnds || 0);
  const bar = `<div class="bar" style="margin-top:16px"><i style="width:${tot ? (m.votes.YES / tot * 100).toFixed(1) : 50}%"></i></div>
    <div class="mfoot"><span class="num">YES ${compactN(m.votes.YES)}${tot ? " (" + pct(m.votes.YES / tot) + ")" : ""}</span><span class="num">NO ${compactN(m.votes.NO)}</span></div>`;
  const admin = ACC?.isAdmin && m.status === "resolving" ? `<details style="margin-top:12px"><summary class="muted" style="cursor:pointer;font-size:13px">Admin: settle now without waiting</summary>
    <div class="yn"><button class="yes" data-act="finalize" data-id="${esc(m.id)}" data-outcome="YES"><span>Resolve YES</span></button><button class="no" data-act="finalize" data-id="${esc(m.id)}" data-outcome="NO"><span>Resolve NO</span></button></div></details>` : "";
  if(m.status === "resolved"){
    const won = my && my.side === m.outcome;
    return `<div class="panel pad"><h2 class="h3">Market resolved</h2>
      <b style="display:block;font-family:var(--display);font-size:40px;font-weight:500;margin-top:10px" class="${m.outcome === "YES" ? "pos" : "neg"}">${esc(m.outcome)}</b>
      <p class="muted">Winning shares pay 1 ${S()} each. Redeem them from your portfolio.</p>${tot ? bar : ""}
      ${my ? `<div class="info">You voted <b>${esc(my.side)}</b> with ${tok(my.weight)}.</div>` : ""}
      ${won && !m.finalized ? `<button class="btn btn-ghost" style="width:100%;margin-top:12px" data-act="finalize" data-id="${esc(m.id)}">Record result to unlock your reward</button>` : ""}
      ${won && m.finalized && !my.claimed ? `<button class="btn btn-grad" style="width:100%;margin-top:12px" data-act="claimVote" data-id="${esc(m.id)}">Claim ${tok(my.weight * 0.01)} reward</button>` : ""}
      ${won && my.claimed ? `<p class="side-note">Reward claimed.</p>` : ""}</div>`;
  }
  return `<div class="panel pad"><h2 class="h3">Vote on the result</h2>
    <p class="muted" style="margin-top:6px">Trading has ended. ${T()} stakers vote using <b>${esc(m.source)}</b>. ${open ? "Voting closes " + new Date(m.voteEnds).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) + "." : "Voting has closed."} Correct voters earn 1% of their stake.</p>
    ${bar}
    ${my ? `<div class="info">You voted <b>${esc(my.side)}</b> with ${tok(my.weight)}.</div>`
      : open ? (ACC?.staked > 0 ? `<div class="yn"><button class="yes" data-act="vote" data-id="${esc(m.id)}" data-side="YES"><span>Vote YES</span></button><button class="no" data-act="vote" data-id="${esc(m.id)}" data-side="NO"><span>Vote NO</span></button></div>`
        : `<div class="info"><a href="#/stake" style="color:var(--cyan)">Stake ${T()}</a> to vote on this result.</div>`) : ""}
    ${!open && tot > 0 ? `<button class="btn btn-grad" style="width:100%;margin-top:12px" data-act="finalize" data-id="${esc(m.id)}">Finalize result</button>` : ""}
    ${!open && tot === 0 ? `<p class="side-note">Nobody voted. The admin will settle this market.</p>` : ""}
    ${admin}
  </div>`;
}
function resolveBox(m){
  if(CHAIN_ON && CONFIG.CONTRACTS.staking) return chainVoteBox(m);
  const tot = m.votes.YES + m.votes.NO || 1, myVote = ACC?.votes?.[m.id];
  if(m.status === "resolved") return `<div class="panel pad"><h2 class="h3">Market resolved</h2>
    <b style="display:block;font-family:var(--display);font-size:40px;font-weight:500;margin-top:10px" class="${m.outcome === "YES" ? "pos" : "neg"}">${esc(m.outcome)}</b>
    <p class="muted">${CHAIN_ON ? `Winning shares pay 1 ${S()} each. Redeem them from your portfolio.` : "Winning shares paid $1 each. Open positions settle automatically in your portfolio."}</p>
    <div class="bar" style="margin-top:16px"><i style="width:${(m.votes.YES / tot * 100).toFixed(1)}%"></i></div>
    <div class="mfoot"><span>YES ${pct(m.votes.YES / tot)}</span><span>NO ${pct(m.votes.NO / tot)}</span></div></div>`;
  if(CHAIN_ON) return `<div class="panel pad"><h2 class="h3">Awaiting resolution</h2>
    <p class="muted" style="margin-top:6px">Trading has ended. The result will be set on-chain using <b>${esc(m.source)}</b>. Winning shares then pay 1 ${S()} each.</p>
    ${ACC?.isAdmin ? `<div class="info">You're the admin. Set the result:</div><div class="yn"><button class="yes" data-act="finalize" data-id="${esc(m.id)}" data-outcome="YES"><span>Resolve YES</span></button><button class="no" data-act="finalize" data-id="${esc(m.id)}" data-outcome="NO"><span>Resolve NO</span></button></div>` : ""}
  </div>`;
  return `<div class="panel pad"><h2 class="h3">Awaiting resolution</h2>
    <p class="muted" style="margin-top:6px">Trading has ended. ${T()} stakers vote on the outcome using <b>${esc(m.source)}</b>. Voters on the correct side earn rewards.</p>
    <div class="bar" style="margin-top:16px"><i style="width:${(m.votes.YES / tot * 100).toFixed(1)}%"></i></div>
    <div class="mfoot"><span class="num">YES ${compactN(m.votes.YES)} (${pct(m.votes.YES / tot)})</span><span class="num">NO ${compactN(m.votes.NO)}</span></div>
    ${myVote ? `<div class="info">You voted <b>${esc(myVote.side)}</b> with ${tok(myVote.weight)}.</div>` : `<div class="yn"><button class="yes" data-act="vote" data-id="${esc(m.id)}" data-side="YES"><span>Vote YES</span></button><button class="no" data-act="vote" data-id="${esc(m.id)}" data-side="NO"><span>Vote NO</span></button></div>`}
    <button class="btn btn-ghost" style="width:100%;margin-top:12px" data-act="finalize" data-id="${esc(m.id)}">${CONFIG.USE_MOCK ? "Finalize now (demo)" : "Finalize result"}</button>
  </div>`;
}

function renderTrade(){
  const box = $("#tradeBox"); if(!box) return;
  const { m, side, margin, lev } = tState;
  box.innerHTML = `
    <div class="side-tabs" role="tablist">
      <button class="y ${side === "YES" ? "on" : ""}" data-act="side" data-v="YES">Yes ${cents(m.p)}</button>
      <button class="n ${side === "NO" ? "on" : ""}" data-act="side" data-v="NO">No ${cents(1 - m.p)}</button>
    </div>
    <div class="field"><label for="amt" style="display:flex;justify-content:space-between"><span>Amount (${S()})</span><span class="num">Balance ${ACC ? num(ACC.stable, 2) : "0.00"}</span></label>
      <input class="input num" id="amt" type="number" min="1" step="any" inputmode="decimal" value="${margin}"></div>
    <div class="amt-quick">${[10, 50, 100, 500].map(v => `<button data-act="quick" data-v="${v}">$${v}</button>`).join("")}<button data-act="quick" data-v="max">Max</button></div>
    ${!CONFIG.LEVERAGE_ENABLED ? `<a class="info" style="display:flex;justify-content:space-between;gap:8px" href="#/leverage"><span>Leverage up to 10×</span><b style="color:var(--cyan)">Coming soon →</b></a>` : `<div class="lev"><div class="lev-head"><span>Leverage</span><b class="num">${lev}×</b></div>
      <div class="lev-opts">${[1, 2, 3, 5, 10].map(L => `<button class="${L === lev ? "on" : ""}" data-act="lev" data-v="${L}" ${L > m.maxLev ? "disabled title='Unlocks at higher market volume'" : ""}>${L}×</button>`).join("")}</div></div>`}
    <div class="summary" id="summary"></div>
    <button class="btn btn-grad" style="width:100%;margin-top:18px;height:48px" id="buyBtn" data-act="buy"></button>
    <p class="side-note" id="tradeNote"></p>`;
  updateQuote();
}
function updateQuote(){
  const { m, side, margin, lev } = tState; if(!$("#summary")) return;
  const q = Engine.quote(m, ACC || Engine.blankUser(), side, margin, lev, refBy());
  const profit = q.shares - q.borrowed - margin;
  $("#summary").innerHTML = `
    ${lev > 1 ? `<div><span>Position size</span><b class="num">${money(q.size, 2)}</b></div><div><span>Borrowed from vault</span><b class="num">${money(q.borrowed, 2)}</b></div>` : ""}
    <div><span>Avg price</span><b class="num">${cents(q.avg)}</b></div>
    <div><span>Shares</span><b class="num">${num(q.shares, 2)}</b></div>
    <div><span>Fee (${pct(q.rate, 2)})</span><b class="num">${money(q.fee, 2)}</b></div>
    <div><span>Price impact</span><b class="num">${q.impact >= 0 ? "+" : ""}${(q.impact * 100).toFixed(2)} pts</b></div>
    ${lev > 1 ? `<div><span>Liquidated if ${side} falls to</span><b class="num neg">${cents(q.liq)}</b></div>` : ""}
    <div class="big"><span>Profit if ${side} wins</span><b class="num">${signed(profit)}</b></div>`;
  const b = $("#buyBtn");
  if(!wallet.address){ b.textContent = "Connect wallet"; b.dataset.act = "connect"; }
  else if(ACC && ACC.stable < margin){ b.textContent = ACC.stable < 1 ? "Get test funds" : "Not enough " + S(); b.dataset.act = ACC.stable < 1 ? "faucet" : "noop"; }
  else { b.textContent = `Buy ${side}${lev > 1 ? " · " + lev + "×" : ""}`; b.dataset.act = "buy"; }
  $("#tradeNote").innerHTML = lev > 1
    ? `<span style="color:#ffd88a">Leverage multiplies gains and losses. If the price hits the liquidation level you lose your ${money(margin, 2)}.</span>`
    : (refBy() ? `Referral discount applied: ${pct(CONFIG.REF_DISCOUNT)} off fees.` : "Prices update as others trade. You can sell before the market ends.");
}
async function refreshMarket(){
  if(!tState.m || !$("#mkChart")) return;
  const m = await api.getMarket(tState.m.id); tState.m = m;
  $("#mkPrice").textContent = pct(m.p); $("#mkChart").innerHTML = lineChart(m.history);
  $("#mkFeed").innerHTML = feedRows(m); $("#mkVol").textContent = compact(m.vol);
  const tabs = $$("#tradeBox .side-tabs button"); if(tabs.length){ tabs[0].textContent = "Yes " + cents(m.p); tabs[1].textContent = "No " + cents(1 - m.p); updateQuote(); }
}

/* ---------- positions table (portfolio + market page) ---------- */
function positionsTable(list, compactView){
  return `<table class="table"><thead><tr>${compactView ? "" : "<th>Market</th>"}<th>Side</th><th class="r">Size</th><th class="r">Avg → now</th><th class="r">Liq. price</th><th class="r">Value</th><th class="r">P&amp;L</th><th></th></tr></thead><tbody>
    ${list.map(p => `<tr>
      ${compactView ? "" : `<td style="min-width:220px;white-space:normal"><a href="${mHref(p.marketId)}">${esc(p.icon)} ${esc(p.q)}</a></td>`}
      <td><span class="tag ${p.side === "YES" ? "ok" : ""}" style="${p.side === "NO" ? "color:var(--no);background:rgba(255,122,136,.12)" : ""}">${esc(p.side)}</span>${p.lev > 1 ? `<span class="lev-badge">${p.lev}×</span>` : ""}</td>
      <td class="r num">${money(p.size, 2)}</td>
      <td class="r num">${cents(p.avg)} → ${cents(p.price)}</td>
      <td class="r num">${p.liq ? cents(p.liq) : "—"}</td>
      <td class="r num">${money(Math.max(0, p.equity), 2)}</td>
      <td class="r num ${p.pnl >= 0 ? "pos" : "neg"}">${signed(p.pnl)}</td>
      <td class="r">${p.status === "live" ? `<button class="btn btn-ghost btn-sm" data-act="close" data-id="${esc(p.id)}">${CHAIN_ON ? "Sell" : "Close"}</button>`
        : p.status === "resolved" && p.outcome === p.side ? `<button class="btn btn-grad btn-sm" data-act="redeem" data-id="${esc(p.marketId)}">Redeem</button>`
        : `<span class="muted" style="font-size:12px">Awaiting result</span>`}</td>
    </tr>`).join("")}</tbody></table>`;
}

/* ---------- create market ---------- */
async function pageCreate(){
  if(!wallet.address) return connectPrompt("Connect your wallet to create a market.");
  return `<section class="page-head"><div class="wrap">
    ${head("Create a market", `Ask a clear YES/NO question. The protocol seeds the liquidity, so you take no market-making risk, and you earn ${pct(CONFIG.CREATOR_FEE, 1)} of every trade on it.`)}
    <div class="two">
      <div class="panel pad">
        <div class="field" style="margin-top:0"><label for="cq">Question</label><textarea class="input" id="cq" maxlength="140" placeholder="Will ... happen by ...?"></textarea><small class="muted" style="font-size:12px">Start with "Will", end with "?". Be specific about the date and the number.</small></div>
        <div class="form-grid">
          <div class="field"><label for="ccat">Category</label><select class="input" id="ccat">${CATS.slice(1).map(c => `<option>${c}</option>`).join("")}</select></div>
          <div class="field"><label for="cend">End date</label><input class="input" id="cend" type="date" min="${addDays(1)}" value="${addDays(30)}"></div>
        </div>
        <div class="field"><label for="csrc">Resolution source</label><input class="input" id="csrc" placeholder="e.g. CoinGecko BTC/USD price, AP race call, official league site"></div>
        <div class="field"><label for="crules">Rules</label><textarea class="input" id="crules" placeholder="Resolves YES if ... Otherwise resolves NO."></textarea></div>
        <div class="field"><label for="cp" style="display:flex;justify-content:space-between"><span>Starting chance of YES</span><b class="num" id="cpv" style="color:var(--text)">50%</b></label><input id="cp" type="range" min="5" max="95" value="50"></div>
        <div class="info">Bond: <b>${tok(CONFIG.CREATE_BOND)}</b>, returned when the market resolves cleanly. Your balance: <b>${ACC ? tok(ACC.token) : "…"}</b>.</div>
        <div class="err" id="cerr"></div>
        <button class="btn btn-grad" style="width:100%;margin-top:6px;height:48px" data-act="createMarket">Create market</button>
      </div>
      <div><div class="panel pad"><h2 class="h3">Preview</h2><div id="cprev" style="margin-top:14px"></div></div>
        <div class="panel pad" style="margin-top:16px"><h2 class="h3">What makes a good market</h2>
          <ul class="muted" style="list-style:disc;padding-left:18px;margin-top:8px;display:grid;gap:6px">
            <li>One clear outcome that anyone can check.</li><li>An exact date and an exact number.</li><li>A public, trusted source for the answer.</li><li>No questions about private people or violence.</li>
          </ul></div></div>
    </div>
  </div></section>`;
}
function previewCreate(){
  const q = $("#cq")?.value.trim() || "Your question will appear here?", p = +$("#cp").value / 100;
  $("#cpv").textContent = pct(p);
  $("#cprev").innerHTML = marketCard({ id: "preview", q, cat: $("#ccat").value, icon: ICONS[$("#ccat").value], ends: $("#cend").value || addDays(30), p, vol: 0, traders: 0, status: "live", maxLev: 2 }).replace(/href="[^"]*"/g, 'href="#/create"');
}

/* ---------- portfolio ---------- */
async function pagePortfolio(){
  if(!wallet.address) return connectPrompt("Connect your wallet to see your positions.");
  const a = ACC; if(!a) return connectPrompt("Could not load your account.");
  const open = a.positions.reduce((s, p) => s + Math.max(0, p.equity), 0), unreal = a.positions.reduce((s, p) => s + p.pnl, 0);
  const canFaucet = Date.now() > a.faucetAt + CONFIG.FAUCET_COOLDOWN_H * 36e5;
  return `<section class="page-head"><div class="wrap">
    ${head("Portfolio", "", `<button class="btn ${canFaucet ? "btn-grad" : "btn-ghost"}" data-act="faucet">💧 ${canFaucet ? "Get test funds" : "Faucet used today"}</button>`)}
    <div class="stat-grid">
      <div class="panel stat"><small>Available ${S()}</small><b class="num">${money(a.stable, 2)}</b></div>
      <div class="panel stat"><small>Open positions value</small><b class="num">${money(open, 2)}</b></div>
      <div class="panel stat"><small>Total P&amp;L</small><b class="num ${a.pnl + unreal >= 0 ? "pos" : "neg"}">${signed(a.pnl + unreal)}</b><em>${signed(unreal)} unrealized</em></div>
      <div class="panel stat"><small>${T()} wallet / staked</small><b class="num">${compactN(a.token)} / ${compactN(a.staked)}</b></div>
    </div>
    <div class="panel" style="margin-top:16px"><div class="pad" style="padding-bottom:0"><h2 class="h3">Open positions</h2></div>
      ${a.positions.length ? `<div class="scroll-x">${positionsTable(a.positions)}</div>` : `<div class="empty">You have no open positions yet.<br><a class="btn btn-grad" href="#/markets">Find a market</a></div>`}</div>
    ${a.created.length ? `<div class="panel" style="margin-top:16px"><div class="pad" style="padding-bottom:0"><h2 class="h3">Markets you created</h2></div><div class="scroll-x"><table class="table">
      <thead><tr><th>Market</th><th>Status</th><th class="r">Volume</th><th class="r">You earned</th><th class="r">Bond</th></tr></thead>
      <tbody>${a.created.map(m => `<tr><td style="white-space:normal;min-width:220px"><a href="${mHref(m.id)}">${esc(m.q)}</a></td><td>${statusTag(m)}</td><td class="r num">${money(m.vol)}</td><td class="r num pos">+${money(m.creatorEarned, 2)}${m.creatorFeesUnclaimed > 0.0001 ? ` <button class="btn btn-ghost btn-sm" data-act="claimFees" data-id="${esc(m.id)}">Claim</button>` : ""}</td><td class="r num">${m.bond.returned ? "Returned" : tok(m.bond.amount)}</td></tr>`).join("")}</tbody></table></div></div>` : ""}
    <div class="panel" style="margin-top:16px"><div class="pad" style="padding-bottom:0"><h2 class="h3">History</h2></div>
      ${a.history.length ? `<div class="scroll-x"><table class="table"><thead><tr><th>Market</th><th>Side</th><th class="r">Staked</th><th class="r">Received</th><th class="r">Result</th><th class="r">When</th></tr></thead><tbody>
      ${a.history.slice(0, 50).map(h => `<tr><td style="white-space:normal;min-width:220px">${esc(h.icon)} ${esc(h.q)}</td><td>${esc(h.side)}${h.lev > 1 ? `<span class="lev-badge">${h.lev}×</span>` : ""}</td><td class="r num">${money(h.margin, 2)}</td><td class="r num">${money(h.received, 2)}</td><td class="r num ${h.received >= h.margin ? "pos" : "neg"}">${esc(h.how)} ${signed(h.received - h.margin)}</td><td class="r muted">${ago(h.closedAt)}</td></tr>`).join("")}
      </tbody></table></div>` : `<div class="empty">Closed and settled trades show up here.</div>`}</div>
  </div></section>`;
}

/* ---------- vault ---------- */
async function pageVault(){
  if(CHAIN_ON && !CONFIG.CONTRACTS.vault) return chainSoon("Liquidity vault", "The vault is being moved on-chain. You'll deposit test USDT, choose a lock period for up to 8× points, and earn 80% of protocol fees.");
  const v = await api.getVault(), a = ACC, L = CONFIG.LOCKS.find(x => x.id === vState.lock);
  vState.apy = v.apy;
  return `<section class="page-head"><div class="wrap">
    ${head("Liquidity vault", `Deposit ${S()} into the protocol vault. Depositors earn ${pct(CONFIG.LP_SHARE)} of protocol fees from every trade, and longer locks earn points faster.`)}
    <div class="stat-grid">
      <div class="panel stat"><small>Total deposited</small><b class="num">${compact(v.tvl)}</b></div>
      <div class="panel stat"><small>${CHAIN_ON ? "Your deposits" : "Lent to traders"}</small><b class="num">${CHAIN_ON ? money((a?.deposits || []).reduce((s, d) => s + d.amount, 0), 2) : pct(v.utilization, 1)}</b></div>
      <div class="panel stat"><small>Est. APY</small><b class="num pos">${pct(v.apy, 1)}</b></div>
      <div class="panel stat"><small>Fees paid to depositors</small><b class="num">${compact(v.fees)}</b></div>
    </div>
    <div class="two">
      <div class="panel pad">
        <h2 class="h3">Deposit</h2>
        ${!wallet.address ? `<p class="muted" style="margin-top:6px">Connect a wallet to deposit.</p><button class="btn btn-grad" style="margin-top:14px" data-act="connect">Connect wallet</button>` : `
        <div class="field"><label for="vamt" style="display:flex;justify-content:space-between"><span>Amount (${S()})</span><span class="num">Balance ${num(a?.stable || 0, 2)}</span></label><input class="input num" id="vamt" type="number" min="1" step="any" value="100"></div>
        <div class="field"><label>Lock period</label><div class="lock-opts">${CONFIG.LOCKS.map(x => `<button class="${x.id === vState.lock ? "on" : ""}" data-act="lock" data-v="${x.id}"><b>${x.mult}×</b><small>${x.label}</small></button>`).join("")}</div></div>
        <div class="summary" id="vsum"></div>
        <button class="btn btn-grad" style="width:100%;margin-top:18px;height:48px" data-act="deposit">Deposit</button>
        <p class="side-note">${L.days ? `Locked deposits can't be withdrawn until the unlock date.` : "Flex deposits can be withdrawn any time, as long as the vault isn't fully lent out."}</p>`}
      </div>
      <div class="panel pad">
        <h2 class="h3">Your deposits</h2>
        ${a && a.deposits.length ? `<div class="feed" style="margin-top:8px">${a.deposits.map(d => `<div><span><b style="color:var(--text)" class="num">${money(d.amount, 2)}</b> · ${CONFIG.LOCKS.find(x => x.id === d.lock).label} · ${d.mult}× points<br><small class="muted">${d.unlock > nowMs() ? "Unlocks " + fmtDate(new Date(d.unlock).toISOString()) : "Unlocked"}${d.earned != null ? ` · earned <b class="pos num">${money(d.earned, 4)}</b>` : ""}</small></span>
          <span style="display:flex;gap:6px">${CHAIN_ON && d.earned > 0.0001 ? `<button class="btn btn-ghost btn-sm" data-act="claimVault" data-id="${esc(d.id)}">Claim</button>` : ""}<button class="btn btn-ghost btn-sm" data-act="withdraw" data-id="${esc(d.id)}" ${d.unlock > nowMs() ? "disabled style='opacity:.4'" : ""}>Withdraw</button></span></div>`).join("")}</div>` : `<p class="muted" style="margin-top:6px">No deposits yet.</p>`}
        <div class="info">Today the vault earns a share of every trading fee. When leverage launches, it will also lend to leveraged traders, who are closed out before their losses reach the vault. Deposits can still lose money in extreme moves.</div>
      </div>
    </div>
  </div></section>`;
}
function updateVaultSum(){
  const el = $("#vsum"); if(!el) return;
  const amt = Math.max(0, +$("#vamt").value || 0), L = CONFIG.LOCKS.find(x => x.id === vState.lock);
  el.innerHTML = `<div><span>Points per day</span><b class="num">${num(amt * L.mult)}</b></div>
    <div><span>Est. yearly earnings</span><b class="num">${money(amt * (vState.apy ?? CONFIG.VAULT_APY_HINT), 2)}</b></div>
    <div><span>Unlocks</span><b>${L.days ? fmtDate(addDays(L.days)) : "Any time"}</b></div>`;
}

/* ---------- stake ---------- */
async function pageStakeChain(){
  const a = ACC, isStake = vState.stakeTab === "stake", locked = a && a.lockedUntil > nowMs();
  return `<section class="page-head"><div class="wrap">
    ${head("Stake " + T(), `Stakers earn ${pct(1 - CONFIG.LP_SHARE)} of protocol fees in ${S()}, vote on how markets resolve, and earn ${T()} for voting with the final outcome.`, `<a class="btn btn-ghost" href="#/resolve">Resolution queue</a>`)}
    <div class="stat-grid">
      <div class="panel stat"><small>You have staked</small><b class="num">${a ? num(a.staked) : "0"}</b><em>${locked ? "Locked until " + fmtDate(new Date(a.lockedUntil).toISOString()) : ""}</em></div>
      <div class="panel stat"><small>In your wallet</small><b class="num">${a ? num(a.token) : "0"}</b></div>
      <div class="panel stat"><small>Fees earned</small><b class="num pos">${a ? money(a.stakeFees || 0, 4) : "$0"}</b>${a && a.stakeFees > 0.0001 ? `<button class="btn btn-ghost btn-sm" style="margin-top:8px" data-act="claimStakeFees">Claim</button>` : ""}</div>
      <div class="panel stat"><small>Voting power</small><b class="num">${a ? compactN(a.staked) : "0"}</b></div>
    </div>
    <div class="two">
      <div class="panel pad">
        <div class="tabs"><button class="${isStake ? "on" : ""}" data-act="stakeTab" data-v="stake">Stake</button><button class="${!isStake ? "on" : ""}" data-act="stakeTab" data-v="unstake">Unstake</button></div>
        ${!wallet.address ? `<button class="btn btn-grad" data-act="connect">Connect wallet</button>` : `
        <div class="field" style="margin-top:0"><label for="samt" style="display:flex;justify-content:space-between"><span>Amount (${T()})</span><span class="num">${isStake ? "Wallet " + num(a.token) : "Staked " + num(a.staked)}</span></label>
          <div class="field-row"><input class="input num" id="samt" type="number" min="1" step="any" value=""><button class="btn btn-ghost" data-act="stakeMax">Max</button></div></div>
        <button class="btn btn-grad" style="width:100%;margin-top:16px;height:48px" data-act="${isStake ? "stake" : "unstake"}" ${!isStake && locked ? "disabled style='opacity:.45'" : ""}>${isStake ? "Stake" : "Unstake"}</button>
        ${!isStake && locked ? `<p class="side-note">You voted on a market, so your stake is locked until its voting closes.</p>` : ""}
        ${a.token < 1 && a.staked < 1 ? `<div class="info">No ${T()} yet? <button style="color:var(--lime);font-weight:600" data-act="faucet">Get test tokens</button></div>` : ""}`}
      </div>
      <div class="panel pad"><h2 class="h3">What staking does</h2><div class="feed" style="margin-top:8px">
        <div><span>💸 Share of protocol fees</span><b>${pct(1 - CONFIG.LP_SHARE)}, in ${S()}</b></div>
        <div><span>🛡 Vote on market results</span><b>1 token = 1 vote</b></div>
        <div><span>🎯 Reward for correct votes</span><b>1% of your stake</b></div>
        <div><span>🏷 Trading fee discounts</span><b class="muted">Next market upgrade</b></div>
      </div><p class="side-note">After you vote, your stake stays locked until that market's voting closes, so nobody can vote twice with the same tokens.</p></div>
    </div>
  </div></section>`;
}

async function pageStake(){
  if(CHAIN_ON && CONFIG.CONTRACTS.staking) return pageStakeChain();
  if(CHAIN_ON && !CONFIG.CONTRACTS.staking) return chainSoon("Stake $369X", "Staking is being moved on-chain. You'll stake test $369X for fee discounts of up to 50% and vote on how markets resolve.");
  const a = ACC, tier = a ? a.stakeTier : CONFIG.STAKE_TIERS[0];
  const next = CONFIG.STAKE_TIERS[CONFIG.STAKE_TIERS.indexOf(tier) + 1];
  const prog = next ? Math.min(100, ((a?.staked || 0) - tier.min) / (next.min - tier.min) * 100) : 100;
  const isStake = vState.stakeTab === "stake";
  return `<section class="page-head"><div class="wrap">
    ${head("Stake " + T(), "Stake to pay lower fees, vote on how markets resolve, and earn rewards when you vote with the correct outcome.", `<a class="btn btn-ghost" href="#/resolve">Resolution queue</a>`)}
    <div class="stat-grid">
      <div class="panel stat"><small>You have staked</small><b class="num">${a ? num(a.staked) : "0"}</b></div>
      <div class="panel stat"><small>In your wallet</small><b class="num">${a ? num(a.token) : "0"}</b></div>
      <div class="panel stat"><small>Your fee discount</small><b class="num pos">${pct(tier.discount)}</b><em>${esc(tier.name)} tier</em></div>
      <div class="panel stat"><small>Voting power</small><b class="num">${a ? compactN(a.staked) : "0"}</b></div>
    </div>
    <div class="two">
      <div class="panel pad">
        <div class="tabs"><button class="${isStake ? "on" : ""}" data-act="stakeTab" data-v="stake">Stake</button><button class="${!isStake ? "on" : ""}" data-act="stakeTab" data-v="unstake">Unstake</button></div>
        ${!wallet.address ? `<button class="btn btn-grad" data-act="connect">Connect wallet</button>` : `
        <div class="field" style="margin-top:0"><label for="samt" style="display:flex;justify-content:space-between"><span>Amount (${T()})</span><span class="num">${isStake ? "Wallet " + num(a.token) : "Staked " + num(a.staked)}</span></label>
          <div class="field-row"><input class="input num" id="samt" type="number" min="1" step="any" value=""><button class="btn btn-ghost" data-act="stakeMax">Max</button></div></div>
        <button class="btn btn-grad" style="width:100%;margin-top:16px;height:48px" data-act="${isStake ? "stake" : "unstake"}">${isStake ? "Stake" : "Unstake"}</button>
        <div style="margin-top:22px"><div style="display:flex;justify-content:space-between;font-size:13px"><span class="muted">${next ? `Progress to ${next.name} (${pct(next.discount)} off fees)` : "Top tier reached"}</span><span class="num muted">${next ? compactN(a.staked) + " / " + compactN(next.min) : ""}</span></div><div class="progress"><i style="width:${prog}%"></i></div></div>
        ${a.token < 1 && a.staked < 1 ? `<div class="info">No ${T()} yet? <button style="color:var(--lime);font-weight:600" data-act="faucet">Get test tokens</button></div>` : ""}`}
      </div>
      <div class="panel pad"><h2 class="h3">Fee discount tiers</h2><div class="tiers" style="margin-top:14px">
        ${CONFIG.STAKE_TIERS.map(t => `<div class="tier ${t === tier && a ? "cur" : ""}"><div><strong>${t.name}</strong><small>${t.min ? num(t.min) + " " + T() + " staked" : "No stake"}</small></div><b class="num">${pct(t.discount)}</b></div>`).join("")}
      </div><p class="side-note">Stacks with the ${pct(CONFIG.REF_DISCOUNT)} referral discount, up to 60% off in total.</p></div>
    </div>
  </div></section>`;
}

/* ---------- resolution ---------- */
async function pageResolve(){
  const pending = await api.getMarkets({ status: "resolving", sort: "ending" }), done = (await api.getMarkets({ status: "resolved", sort: "ending" })).reverse();
  return `<section class="page-head"><div class="wrap">
    ${head("Resolution", `When a market ends, ${T()} stakers vote on the result using its resolution source. Vote with the final outcome to earn rewards.`, `<a class="btn btn-ghost" href="#/stake">Stake to vote</a>`)}
    <h2 class="h3" style="margin-bottom:12px">Waiting for votes (${pending.length})</h2>
    <div class="grid">${pending.length ? pending.map(m => `<div>${resolveBox(m).replace(/<h2 class="h3">[^<]*<\/h2>/, `<a class="h3" style="display:block" href="${mHref(m.id)}">${esc(m.icon)} ${esc(m.q)}</a><div class="mcat">Ended ${fmtDate(m.ends)}</div>`)}</div>`).join("") : `<div class="panel empty" style="grid-column:1/-1">Nothing to resolve right now.</div>`}</div>
    <h2 class="h3" style="margin:32px 0 12px">Recently resolved</h2>
    <div class="grid">${done.slice(0, 6).map(marketCard).join("") || `<div class="panel empty" style="grid-column:1/-1">None yet.</div>`}</div>
  </div></section>`;
}

/* ---------- rewards ---------- */
async function pageRewards(){
  if(!wallet.address) return connectPrompt("Connect your wallet to see your points and badges.");
  const a = ACC, parts = Object.entries(a.points.parts), max = Math.max(1, ...parts.map(p => p[1]));
  return `<section class="page-head"><div class="wrap">
    ${head("Rewards", `Earn points by trading, providing liquidity, staking, creating markets and inviting friends. Points are planned to convert into ${T()} at launch.`)}
    <div class="two" style="margin-top:0">
      <div class="panel pad"><small class="muted">Your points</small>
        <b style="display:block;font-family:var(--display);font-weight:500;font-size:clamp(34px,4vw,52px);margin-top:6px" class="num">${num(a.points.total)}</b>
        <div style="display:grid;gap:10px;margin-top:20px">${parts.map(([k, v]) => `<div><div style="display:flex;justify-content:space-between;font-size:13px"><span class="muted">${k}</span><span class="num">${num(v)}</span></div><div class="progress" style="margin-top:6px"><i style="width:${(v / max * 100).toFixed(1)}%"></i></div></div>`).join("")}</div>
      </div>
      <div class="panel pad"><h2 class="h3">How to earn points</h2><div class="feed" style="margin-top:8px">
        <div><span>Trade</span><b>1 pt per $1 of size</b></div><div><span>Vault deposit</span><b>1–8 pts per $1 per day</b></div>
        <div><span>Stake ${T()}</span><b>0.1 pt per token per day</b></div><div><span>Create a market</span><b>1,000 pts</b></div>
        <div><span>Vote correctly</span><b>250 pts + 1% of stake</b></div><div><span>Referrals</span><b>10% of their volume</b></div><div><span>Each badge</span><b>500 pts</b></div>
      </div></div>
    </div>
    <div class="panel pad" style="margin-top:16px"><h2 class="h3">Badges (${a.badges.filter(b => b.got).length}/${a.badges.length})</h2>
      <div class="badges">${a.badges.map(b => `<div class="badge ${b.got ? "got" : ""}"><div class="ico">${b.ico}</div><b>${esc(b.name)}</b><small>${esc(b.desc)}</small></div>`).join("")}</div></div>
  </div></section>`;
}

/* ---------- leaderboard ---------- */
async function pageLeaderboard(){
  const by = vState.lb, rows = await api.getLeaderboard(by);
  const tab = (k, l) => `<button class="${by === k ? "on" : ""}" data-act="lb" data-v="${k}">${l}</button>`;
  return `<section class="page-head"><div class="wrap">
    ${head("Leaderboard", "Top traders this season.")}
    <div class="tabs">${tab("profit", "Profit")}${tab("volume", "Volume")}${tab("points", "Points")}</div>
    <div class="panel"><div class="scroll-x"><table class="table">
      <thead><tr><th>#</th><th>Trader</th><th class="r">Profit</th><th class="r">Volume</th><th class="r">Win rate</th><th class="r">Points</th></tr></thead>
      <tbody>${rows.length ? "" : `<tr><td colspan="6" class="empty">No trades yet this season. <a href="#/markets" style="color:var(--cyan)">Make the first one</a>.</td></tr>`}${rows.map((r, i) => `<tr style="${r.you ? "background:rgba(124,242,106,.06)" : ""}"><td class="rank ${i < 3 ? "top" : ""}">${i + 1}</td><td class="num">${esc(r.addr)}${r.you ? ` <span class="tag ok">You</span>` : ""}</td><td class="r num ${r.pnl >= 0 ? "pos" : "neg"}">${signed(r.pnl, 0)}</td><td class="r num">${compact(r.volume)}</td><td class="r num">${r.win}%</td><td class="r num">${num(r.points)}</td></tr>`).join("")}</tbody>
    </table></div></div>
  </div></section>`;
}

/* ---------- affiliate ---------- */
async function pageAffiliate(){
  if(CHAIN_ON) return chainSoon("Affiliate program", "Referral rewards are being moved on-chain. You'll earn up to 35% of the fees from everyone you invite, paid in test USDT.");
  if(!wallet.address) return `<section class="page-head"><div class="wrap">
    ${head("Affiliate program", `Earn up to 35% of the trading fees from everyone you invite. Your referrals get ${pct(CONFIG.REF_DISCOUNT)} off their fees.`)}
    <div class="panel aff-tease"><div><h3 class="h3">Connect a wallet to get your link</h3><p class="muted" style="margin-top:6px">Your earnings are tied to your wallet address and paid out in ${S()}.</p><div class="hero-cta"><button class="btn btn-grad" data-act="connect">Connect wallet</button></div></div><div class="tiers">${tierRows(null)}</div></div></div></section>`;
  const a = await api.getAffiliate(wallet.address);
  let tier = CONFIG.REF_TIERS[0]; CONFIG.REF_TIERS.forEach(t => { if(a.stats.volume >= t.min) tier = t; });
  const next = CONFIG.REF_TIERS[CONFIG.REF_TIERS.indexOf(tier) + 1];
  const prog = next ? Math.min(100, (a.stats.volume - tier.min) / (next.min - tier.min) * 100) : 100;
  const site = location.protocol.startsWith("http") ? location.origin : CONFIG.SITE_URL;
  const link = a.code ? `${site}/?ref=${a.code}` : "";
  const max = Math.max(0.01, ...a.earnings);
  const days = a.earnings.map((_, i) => { const d = new Date(); d.setDate(d.getDate() - (a.earnings.length - 1 - i)); return d.getDate(); });
  const msg = `I'm calling outcomes on ${CONFIG.SITE_NAME}. Join with my link and pay ${pct(CONFIG.REF_DISCOUNT)} less in fees: `;
  return `<section class="page-head"><div class="wrap">
    ${head("Affiliate dashboard", `You're on the <b style="color:var(--text)">${tier.name}</b> tier, earning ${pct(tier.rate)} of fees from direct referrals and 5% from theirs.`)}
    <div class="stat-grid">
      <div class="panel stat"><small>Link clicks</small><b class="num">${num(a.stats.clicks)}</b></div>
      <div class="panel stat"><small>Referred traders</small><b class="num">${a.stats.signups}</b></div>
      <div class="panel stat"><small>Referred volume</small><b class="num">${money(a.stats.volume)}</b></div>
      <div class="panel stat"><small>Total earned</small><b class="num">${money(a.stats.earned, 2)}</b></div>
    </div>
    <div class="aff-top">
      <div class="panel pad">
        <h2 class="h3">Your referral link</h2>
        ${a.code ? `<div class="linkbox"><code class="num">${esc(link)}</code><button class="btn btn-grad btn-sm" data-act="copy" data-v="${esc(link)}">Copy link</button></div>
          <div class="share">
            <a class="btn btn-ghost btn-sm" target="_blank" rel="noopener" href="https://x.com/intent/tweet?text=${encodeURIComponent(msg + link)}">Share on X</a>
            <a class="btn btn-ghost btn-sm" target="_blank" rel="noopener" href="https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent("Trade predictions on " + CONFIG.SITE_NAME)}">Share on Telegram</a>
            <a class="btn btn-ghost btn-sm" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(msg + link)}">Share on WhatsApp</a>
          </div>` : `<p class="muted" style="margin-top:6px">Pick a short code. It becomes your link, like ${esc(site.replace(/^https?:\/\//, ""))}/?ref=yourname</p>`}
        <div class="field"><label for="code">${a.code ? "Change your code" : "Referral code"}</label>
          <div class="field-row"><input class="input" id="code" maxlength="20" placeholder="yourname" value="${esc(a.code || "")}" autocomplete="off"><button class="btn btn-ghost" data-act="saveCode">${a.code ? "Update" : "Create link"}</button></div>
          <small id="codeErr" class="err"></small></div>
      </div>
      <div class="panel pad">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:10px"><h2 class="h3">Ready to claim</h2><span class="tag cy">${S()}</span></div>
        <b style="display:block;font-family:var(--display);font-weight:500;font-size:clamp(30px,3.4vw,42px);margin-top:10px" class="num">${money(a.stats.claimable, 2)}</b>
        <button class="btn btn-grad" style="width:100%;margin-top:16px;${a.stats.claimable <= 0 ? "opacity:.45;cursor:not-allowed" : ""}" data-act="claimRef" ${a.stats.claimable <= 0 ? "disabled" : ""}>Claim earnings</button>
        <div style="margin-top:22px"><div style="display:flex;justify-content:space-between;font-size:13px"><span class="muted">${next ? `Progress to ${next.name} (${pct(next.rate)})` : "Top tier reached"}</span><span class="num muted">${next ? money(a.stats.volume) + " / " + compact(next.min) : ""}</span></div><div class="progress"><i style="width:${prog}%"></i></div></div>
      </div>
    </div>
    <div class="aff-top">
      <div class="panel pad"><h2 class="h3">Daily earnings</h2><p class="muted">Last 14 days</p>
        <div class="bars">${a.earnings.map(e => `<div style="height:${(e / max) * 100}%" title="${money(e, 2)}"></div>`).join("")}</div>
        <div class="bars-x">${days.map(d => `<span>${d}</span>`).join("")}</div></div>
      <div class="panel pad"><h2 class="h3">Commission tiers</h2><p class="muted">Based on total referred volume</p><div class="tiers" style="margin-top:14px">${tierRows(a.stats.volume)}</div></div>
    </div>
    <div class="panel" style="margin-top:16px"><div class="pad" style="padding-bottom:0"><h2 class="h3">Your referrals</h2></div>
      <div class="scroll-x"><table class="table" style="margin-top:8px"><thead><tr><th>Wallet</th><th>Level</th><th>Joined</th><th class="r">Volume</th><th class="r">You earned</th></tr></thead>
        <tbody>${a.referrals.map(r => `<tr><td class="num">${esc(r.addr)}</td><td><span class="tag ${r.tier === 1 ? "ok" : ""}">${r.tier === 1 ? "Direct" : "Level 2"}</span></td><td>${fmtDate(r.joined)}</td><td class="r num">${money(r.volume)}</td><td class="r num pos">+${money(r.earned, 2)}</td></tr>`).join("")}</tbody></table></div></div>
  </div></section>`;
}

/* ---------- token ---------- */
async function pageToken(){
  const alloc = CONFIG.TOKEN_ALLOCATION, R = 70, C = 2 * Math.PI * R; let off = 0;
  const arcs = alloc.map(([, p, c]) => { const len = C * p / 100, s = `<circle cx="100" cy="100" r="${R}" fill="none" stroke="${c}" stroke-width="26" stroke-dasharray="${len - 2} ${C - len + 2}" stroke-dashoffset="${-off}"/>`; off += len; return s; }).join("");
  return `<section class="page-head"><div class="wrap">
    ${head(T(), `The utility and governance token of ${CONFIG.SITE_NAME}.`)}
    <div class="stat-grid">
      <div class="panel stat"><small>Total supply</small><b class="num">${compactN(CONFIG.TOKEN_SUPPLY)}</b></div>
      <div class="panel stat"><small>Network</small><b>BNB Chain</b><em>BEP-20</em></div>
      <div class="panel stat"><small>Contract</small><b style="font-size:16px">${CONFIG.TOKEN_ADDRESS ? `<button data-act="copy" data-v="${esc(CONFIG.TOKEN_ADDRESS)}">${short(CONFIG.TOKEN_ADDRESS)}</button>` : "Coming soon"}</b></div>
      <div class="panel stat"><small>Airdrop</small><b class="num">${alloc[0][1]}%</b><em>for testnet users</em></div>
    </div>
    <div class="two">
      <div class="panel pad"><h2 class="h3">Allocation</h2><div class="donut-wrap" style="margin-top:16px">
        <svg viewBox="0 0 200 200" style="transform:rotate(-90deg)">${arcs}</svg>
        <div class="legend">${alloc.map(([n, p, c]) => `<div><i style="background:${c}"></i>${esc(n)}<b class="num">${p}%</b></div>`).join("")}</div></div>
        <p class="side-note">Placeholder numbers. Final tokenomics will be published before launch.</p></div>
      <div class="panel pad"><h2 class="h3">What ${T()} does</h2><div class="feed" style="margin-top:8px">
        <div><span>💸 Fee discounts</span><b>Up to 50% off</b></div><div><span>🛡 Resolution voting</span><b>Earn rewards</b></div>
        <div><span>🏗 Market creation bond</span><b>${num(CONFIG.CREATE_BOND)} ${T()}</b></div><div><span>🗳 Governance</span><b>Vote on fees & listings</b></div>
        <div><span>🌱 Liquidity mining</span><b>Vault rewards</b></div></div></div>
    </div>
  </div></section>`;
}

/* ---------- docs ---------- */
async function pageDocs(){
  const sec = [
    ["start", "Getting started", `<p>1. Install a wallet app like MetaMask or Trust Wallet. 2. Click <b>Connect wallet</b>; we switch you to ${esc(CONFIG.CHAIN.chainName)} automatically. 3. Open the wallet menu and click <b>Get test funds</b> for ${num(CONFIG.FAUCET_STABLE)} test ${S()} and ${num(CONFIG.FAUCET_TOKEN)} test ${T()}. 4. Pick a market and buy YES or NO.</p>`],
    ["prices", "How prices work", `<p>Prices come from an automated market maker called <b>LMSR</b> (Logarithmic Market Scoring Rule). It always quotes a price, so you never wait for someone to take the other side. YES + NO always add up to $1. Buying YES pushes the YES price up; the size of the move depends on the market's liquidity depth.</p><p>The protocol's worst-case loss per market is capped at <code>b × ln 2</code>, where <code>b</code> is the liquidity setting. That makes it safe to seed every new market automatically.</p>`],
    ["leverage", "Leverage (coming soon)", `<p><b>Leverage is not live yet.</b> When it launches, it will let you open a bigger position than your deposit. At 5× a $100 deposit opens a $500 position; the extra $400 is borrowed from the vault.</p><ul><li>Available leverage depends on market volume: ${CONFIG.LEVERAGE_TIERS.map(([l, v]) => `${l}× from ${compact(v)}`).join(", ")}.</li><li>If your position's value minus the borrowed amount falls below ${pct(CONFIG.MAINTENANCE)} of its size, it is <b>liquidated</b> and you lose your deposit.</li><li>Positions from ${money(CONFIG.LEVERAGE_MIN)} to ${money(CONFIG.LEVERAGE_MAX)} at launch.</li><li>The liquidation price is shown before you trade.</li></ul><p><a href="#/leverage" style="color:var(--cyan)">Try the leverage simulator →</a></p>`],
    ["fees", "Fees", `<p>Each trade pays ${pct(CONFIG.CREATOR_FEE + CONFIG.PROTOCOL_FEE, 1)} of its size: ${pct(CONFIG.CREATOR_FEE, 1)} to the market creator and ${pct(CONFIG.PROTOCOL_FEE, 1)} to the protocol. ${pct(CONFIG.LP_SHARE)} of the protocol fee goes to vault depositors. Staking ${T()} cuts fees by up to 50%, and invited users get ${pct(CONFIG.REF_DISCOUNT)} off.</p>`],
    ["create", "Creating markets", `<p>Anyone can create a market by posting a ${num(CONFIG.CREATE_BOND)} ${T()} bond. The protocol seeds the liquidity, so creators take no market-making risk and earn ${pct(CONFIG.CREATOR_FEE, 1)} of every trade for the life of the market. The bond comes back when the market resolves cleanly; unclear or abusive markets can lose it.</p>`],
    ["vault", "Vault", `<p>Vault depositors provide ${S()} liquidity to the protocol (and, once leverage launches, the money leveraged traders borrow). In return they earn ${pct(CONFIG.LP_SHARE)} of protocol fees. Choose a lock period: ${CONFIG.LOCKS.map(l => `${l.label} (${l.mult}× points)`).join(", ")}. Longer locks earn points faster.</p>`],
    ["resolve", "Resolution", `<p>When a market ends it moves to <b>Resolving</b>. ${T()} stakers vote YES or NO based on the listed resolution source. Votes are weighted by stake. Voters on the final outcome earn rewards. Winning shares then pay $1 each and positions settle automatically.</p>`],
    ["points", "Points & badges", `<p>Points track how much you use ${CONFIG.SITE_NAME}: trading, vault deposits, staking, creating markets, correct votes, referrals and badges. Points are planned to convert into ${T()} at launch; the exact formula will be announced.</p>`],
    ["risks", "Risks", `<ul><li>You can lose everything you put into a trade, and leverage makes losses faster.</li><li>Smart contracts can have bugs.</li><li>Resolution relies on voters reading the source correctly.</li><li>Prediction markets may be restricted where you live. Check your local laws.</li></ul>`]
  ];
  return `<section class="page-head"><div class="wrap">
    ${head("Docs", `Everything you need to know about ${CONFIG.SITE_NAME}.`)}
    <div class="docs"><nav>${sec.map(([id, t]) => `<a href="#/docs" data-act="jump" data-v="${id}">${t}</a>`).join("")}</nav>
    <article class="panel pad">${sec.map(([id, t, b]) => `<h2 id="d-${id}">${t}</h2>${b}`).join("")}</article></div>
  </div></section>`;
}

/* ---------- leverage (coming soon) ---------- */
const simState = { p: 0.5, side: "YES", lev: 5, amt: 200 };
// liquidation price for a fresh position, ignoring price impact (good enough for a simulator)
function levMath(p, lev, amt){
  const size = amt * lev, fee = size * (CONFIG.CREATOR_FEE + CONFIG.PROTOCOL_FEE), shares = (size - fee) / p, borrowed = size - amt;
  const liq = lev > 1 ? Math.min(p, (borrowed + CONFIG.MAINTENANCE * size) / shares) : 0;
  return { size, fee, shares, borrowed, liq, profit: shares - borrowed - amt };
}
async function pageLeverage(){
  const tiers = CONFIG.LEVERAGE_TIERS;
  const rows = tiers.map(([L]) => { const liq = levMath(0.5, L, 100).liq; return `<div class="liq-row"><b class="num">${L}×</b>
    <div class="liq-track"><i style="width:${(liq * 100).toFixed(1)}%"></i><s style="left:${(liq * 100).toFixed(1)}%"></s><u style="left:50%"></u></div>
    <span class="num neg">${cents(liq)}</span></div>`; }).join("");
  return `<section class="page-head"><div class="wrap">
    <div class="lev-hero">
      <div>
        <div class="eyebrow">Leverage · Coming soon</div>
        <h1 class="lev-h1">Soon: trade with up to <span class="g">10×</span> leverage.</h1>
        <p class="lede" style="font-size:17px">Bigger positions on the same markets you already trade. Leverage switches on for a market once it has enough volume and traders to price it safely, starting at 2× and rising to 10× on the deepest markets. ${money(CONFIG.LEVERAGE_MIN)} minimum and ${money(CONFIG.LEVERAGE_MAX)} maximum per position at launch, with automatic liquidations.</p>
        <div class="hero-cta"><a class="btn btn-grad" href="#/markets">Browse live markets →</a><a class="btn btn-ghost" href="#/leverage" data-act="jumpSim">Try the simulator</a></div>
      </div>
      <div class="panel pad">
        <div class="liq-head"><span>LIQUIDATION BY TIER</span><span>YES bought at 50¢</span></div>
        <div class="liq-rows">${rows}</div>
        <p class="side-note" style="border-top:1px solid var(--line-soft);padding-top:14px;margin-top:18px">The red zone is where the YES price would close your position. Higher leverage means a smaller move wipes you out.</p>
      </div>
    </div>

    <h2 class="h3" style="margin:40px 0 12px">When leverage unlocks on a market</h2>
    <div class="steps">${tiers.map(([L, v]) => `<div class="step"><span class="n">${L}×</span><h3>${compact(v)}+ volume</h3><p>Liquidated if the price falls about ${Math.round((0.5 - levMath(0.5, L, 100).liq) * 100)} points from a 50¢ entry.</p></div>`).join("")}</div>

    <div class="two" id="sim" style="margin-top:40px">
      <div class="panel pad">
        <h2 class="h3">Leverage simulator</h2><p class="muted" style="margin-top:4px">See what a leveraged position would look like. Nothing is traded.</p>
        <div class="side-tabs" style="margin-top:16px"><button class="y ${simState.side === "YES" ? "on" : ""}" data-act="simSide" data-v="YES">Yes</button><button class="n ${simState.side === "NO" ? "on" : ""}" data-act="simSide" data-v="NO">No</button></div>
        <div class="field"><label for="simP" style="display:flex;justify-content:space-between"><span>Entry price of ${simState.side}</span><b class="num" id="simPv" style="color:var(--text)">${cents(simState.p)}</b></label><input id="simP" type="range" min="5" max="95" value="${Math.round(simState.p * 100)}"></div>
        <div class="field"><label for="simAmt">Your deposit (${S()})</label><input class="input num" id="simAmt" type="number" min="${CONFIG.LEVERAGE_MIN}" max="${CONFIG.LEVERAGE_MAX}" value="${simState.amt}"></div>
        <div class="lev"><div class="lev-head"><span>Leverage</span><b class="num">${simState.lev}×</b></div>
          <div class="lev-opts">${[2, 3, 5, 10].map(L => `<button class="${L === simState.lev ? "on" : ""}" data-act="simLev" data-v="${L}">${L}×</button>`).join("")}</div></div>
      </div>
      <div class="panel pad"><h2 class="h3">Result</h2><div class="summary" id="simOut"></div></div>
    </div>
  </div></section>`;
}
function updateSim(){
  const out = $("#simOut"); if(!out) return;
  simState.p = +$("#simP").value / 100; simState.amt = Math.max(0, +$("#simAmt").value || 0);
  $("#simPv").textContent = cents(simState.p);
  const r = levMath(simState.p, simState.lev, simState.amt), drop = simState.p - r.liq;
  const bad = simState.amt < CONFIG.LEVERAGE_MIN || simState.amt > CONFIG.LEVERAGE_MAX;
  out.innerHTML = `<div><span>Position size</span><b class="num">${money(r.size, 2)}</b></div>
    <div><span>Borrowed from the vault</span><b class="num">${money(r.borrowed, 2)}</b></div>
    <div><span>Shares of ${simState.side}</span><b class="num">${num(r.shares, 2)}</b></div>
    <div><span>Fee</span><b class="num">${money(r.fee, 2)}</b></div>
    <div><span>Liquidated if ${simState.side} falls to</span><b class="num neg">${cents(r.liq)} (−${(drop * 100).toFixed(1)} pts)</b></div>
    <div><span>Lose if liquidated</span><b class="num neg">−${money(simState.amt, 2)}</b></div>
    <div class="big"><span>Profit if ${simState.side} wins</span><b class="num">${signed(r.profit)}</b></div>
    ${bad ? `<div class="warn">At launch, deposits must be between ${money(CONFIG.LEVERAGE_MIN)} and ${money(CONFIG.LEVERAGE_MAX)}.</div>` : ""}`;
}

/* ---------- more (mobile menu) ---------- */
async function pageMore(){
  const items = [["#/leverage", "Leverage", "Up to 10× · coming soon"], ["#/create", "Create market", "Launch a question and earn 0.5%"], ["#/vault", "Vault", "Earn fees on " + S()], ["#/stake", "Stake " + T(), "Lower fees, vote on outcomes"], ["#/resolve", "Resolution", "Vote on ended markets"], ["#/rewards", "Rewards", "Points and badges"], ["#/leaderboard", "Leaderboard", "Top traders"], ["#/affiliate", "Affiliate", "Your referral link"], ["#/token", T(), "Tokenomics"], ["#/docs", "Docs", "How everything works"]];
  return `<section class="page-head"><div class="wrap">${head("More", "")}<div class="more-list">${items.map(([h, t, d]) => `<a href="${h}"><div><b>${t}</b><small>${d}</small></div><span class="muted">›</span></a>`).join("")}</div></div></section>`;
}

/* =====================================================================
   HERO MOTION
   ===================================================================== */
const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
function scramble(el, text, dur = 900){
  if(!el || reduce){ if(el) el.textContent = text; return; }
  const chars = "369X0123456789", t0 = performance.now();
  (function tick(now){ const k = Math.min(1, (now - t0) / dur), n = Math.floor(k * text.length);
    el.textContent = text.split("").map((c, i) => i < n || c === " " || c === "." ? c : chars[Math.floor(Math.random() * chars.length)]).join("");
    if(k < 1) requestAnimationFrame(tick); })(t0);
}
function setDial(v){
  const arc = $("#dialArc"); if(!arc) return;
  arc.style.strokeDashoffset = (314.16 * (1 - v)).toFixed(2);
  $("#dialVal").textContent = pct(v); $("#dialYes").textContent = cents(v); $("#dialNo").textContent = cents(1 - v);
}

/* =====================================================================
   ROUTER
   ===================================================================== */
const PAGES = { home: pageHome, markets: pageMarkets, leverage: pageLeverage, market: pageMarket, create: pageCreate, portfolio: pagePortfolio, vault: pageVault, stake: pageStake,
  resolve: pageResolve, rewards: pageRewards, leaderboard: pageLeaderboard, affiliate: pageAffiliate, token: pageToken, docs: pageDocs, more: pageMore };
const MORE = ["create", "stake", "resolve", "affiliate", "token", "docs"];

let routeSeq = 0;
async function route(keepScroll){
  const seq = ++routeSeq;                       // a newer navigation cancels this one
  const raw = location.hash.replace(/^#\/?/, ""), [path, qs = ""] = raw.split("?");
  const parts = path.split("/"), r = PAGES[parts[0]] ? parts[0] : "home", param = decodeURIComponent(parts[1] || "");
  const query = new URLSearchParams(qs);
  $$("[data-r]").forEach(a => a.classList.toggle("on", a.dataset.r === r || (a.dataset.r === "markets" && r === "market") || (a.dataset.r === "more" && MORE.includes(r))));
  $(".nav-more")?.classList.toggle("on", MORE.includes(r));
  clearInterval(pollT);
  if(wallet.address && !ACC) await refreshAccount();
  const app = $("#app");
  let html;
  try{ html = await PAGES[r](r === "market" ? param : query, query); }
  catch(e){ console.error(e); html = `<section class="page-head"><div class="wrap"><div class="panel empty">Something went wrong: ${esc(e.message)}<br><a class="btn btn-ghost" href="#/">Go home</a></div></div></section>`; }
  if(seq !== routeSeq) return;                  // user moved on while this page was loading
  app.innerHTML = html;
  afterRender(r);
  if(!keepScroll) window.scrollTo({ top: 0 });
}
function afterRender(r){
  if(r === "home"){
    scramble($("#scr1"), "Predict."); setTimeout(() => scramble($("#scr2"), "Participate."), 180);
    const v = +($("#dialYes")?.textContent.replace("¢", "") || 50) / 100; requestAnimationFrame(() => setDial(v));
  }
  if(r === "markets"){
    fillMarkets(); let t;
    $("#q").addEventListener("input", e => { clearTimeout(t); t = setTimeout(() => { mState.q = e.target.value; fillMarkets(); }, 200); });
    $("#fStatus").addEventListener("change", e => { mState.status = e.target.value; fillMarkets(); });
    $("#fSort").addEventListener("change", e => { mState.sort = e.target.value; fillMarkets(); });
  }
  if(r === "market" && tState.m){
    renderTrade();
    pollT = setInterval(refreshMarket, 15000);
  }
  if(r === "create"){ ["cq", "ccat", "cend", "cp"].forEach(id => $("#" + id)?.addEventListener("input", previewCreate)); if($("#cprev")) previewCreate(); }
  if(r === "leverage"){ ["simP", "simAmt"].forEach(id => $("#" + id).addEventListener("input", updateSim)); updateSim(); }
  if(r === "vault" && $("#vamt")){ $("#vamt").addEventListener("input", updateVaultSum); updateVaultSum(); }
}

/* =====================================================================
   BUTTON ACTIONS  (every data-act="..." lands here)
   ===================================================================== */
async function busy(btn, label, fn){
  const old = btn?.textContent; if(btn){ btn.disabled = true; btn.textContent = label; }
  try{ await fn(); }catch(e){ toast(e.message, true); if(btn && document.body.contains(btn)){ btn.disabled = false; btn.textContent = old; } }
}
const ACTIONS = {
  noop(){},
  connect(){ return wallet.connect(); },
  disconnect(){ ACC = null; wallet.disconnect(); },
  switchChain(){ return wallet.switchChain(); },
  copyAddr(){ copyText(wallet.address, "Address copied"); },
  copy(el){ copyText(el.dataset.v, "Link copied"); },
  resetDemo(){ if(confirm("Reset all demo data in this browser?")){ api.resetDemo(); ACC = null; location.hash = "#/"; location.reload(); } },
  async faucet(el){
    if(!wallet.address) return wallet.connect();
    await busy(el, "Sending…", async () => { await api.faucet(wallet.address); toast(`Received ${num(CONFIG.FAUCET_STABLE)} ${S()} + ${num(CONFIG.FAUCET_TOKEN)} ${T()}`); await refreshAccount(); route(true); });
  },
  setCat(el){ mState.cat = el.dataset.v; $$(".chip").forEach(b => b.classList.toggle("on", b.dataset.v === mState.cat)); fillMarkets(); },
  side(el){ tState.side = el.dataset.v; renderTrade(); },
  lev(el){ tState.lev = +el.dataset.v; renderTrade(); },
  quick(el){ tState.margin = el.dataset.v === "max" ? Math.floor((ACC?.stable || 0) * 100) / 100 : +el.dataset.v; renderTrade(); },
  async buy(el){
    if(tState.margin < 1) return toast("Enter at least $1", true);
    await busy(el, "Placing order…", async () => {
      const q = Engine.quote(tState.m, ACC || Engine.blankUser(), tState.side, tState.margin, tState.lev, refBy());
      await api.placeTrade({ marketId: tState.m.id, side: tState.side, margin: tState.margin, lev: tState.lev, wallet: wallet.address, ref: refBy(), minShares: q.shares * 0.97 });
      toast(`Bought ${tState.side}${tState.lev > 1 ? " at " + tState.lev + "×" : ""}`);
      await refreshAccount(); route(true);
    });
  },
  async close(el){
    await busy(el, "Closing…", async () => { const r = await api.closePosition({ id: el.dataset.id, wallet: wallet.address }); toast("Closed. You received " + money(r.received, 2)); await refreshAccount(); route(true); });
  },
  async createMarket(el){
    const q = $("#cq").value.trim().replace(/\s+/g, " "), src = $("#csrc").value.trim(), ends = $("#cend").value, err = $("#cerr");
    let rules = $("#crules").value.trim();
    if(q.length < 15 || !q.endsWith("?")) return err.textContent = "Write a full question of at least 15 characters that ends with a question mark.";
    if(!ends || ends <= today()) return err.textContent = "Pick an end date in the future.";
    if(src.length < 4) return err.textContent = "Add a resolution source people can check.";
    if(!rules) rules = `Resolves YES if this happens by ${fmtDate(ends)} according to ${src}. Otherwise resolves NO.`;
    err.textContent = "";
    await busy(el, "Creating…", async () => {
      const m = await api.createMarket({ wallet: wallet.address, q, cat: $("#ccat").value, ends, source: src, rules, p: +$("#cp").value / 100 });
      toast("Market created"); await refreshAccount(); location.hash = mHref(m.id);
    });
  },
  lock(el){ vState.lock = el.dataset.v; $$(".lock-opts button").forEach(b => b.classList.toggle("on", b.dataset.v === vState.lock)); updateVaultSum(); },
  async deposit(el){
    const amount = +$("#vamt").value || 0; if(amount < 1) return toast("Enter at least $1", true);
    await busy(el, "Depositing…", async () => { await api.deposit({ wallet: wallet.address, amount, lock: vState.lock }); toast("Deposited " + money(amount, 2)); await refreshAccount(); route(true); });
  },
  async withdraw(el){
    await busy(el, "…", async () => { const r = await api.withdraw({ wallet: wallet.address, id: el.dataset.id }); toast("Withdrew " + money(r.amount, 2)); await refreshAccount(); route(true); });
  },
  stakeTab(el){ vState.stakeTab = el.dataset.v; route(true); },
  stakeMax(){ $("#samt").value = Math.floor(vState.stakeTab === "stake" ? ACC.token : ACC.staked); },
  async stake(el){
    const amount = +$("#samt").value || 0; if(amount <= 0) return toast("Enter an amount", true);
    await busy(el, "Staking…", async () => { await api.stake({ wallet: wallet.address, amount }); toast("Staked " + tok(amount)); await refreshAccount(); route(true); });
  },
  async unstake(el){
    const amount = +$("#samt").value || 0; if(amount <= 0) return toast("Enter an amount", true);
    await busy(el, "Unstaking…", async () => { await api.unstake({ wallet: wallet.address, amount }); toast("Unstaked " + tok(amount)); await refreshAccount(); route(true); });
  },
  async vote(el){
    if(!wallet.address) return wallet.connect();
    await busy(el, "Voting…", async () => { await api.vote({ wallet: wallet.address, id: el.dataset.id, side: el.dataset.side }); toast("Vote recorded"); await refreshAccount(); route(true); });
  },
  async finalize(el){
    await busy(el, "Finalizing…", async () => { const r = await api.finalize({ id: el.dataset.id, outcome: el.dataset.outcome }); toast("Resolved " + r.outcome); await refreshAccount(); route(true); });
  },
  lb(el){ vState.lb = el.dataset.v; route(true); },
  async claimVault(el){
    await busy(el, "Claiming…", async () => { await api.claimVault({ id: el.dataset.id }); toast("Vault earnings sent to your wallet"); await refreshAccount(); route(true); });
  },
  async claimStakeFees(el){
    await busy(el, "Claiming…", async () => { await api.claimStakeFees(); toast("Staking fees sent to your wallet"); await refreshAccount(); route(true); });
  },
  async claimVote(el){
    await busy(el, "Claiming…", async () => { await api.claimVoteReward({ id: el.dataset.id }); toast("Voting reward sent to your wallet"); await refreshAccount(); route(true); });
  },
  async redeem(el){
    await busy(el, "Redeeming…", async () => { await api.redeem({ id: el.dataset.id }); toast("Winnings paid to your wallet"); await refreshAccount(); route(true); });
  },
  async claimFees(el){
    await busy(el, "Claiming…", async () => { await api.claimCreatorFees({ id: el.dataset.id }); toast("Creator fees sent to your wallet"); await refreshAccount(); route(true); });
  },
  simSide(el){ simState.side = el.dataset.v; route(true); },
  simLev(el){ simState.lev = +el.dataset.v; route(true); },
  jumpSim(el, e){ e.preventDefault(); $("#sim")?.scrollIntoView({ behavior: reduce ? "auto" : "smooth" }); },
  jump(el, e){ e.preventDefault(); $("#d-" + el.dataset.v)?.scrollIntoView({ behavior: reduce ? "auto" : "smooth" }); },
  async saveCode(el){
    const v = $("#code").value.trim().toLowerCase(), err = $("#codeErr");
    if(!/^[a-z0-9_-]{3,20}$/.test(v)) return err.textContent = "Use 3 to 20 letters, numbers, dashes or underscores.";
    try{ await api.setAffiliateCode(wallet.address, v); toast("Referral link saved"); route(true); }catch(e){ err.textContent = e.message; }
  },
  async claimRef(el){
    await busy(el, "Claiming…", async () => { const r = await api.claimAffiliate(wallet.address); toast("Claimed " + money(r.amount, 2)); await refreshAccount(); route(true); });
  }
};

document.addEventListener("click", e => {
  // close open dropdowns when clicking elsewhere or on a menu item
  $$("details[open]").forEach(d => { if(!d.contains(e.target) || e.target.closest(".menu a, .menu button")) d.removeAttribute("open"); });
  const el = e.target.closest("[data-act]"); if(!el || el.disabled) return;
  const fn = ACTIONS[el.dataset.act]; if(fn) fn(el, e);
});
document.addEventListener("input", e => { if(e.target.id === "amt" && tState.m){ tState.margin = Math.max(0, +e.target.value || 0); updateQuote(); } });
window.addEventListener("hashchange", () => route());

(async function start(){
  captureRef();
  await wallet.init();
  await refreshAccount();
  route();
})();
