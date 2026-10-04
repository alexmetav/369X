const { expect } = require("chai");
const { ethers, network } = require("hardhat");

const E = (n) => ethers.parseEther(String(n));
const F = (x) => Number(ethers.formatEther(x));
const DAY = 86400;

async function deploy() {
  const [owner, alice, bob, carol, dave] = await ethers.getSigners();
  const Token = await ethers.getContractFactory("TestToken");
  const usdt = await Token.deploy("Test USDT", "tUSDT", E(1000), E(10_000_000));
  const x369 = await Token.deploy("Test 369X", "t369X", E(5000), E(3_690_000_000));
  const Market = await ethers.getContractFactory("Market369X");
  const market = await Market.deploy(usdt, x369, owner.address, owner.address);
  await usdt.approve(market, ethers.MaxUint256);
  await x369.approve(market, ethers.MaxUint256);
  await market.fundReserve(E(1_000_000));
  for (const u of [alice, bob, carol, dave]) {
    await usdt.mint(u.address, E(10_000_000));
    await x369.mint(u.address, E(10_000));
    await usdt.connect(u).approve(market, ethers.MaxUint256);
    await x369.connect(u).approve(market, ethers.MaxUint256);
  }
  const now = (await ethers.provider.getBlock("latest")).timestamp;
  return { owner, alice, bob, carol, dave, usdt, x369, market, now };
}

// JS reference LMSR, same as the website
const fs = require("fs"), path = require("path");
const LMSR = new Function(fs.readFileSync(path.join(__dirname, "../../js/lmsr.js"), "utf8") + "; return LMSR;")();
const lmsr = { priceYes: (qy, qn, b) => LMSR.priceYes({ qY: qy, qN: qn, b }) };

describe("TestToken faucet", () => {
  it("gives tokens once per 24h", async () => {
    const { alice, usdt } = await deploy();
    const before = await usdt.balanceOf(alice);
    await usdt.connect(alice).faucet();
    expect(await usdt.balanceOf(alice) - before).to.equal(E(1000));
    await expect(usdt.connect(alice).faucet()).to.be.revertedWith("Faucet: try again later");
    await network.provider.send("evm_increaseTime", [DAY]);
    await usdt.connect(alice).faucet();
  });
  it("only owner can mint", async () => {
    const { alice, usdt } = await deploy();
    await expect(usdt.connect(alice).mint(alice.address, 1)).to.be.reverted;
  });
});

describe("Market369X", () => {
  async function withMarket(p = 0.5) {
    const ctx = await deploy();
    await ctx.market.connect(ctx.alice).createMarket("Will 369X reach 10,000 users by 2027?", "369X public dashboard", ctx.now + 30 * DAY, E(p));
    return ctx;
  }

  it("creates a market at the requested price and takes the bond", async () => {
    const { market, alice, x369 } = await withMarket(0.62);
    const [m, p] = await market.getMarket(0);
    expect(F(p)).to.be.closeTo(0.62, 1e-9);
    expect(m.creator).to.equal(alice.address);
    expect(await x369.balanceOf(alice)).to.equal(E(9000));
  });

  it("rejects bad market inputs", async () => {
    const { market, alice, now } = await deploy();
    await expect(market.connect(alice).createMarket("too short?", "source", now + 30 * DAY, E(0.5))).to.be.revertedWith("Question length");
    await expect(market.connect(alice).createMarket("Will this be a valid market question?", "source", now + 60, E(0.5))).to.be.revertedWith("Bad end time");
    await expect(market.connect(alice).createMarket("Will this be a valid market question?", "source", now + 30 * DAY, E(0.99))).to.be.revertedWith("Start price 5%-95%");
  });

  it("buying YES raises the YES price and matches the JS formula", async () => {
    const { market, alice } = await withMarket();
    const [q] = await market.quoteBuy(0, true, E(1000));
    await market.connect(alice).buy(0, true, E(1000), q);
    const [m, p] = await market.getMarket(0);
    expect(F(p)).to.be.greaterThan(0.5);
    expect(F(p)).to.be.closeTo(lmsr.priceYes(F(m.qYes), F(m.qNo), F(m.b)), 1e-9);
    expect(await market.yesShares(0, alice)).to.equal(q);
    // same number of shares as the website's own LMSR code (985 after fees, starting at 50c, b=5000)
    expect(F(q)).to.be.closeTo(LMSR.sharesFor(LMSR.init(0.5, 5000), "YES", 985), 1e-6);
  });

  it("protects against price moves (slippage)", async () => {
    const { market, alice, bob } = await withMarket();
    const [q] = await market.quoteBuy(0, true, E(1000));
    await market.connect(bob).buy(0, true, E(5000), 0);
    await expect(market.connect(alice).buy(0, true, E(1000), q)).to.be.revertedWith("Price moved");
  });

  it("sell returns less than paid (fees + spread) and cannot oversell", async () => {
    const { market, usdt, alice } = await withMarket();
    const start = await usdt.balanceOf(alice);
    const sh = await market.connect(alice).buy.staticCall(0, true, E(500), 0);
    await market.connect(alice).buy(0, true, E(500), 0);
    await expect(market.connect(alice).sell(0, true, sh + 1n, 0)).to.be.revertedWith("Not enough shares");
    await market.connect(alice).sell(0, true, sh, 0);
    const lost = F(start - (await usdt.balanceOf(alice)));
    expect(lost).to.be.greaterThan(14).and.lessThan(16); // ~1.5% in + ~1.5% out
  });

  it("blocks trading after the end and resolving before it", async () => {
    const { market, owner, alice } = await withMarket();
    await expect(market.resolve(0, true, false)).to.be.revertedWith("Not ended yet");
    await network.provider.send("evm_increaseTime", [31 * DAY]);
    await network.provider.send("evm_mine");
    await expect(market.connect(alice).buy(0, true, E(10), 0)).to.be.revertedWith("Market closed");
    await expect(market.connect(alice).resolve(0, true, false)).to.be.revertedWith("Not resolver");
    await market.connect(owner).resolve(0, true, false);
    await expect(market.resolve(0, false, false)).to.be.revertedWith("Already resolved");
  });

  it("pays winners 1:1, losers nothing, returns bond and creator fees", async () => {
    const { market, usdt, x369, alice, bob, carol } = await withMarket();
    await market.connect(bob).buy(0, true, E(2000), 0);
    await market.connect(carol).buy(0, false, E(1500), 0);
    const bobShares = await market.yesShares(0, bob);
    await network.provider.send("evm_increaseTime", [31 * DAY]);
    await market.resolve(0, true, false);
    const b0 = await usdt.balanceOf(bob);
    await market.connect(bob).redeem(0);
    expect(await usdt.balanceOf(bob) - b0).to.equal(bobShares);
    await expect(market.connect(carol).redeem(0)).to.be.revertedWith("Nothing to redeem");
    await expect(market.connect(bob).redeem(0)).to.be.revertedWith("Nothing to redeem");
    expect(await x369.balanceOf(alice)).to.equal(E(10_000));          // bond back
    const a0 = await usdt.balanceOf(alice);
    await market.connect(alice).claimCreatorFees(0);
    expect(F(await usdt.balanceOf(alice) - a0)).to.be.closeTo(3500 * 0.005, 1e-6);
    await expect(market.connect(bob).claimCreatorFees(0)).to.be.revertedWith("Not creator");
  });

  it("slashed bond goes to the fee recipient", async () => {
    const { market, x369, owner, alice } = await withMarket();
    await network.provider.send("evm_increaseTime", [31 * DAY]);
    const before = await x369.balanceOf(owner);
    await market.resolve(0, false, true);
    expect(await x369.balanceOf(owner) - before).to.equal(E(1000));
    expect(await x369.balanceOf(alice)).to.equal(E(9000));
  });

  it("admin functions are owner-only and fees are capped", async () => {
    const { market, alice } = await deploy();
    await expect(market.connect(alice).setFees(0, 0)).to.be.reverted;
    await expect(market.connect(alice).withdrawReserve(1, alice.address)).to.be.reverted;
    await expect(market.setFees(300, 300)).to.be.revertedWith("Fees too high");
  });

  it("STRESS: 300 random trades, every winner can always be paid", async function () {
    this.timeout(300000);
    const { market, usdt, owner, alice, bob, carol, dave, now } = await deploy();
    const users = [alice, bob, carol, dave];
    const starts = [0.08, 0.5, 0.93];
    for (const p of starts) await market.connect(alice).createMarket(`Stress market starting at ${p} chance?`, "test source", now + 10 * DAY, E(p));
    let seed = 42; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 300; i++) {
      const id = Math.floor(rnd() * starts.length), u = users[Math.floor(rnd() * 4)], yes = rnd() < 0.5;
      const held = yes ? await market.yesShares(id, u) : await market.noShares(id, u);
      if (held > 0n && rnd() < 0.35) await market.connect(u).sell(id, yes, held * BigInt(Math.floor(rnd() * 100) + 1) / 100n, 0);
      else await market.connect(u).buy(id, yes, E(Math.floor(10 + rnd() ** 2 * 8000)), 0);
    }
    await network.provider.send("evm_increaseTime", [11 * DAY]);
    for (let id = 0; id < starts.length; id++) {
      const outcome = rnd() < 0.5;
      const [m] = await market.getMarket(id);
      // solvency BEFORE settlement: the market's own pool covers every winning share
      const owed = F(outcome ? m.qYes - m.q0Yes : m.qNo - m.q0No);
      expect(F(m.pool)).to.be.at.least(owed);
      await market.resolve(id, outcome, false);
      for (const u of users) { const s = outcome ? await market.yesShares(id, u) : await market.noShares(id, u); if (s > 0n) await market.connect(u).redeem(id); }
      const [m2] = await market.getMarket(id);
      expect(m2.pool).to.be.lessThan(E(0.000001)); // only rounding dust left
    }
    // contract holds at least reserve + unpaid fees
    let fees = await market.protocolFees();
    for (let id = 0; id < starts.length; id++) { const [m] = await market.getMarket(id); fees += m.creatorFees + m.pool; }
    expect(await usdt.balanceOf(market)).to.be.at.least((await market.reserve()) + fees);
    // the reserve never ends up below its start minus the worst-case subsidies
    expect(F(await market.reserve())).to.be.greaterThan(1_000_000 - 3 * 5000 * Math.log(1 / 0.07));
  });
});
