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

  it("v2: fees pulled by a stranger calling the market directly are still shared out", async () => {
    const { alice, bob, carol, usdt, market, vault, stake } = await setup();
    await vault.connect(alice).deposit(E(1000), 0);
    await stake.connect(bob).stake(E(10_000));
    await market.connect(carol).buy(0, true, E(10_000), 0);    // 100 protocol fee
    await market.connect(carol).withdrawProtocolFees();         // anyone can push fees into the vault
    expect(F(await vault.pendingFees())).to.be.closeTo(100, 1e-9);
    const [, pending] = await vault.depositsOf(alice);
    expect(F(pending[0])).to.be.closeTo(80, 1e-6);
    const a0 = await usdt.balanceOf(alice);
    await vault.connect(alice).withdraw(0);
    expect(F(await usdt.balanceOf(alice) - a0)).to.be.closeTo(1080, 1e-6);
    expect(F(await stake.pendingFees(bob.address))).to.be.closeTo(20, 1e-6);
    expect(await vault.accounted()).to.be.lessThan(1000n);     // only rounding dust left
  });

  it("v2: slashed bonds sent to the vault can be moved out by the owner", async () => {
    const { owner, alice, x, usdt, market, vault } = await setup();
    await jump(10 * DAY);
    await market.resolve(0, true, true);                       // slash the creator's bond -> vault
    expect(await x.balanceOf(vault)).to.equal(E(1000));
    await expect(vault.connect(alice).sweepOther(x, alice.address, E(1000))).to.be.reverted;
    await expect(vault.sweepOther(usdt, owner.address, 1n)).to.be.revertedWith("Not USDT");
    await vault.sweepOther(x, owner.address, E(1000));
    expect(await x.balanceOf(vault)).to.equal(0n);
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
    await stake.setVoteReward(100);                            // off by default in v2
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
    await expect(stake.connect(alice).claimVoteReward(0)).to.be.revertedWith("Too few votes for rewards");
  });

  it("v2: too few votes can't settle a market; the owner settles it", async () => {
    const { owner, alice, bob, market, stake } = await setup();
    await stake.connect(alice).stake(E(5000));                 // below the 10,000 minimum
    await stake.connect(bob).stake(E(95_000));                 // quorum = 10% of 100,000 = 10,000
    expect(F(await stake.quorum())).to.equal(10_000);
    await jump(10 * DAY);
    await stake.connect(alice).vote(0, true);
    await jump(2 * DAY);
    await expect(stake.finalize(0)).to.be.revertedWith("Not enough votes: the owner settles this market");
    await market.connect(owner).resolve(0, false, false);
    await stake.finalize(0);
    expect((await stake.tallies(0)).outcomeYes).to.equal(false);
    expect(await stake.turnoutMet(0)).to.equal(false);
  });

  it("v2: the market creator never earns a voting reward on their own market", async () => {
    const { owner, alice, x, market, stake } = await setup();
    await stake.setVoteReward(100);
    const now = (await ethers.provider.getBlock("latest")).timestamp;
    await market.connect(alice).createMarket("Will alice farm voting rewards on this?", "test source", now + 2 * DAY, E(0.5));
    await stake.connect(alice).stake(E(50_000));
    await x.approve(stake, ethers.MaxUint256); await stake.connect(owner).stake(E(50_000));
    await jump(3 * DAY);
    await stake.connect(alice).vote(1, true);
    await stake.connect(owner).vote(1, true);
    await jump(2 * DAY);
    await stake.finalize(1);
    await expect(stake.connect(alice).claimVoteReward(1)).to.be.revertedWith("No reward on your own market");
    const o0 = await x.balanceOf(owner);
    await stake.connect(owner).claimVoteReward(1);
    expect(await x.balanceOf(owner) - o0).to.equal(E(500));
  });

  it("v2: fees that arrive while nobody is staked don't go to the first staker", async () => {
    const { owner, alice, carol, usdt, market, vault, stake } = await setup();
    await market.connect(carol).buy(0, true, E(10_000), 0);    // 100 protocol fee, no depositors: all to staking
    await vault.harvest();
    await stake.connect(alice).stake(E(10_000));
    expect(F(await stake.pendingFees(alice.address))).to.equal(0);
    expect(F(await stake.unallocated())).to.be.closeTo(100, 1e-9);
    await expect(stake.connect(alice).sweepUnallocated(alice.address)).to.be.reverted;
    const b0 = await usdt.balanceOf(owner);
    await stake.sweepUnallocated(owner.address);
    expect(F(await usdt.balanceOf(owner) - b0)).to.be.closeTo(100, 1e-9);
    await market.connect(carol).buy(0, true, E(10_000), 0);    // later fees go to the staker
    await vault.harvest();
    expect(F(await stake.pendingFees(alice.address))).to.be.closeTo(100, 1e-6);
  });

  it("v2: the reward pool can be withdrawn by the owner, but never anyone's stake", async () => {
    const { owner, alice, x, stake } = await setup();
    await stake.connect(alice).stake(E(10_000));
    await expect(stake.withdrawRewardPool(E(1_000_001), owner.address)).to.be.revertedWith("More than the reward pool");
    await stake.withdrawRewardPool(E(1_000_000), owner.address);
    expect(await stake.rewardPool()).to.equal(0n);
    expect(await x.balanceOf(stake)).to.equal(E(10_000));
  });

  it("only the owner can change settings; nobody else can resolve the market", async () => {
    const { alice, market, stake, vault } = await setup();
    await expect(stake.connect(alice).setVotingPeriod(3600)).to.be.reverted;
    await expect(vault.connect(alice).setStaking(alice.address)).to.be.reverted;
    await jump(10 * DAY);
    await expect(market.connect(alice).resolve(0, true, false)).to.be.revertedWith("Not resolver");
  });
});
