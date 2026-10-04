const { expect } = require("chai");
const { ethers, network } = require("hardhat");

const E = (n) => ethers.parseEther(String(n));
const F = (x) => Number(ethers.formatEther(x));
const DAY = 86400;
const jump = async (s) => { await network.provider.send("evm_increaseTime", [s]); await network.provider.send("evm_mine"); };

async function setup() {
  const [owner, alice, bob, carol] = await ethers.getSigners();
  const T = await ethers.getContractFactory("TestToken");
  const usdt = await T.deploy("Test USDT", "tUSDT", E(1000), E(10_000_000));
  const x = await T.deploy("Test 369X", "t369X", E(5000), E(3_690_000_000));
  const market = await (await ethers.getContractFactory("Market369X")).deploy(usdt, x, owner.address, owner.address);
  const vault = await (await ethers.getContractFactory("Vault369X")).deploy(usdt, market);
  const stake = await (await ethers.getContractFactory("Stake369X")).deploy(x, usdt, market);
  await vault.setStaking(stake);
  await market.setFeeRecipient(vault);
  await market.setResolver(stake);
  await usdt.approve(market, ethers.MaxUint256); await x.approve(market, ethers.MaxUint256);
  await market.fundReserve(E(1_000_000));
  await x.transfer(stake, E(1_000_000));                     // voting reward pool
  for (const u of [alice, bob, carol]) {
    await usdt.mint(u.address, E(1_000_000)); await x.mint(u.address, E(100_000));
    for (const c of [market, vault]) await usdt.connect(u).approve(c, ethers.MaxUint256);
    for (const c of [market, stake]) await x.connect(u).approve(c, ethers.MaxUint256);
  }
  const now = (await ethers.provider.getBlock("latest")).timestamp;
  await market.createMarket("Will the vault and staking test pass today?", "test source", now + 10 * DAY, E(0.5));
  return { owner, alice, bob, carol, usdt, x, market, vault, stake };
}

describe("Vault369X", () => {
  it("depositors earn 80% of protocol fees pro rata, stakers 20%", async () => {
    const { alice, bob, carol, usdt, market, vault, stake } = await setup();
    await vault.connect(alice).deposit(E(3000), 0);
    await vault.connect(bob).deposit(E(1000), 0);
    await stake.connect(carol).stake(E(10_000));
    await market.connect(carol).buy(0, true, E(10_000), 0);       // protocol fee = 1% = 100
    expect(F(await market.protocolFees())).to.be.closeTo(100, 1e-9);
    // pending shows before anyone harvests
    const [, pa] = await vault.depositsOf(alice.address);
    expect(F(pa[0])).to.be.closeTo(60, 1e-6);                    // 80 * 3/4
    await vault.harvest();
    expect(F(await usdt.balanceOf(stake))).to.be.closeTo(20, 1e-6);
    const b0 = await usdt.balanceOf(alice);
    await vault.connect(alice).claim(0);
    expect(F(await usdt.balanceOf(alice) - b0)).to.be.closeTo(60, 1e-6);
    const [, pb] = await vault.depositsOf(bob.address);
    expect(F(pb[0])).to.be.closeTo(20, 1e-6);
    expect(F(await stake.pendingFees(carol.address))).to.be.closeTo(20, 1e-6);
  });

  it("late depositors don't get fees earned before they joined", async () => {
    const { alice, bob, carol, market, vault } = await setup();
    await vault.connect(alice).deposit(E(1000), 0);
    await market.connect(carol).buy(0, true, E(5000), 0);       // 50 fee before bob joins
    await vault.connect(bob).deposit(E(1000), 0);               // deposit harvests first
    const [, pa] = await vault.depositsOf(alice.address), [, pb] = await vault.depositsOf(bob.address);
    expect(F(pa[0])).to.be.closeTo(40, 1e-6);
    expect(F(pb[0])).to.equal(0);
  });

  it("locked deposits can't be withdrawn early; flex can; points use the multiplier", async () => {
    const { alice, usdt, vault } = await setup();
    await vault.connect(alice).deposit(E(100), 3);   // 365 days, 8x
    await vault.connect(alice).deposit(E(100), 0);   // flex, 1x
    await expect(vault.connect(alice).withdraw(0)).to.be.revertedWith("Still locked");
    await jump(10 * DAY);
    expect(F(await vault.pointsOf(alice.address))).to.be.closeTo(100 * 8 * 10 + 100 * 10, 1);
    const b0 = await usdt.balanceOf(alice);
    await vault.connect(alice).withdraw(1);
    expect(await usdt.balanceOf(alice) - b0).to.equal(E(100));
    await expect(vault.connect(alice).withdraw(1)).to.be.revertedWith("Already withdrawn");
    await jump(356 * DAY);
    await vault.connect(alice).withdraw(0);
    expect(await vault.totalDeposits()).to.equal(0);
  });

  it("with no depositors, all fees go to stakers", async () => {
    const { carol, usdt, market, vault, stake } = await setup();
    await market.connect(carol).buy(0, true, E(1000), 0);
    await vault.harvest();
    expect(F(await usdt.balanceOf(stake))).to.be.closeTo(10, 1e-9);
  });
});

describe("Stake369X", () => {
  it("stakers share fees pro rata and can claim", async () => {
    const { alice, bob, carol, usdt, market, vault, stake } = await setup();
    await stake.connect(alice).stake(E(3000));
    await stake.connect(bob).stake(E(1000));
    await market.connect(carol).buy(0, true, E(20_000), 0);   // 200 fee, no LPs -> all to stakers
    await vault.harvest();
    expect(F(await stake.pendingFees(alice.address))).to.be.closeTo(150, 1e-6);
    const b0 = await usdt.balanceOf(bob);
    await stake.connect(bob).claimFees();
    expect(F(await usdt.balanceOf(bob) - b0)).to.be.closeTo(50, 1e-6);
    await expect(stake.connect(bob).claimFees()).to.be.revertedWith("Nothing to claim");
  });

  it("voting resolves the market; winners redeem, correct voters earn 1%", async () => {
    const { alice, bob, carol, x, market, stake } = await setup();
    await market.connect(carol).buy(0, true, E(1000), 0);
    const carolShares = await market.yesShares(0, carol);
    await stake.connect(alice).stake(E(30_000));
    await stake.connect(bob).stake(E(10_000));
    await expect(stake.connect(alice).vote(0, true)).to.be.revertedWith("Market has not ended");
    await jump(10 * DAY);
    await stake.connect(alice).vote(0, true);
    await stake.connect(bob).vote(0, false);
    await expect(stake.connect(alice).vote(0, false)).to.be.revertedWith("Already voted");
    await expect(stake.connect(carol).vote(0, true)).to.be.revertedWith("Stake $369X to vote");
    await expect(stake.finalize(0)).to.be.revertedWith("Voting still open");
    await expect(stake.connect(alice).unstake(E(1))).to.be.revertedWith("Locked until your votes close");
    await jump(2 * DAY);
    await stake.connect(carol).finalize(0);                    // anyone can finalize
    const [m] = await market.getMarket(0);
    expect(m.status).to.equal(1n); expect(m.outcomeYes).to.equal(true);
    await market.connect(carol).redeem(0);
    expect(await market.yesShares(0, carol)).to.equal(0n);
    expect(carolShares).to.be.greaterThan(0n);
    const a0 = await x.balanceOf(alice);
    await stake.connect(alice).claimVoteReward(0);
    expect(await x.balanceOf(alice) - a0).to.equal(E(300));     // 1% of 30,000
    await expect(stake.connect(alice).claimVoteReward(0)).to.be.revertedWith("Already claimed");
    await expect(stake.connect(bob).claimVoteReward(0)).to.be.revertedWith("No reward for this vote");
    await stake.connect(alice).unstake(E(30_000));             // unlocked after the window
  });

  it("owner can still settle directly; finalize then records that outcome", async () => {
    const { owner, alice, market, stake } = await setup();
    await stake.connect(alice).stake(E(1000));
    await jump(10 * DAY);
    await stake.connect(alice).vote(0, false);
    await market.connect(owner).resolve(0, false, false);
    await stake.finalize(0);
    const t = await stake.tallies(0);
    expect(t.finalized).to.equal(true); expect(t.outcomeYes).to.equal(false);
    await stake.connect(alice).claimVoteReward(0);
  });

  it("only the owner can change settings; nobody else can resolve the market", async () => {
    const { alice, market, stake, vault } = await setup();
    await expect(stake.connect(alice).setVotingPeriod(3600)).to.be.reverted;
    await expect(vault.connect(alice).setStaking(alice.address)).to.be.reverted;
    await jump(10 * DAY);
    await expect(market.connect(alice).resolve(0, true, false)).to.be.revertedWith("Not resolver");
  });
});
