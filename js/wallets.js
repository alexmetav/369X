/* =====================================================================
   Wallet discovery (EIP-6963)
   When several wallet extensions are installed (MetaMask, Phantom,
   Coinbase, Rabby...) they fight over window.ethereum. This asks every
   wallet to announce itself and prefers MetaMask.
   ===================================================================== */
const Wallets = {
  list: [],
  discover(timeout = 350){
    return new Promise((resolve) => {
      const found = [];
      const onAnnounce = (e) => { if(e.detail?.provider && !found.some(f => f.info.uuid === e.detail.info.uuid)) found.push(e.detail); };
      window.addEventListener("eip6963:announceProvider", onAnnounce);
      window.dispatchEvent(new Event("eip6963:requestProvider"));
      setTimeout(() => { window.removeEventListener("eip6963:announceProvider", onAnnounce); Wallets.list = found; resolve(found); }, timeout);
    });
  },
  // MetaMask first, then any announced wallet, then the old window.ethereum
  pick(){
    const l = Wallets.list;
    const mm = l.find(w => w.info.rdns === "io.metamask") || l.find(w => /metamask/i.test(w.info.name));
    if(mm) return mm;
    if(l.length) return l[0];
    const eth = window.ethereum; if(!eth) return null;
    const legacy = eth.providers?.find(p => p.isMetaMask && !p.isPhantom && !p.isBraveWallet) || eth;
    return { info: { name: legacy.isMetaMask && !legacy.isPhantom ? "MetaMask" : "Browser wallet", rdns: "" }, provider: legacy };
  }
};
