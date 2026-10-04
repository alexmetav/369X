/* =====================================================================
   WALLET
   Uses a real browser wallet (MetaMask, Trust Wallet, Coinbase Wallet,
   Rabby, Binance Wallet...) when one is installed and switches it to the
   chain in CONFIG.CHAIN. With no wallet installed, demo mode falls back
   to a demo address; on-chain and live modes ask for a real wallet
   (on phones: a link that opens this site inside the MetaMask app).
   ===================================================================== */
const wallet = {
  get address(){ return store.get("wallet", null)?.address || null; },
  get kind(){ return store.get("wallet", null)?.kind || null; },
  chainId: null,
  get wrongChain(){ return this.kind === "injected" && this.chainId && this.chainId.toLowerCase() !== CONFIG.CHAIN.chainId.toLowerCase(); },
  picked: null,                                            // { info: {name, rdns}, provider } from Wallets.pick()
  provider(){ return this.picked?.provider || null; },
  get name(){ return this.picked?.info?.name || "Wallet"; },

  async connect(){
    if(!this.picked){ await Wallets.discover(); this.picked = Wallets.pick(); }
    const eth = this.provider();
    const realOnly = backend.live || (typeof CHAIN_ON !== "undefined" && CHAIN_ON);
    if(!eth && realOnly){
      if(/Android|iPhone|iPad|iPod/i.test(navigator.userAgent)){
        if(confirm("No wallet found in this browser.\n\nOpen this site inside the MetaMask app?")) location.href = "https://metamask.app.link/dapp/" + location.host + location.pathname + location.hash;
      }else toast("No wallet found. Install MetaMask (metamask.io), then refresh this page.", true);
      return;
    }
    if(!eth){
      store.set("wallet", { address: randAddr(), kind: "demo" });
      toast("No wallet app found, using a demo wallet");
      return this.changed();
    }
    try{
      const [addr] = await eth.request({ method: "eth_requestAccounts" });
      this.chainId = await eth.request({ method: "eth_chainId" });
      if(this.wrongChain) await this.switchChain();
      if(backend.live){ toast("Check your wallet to sign in (free)"); await backend.login(addr); }
      store.set("wallet", { address: addr, kind: "injected" });
      toast("Wallet connected");
      this.changed();
    }catch(e){
      store.set("wallet", null);
      toast(e.code === 4001 ? "Connection cancelled" : (e.message || "Could not connect"), true);
    }
  },
  async switchChain(){
    const eth = this.provider(); if(!eth) return;
    try{
      await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: CONFIG.CHAIN.chainId }] });
    }catch(e){
      if(e.code === 4902){ // chain not added yet
        try{ await eth.request({ method: "wallet_addEthereumChain", params: [CONFIG.CHAIN] }); }
        catch(e2){ toast("Please add " + CONFIG.CHAIN.chainName + " in your wallet", true); }
      }else if(e.code !== 4001) toast(e.message || "Could not switch network", true);
    }
    this.chainId = await eth.request({ method: "eth_chainId" }).catch(() => this.chainId);
    this.changed();
  },
  disconnect(){ store.set("wallet", null); if(backend.live) backend.logout(); toast("Wallet disconnected"); this.changed(); },
  changed(){ if(typeof onWalletChange === "function") onWalletChange(); },

  // restore a previous session silently and follow account / network changes
  async init(){
    if((backend.live || (typeof CHAIN_ON !== "undefined" && CHAIN_ON)) && this.kind === "demo") store.set("wallet", null);   // demo wallets can't sign transactions
    await Wallets.discover(); this.picked = Wallets.pick();
    const eth = this.provider(); if(!eth) return;
    try{
      this.chainId = await eth.request({ method: "eth_chainId" });
      if(this.kind === "injected"){
        const [addr] = await eth.request({ method: "eth_accounts" });
        // in live mode the database session must belong to the same wallet
        const ok = addr && (!backend.live || (await backend.sessionAddress()) === addr.toLowerCase());
        if(ok) store.set("wallet", { address: addr, kind: "injected" }); else store.set("wallet", null);
      }
    }catch(e){}
    eth.on?.("accountsChanged", (accs) => {
      if(this.kind !== "injected") return;
      if(backend.live){ backend.logout(); store.set("wallet", null); toast("Wallet account changed. Connect again to sign in."); return this.changed(); }
      store.set("wallet", accs[0] ? { address: accs[0], kind: "injected" } : null); this.changed();
    });
    eth.on?.("chainChanged", (id) => { this.chainId = id; this.changed(); });
  }
};
