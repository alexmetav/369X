const { expect } = require("chai");
const { ethers } = require("hardhat");
const fs = require("fs"), path = require("path");
const Referral = require("../../js/referral.js");
const CONFIG = new Function(fs.readFileSync(path.join(__dirname, "../../js/config.js"), "utf8") + "; return CONFIG;")();

const E = (n) => ethers.parseEther(String(n));
const F = (x) => Number(ethers.formatEther(x));

async function setup() {
  const [owner, alice, bob, carol, dave] = await ethers.getSigners();
  const T = await ethers.getContractFactory("TestToken");
  const usdt = await T.deploy("Test USDT", "tUSDT", E(1000), E(10_000_000));
  const x = await T.deploy("Test 369X", "t369X", E(5000), E(3_690_000_000));
  const market = await (await ethers.getContractFactory("Market369X")).deploy(usdt, x, owner.address, owner.address);
  const ref = await (await ethers.getContractFactory("Referral369X")).deploy(usdt, market);
  await usdt.approve(market, ethers.MaxUint256); await x.approve(market, ethers.MaxUint256);
  await market.fundReserve(E(1_000_000));
  for (const u of [alice, bob, carol, dave]) { await usdt.mint(u.address, E(1_000_000)); await usdt.connect(u).approve(market, ethers.MaxUint256); }
  const now = (await ethers.provider.getBlock("latest")).timestamp;
  await market.createMarket("Will the referral program test pass today?", "test source", now + 10 * 86400, E(0.5));
  return { owner, alice, bob, carol, dave, usdt, market, ref };
}

// read events exactly like the website does
async function events(market, ref) {
  const logs = await ethers.provider.getLogs({ address: [await market.getAddress(), await ref.getAddress()], fromBlock: 0, toBlock: "latest" });
  const out = [];
  for (const l of logs) {
    let ev = null;
    try { ev = market.interface.parseLog(l); } catch (e) {}
    if (!ev) try { ev = ref.interface.parseLog(l); } catch (e) {}
    if (!ev) continue;
    if (ev.name === "Trade") out.push({ kind: "trade", block: l.blockNumber, logIndex: l.index, user: ev.args.user, fee: ev.args.fee, amount: ev.args.amount });
    if (ev.name === "ReferrerSet") out.push({ kind: "ref", block: l.blockNumber, logIndex: l.index, user: ev.args.user, referrer: ev.args.referrer });
  }
  return out;
}

describe("Referral369X", () => {
  it("validates codes and invites", async () => {
    const { alice, bob, ref } = await setup();
    await expect(ref.connect(alice).registerCode("ab")).to.be.revertedWith("Use 3 to 20 characters");
    await expect(ref.connect(alice).registerCode("Alice")).to.be.revertedWith("Use lowercase letters, numbers, - or _");
    await ref.connect(alice).registerCode("alice");
    await expect(ref.connect(alice).registerCode("alice2")).to.be.revertedWith("You already have a code");
    await expect(ref.connect(bob).registerCode("alice")).to.be.revertedWith("That code is taken");
    await expect(ref.connect(alice).setReferrer("alice")).to.be.revertedWith("You can't refer yourself");
    await expect(ref.connect(bob).setReferrer("nobody")).to.be.revertedWith("Unknown referral code");
    await ref.connect(bob).setReferrer("alice");
    await expect(ref.connect(bob).setReferrer("alice")).to.be.revertedWith("You already have a referrer");
    await ref.connect(bob).registerCode("bob");
    await expect(ref.connect(alice).setReferrer("bob")).to.be.revertedWith("You can't refer your own referrer");
    expect(await ref.ownerOfCode("alice")).to.equal(alice.address);
  });

  it("computes rewards from trades, publishes a Merkle root, and pays claims", async () => {
    const { owner, alice, bob, carol, dave, usdt, market, ref } = await setup();
    await market.connect(bob).buy(0, true, E(1000), 0);           // before bob accepts the invite: earns nothing
    await ref.connect(alice).registerCode("alice");
    await ref.connect(bob).setReferrer("alice");
    await ref.connect(bob).registerCode("bob");
    await ref.connect(carol).setReferrer("bob");
    await market.connect(bob).buy(0, true, E(10_000), 0);         // fee 150 -> protocol 100
    await market.connect(carol).buy(0, false, E(5_000), 0);       // fee 75  -> protocol 50
    await market.connect(dave).buy(0, true, E(2_000), 0);         // no referrer: nothing

    const r = Referral.compute(await events(market, ref), CONFIG);
    const owed = (s) => F(r.owed.get(s.address.toLowerCase()) || 0n);
    expect(owed(alice)).to.be.closeTo(20 + 2.5, 1e-9);            // 20% of 100 + 5% (level 2) of 50
    expect(owed(bob)).to.be.closeTo(10 + 15, 1e-9);               // 20% of 50 + 10% rebate of 150
    expect(owed(carol)).to.be.closeTo(7.5, 1e-9);                 // 10% rebate of 75
    expect(owed(dave)).to.equal(0);

    const t = Referral.tree(r.owed);
    const snap = await ethers.provider.getBlockNumber();
    await expect(ref.publish(t.root, snap, t.total)).to.be.revertedWith("Fund the reward pool first");
    await usdt.transfer(ref, E(1000));
    await ref.publish(t.root, snap, t.total);
    await expect(ref.connect(alice).publish(t.root, snap, t.total)).to.be.reverted;

    for (const u of [alice, bob, carol]) {
      const a = u.address.toLowerCase(), before = await usdt.balanceOf(u);
      await ref.connect(u).claim(t.amounts.get(a), t.proofs.get(a));
      expect(await usdt.balanceOf(u) - before).to.equal(t.amounts.get(a));
      await expect(ref.connect(u).claim(t.amounts.get(a), t.proofs.get(a))).to.be.revertedWith("Nothing to claim");
    }
    // can't claim someone else's amount or a bigger amount
    await expect(ref.connect(dave).claim(t.amounts.get(alice.address.toLowerCase()), t.proofs.get(alice.address.toLowerCase()))).to.be.revertedWith("Invalid proof");

    // more trading, second publish: claims pay only the difference
    await market.connect(bob).buy(0, true, E(10_000), 0);
    const r2 = Referral.compute(await events(market, ref), CONFIG), t2 = Referral.tree(r2.owed);
    await ref.publish(t2.root, await ethers.provider.getBlockNumber(), t2.total);
    const a = alice.address.toLowerCase(), b0 = await usdt.balanceOf(alice);
    await ref.connect(alice).claim(t2.amounts.get(a), t2.proofs.get(a));
    expect(F(await usdt.balanceOf(alice) - b0)).to.be.closeTo(20, 1e-9);
    // owner can't withdraw money that is owed
    const owedLeft = (await ref.totalPublished()) - (await ref.totalClaimed());
    const pool = await ref.pool();
    await expect(ref.withdrawExcess(pool - owedLeft + 1n, owner.address)).to.be.revertedWith("That money is owed to users");
    await ref.withdrawExcess(pool - owedLeft, owner.address);
  });

  it("tier rate rises with referred volume", async () => {
    const { alice, bob, market, ref } = await setup();
    await ref.connect(alice).registerCode("alice");
    await ref.connect(bob).setReferrer("alice");
    await market.connect(bob).buy(0, true, E(30_000), 0);   // counted at 20%, volume now 30k (Pro tier from 25k)
    await market.connect(bob).sell(0, true, (await market.yesShares(0, bob)) / 2n, 0); // counted at 25%
    const evs = await events(market, ref), trades = evs.filter(e => e.kind === "trade");
    const r = Referral.compute(evs, CONFIG);
    const p = (fee) => Number(ethers.formatEther(fee)) * 100 / 150;
    const expected = p(trades[0].fee) * 0.20 + p(trades[1].fee) * 0.25;
    expect(F(r.owed.get(alice.address.toLowerCase()))).to.be.closeTo(expected, 1e-9);
  });

  it("single-claimer tree works (empty proof)", async () => {
    const { alice, usdt, ref } = await setup();
    const t = Referral.tree(new Map([[alice.address.toLowerCase(), E(5)]]));
    await usdt.transfer(ref, E(5));
    await ref.publish(t.root, await ethers.provider.getBlockNumber(), t.total);
    await ref.connect(alice).claim(E(5), []);
  });
});
