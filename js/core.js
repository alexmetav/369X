/* =====================================================================
   Small helpers used everywhere: storage, formatting, escaping, toast.
   ===================================================================== */
const store = {
  pre: "369x:v2:",
  get(k, d){ try{ const v = localStorage.getItem(this.pre + k); return v ? JSON.parse(v) : d; }catch(e){ return d; } },
  set(k, v){ try{ localStorage.setItem(this.pre + k, JSON.stringify(v)); return true; }catch(e){ return false; } },   // false = storage full or blocked
  del(k){ try{ localStorage.removeItem(this.pre + k); }catch(e){} }
};

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
// escape anything that came from data/users before putting it into HTML
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
const num = (n, d = 0) => Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
const money = (n, d = 0) => (n < 0 ? "-$" : "$") + num(Math.abs(n), d);
const signed = (n, d = 2) => (n >= 0 ? "+" : "") + money(n, d);
const compact = (n) => {
  const a = Math.abs(n), s = n < 0 ? "-$" : "$";
  return a >= 1e9 ? s + (a / 1e9).toFixed(2) + "B" : a >= 1e6 ? s + (a / 1e6).toFixed(1) + "M" : a >= 1e3 ? s + (a / 1e3).toFixed(1) + "K" : s + a.toFixed(0);
};
const compactN = (n) => compact(n).replace("$", "");
const pct = (p, d = 0) => (p * 100).toFixed(d) + "%";
const cents = (p) => (p * 100).toFixed(p < 0.01 || p > 0.99 ? 1 : 0) + "¢";
const tok = (n, d = 0) => num(n, d) + " $" + CONFIG.TOKEN;
const stab = (n, d = 2) => num(n, d) + " " + CONFIG.STABLE;
const fmtDate = (d) => new Date(d.length === 10 ? d + "T00:00:00" : d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
const ago = (ts) => {
  const s = Math.max(1, Math.round((Date.now() - ts) / 1000));
  return s < 60 ? s + "s ago" : s < 3600 ? Math.floor(s / 60) + "m ago" : s < 86400 ? Math.floor(s / 3600) + "h ago" : Math.floor(s / 86400) + "d ago";
};
const short = (a) => a ? a.slice(0, 6) + "…" + a.slice(-4) : "";
const today = () => new Date().toISOString().slice(0, 10);
const addDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const delay = (ms) => new Promise(r => setTimeout(r, ms));
const randAddr = () => { const h = "0123456789abcdef"; let a = "0x"; for(let i = 0; i < 40; i++) a += h[Math.floor(Math.random() * 16)]; return a; };
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

// branded loader: the 369X logo with a light sweep and a gradient bar
function loader(text = "Loading…", small = false){
  return `<div class="xl${small ? " xl-sm" : ""}" role="status" aria-live="polite"><div class="xl-logo"><img src="assets/logo.png" alt="" width="160" height="66"><i class="xl-shine" aria-hidden="true"></i></div><div class="xl-bar" aria-hidden="true"><i></i></div><p class="xl-text">${esc(text)}</p></div>`;
}

let toastT;
function toast(msg, bad){
  const t = $("#toast");
  t.innerHTML = `<span class="addr-dot" style="${bad ? "background:var(--no);box-shadow:0 0 10px var(--no)" : ""}"></span>${esc(msg)}`;
  t.classList.add("show"); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("show"), bad ? 6000 : Math.min(6000, 2800 + String(msg).length * 25));
}
async function copyText(text, label = "Copied"){
  try{ await navigator.clipboard.writeText(text); toast(label); }catch(e){ prompt("Copy this:", text); }
}
