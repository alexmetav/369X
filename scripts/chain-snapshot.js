#!/usr/bin/env node
/* =====================================================================
   CHAIN HISTORY SNAPSHOT
   Writes data/chain-snapshot.json: every market/referral event up to a
   recent confirmed block. The website starts from this file, so a new
   visitor only scans the blocks after it instead of the whole history.

   Run:  node scripts/chain-snapshot.js        (needs the "ethers" v6 package)
   It continues from the existing snapshot, so later runs are quick.
   ===================================================================== */
const fs = require("fs"), path = require("path"), vm = require("vm");
const { ethers } = require("ethers");
const EV = require("../js/chain-events.js");

// SNAPSHOT_CONFIG / SNAPSHOT_OUT / SNAPSHOT_RPC override the defaults (used for local testing)
const ROOT = path.join(__dirname, ".."), OUT = process.env.SNAPSHOT_OUT || path.join(ROOT, "data", "chain-snapshot.json");
const CONFIG = vm.runInNewContext(fs.readFileSync(process.env.SNAPSHOT_CONFIG || path.join(ROOT, "js", "config.js"), "utf8") + "\n;CONFIG");
if(process.env.SNAPSHOT_RPC) CONFIG.READ_RPCS = [process.env.SNAPSHOT_RPC];
const C = CONFIG.CONTRACTS, addrs = [C.market, C.referral].filter(Boolean);
const SAFE = 64;                                   // stay this many blocks behind the tip (well past any reorg)

async function provider(){
  for(const url of CONFIG.READ_RPCS){
    try{ const p = new ethers.JsonRpcProvider(url, Number(CONFIG.CHAIN.chainId), { staticNetwork: true, batchMaxCount: 1 }); await p.getBlockNumber(); console.log("RPC", url); return p; }
    catch(e){ console.log("skip", url, e.shortMessage || e.message); }
  }
  throw new Error("no RPC reachable");
}
async function retry(fn, n = 4){ let last; for(let i = 0; i < n; i++){ try{ return await fn(); }catch(e){ last = e; await new Promise(r => setTimeout(r, 800 * (i + 1))); } } throw last; }

(async () => {
  const p = await provider();
  const same = (a, b) => (a || "-").toLowerCase() === (b || "-").toLowerCase();
  let snap = null;
  try{ snap = JSON.parse(fs.readFileSync(OUT, "utf8")); }catch(e){}
  if(!snap || snap.v !== EV.VERSION || !same(snap.market, C.market) || !same(snap.referral, C.referral)){
    let lo = Number.isInteger(CONFIG.DEPLOY_BLOCK) ? CONFIG.DEPLOY_BLOCK : 0, hi = await p.getBlockNumber();
    if(!Number.isInteger(CONFIG.DEPLOY_BLOCK)) while(lo < hi){ const mid = Math.floor((lo + hi) / 2); if((await retry(() => p.getCode(C.market, mid))) === "0x") lo = mid + 1; else hi = mid; }
    console.log("fresh snapshot from deploy block", lo);
    snap = { v: EV.VERSION, market: C.market, referral: C.referral || null, from: lo, ev: [] };
  }
  const tip = await p.getBlockNumber(), to = tip - SAFE;
  if(snap.from > to){ console.log("already up to date"); return; }
  const parse = EV.makeParser(ethers, C.referral);
  const getLogs = (f, t) => retry(() => p.getLogs({ address: addrs, fromBlock: f, toBlock: t }), 2);
  let n = 0;
  await EV.scanLogs(getLogs, snap.from, to, { step: 50000, parallel: 3, onBatch: (logs, last, step) => {
    logs.forEach(l => { const e = parse(l); if(e){ snap.ev.push(e); n++; } });
    snap.from = last + 1;
    process.stdout.write(`\rscanned to ${last} (step ${step}), +${n} events   `);
  } });
  console.log();
  snap.ev.sort((a, b) => a.b - b.b || a.i - b.i);
  if(!snap.t0){
    const b0 = await retry(() => p.getBlock(snap.ev.length ? snap.ev[0].b : to));
    snap.t0 = { b: b0.number, t: b0.timestamp };
  }
  snap.updated = new Date().toISOString();
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(snap));
  console.log(`wrote ${path.relative(ROOT, OUT)}: ${snap.ev.length} events, next block ${snap.from}, ${(fs.statSync(OUT).size / 1024).toFixed(1)} KB`);
})().catch(e => { console.error(e); process.exit(1); });
