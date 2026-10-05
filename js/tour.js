/* =====================================================================
   TESTNET TOUR
   A short guided popup that walks a new visitor through joining the
   testnet: connect wallet -> right network -> free tBNB for gas ->
   claim test tokens -> first trade. Each step checks itself, so steps
   that are already done show a tick. Skip any time.
   ===================================================================== */
const TOUR = { i: 0, busy: false, gas: null, open: false };
const GAS_MIN = 0.002;          // enough tBNB for a handful of testnet transactions
const BNB_FAUCET = "https://www.bnbchain.org/en/testnet-faucet";

function tourState(){
  const connected = !!wallet.address && wallet.kind === "injected";
  const network = connected && !wallet.wrongChain;
  const gas = TOUR.gas;
  const funded = !!ACC && (ACC.stable > 0 || nowMs() < (ACC.faucetAt || 0) + CONFIG.FAUCET_COOLDOWN_H * 36e5);
  return { connected, network, gasOk: gas !== null && gas >= GAS_MIN, gas, funded };
}

function tourSteps(){
  const s = tourState(), phone = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent), hasWallet = !!wallet.provider();
  return [
    { key: "hi", icon: "crypto", title: "Welcome to the 369X testnet",
      text: `Testnet is live. You trade real on-chain markets on ${esc(CONFIG.CHAIN.chainName)} with <b>free test tokens</b>. Nothing here costs real money. Five quick steps and you're in.`,
      done: true, action: null },
    { key: "connect", icon: "link", title: "Connect your wallet",
      text: hasWallet || s.connected ? "Use MetaMask (or any EVM wallet). We only read your address; every action asks your wallet first."
        : phone ? "Open this site inside the MetaMask app to connect." : "Install the free MetaMask browser extension, then come back and connect.",
      done: s.connected, status: s.connected ? `Connected: <b class="num">${esc(short(wallet.address))}</b>` : "",
      action: s.connected ? null : hasWallet ? ["Connect wallet", "tourConnect"]
        : phone ? ["Open in MetaMask", "tourMetaMask"] : ["Get MetaMask", "tourGetMetaMask"] },
    { key: "network", icon: "shield", title: `Switch to ${esc(CONFIG.CHAIN.chainName)}`,
      text: "Your wallet needs to be on the testnet network. One tap adds and switches it for you.",
      done: s.network, status: s.network ? "You're on the testnet network" : (s.connected ? "Your wallet is on another network" : "Connect your wallet first"),
      action: s.network || !s.connected ? null : ["Switch network", "tourSwitch"] },
    { key: "gas", icon: "drop", title: "Get free tBNB for network fees",
      text: "Every testnet transaction needs a tiny bit of tBNB (free test BNB). Grab some from the official BNB faucet, then come back.",
      done: s.gasOk, status: !s.connected ? "Connect your wallet first" : s.gas === null ? "Checking your tBNB…" : `Your balance: <b class="num">${num(s.gas, 4)} tBNB</b>`,
      action: s.gasOk || !s.connected ? null : ["Get free tBNB", "tourGas"], extra: !s.gasOk && s.connected ? ["I've got it, check again", "tourRecheck"] : null },
    { key: "faucet", icon: "coins", title: "Claim your test tokens",
      text: `Get <b>${num(CONFIG.FAUCET_STABLE)} test ${S()}</b> to trade with and <b>${num(CONFIG.FAUCET_TOKEN)} test ${T()}</b> to stake or create markets. Claim again every ${CONFIG.FAUCET_COOLDOWN_H} hours.`,
      done: s.funded, status: s.funded && ACC ? `In your wallet: <b class="num">${num(ACC.stable, 2)} ${S()}</b> · <b class="num">${compactN(ACC.token)} ${T()}</b>` : (!s.network ? "Finish the steps above first" : !s.gasOk ? "You need a little tBNB first" : ""),
      action: s.funded || !s.network ? null : ["Claim test tokens", "tourFaucet"] },
    { key: "trade", icon: "target", title: "You're on the testnet",
      text: "Pick a market, choose YES or NO, and place your first trade. Your test balance always shows at the top of the screen.",
      done: s.funded, status: ACC ? `Testnet wallet: <b class="num">${num(ACC.stable, 2)} ${S()}</b> · <b class="num">${compactN(ACC.token)} ${T()}</b>` : "",
      action: ["Pick a market", "tourFinish"] }
  ];
}

function tourEl(){
  let el = $("#tour");
  if(el) return el;
  el = document.createElement("div"); el.id = "tour"; el.className = "tour-wrap"; el.hidden = true;
  el.innerHTML = `<div class="tour-scrim"></div><div class="tour" role="dialog" aria-modal="true" aria-labelledby="tourTitle"></div>`;
  document.body.appendChild(el);
  el.querySelector(".tour-scrim").addEventListener("click", () => closeTour(false));
  document.addEventListener("keydown", e => { if(e.key === "Escape" && TOUR.open) closeTour(false); });
  return el;
}

function renderTour(dir = 0){
  const box = $("#tour .tour"); if(!box) return;
  const steps = tourSteps(), st = steps[TOUR.i], last = TOUR.i === steps.length - 1;
  box.innerHTML = `
    <div class="tour-top">
      <div class="tour-dots" aria-hidden="true">${steps.map((x, k) => `<i class="${k === TOUR.i ? "on" : ""} ${x.done && k > 0 ? "ok" : ""}"></i>`).join("")}</div>
      <button class="tour-skip" data-act="tourSkip">Skip</button>
    </div>
    <div class="tour-body ${dir > 0 ? "in-r" : dir < 0 ? "in-l" : ""}">
      <div class="tour-ico ${st.done && TOUR.i > 0 ? "ok" : ""}">${st.done && TOUR.i > 0 ? ic("check", "g") : ic(st.icon, "g")}</div>
      <small class="tour-step">${TOUR.i === 0 ? `<span class="tn-dot"></span>Testnet is live` : `Step ${TOUR.i} of ${steps.length - 1}`}</small>
      <h2 id="tourTitle">${st.title}</h2>
      <p>${st.text}</p>
      ${st.status ? `<div class="tour-status ${st.done ? "ok" : ""}">${st.status}</div>` : ""}
      ${st.action ? `<button class="btn btn-grad tour-main" data-act="${st.action[1]}">${esc(st.action[0])}</button>` : ""}
      ${st.extra ? `<button class="tour-link" data-act="${st.extra[1]}">${esc(st.extra[0])}</button>` : ""}
    </div>
    <div class="tour-nav">
      <button class="btn btn-ghost btn-sm" data-act="tourBack" ${TOUR.i === 0 ? "disabled" : ""}>Back</button>
      ${last ? "" : `<button class="btn ${st.done || TOUR.i === 0 ? "btn-grad" : "btn-ghost"} btn-sm" data-act="tourNext">${TOUR.i === 0 ? "Let's go" : st.done ? "Next" : "Skip this step"}</button>`}
    </div>`;
  (box.querySelector(".tour-main") || box.querySelector("[data-act=tourNext]"))?.focus({ preventScroll: true });
}

async function tourRefresh(){
  if(!TOUR.open) return;
  if(wallet.address && wallet.kind === "injected" && api.gasBalance){
    try{ TOUR.gas = await api.gasBalance(wallet.address); }catch(e){ /* keep the last value */ }
  } else TOUR.gas = null;
  renderTour();
}

function openTour(start){
  if(!(typeof CHAIN_ON !== "undefined" && CHAIN_ON)){ location.hash = "#/markets"; return; }
  const el = tourEl();
  // jump to the first step that isn't done yet
  const steps = tourSteps();
  // new visitors start at the welcome; returning ones jump to the first step not done yet
  const next = steps.findIndex((x, k) => k > 0 && !x.done);
  TOUR.i = start ?? (!wallet.address ? 0 : next < 0 ? steps.length - 1 : next);
  TOUR.open = true; el.hidden = false; document.body.style.overflow = "hidden";
  requestAnimationFrame(() => el.classList.add("open"));
  renderTour(); tourRefresh();
}
function closeTour(finished){
  const el = $("#tour"); if(!el || !TOUR.open) return;
  TOUR.open = false; store.set("tourSeen", true); if(finished) store.set("tourDone", true);
  el.classList.remove("open"); document.body.style.overflow = "";
  setTimeout(() => { el.hidden = true; }, 220);
}
function tourGo(d){ const n = tourSteps().length; TOUR.i = Math.max(0, Math.min(n - 1, TOUR.i + d)); renderTour(d); }
// after an action: advance automatically if that step is now done
async function tourAfter(key){
  await tourRefresh();
  const st = tourSteps()[TOUR.i];
  if(st && st.key === key && st.done) setTimeout(() => tourGo(1), 600);
}
async function tourRun(btn, label, key, fn){
  if(TOUR.busy) return; TOUR.busy = true;
  const old = btn.innerHTML; btn.disabled = true; btn.innerHTML = `<span class="xl-ring" aria-hidden="true"></span>${esc(label)}`;
  try{ await fn(); }catch(e){ toast(e.message || "Something went wrong", true); }
  finally{ TOUR.busy = false; if(document.body.contains(btn)){ btn.disabled = false; btn.innerHTML = old; } }
  await tourAfter(key);
}
