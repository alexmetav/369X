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
  const PHASE2 = !!C.market;                 // core contracts exist: this page now adds the vault + staking
  const REWARD_POOL = 1_000_000;

  function toast(msg, bad){
    const t = $("#toast"); t.textContent = msg; t.style.color = bad ? "var(--no)" : "";
    t.classList.add("show"); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove("show"), 3500);
  }
  const key = () => `369x:deploy${PHASE2 ? "2" : ""}:${chainId}:${me}`;
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

  function steps(seed){
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
    if(PHASE2 && me.toLowerCase() !== String(C.owner).toLowerCase())
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
