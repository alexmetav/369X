/* 369X contract deployer: runs in the browser with MetaMask. No private keys leave the wallet. */
(function(){
  const $ = (s) => document.querySelector(s);
  const E = (n) => ethers.parseEther(String(n));
  const explorer = CONFIG.CHAIN.blockExplorerUrls[0];
  const WANT_CHAIN = BigInt(CONFIG.CHAIN.chainId);
  let provider, signer, me, chainId, art;

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

  function toast(msg, bad){
    const t = $("#toast"); t.textContent = msg; t.style.color = bad ? "var(--no)" : "";
    t.classList.add("show"); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove("show"), 3500);
  }
  const key = () => `369x:deploy:${chainId}:${me}`;
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

  function steps(seed){
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
    $("#resultBox").hidden = !state.market;
    if(state.market) $("#result").textContent = JSON.stringify({
      network: CONFIG.CHAIN.chainName, chainId: Number(chainId), owner: me,
      usdt: state.usdt, token: state.token, market: state.market, complete: all
    }, null, 2);
  }

  async function connect(){
    if(!window.ethereum) return toast("Install MetaMask first", true);
    provider = new ethers.BrowserProvider(window.ethereum);
    await provider.send("eth_requestAccounts", []);
    let net = await provider.getNetwork();
    if(net.chainId !== WANT_CHAIN){
      try{ await provider.send("wallet_switchEthereumChain", [{ chainId: CONFIG.CHAIN.chainId }]); }
      catch(e){ if(e.code === 4902 || e.error?.code === 4902) await provider.send("wallet_addEthereumChain", [CONFIG.CHAIN]); else throw e; }
      provider = new ethers.BrowserProvider(window.ethereum);
      net = await provider.getNetwork();
    }
    if(net.chainId !== WANT_CHAIN) return toast("Please switch MetaMask to " + CONFIG.CHAIN.chainName, true);
    signer = await provider.getSigner(); me = await signer.getAddress(); chainId = net.chainId;
    const bal = Number(ethers.formatEther(await provider.getBalance(me)));
    $("#who").innerHTML = `Connected: <b>${me.slice(0, 6)}…${me.slice(-4)}</b> on ${CONFIG.CHAIN.chainName} · Balance <b>${bal.toFixed(4)} tBNB</b>` +
      (bal < 0.05 ? ` · <span style="color:var(--no)">You need about 0.05 tBNB. Use the faucet button.</span>` : "");
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

  $("#connect").onclick = () => connect().catch(e => toast(e.shortMessage || e.message, true));
  $("#go").onclick = go;
  $("#seed").onchange = () => me && render(load(), steps($("#seed").checked));
  $("#reset").onclick = () => { if(me && confirm("Forget saved progress and deploy fresh contracts?")){ localStorage.removeItem(key()); render(load(), steps($("#seed").checked)); } };
  $("#copy").onclick = async () => { try{ await navigator.clipboard.writeText($("#result").textContent); toast("Copied"); }catch(e){ prompt("Copy:", $("#result").textContent); } };
})();
