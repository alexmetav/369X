// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Market369X} from "./Market369X.sol";

/// @title Stake369X (v2)
/// @notice Stake $369X to (1) earn the stakers' share of protocol fees in USDT,
///         (2) vote on how ended markets resolve, and (3) earn $369X for voting
///         with the final outcome. This contract is the market's resolver: after
///         the voting window anyone can finalize, and the majority outcome is
///         written to the market. The market owner can still settle directly.
///         v2: a market is only settled by vote when enough stake voted (quorum);
///         otherwise the owner settles it. Voting rewards need that turnout and
///         are never paid to the market's creator. Fees that arrive while nobody
///         is staked go to the owner instead of the first staker.
///         TESTNET VERSION: not audited. Do not use with real money.
contract Stake369X is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct Vote { bool voted; bool yes; bool claimed; uint256 weight; }
    struct Tally { uint256 yes; uint256 no; bool finalized; bool outcomeYes; }

    uint256 private constant ACC = 1e18;

    IERC20 public immutable token;       // $369X (staked + voting rewards)
    IERC20 public immutable usdt;        // fee share is paid in USDT
    Market369X public immutable market;

    uint256 public votingPeriod = 2 days;
    uint256 public voteRewardBps = 0;    // share of vote weight paid in $369X (off by default)
    uint256 public quorumBps = 1000;     // votes needed: 10% of all stake ...
    uint256 public minQuorum = 10_000e18; // ... and never less than 10,000 $369X

    uint256 public totalStaked;
    mapping(address => uint256) public staked;
    mapping(address => uint256) public lockedUntil;   // can't unstake while votes are open

    // USDT fee share
    uint256 public accUsdtPerToken;
    uint256 public usdtAccounted;
    mapping(address => uint256) public usdtDebt;
    mapping(address => uint256) public usdtOwed;
    uint256 public unallocated;          // fees that arrived while nobody was staked (owner can sweep)

    mapping(uint256 => Tally) public tallies;
    mapping(uint256 => mapping(address => Vote)) public votes;
    mapping(uint256 => bool) public turnoutMet;   // set at finalize: did enough stake vote?

    event Staked(address indexed user, uint256 amount);
    event Unstaked(address indexed user, uint256 amount);
    event FeesClaimed(address indexed user, uint256 amount);
    event Voted(uint256 indexed id, address indexed user, bool yes, uint256 weight);
    event Finalized(uint256 indexed id, bool outcomeYes, uint256 yes, uint256 no);
    event VoteRewardClaimed(uint256 indexed id, address indexed user, uint256 amount);

    constructor(IERC20 token_, IERC20 usdt_, Market369X market_) Ownable(msg.sender) {
        token = token_;
        usdt = usdt_;
        market = market_;
    }

    // ------------------------------------------------------------------ fee share
    /// count any USDT that arrived (sent by the vault) since last time
    function sync() public {
        uint256 bal = usdt.balanceOf(address(this));
        if (bal > usdtAccounted) {
            if (totalStaked > 0) accUsdtPerToken += (bal - usdtAccounted) * ACC / totalStaked;
            else unallocated += bal - usdtAccounted;     // no stakers: don't hand it to whoever stakes first
            usdtAccounted = bal;
        }
    }

    function _settle(address user) internal {
        sync();
        usdtOwed[user] += staked[user] * accUsdtPerToken / ACC - usdtDebt[user];
    }

    function _reset(address user) internal { usdtDebt[user] = staked[user] * accUsdtPerToken / ACC; }

    function claimFees() external nonReentrant {
        _settle(msg.sender);
        _reset(msg.sender);
        uint256 amt = usdtOwed[msg.sender];
        require(amt > 0, "Nothing to claim");
        usdtOwed[msg.sender] = 0;
        usdtAccounted -= amt;
        usdt.safeTransfer(msg.sender, amt);
        emit FeesClaimed(msg.sender, amt);
    }

    // ------------------------------------------------------------------ staking
    function stake(uint256 amount) external nonReentrant {
        require(amount > 0, "Zero amount");
        _settle(msg.sender);
        token.safeTransferFrom(msg.sender, address(this), amount);
        staked[msg.sender] += amount;
        totalStaked += amount;
        _reset(msg.sender);
        emit Staked(msg.sender, amount);
    }

    function unstake(uint256 amount) external nonReentrant {
        require(amount > 0 && amount <= staked[msg.sender], "Not enough staked");
        require(block.timestamp >= lockedUntil[msg.sender], "Locked until your votes close");
        _settle(msg.sender);
        staked[msg.sender] -= amount;
        totalStaked -= amount;
        _reset(msg.sender);
        token.safeTransfer(msg.sender, amount);
        emit Unstaked(msg.sender, amount);
    }

    // ------------------------------------------------------------------ resolution voting
    function vote(uint256 id, bool yes) external {
        (Market369X.Market memory m, ) = market.getMarket(id);
        require(m.status == Market369X.Status.Open, "Market already resolved");
        require(block.timestamp >= m.endTime, "Market has not ended");
        uint256 closes = uint256(m.endTime) + votingPeriod;
        require(block.timestamp < closes, "Voting closed");
        uint256 w = staked[msg.sender];
        require(w > 0, "Stake $369X to vote");
        Vote storage v = votes[id][msg.sender];
        require(!v.voted, "Already voted");
        votes[id][msg.sender] = Vote(true, yes, false, w);
        if (yes) tallies[id].yes += w; else tallies[id].no += w;
        if (lockedUntil[msg.sender] < closes) lockedUntil[msg.sender] = closes;   // no vote-then-move-tokens
        emit Voted(id, msg.sender, yes, w);
    }

    /// @notice After the voting window, write the majority result to the market.
    ///         If the market owner already settled it, record that outcome instead.
    function finalize(uint256 id) external nonReentrant {
        Tally storage t = tallies[id];
        require(!t.finalized, "Already finalized");
        (Market369X.Market memory m, ) = market.getMarket(id);
        if (m.status == Market369X.Status.Resolved) {
            t.outcomeYes = m.outcomeYes;
        } else {
            require(block.timestamp >= uint256(m.endTime) + votingPeriod, "Voting still open");
            require(t.yes + t.no >= quorum(), "Not enough votes: the owner settles this market");
            t.outcomeYes = t.yes >= t.no;
            market.resolve(id, t.outcomeYes, false);
        }
        t.finalized = true;
        turnoutMet[id] = t.yes + t.no >= quorum();
        emit Finalized(id, t.outcomeYes, t.yes, t.no);
    }

    function claimVoteReward(uint256 id) external nonReentrant {
        Tally storage t = tallies[id];
        require(t.finalized, "Not finalized");
        Vote storage v = votes[id][msg.sender];
        require(v.voted && v.yes == t.outcomeYes, "No reward for this vote");
        require(!v.claimed, "Already claimed");
        require(turnoutMet[id], "Too few votes for rewards");
        (Market369X.Market memory m, ) = market.getMarket(id);
        require(msg.sender != m.creator, "No reward on your own market");
        v.claimed = true;
        uint256 reward = v.weight * voteRewardBps / 10_000;
        require(rewardPool() >= reward, "Reward pool empty");
        token.safeTransfer(msg.sender, reward);
        emit VoteRewardClaimed(id, msg.sender, reward);
    }

    // ------------------------------------------------------------------ views
    /// $369X held here that isn't someone's stake (funded by the owner)
    function rewardPool() public view returns (uint256) { return token.balanceOf(address(this)) - totalStaked; }

    /// @notice votes needed to settle a market by vote
    function quorum() public view returns (uint256) {
        uint256 q = totalStaked * quorumBps / 10_000;
        return q > minQuorum ? q : minQuorum;
    }

    function pendingFees(address user) external view returns (uint256) {
        uint256 acc = accUsdtPerToken;
        uint256 bal = usdt.balanceOf(address(this));
        if (bal > usdtAccounted && totalStaked > 0) acc += (bal - usdtAccounted) * ACC / totalStaked;
        return usdtOwed[user] + staked[user] * acc / ACC - usdtDebt[user];
    }

    function voteOf(uint256 id, address user) external view returns (Vote memory) { return votes[id][user]; }

    // ------------------------------------------------------------------ admin
    function setVotingPeriod(uint256 s) external onlyOwner {
        require(s >= 1 hours && s <= 14 days, "Bad period");
        votingPeriod = s;
    }

    function setVoteReward(uint256 bps) external onlyOwner {
        require(bps <= 1000, "Too high");
        voteRewardBps = bps;
    }

    function setQuorum(uint256 bps, uint256 minTokens) external onlyOwner {
        require(bps <= 5000, "Too high");
        quorumBps = bps;
        minQuorum = minTokens;
    }

    function sweepUnallocated(address to) external onlyOwner {
        sync();
        uint256 amt = unallocated;
        require(amt > 0, "Nothing to sweep");
        unallocated = 0;
        usdtAccounted -= amt;
        usdt.safeTransfer(to, amt);
    }

    /// @notice take back $369X reward tokens (never anyone's stake)
    function withdrawRewardPool(uint256 amount, address to) external onlyOwner {
        require(amount <= rewardPool(), "More than the reward pool");
        token.safeTransfer(to, amount);
    }
}
