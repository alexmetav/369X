/* 369X contract deployer: runs in the browser with MetaMask. No private keys leave the wallet. */
(function(){
  const $ = (s) => document.querySelector(s);
  const E = (n) => ethers.parseEther(String(n));
  const explorer = CONFIG.CHAIN.blockExplorerUrls[0];
  const WANT_CHAIN = BigInt(CONFIG.CHAIN.chainId);
  let provider, signer, me, chainId, art, eth, walletName;

  // starting markets (same as the website); end = 23:59:59 UTC on that date
  const SEED = [
    ["Will Bitcoin trade above $150K before Dec 31, 2026?", "CoinGecko BTC/USD price", "2026-12-31", 0.41],
    ["Will the Fed cut rates at the November 2026 meeting?", "federalreserve.gov FOMC statement", "2026-11-04", 0.62],
    ["Will ETH close Q4 2026 above $6,000?", "CoinGecko ETH/USD daily close", "2026-12-31", 0.33],
    ["Will Real Madrid reach the Champions League quarter-finals?", "uefa.com official results", "2027-04-15", 0.71],
    ["Will Democrats win the US House in the 2026 midterms?", "AP race calls", "2026-11-03", 0.58],
    ["Will BNB set a new all-time high before November 2026?", "CoinGecko BNB/USD price", "2026-10-31", 0.47],
    ["Will the S&P 500 close 2026 above 7,500?", "S&P Dow Jones Indices close", "2026-12-31", 0.55],
    ["Will the Lakers make the 2027 NBA playoffs?", "nba.com standings", "2027-04-12", 0.64],
    ["Will GTA VI launch on its announced release date?", "Rockstar Games official announcement", "2026-11-19", 0.72],
    ["Will India win their next Test series against Australia?", "ESPNcricinfo series result", "2027-01-20", 0.52],
    ["Will 2026 be the hottest year on record globally?", "NASA GISS annual report", "2027-01-15", 0.44],
    ["Will Starship complete a full booster and ship reuse in 2026?", "SpaceX official statement", "2026-12-31", 0.29]
  ].filter(([, , d]) => Date.parse(d + "T23:59:59Z") > Date.now() + 2 * 3600e3);

  const RESERVE = 1_000_000;
  const C = CONFIG.CONTRACTS || {};
  const PHASE2 = !!C.market && !(C.vault && C.staking);   // core contracts exist: add the vault + staking
  const PHASE3 = !!(C.vault && C.staking) && !C.referral;  // then: add the referral program
  let UPGRADE = false;                                     // all live, but vault + staking are still v1: upgrade them
  const REF_POOL = 100_000;
  const REWARD_POOL = 1_000_000;

  function toast(msg, bad){
    const t = $("#toast"); t.textContent = msg; t.style.color = bad ? "var(--no)" : "";
    t.classList.add("show"); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove("show"), 3500);
  }
  const key = () => `369x:deploy${UPGRADE ? "4" : PHASE3 ? "3" : PHASE2 ? "2" : ""}:${chainId}:${me}`;
  const load = () => { try{ return JSON.parse(localStorage.getItem(key())) || { done: {} }; }catch(e){ return { done: {} }; } };
  const save = (s) => { try{ localStorage.setItem(key(), JSON.stringify(s)); }catch(e){} };

  async function deployContract(name, args){
    const f = new ethers.ContractFactory(art[name].abi, art[name].bytecode, signer);
    const c = await f.deploy(...args);
    await c.waitForDeployment();
    return { address: await c.getAddress(), tx: c.deploymentTransaction().hash };
  }
  async function send(contract, fn, args){
    const tx = await contract[fn](...args);
    await tx.wait();
    return { tx: tx.hash };
  }
  const token = (addr) => new ethers.Contract(addr, art.TestToken.abi, signer);
  const market = (addr) => new ethers.Contract(addr, art.Market369X.abi, signer);
  const vault = (addr) => new ethers.Contract(addr, art.Vault369X.abi, signer);

  // stage 2: vault + staking, wired into the existing market
  function steps2(){
    return [
      { id: "vault", label: "Create the vault contract", run: async (s) => { const r = await deployContract("Vault369X", [C.usdt, C.market]); s.vault = r.address; return r; } },
      { id: "stake", label: "Create the staking contract", run: async (s) => { const r = await deployContract("Stake369X", [C.token, C.usdt, C.market]); s.staking = r.address; return r; } },
      { id: "link", label: "Tell the vault where the stakers' 20% of fees goes", run: async (s) => send(vault(s.vault), "setStaking", [s.staking]) },
      { id: "fees", label: "Send the market's protocol fees to the vault", run: async (s) => send(market(C.market), "setFeeRecipient", [s.vault]) },
      { id: "resolver", label: "Let stakers' votes settle markets", run: async (s) => send(market(C.market), "setResolver", [s.staking]) },
      { id: "pool", label: `Fund voting rewards (${REWARD_POOL.toLocaleString()} t369X)`, run: async (s) => send(token(C.token), "transfer", [s.staking, E(REWARD_POOL)]) }
    ];
  }

  function steps3(){
    return [
      { id: "referral", label: "Create the referral contract", run: async (s) => { const r = await deployContract("Referral369X", [C.usdt, C.market]); s.referral = r.address; return r; } },
      { id: "pool", label: `Fund the referral reward pool (${REF_POOL.toLocaleString()} tUSDT)`, run: async (s) => send(token(C.usdt), "transfer", [s.referral, E(REF_POOL)]) }
    ];
  }
  // stage 4: replace vault + staking with v2 and point the market at them (one run, 6 confirmations)
  function steps4(){
    return [
      { id: "harvest", label: "Pay out the fees waiting in the old vault (to its depositors and stakers)", run: async () => send(vault(C.vault), "harvest", []) },
      { id: "vault", label: "Create the new vault (v2)", run: async (s) => { const r = await deployContract("Vault369X", [C.usdt, C.market]); s.vault = r.address; return r; } },
      { id: "stake", label: "Create the new staking contract (v2, with minimum turnout)", run: async (s) => { const r = await deployContract("Stake369X", [C.token, C.usdt, C.market]); s.staking = r.address; return r; } },
      { id: "link", label: "Tell the new vault where the stakers' 20% of fees goes", run: async (s) => send(vault(s.vault), "setStaking", [s.staking]) },
      { id: "fees", label: "Send the market's protocol fees to the new vault", run: async (s) => send(market(C.market), "setFeeRecipient", [s.vault]) },
      { id: "resolver", label: "Let the new staking contract settle markets", run: async (s) => send(market(C.market), "setResolver", [s.staking]) }
    ];
  }
  function steps(seed){
    if(UPGRADE) return steps4();
    if(PHASE3) return steps3();
    if(PHASE2) return steps2();
    const list = [
      { id: "usdt", label: "Create test USDT token (faucet: 1,000 a day)", run: async (s) => { const r = await deployContract("TestToken", ["369X Test USDT", "tUSDT", E(1000), E(10_000_000)]); s.usdt = r.address; return r; } },
      { id: "token", label: "Create test $369X token (faucet: 5,000 a day)", run: async (s) => { const r = await deployContract("TestToken", ["369X Test Token", "t369X", E(5000), E(3_690_000_000)]); s.token = r.address; return r; } },
      { id: "market", label: "Create the 369X market contract", run: async (s) => { const r = await deployContract("Market369X", [s.usdt, s.token, me, me]); s.market = r.address; return r; } },
      { id: "approveUsdt", label: `Allow the market to take ${RESERVE.toLocaleString()} tUSDT for its reserve`, run: async (s) => send(token(s.usdt), "approve", [s.market, E(RESERVE)]) },
      { id: "reserve", label: `Fund the protocol reserve (${RESERVE.toLocaleString()} tUSDT)`, run: async (s) => send(market(s.market), "fundReserve", [E(RESERVE)]) }
    ];
    if(seed && SEED.length){
      list.push({ id: "approveToken", label: `Allow the market to take ${SEED.length} market bonds in t369X`, run: async (s) => send(token(s.token), "approve", [s.market, E(1000 * SEED.length)]) });
      SEED.forEach(([q, src, d, p], i) => list.push({ id: "m" + i, label: "Market: " + q,
        run: async (s) => send(market(s.market), "createMarket", [q, src, Math.floor(Date.parse(d + "T23:59:59Z") / 1000), E(p)]) }));
    }
    return list;
  }

  function render(state, list, running){
    $("#steps").innerHTML = list.map(st => {
      const d = state.done[st.id], cls = d ? "done" : running === st.id ? "run" : state.failed === st.id ? "fail" : "";
      const right = d ? `<a href="${explorer}/tx/${d}" target="_blank" rel="noopener">✓ view</a>` : running === st.id ? "Confirm in MetaMask…" : state.failed === st.id ? "Failed, press Deploy to retry" : "";
      return `<div class="${cls}"><span>${st.label.replace(/</g, "&lt;")}</span><span>${right}</span></div>`;
    }).join("");
    const all = list.every(st => state.done[st.id]);
    $("#reset").hidden = all;                 // nothing to restart once everything is deployed
    $("#go").hidden = all;
    if(UPGRADE){
      $("#resultBox").hidden = !state.vault;
      if(state.vault) $("#result").textContent = JSON.stringify({ network: CONFIG.CHAIN.chainName, chainId: Number(chainId), upgrade: "v2", vault: state.vault, staking: state.staking || null, oldVault: C.vault, oldStaking: C.staking, complete: all }, null, 2);
      return;
    }
    if(PHASE3){
      $("#resultBox").hidden = !state.referral;
      if(state.referral) $("#result").textContent = JSON.stringify({ network: CONFIG.CHAIN.chainName, chainId: Number(chainId), referral: state.referral, complete: all }, null, 2);
      return;
    }
    if(PHASE2){
      $("#resultBox").hidden = !state.vault;
      if(state.vault) $("#result").textContent = JSON.stringify({ network: CONFIG.CHAIN.chainName, chainId: Number(chainId), vault: state.vault, staking: state.staking || null, complete: all }, null, 2);
      return;
    }
    $("#resultBox").hidden = !state.market;
    if(state.market) $("#result").textContent = JSON.stringify({
      network: CONFIG.CHAIN.chainName, chainId: Number(chainId), owner: me,
      usdt: state.usdt, token: state.token, market: state.market, complete: all
    }, null, 2);
  }

  async function connect(){
    await Wallets.discover();
    const w = Wallets.pick();
    if(!w) return toast("Install MetaMask first", true);
    eth = w.provider; walletName = w.info.name;
    await eth.request({ method: "eth_requestAccounts" });
    let id = BigInt(await eth.request({ method: "eth_chainId" }));
    if(id !== WANT_CHAIN){
      try{ await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: CONFIG.CHAIN.chainId }] }); }
      catch(e){ if(e.code === 4902 || e.data?.originalError?.code === 4902) await eth.request({ method: "wallet_addEthereumChain", params: [CONFIG.CHAIN] }); else throw e; }
      id = BigInt(await eth.request({ method: "eth_chainId" }));
    }
    if(id !== WANT_CHAIN) return toast(`${walletName} is on network ${id}, not ${CONFIG.CHAIN.chainName} (97). Switch it in ${walletName} and try again.`, true);
    provider = new ethers.BrowserProvider(eth);
    const net = await provider.getNetwork();
    signer = await provider.getSigner(); me = await signer.getAddress(); chainId = net.chainId;
    const bal = Number(ethers.formatEther(await provider.getBalance(me)));
    $("#who").innerHTML = `Connected with <b>${walletName}</b>: <b>${me.slice(0, 6)}…${me.slice(-4)}</b> on ${CONFIG.CHAIN.chainName} · Balance <b>${bal.toFixed(4)} tBNB</b>` +
      (bal < 0.05 ? ` · <span style="color:var(--no)">You need about 0.05 tBNB. Use the faucet button.</span>` : "");
    if((PHASE2 || PHASE3 || UPGRADE) && me.toLowerCase() !== String(C.owner).toLowerCase())
      return toast(`Connect with the wallet that owns the market (${C.owner.slice(0, 6)}…${C.owner.slice(-4)}). Switch account in MetaMask.`, true);
    $("#go").disabled = false;
    render(load(), steps($("#seed").checked));
  }

  async function go(){
    if(!art) art = await (await fetch("/deploy/artifacts.json")).json();
    const state = load(), list = steps($("#seed").checked);
    $("#go").disabled = true;
    for(const st of list){
      if(state.done[st.id]) continue;
      render(state, list, st.id);
      try{
        const r = await st.run(state);
        state.done[st.id] = r.tx; delete state.failed; save(state);
      }catch(e){
        state.failed = st.id; save(state); render(state, list);
        toast(e.shortMessage || e.reason || e.message || "Step failed", true);
        $("#go").disabled = false; return;
      }
    }
    render(state, list); $("#go").disabled = false;
    toast("All done. Copy the addresses below and send them to Claude.");
  }

  function showLive(){
    // everything is live: show the addresses, no deploy buttons
    document.querySelector("h1").textContent = "All 369X contracts are live";
    document.querySelector(".lede").innerHTML = "Nothing to deploy. These are the contracts your website uses on " + CONFIG.CHAIN.chainName + ".";
    document.querySelectorAll(".panel").forEach(el => el.hidden = true);
    const box = document.createElement("div"); box.className = "panel pad"; box.style.marginTop = "24px";
    box.innerHTML = ["usdt", "token", "market", "vault", "staking", "referral"].map(k => `<div class="bal-row"><span>${k}</span><a style="color:var(--cyan)" target="_blank" rel="noopener" href="${explorer}/address/${C[k]}">${C[k]}</a></div>`).join("");
    document.querySelector("main").appendChild(box);
    verifyPanel();
  }

  // ---- publish the source code (Sourcify: public, free, no API key) + files for BscScan ----
  const SOURCIFY = "https://sourcify.dev/server";
  const VERIFY = [
    ["usdt", "TestToken", ["string", "string", "uint256", "uint256"], () => ["369X Test USDT", "tUSDT", E(1000), E(10_000_000)]],
    ["token", "TestToken", ["string", "string", "uint256", "uint256"], () => ["369X Test Token", "t369X", E(5000), E(3_690_000_000)]],
    ["market", "Market369X", ["address", "address", "address", "address"], () => [C.usdt, C.token, C.owner, C.owner]],
    ["vault", "Vault369X", ["address", "address"], () => [C.usdt, C.market]],
    ["staking", "Stake369X", ["address", "address", "address"], () => [C.token, C.usdt, C.market]],
    ["referral", "Referral369X", ["address", "address"], () => [C.usdt, C.market]]
  ];
  function verifyPanel(){
    const box = document.createElement("div"); box.className = "panel pad"; box.style.marginTop = "16px";
    box.innerHTML = `<h2 class="h3">Publish the source code</h2>
      <p class="muted" style="margin-top:6px">Lets anyone check that these contracts run exactly the code in your project. Uses Sourcify, a free public verification service. No wallet, no fees, no keys.</p>
      <div class="hero-cta" style="margin-top:14px"><button class="btn btn-grad" id="verifyGo">Verify source code</button></div>
      <div class="steps-list" id="verifyList">${VERIFY.map(([k, n]) => `<div id="v-${k}"><span>${k} · ${n}</span><span class="muted">not checked</span></div>`).join("")}</div>
      <details style="margin-top:16px"><summary class="muted" style="cursor:pointer">Also want the green check on BscScan? (optional, manual)</summary>
        <ol class="muted" style="margin:10px 0 0 18px;display:grid;gap:6px;font-size:14px">
          <li><button class="btn btn-ghost btn-sm" id="dlInput">Download source file (369x-standard-input.json)</button></li>
          <li>On BscScan open a contract below → <b>Contract</b> tab → <b>Verify and Publish</b>.</li>
          <li>Compiler type <b>Solidity (Standard-Json-Input)</b>, version <b id="vVer"></b>, license <b>MIT</b>. Upload the file.</li>
          <li>Paste that contract's <b>constructor arguments</b> (Copy button below), then submit. Repeat for each contract.</li>
        </ol>
        <div style="margin-top:10px">${VERIFY.map(([k, n]) => `<div class="bal-row"><span>${k} · ${n}</span><span><a style="color:var(--cyan)" target="_blank" rel="noopener" href="${explorer}/verifyContract?a=${C[k]}">Verify on BscScan</a> · <button style="color:var(--lime)" data-args="${k}">Copy constructor args</button></span></div>`).join("")}</div>
      </details>`;
    document.querySelector("main").appendChild(box);
    let vj = null;
    const getVJ = async () => vj || (vj = await (await fetch("/deploy/verify.json")).json());
    const args = (k) => { const [, , types, vals] = VERIFY.find(v => v[0] === k); return ethers.AbiCoder.defaultAbiCoder().encode(types, vals()).slice(2); };
    box.querySelectorAll("[data-args]").forEach(b => b.onclick = async () => { const a = args(b.dataset.args); try{ await navigator.clipboard.writeText(a); toast("Constructor arguments copied"); }catch(e){ prompt("Copy:", a); } });
    getVJ().then(j => { $("#vVer").textContent = "v" + j.compilerVersion; }).catch(() => {});
    $("#dlInput").onclick = async () => {
      const j = await getVJ(), url = URL.createObjectURL(new Blob([JSON.stringify(j.input)], { type: "application/json" }));
      const a = document.createElement("a"); a.href = url; a.download = "369x-standard-input.json"; a.click(); setTimeout(() => URL.revokeObjectURL(url), 5000);
    };
    const chain = Number(CONFIG.CHAIN.chainId);
    const show = (k, html) => { const el = $("#v-" + k); if(el) el.lastElementChild.outerHTML = `<span>${html}</span>`; };
    const link = (k) => `<a style="color:var(--cyan)" target="_blank" rel="noopener" href="https://repo.sourcify.dev/${chain}/${C[k]}">✓ verified</a>`;
    async function status(addr){
      const r = await fetch(`${SOURCIFY}/v2/contract/${chain}/${addr}`);
      if(r.status === 404) return null;
      const j = await r.json(); return j.match || j.runtimeMatch || j.creationMatch || null;
    }
    async function verifyOne(k, name, j){
      const addr = C[k];
      if(await status(addr)) return show(k, link(k));
      show(k, "Sending…");
      const r = await fetch(`${SOURCIFY}/v2/verify/${chain}/${addr}`, { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ stdJsonInput: j.input, compilerVersion: j.compilerVersion, contractIdentifier: j.ids[name] }) });
      const body = await r.json().catch(() => ({}));
      if(r.status === 409) return show(k, link(k));                    // already verified
      if(!r.ok || !body.verificationId) throw new Error(body.message || ("Sourcify said " + r.status));
      for(let i = 0; i < 60; i++){
        await new Promise(res => setTimeout(res, 3000));
        const jj = await (await fetch(`${SOURCIFY}/v2/verify/${body.verificationId}`)).json();
        if(!jj.isJobCompleted){ show(k, "Checking…"); continue; }
        if(jj.error) throw new Error(jj.error.message || jj.error.customCode || "Not verified");
        return show(k, link(k));
      }
      throw new Error("Still checking. Press Verify again in a minute.");
    }
    $("#verifyGo").onclick = async () => {
      $("#verifyGo").disabled = true;
      let ok = 0;
      try{
        const j = await getVJ();
        for(const [k, name] of VERIFY){
          try{ await verifyOne(k, name, j); ok++; }
          catch(e){ show(k, `<span style="color:var(--no)">${String(e.message || e).replace(/</g, "&lt;").slice(0, 120)}</span>`); }
        }
      }catch(e){ toast(e.message || "Couldn't reach Sourcify", true); }
      $("#verifyGo").disabled = false;
      toast(ok === VERIFY.length ? "All contracts verified" : `${ok} of ${VERIFY.length} verified`, ok !== VERIFY.length);
    };
  }
  async function isV2(){
    for(const url of CONFIG.READ_RPCS){
      try{
        const p = new ethers.JsonRpcProvider(url, Number(CONFIG.CHAIN.chainId), { staticNetwork: true });
        const code = await p.getCode(C.staking);
        if(code === "0x") return true;                       // not readable: don't offer an upgrade
        try{ await new ethers.Contract(C.staking, ["function quorum() view returns (uint256)"], p).quorum(); return true; }
        catch(e){ if(e.code === "CALL_EXCEPTION") return false; throw e; }
      }catch(e){ /* next RPC */ }
    }
    return true;
  }
  if(C.vault && C.staking && C.referral){
    $("#seed").closest("label").hidden = true;
    document.querySelector("h1").textContent = "Checking your contracts…";
    $("#connect").disabled = true;                            // wait until we know what this page should do
    isV2().then(v2 => {
      if(v2) return showLive();
      UPGRADE = true; $("#connect").disabled = false;
      document.querySelector("h1").textContent = "Upgrade the vault and staking (v2)";
      document.querySelector(".lede").innerHTML = "One run, about <b>6 MetaMask confirmations</b> (free test BNB). Your markets, trades, tokens and referral program stay exactly as they are. " +
        "The new versions add a <b>minimum voter turnout</b>, make sure <b>fees can never get stuck</b> in the vault, stop the <b>first staker</b> from taking fees earned before they joined, and let you recover <b>slashed bonds</b>. " +
        "Old deposits and stakes stay safe in the old contracts; the website shows everyone a button to withdraw them.";
    });
  }
  if(PHASE3){
    document.querySelector("h1").textContent = "Add the referral program";
    document.querySelector(".lede").innerHTML = "Adds the on-chain <b>referral</b> contract (codes, invites and reward claims) and funds its reward pool. 2 MetaMask confirmations, paid in free test BNB.";
    $("#seed").closest("label").hidden = true;
  }
  if(PHASE2){
    document.querySelector("h1").textContent = "Add the vault and staking";
    document.querySelector(".lede").innerHTML = "Your markets are already live. This adds the <b>liquidity vault</b> and <b>$369X staking</b> contracts and connects them to your market. About 6 MetaMask confirmations, paid in free test BNB.";
    $("#seed").closest("label").hidden = true;
  }
  $("#connect").onclick = () => connect().catch(e => toast(e.shortMessage || e.message, true));
  $("#go").onclick = go;
  $("#seed").onchange = () => me && render(load(), steps($("#seed").checked));
  $("#reset").onclick = () => { if(me && confirm("This does NOT delete anything on the blockchain. It only forgets the progress saved in this browser, so the next Deploy creates a brand-new, separate set of contracts. Your website keeps using the current ones. Continue?")){ localStorage.removeItem(key()); render(load(), steps($("#seed").checked)); } };
  $("#copy").onclick = async () => { try{ await navigator.clipboard.writeText($("#result").textContent); toast("Copied"); }catch(e){ prompt("Copy:", $("#result").textContent); } };
})();
