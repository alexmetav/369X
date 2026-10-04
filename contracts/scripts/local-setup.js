// Local test chain setup: deploy everything like the /deploy page does, plus a market that ends soon.
const { ethers } = require("hardhat");
async function main(){
  const [owner] = await ethers.getSigners();
  const E = (n) => ethers.parseEther(String(n));
  const T = await ethers.getContractFactory("TestToken");
  const usdt = await T.deploy("369X Test USDT", "tUSDT", E(1000), E(10_000_000));
  const tok = await T.deploy("369X Test Token", "t369X", E(5000), E(3_690_000_000));
  const M = await ethers.getContractFactory("Market369X");
  const m = await M.deploy(usdt, tok, owner.address, owner.address);
  await usdt.approve(m, E(1_000_000)); await m.fundReserve(E(1_000_000));
  await tok.approve(m, E(10_000));
  const now = (await ethers.provider.getBlock("latest")).timestamp;
  await m.createMarket("Will Bitcoin trade above $150K before Dec 31, 2026?", "CoinGecko BTC/USD price", now + 60 * 86400, E(0.41));
  await m.createMarket("Will the Fed cut rates at the November 2026 meeting?", "federalreserve.gov FOMC statement", now + 30 * 86400, E(0.62));
  await m.createMarket("Will this short test market resolve YES soon?", "[World] test source", now + 2 * 3600, E(0.5));
  console.log(JSON.stringify({ usdt: await usdt.getAddress(), token: await tok.getAddress(), market: await m.getAddress(), owner: owner.address }));
}
main().catch(e => { console.error(e); process.exit(1); });
