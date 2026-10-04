// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IFeeSource {
    function withdrawProtocolFees() external;
    function protocolFees() external view returns (uint256);
}

/// @title Vault369X
/// @notice Liquidity vault. Depositors lock test USDT and earn 80% of the market's
///         protocol fees (pro rata to principal). The other 20% goes to stakers.
///         Longer locks earn points faster (1x / 2x / 4x / 8x).
///         TESTNET VERSION: not audited. Do not use with real money.
contract Vault369X is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct Deposit {
        uint128 amount;
        uint64 start;
        uint64 unlock;
        uint8 lock;          // index into lockDays / lockMult
        bool closed;
        uint256 debt;        // amount * accPerShare at last claim
    }

    uint256 private constant ACC = 1e18;
    uint16[4] public lockDays = [0, 90, 180, 365];
    uint8[4] public lockMult = [1, 2, 4, 8];

    IERC20 public immutable usdt;
    IFeeSource public immutable market;
    address public staking;                  // receives the stakers' share of fees
    uint256 public lpShareBps = 8000;        // 80% to depositors

    uint256 public totalDeposits;
    uint256 public accPerShare;              // fees per 1 unit deposited, scaled by 1e18
    uint256 public totalFeesToLps;
    uint256 public totalFeesToStakers;
    uint256 public immutable startTime;

    mapping(address => Deposit[]) private _deposits;
    mapping(address => uint256) public settledPoints;   // points from closed deposits

    event Deposited(address indexed user, uint256 indexed index, uint256 amount, uint8 lock, uint64 unlock);
    event Withdrawn(address indexed user, uint256 indexed index, uint256 amount, uint256 fees);
    event Claimed(address indexed user, uint256 indexed index, uint256 fees);
    event Harvested(uint256 toLps, uint256 toStakers);

    constructor(IERC20 usdt_, IFeeSource market_) Ownable(msg.sender) {
        usdt = usdt_;
        market = market_;
        startTime = block.timestamp;
    }

    /// @notice Pull protocol fees from the market and split them. Anyone can call.
    function harvest() public {
        uint256 before = usdt.balanceOf(address(this));
        if (market.protocolFees() > 0) {
            try market.withdrawProtocolFees() {} catch {}
        }
        uint256 got = usdt.balanceOf(address(this)) - before;
        if (got == 0) return;
        uint256 toLps = totalDeposits > 0 ? got * lpShareBps / 10_000 : 0;
        uint256 toStakers = got - toLps;
        if (toLps > 0) { accPerShare += toLps * ACC / totalDeposits; totalFeesToLps += toLps; }
        if (toStakers > 0) {
            if (staking != address(0)) { usdt.safeTransfer(staking, toStakers); totalFeesToStakers += toStakers; }
            else { usdt.safeTransfer(owner(), toStakers); }
        }
        emit Harvested(toLps, toStakers);
    }

    function deposit(uint256 amount, uint8 lock) external nonReentrant returns (uint256 index) {
        require(amount >= 1e18, "Minimum deposit is 1");
        require(lock < 4, "Bad lock");
        harvest();                                   // earlier fees belong to earlier depositors
        usdt.safeTransferFrom(msg.sender, address(this), amount);
        uint64 unlock = uint64(block.timestamp + uint256(lockDays[lock]) * 1 days);
        _deposits[msg.sender].push(Deposit(uint128(amount), uint64(block.timestamp), unlock, lock, false, amount * accPerShare / ACC));
        totalDeposits += amount;
        index = _deposits[msg.sender].length - 1;
        emit Deposited(msg.sender, index, amount, lock, unlock);
    }

    function claim(uint256 index) external nonReentrant {
        harvest();
        Deposit storage d = _get(msg.sender, index);
        uint256 fees = _pending(d);
        require(fees > 0, "Nothing to claim");
        d.debt = uint256(d.amount) * accPerShare / ACC;
        usdt.safeTransfer(msg.sender, fees);
        emit Claimed(msg.sender, index, fees);
    }

    function withdraw(uint256 index) external nonReentrant {
        harvest();
        Deposit storage d = _get(msg.sender, index);
        require(block.timestamp >= d.unlock, "Still locked");
        uint256 fees = _pending(d);
        uint256 amount = d.amount;
        settledPoints[msg.sender] += _points(d, block.timestamp);
        d.closed = true;
        totalDeposits -= amount;
        usdt.safeTransfer(msg.sender, amount + fees);
        emit Withdrawn(msg.sender, index, amount, fees);
    }

    // ------------------------------------------------------------------ views
    function depositsOf(address user) external view returns (Deposit[] memory list, uint256[] memory pending) {
        list = _deposits[user];
        pending = new uint256[](list.length);
        uint256 acc = accPerShare + _unharvestedPerShare();
        for (uint256 i = 0; i < list.length; i++) {
            if (!list[i].closed) pending[i] = uint256(list[i].amount) * acc / ACC - list[i].debt;
        }
    }

    /// @notice points = amount x lock multiplier x days deposited (18 decimals)
    function pointsOf(address user) external view returns (uint256 pts) {
        pts = settledPoints[user];
        Deposit[] storage list = _deposits[user];
        for (uint256 i = 0; i < list.length; i++) if (!list[i].closed) pts += _points(list[i], block.timestamp);
    }

    function pendingFees() external view returns (uint256) { return market.protocolFees(); }

    // ------------------------------------------------------------------ admin
    function setStaking(address s) external onlyOwner { staking = s; }

    function setLpShare(uint256 bps) external onlyOwner {
        require(bps <= 10_000, "Too high");
        lpShareBps = bps;
    }

    // ------------------------------------------------------------------ internal
    function _get(address user, uint256 index) internal view returns (Deposit storage d) {
        require(index < _deposits[user].length, "No such deposit");
        d = _deposits[user][index];
        require(!d.closed, "Already withdrawn");
    }

    function _pending(Deposit storage d) internal view returns (uint256) {
        return uint256(d.amount) * accPerShare / ACC - d.debt;
    }

    function _points(Deposit storage d, uint256 until) internal view returns (uint256) {
        return uint256(d.amount) * lockMult[d.lock] * (until - d.start) / 1 days;
    }

    function _unharvestedPerShare() internal view returns (uint256) {
        if (totalDeposits == 0) return 0;
        return market.protocolFees() * lpShareBps / 10_000 * ACC / totalDeposits;
    }
}
