/* =====================================================================
   SHARE P&L CARD
   Draws a branded 1200x630 image of a position, a closed trade or the
   whole portfolio on a <canvas>, entirely in the browser. People can save
   it, copy it, use the phone's share sheet, or post it to X / Telegram
   with their referral link. Testnet cards always say "test funds".
   ===================================================================== */
const SHARE = { item: null, hide: false, url: "" };
const CARD_W = 1200, CARD_H = 630;
const FD = "Unbounded, 'Arial Black', Arial, sans-serif", FB = "Manrope, 'Helvetica Neue', Arial, sans-serif";

function shareLink(){
  const code = ACC?.refCode || store.get("affCode:" + (wallet.address || "").toLowerCase(), null);
  const base = location.origin + location.pathname.replace(/index\.html$/, "");
  return { code, url: code ? `${base}?ref=${encodeURIComponent(code)}` : base };
}

// what goes on the card, from a position / history row / the whole account
function shareItemFromPosition(p){
  return { kind: "position", q: p.q, icon: p.icon, side: p.side, cost: p.margin, value: Math.max(0, p.equity), pnl: p.pnl,
    status: p.status === "resolved" ? (p.outcome === p.side ? "Won" : "Lost") : "Open",
    a: ["Avg price", cents(p.avg)], b: [p.status === "resolved" ? "Settled at" : "Now", cents(p.price)] };
}
function shareItemFromHistory(h){
  return { kind: "trade", q: h.q, icon: h.icon, side: h.side, cost: h.margin, value: h.received, pnl: h.received - h.margin,
    status: h.how, a: ["Staked", money(h.margin, 2)], b: ["Received", money(h.received, 2)] };
}
function shareItemTotal(a){
  const unreal = a.positions.reduce((s, p) => s + p.pnl, 0), pnl = a.pnl + unreal;
  const cost = a.history.reduce((s, h) => s + h.margin, 0) + a.positions.reduce((s, p) => s + p.margin, 0);
  const closed = a.history.length, wins = a.history.filter(h => h.received > h.margin).length;
  return { kind: "total", q: `My ${CONFIG.SITE_NAME} trading P&L`, icon: null, side: null, cost, pnl, status: "All time",
    a: ["Trades", num(a.trades)], b: ["Win rate", closed ? pct(wins / closed) : "—"] };
}

// ---------- drawing ----------
let shareLogo = null;
const loadLogo = () => shareLogo || (shareLogo = new Promise(res => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = "assets/logo.png"; }));

function wrapLines(ctx, text, maxW, maxLines){
  const words = String(text).split(/\s+/), lines = [];
  let line = "";
  for(const w of words){
    const t = line ? line + " " + w : w;
    if(ctx.measureText(t).width <= maxW) line = t;
    else { if(line) lines.push(line); line = w; if(lines.length === maxLines) break; }
  }
  if(lines.length < maxLines && line) lines.push(line);
  if(lines.length === maxLines && words.join(" ") !== lines.join(" ")){
    let last = lines[maxLines - 1];
    while(ctx.measureText(last + "…").width > maxW && last.length) last = last.slice(0, -1);
    lines[maxLines - 1] = last.replace(/\s+\S*$/, "") + "…";
  }
  return lines;
}
function pill(ctx, x, y, text, fg, bg, font = "700 22px " + FB){
  ctx.font = font; const w = ctx.measureText(text).width + 32, h = 40;
  ctx.fillStyle = bg; ctx.beginPath(); ctx.roundRect(x, y, w, h, 20); ctx.fill();
  ctx.fillStyle = fg; ctx.textBaseline = "middle"; ctx.fillText(text, x + 16, y + h / 2 + 1); ctx.textBaseline = "alphabetic";
  return w;
}

async function drawShareCard(item, hide){
  await Promise.all([loadLogo(), document.fonts?.load?.("700 120px " + FD), document.fonts?.load?.("600 34px " + FB), document.fonts?.load?.("700 22px " + FB)].map(p => Promise.resolve(p).catch(() => null)));
  const cv = document.createElement("canvas"); cv.width = CARD_W; cv.height = CARD_H;
  const ctx = cv.getContext("2d"), up = item.pnl >= 0, link = shareLink();
  const LIME = "#7cf26a", MINT = "#6fe6c0", CYAN = "#5fd6f2", RED = "#ff7a88", INK = "#f4f7f5", INK2 = "rgba(244,247,245,.62)", INK3 = "rgba(244,247,245,.4)";

  // background: near-black with soft brand glows and a faint grid
  ctx.fillStyle = "#040607"; ctx.fillRect(0, 0, CARD_W, CARD_H);
  const glow = (x, y, r, c) => { const g = ctx.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, c); g.addColorStop(1, "rgba(0,0,0,0)"); ctx.fillStyle = g; ctx.fillRect(0, 0, CARD_W, CARD_H); };
  glow(120, -40, 520, up ? "rgba(124,242,106,.16)" : "rgba(255,122,136,.14)");
  glow(1120, 680, 560, "rgba(95,214,242,.12)");
  ctx.strokeStyle = "rgba(255,255,255,.035)"; ctx.lineWidth = 1;
  for(let x = 0; x <= CARD_W; x += 60){ ctx.beginPath(); ctx.moveTo(x + .5, 0); ctx.lineTo(x + .5, CARD_H); ctx.stroke(); }
  for(let y = 0; y <= CARD_H; y += 60){ ctx.beginPath(); ctx.moveTo(0, y + .5); ctx.lineTo(CARD_W, y + .5); ctx.stroke(); }
  ctx.strokeStyle = "rgba(255,255,255,.08)"; ctx.lineWidth = 2; ctx.beginPath(); ctx.roundRect(1, 1, CARD_W - 2, CARD_H - 2, 28); ctx.stroke();

  // decorative rings on the right, with an arc for the result
  const cx = 1010, cy = 300;
  [210, 160, 110].forEach((r, i) => { ctx.strokeStyle = `rgba(255,255,255,${.05 + i * .02})`; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke(); });
  const arcG = ctx.createLinearGradient(cx - 160, cy - 160, cx + 160, cy + 160);
  if(up){ arcG.addColorStop(0, LIME); arcG.addColorStop(.5, MINT); arcG.addColorStop(1, CYAN); } else { arcG.addColorStop(0, RED); arcG.addColorStop(1, "#ff9aa5"); }
  const share = item.cost > 0 ? Math.min(1, Math.abs(item.pnl) / item.cost) : 0;
  ctx.strokeStyle = arcG; ctx.lineWidth = 10; ctx.lineCap = "round";
  ctx.beginPath(); ctx.arc(cx, cy, 160, -Math.PI / 2, -Math.PI / 2 + Math.max(.08, share) * Math.PI * 2); ctx.stroke();
  ctx.fillStyle = INK3; ctx.font = "600 20px " + FB; ctx.textAlign = "center"; ctx.fillText(item.status.toUpperCase(), cx, cy + 8); ctx.textAlign = "left";

  // header: logo + testnet label
  const logo = await loadLogo();
  if(logo){ const h = 56, w = logo.width / logo.height * h; ctx.drawImage(logo, 64, 52, w, h); }
  else { ctx.fillStyle = INK; ctx.font = "700 44px " + FD; ctx.fillText(CONFIG.SITE_NAME, 64, 96); }
  if(CHAIN_ON || CONFIG.USE_MOCK){ ctx.font = "600 18px " + FB; const t = (CHAIN_ON ? CONFIG.CHAIN.chainName.replace("BNB Smart Chain", "BNB") : "Demo") + " · test funds";
    ctx.textAlign = "right"; ctx.fillStyle = INK3; ctx.fillText(t, CARD_W - 64, 88); ctx.textAlign = "left"; }

  // market + side (fixed rows, so long questions never push into the footer)
  let y = 148;
  if(item.side){ const isY = item.side === "YES";
    pill(ctx, 64, y, item.side, isY ? LIME : RED, isY ? "rgba(124,242,106,.14)" : "rgba(255,122,136,.14)"); y += 40; }
  ctx.fillStyle = INK; ctx.font = "600 32px " + FB;
  const lines = wrapLines(ctx, item.q || "", 690, item.side ? 2 : 1);
  lines.forEach((l, i) => ctx.fillText(l, 64, y + 44 + i * 40)); y += 44 + (lines.length - 1) * 40;

  // the number: P&L %
  const pctVal = item.cost > 0 ? item.pnl / item.cost : 0, pctText = (up ? "+" : "\u2212") + Math.abs(pctVal * 100).toFixed(Math.abs(pctVal) >= 10 ? 0 : 1) + "%";
  ctx.font = "700 96px " + FD;
  const numG = ctx.createLinearGradient(64, 0, 64 + ctx.measureText(pctText).width, 0);
  if(up){ numG.addColorStop(0, LIME); numG.addColorStop(.55, MINT); numG.addColorStop(1, CYAN); } else { numG.addColorStop(0, RED); numG.addColorStop(1, "#ffa3ad"); }
  ctx.fillStyle = numG; ctx.fillText(pctText, 60, y + 106);
  if(!hide){ ctx.font = "700 32px " + FB; ctx.fillStyle = up ? LIME : RED; ctx.fillText((up ? "+" : "\u2212") + money(Math.abs(item.pnl), 2).replace("-", ""), 64, y + 152); }

  // stats row, always just above the footer
  const stats = hide && item.kind === "trade" ? [] : [item.a, item.b];
  let sx = 64;
  stats.forEach(([label, val]) => { ctx.font = "600 17px " + FB; ctx.fillStyle = INK3; ctx.fillText(label.toUpperCase(), sx, 478);
    ctx.font = "700 28px " + FB; ctx.fillStyle = INK; ctx.fillText(val, sx, 514); sx += Math.max(200, ctx.measureText(val).width + 60); });

  // footer: call to action + referral
  ctx.fillStyle = "rgba(255,255,255,.06)"; ctx.fillRect(0, CARD_H - 70, CARD_W, 70);
  ctx.font = "600 22px " + FB; ctx.fillStyle = INK2; ctx.fillText("Predict. Participate. Prosper.", 64, CARD_H - 27);
  ctx.textAlign = "right"; ctx.font = "700 22px " + FB; ctx.fillStyle = INK;
  ctx.fillText(link.url.replace(/^https?:\/\//, "").replace(/\/$/, ""), CARD_W - 64, CARD_H - 27); ctx.textAlign = "left";
  return cv;
}

// ---------- modal ----------
function shareModal(){
  let el = $("#shareModal");
  if(!el){
    el = document.createElement("div"); el.id = "shareModal"; el.className = "overlay"; el.setAttribute("role", "dialog"); el.setAttribute("aria-modal", "true"); el.setAttribute("aria-label", "Share your P&L");
    el.innerHTML = `<div class="sheet share-sheet">
      <button class="close" data-act="shareClose" aria-label="Close">${ic("x")}</button>
      <div class="share-body">
        <h2 class="h3">Share your P&amp;L</h2>
        <div class="share-preview"><img id="shareImg" alt="Your P&L card"></div>
        <label class="chk share-hide"><input type="checkbox" id="shareHide"> Hide dollar amounts (show % only)</label>
        <p class="side-note" id="shareRefNote"></p>
        <div class="share-actions">
          <button class="btn btn-grad" data-act="shareDownload">${ic("download")}Save image</button>
          <button class="btn btn-ghost" data-act="shareCopy" id="shareCopyBtn">${ic("copy")}Copy image</button>
          <button class="btn btn-ghost" data-act="shareNative" id="shareNativeBtn" hidden>${ic("share")}Share</button>
          <button class="btn btn-ghost" data-act="shareX">Post on X</button>
          <button class="btn btn-ghost" data-act="shareTg">Telegram</button>
        </div>
      </div></div>`;
    document.body.appendChild(el);
    el.addEventListener("click", e => { if(e.target === el) closeShare(); });
    el.querySelector("#shareHide").addEventListener("change", e => { SHARE.hide = e.target.checked; renderShare(); });
    document.addEventListener("keydown", e => { if(e.key === "Escape" && el.classList.contains("open")) closeShare(); });
  }
  return el;
}
async function openShare(item){
  SHARE.item = item;
  const el = shareModal(), link = shareLink();
  el.querySelector("#shareHide").checked = SHARE.hide;
  el.querySelector("#shareRefNote").innerHTML = link.code
    ? `Your referral link is on the card. Friends who join through it earn you a share of their fees.`
    : `Tip: <a href="#/affiliate" data-act="shareClose" style="color:var(--cyan)">create your referral link</a> first, and every share can earn you fees.`;
  el.querySelector("#shareCopyBtn").hidden = !(navigator.clipboard && window.ClipboardItem);
  el.classList.add("open"); document.body.style.overflow = "hidden";
  await renderShare();
  el.querySelector("[data-act=shareDownload]").focus();
}
async function renderShare(){
  const img = $("#shareImg"); if(!img || !SHARE.item) return;
  img.style.opacity = .5;
  const cv = await drawShareCard(SHARE.item, SHARE.hide);
  SHARE.url = cv.toDataURL("image/png"); SHARE.canvas = cv;
  img.src = SHARE.url; img.style.opacity = 1;
  const nb = $("#shareNativeBtn");
  if(nb){ try{ const f = await shareFile(); nb.hidden = !(navigator.canShare && navigator.canShare({ files: [f] })); }catch(e){ nb.hidden = true; } }
}
function closeShare(){ const el = $("#shareModal"); if(el){ el.classList.remove("open"); document.body.style.overflow = ""; } }
const shareBlob = () => new Promise(res => SHARE.canvas.toBlob(res, "image/png"));
const shareFile = async () => new File([await shareBlob()], "369x-pnl.png", { type: "image/png" });
function shareText(){
  const it = SHARE.item, up = it.pnl >= 0, p = it.cost > 0 ? Math.abs(it.pnl / it.cost * 100).toFixed(1) : "0";
  const what = it.kind === "total" ? "on " + CONFIG.SITE_NAME : (it.side ? it.side + " on \"" + it.q + "\"" : "");
  return `${up ? "Up" : "Down"} ${p}% ${what} · Predict the future with me on ${CONFIG.SITE_NAME}`.replace(/\s+/g, " ");
}
