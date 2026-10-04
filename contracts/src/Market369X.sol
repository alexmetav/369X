// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {SD59x18, sd, exp, ln} from "@prb/math/src/SD59x18.sol";

/// @title Market369X
/// @notice YES/NO prediction markets priced by an LMSR automated market maker.
///         Each share pays 1 collateral token if its side wins.
/// @dev    Every market starts at q0 = (b*ln(p), b*ln(1-p)) so cost(q0) = 0.
///         The protocol funds a subsidy of b*ln(1/min(p,1-p)) from `reserve`,
///         which guarantees the market can always pay every winning share.
///         TESTNET VERSION: not audited. Do not use with real money.
contract Market369X is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum Status { Open, Resolved }

    struct Market {
        address creator;
        uint64 endTime;
        Status status;
        bool outcomeYes;
        bool bondSlashed;
        int256 b;          // liquidity parameter (wad)
        int256 qYes;       // LMSR state (wad, may be negative)
        int256 qNo;
        int256 q0Yes;      // starting state, to count shares sold
        int256 q0No;
        uint256 pool;      // collateral backing this market
        uint256 volume;
        uint256 creatorFees;
        uint256 bond;
        string question;
        string source;
    }

    int256 private constant WAD = 1e18;
    uint256 private constant DUST = 1e9;          // shares are rounded down by this to absorb math rounding
    uint256 public constant MAX_FEE_BPS = 500;

    IERC20 public immutable collateral;           // test USDT
    IERC20 public immutable bondToken;            // $369X

    address public resolver;                      // can resolve markets (later: the staking/voting contract)
    address public feeRecipient;                  // receives protocol fees (later: the vault)
    uint256 public creatorFeeBps = 50;            // 0.5%
    uint256 public protocolFeeBps = 100;          // 1%
    uint256 public bondAmount = 1000e18;
    int256 public defaultB = 5000e18;

    uint256 public reserve;                       // protocol money that subsidises new markets
    uint256 public protocolFees;

    Market[] private _markets;
    mapping(uint256 => mapping(address => uint256)) public yesShares;
    mapping(uint256 => mapping(address => uint256)) public noShares;

    event MarketCreated(uint256 indexed id, address indexed creator, string question, uint64 endTime, uint256 pYes, int256 b);
    event Trade(uint256 indexed id, address indexed user, bool yes, bool buy, uint256 shares, uint256 amount, uint256 fee, uint256 priceYes);
    event Resolved(uint256 indexed id, bool outcomeYes, bool bondSlashed);
    event Redeemed(uint256 indexed id, address indexed user, uint256 amount);
    event CreatorFeesClaimed(uint256 indexed id, address indexed creator, uint256 amount);
    event ReserveChanged(uint256 reserve);

    modifier onlyResolver() {
        require(msg.sender == resolver || msg.sender == owner(), "Not resolver");
        _;
    }

    constructor(IERC20 collateral_, IERC20 bondToken_, address resolver_, address feeRecipient_) Ownable(msg.sender) {
        collateral = collateral_;
        bondToken = bondToken_;
        resolver = resolver_;
        feeRecipient = feeRecipient_;
    }

    // ------------------------------------------------------------------
    // LMSR math (wad fixed point)
    // ------------------------------------------------------------------
    function _cost(int256 qy, int256 qn, int256 b) internal pure returns (int256) {
        int256 m = qy > qn ? qy : qn;
        SD59x18 bb = sd(b);
        SD59x18 s = exp(sd(qy - m).div(bb)) + exp(sd(qn - m).div(bb));
        return m + bb.mul(ln(s)).unwrap();
    }

    function _priceYes(int256 qy, int256 qn, int256 b) internal pure returns (uint256) {
        int256 m = qy > qn ? qy : qn;
        SD59x18 bb = sd(b);
        SD59x18 ey = exp(sd(qy - m).div(bb));
        SD59x18 en = exp(sd(qn - m).div(bb));
        return uint256(ey.div(ey + en).unwrap());
    }

    /// shares bought on one side for `amount` collateral (closed form, rounded down)
    function _sharesFor(int256 qy, int256 qn, int256 b, bool yes, uint256 amount) internal pure returns (uint256) {
        int256 own = yes ? qy : qn;
        int256 other = yes ? qn : qy;
        int256 t = _cost(qy, qn, b) + int256(amount);       // t > other because cost >= max(qy, qn)
        SD59x18 bb = sd(b);
        int256 newOwn = t + bb.mul(ln(sd(WAD) - exp(sd(other - t).div(bb)))).unwrap();
        int256 shares = newOwn - own;
        if (shares <= int256(DUST)) return 0;
        return uint256(shares) - DUST;
    }

    function _proceedsFor(int256 qy, int256 qn, int256 b, bool yes, uint256 shares) internal pure returns (uint256) {
        int256 s = int256(shares);
        int256 c = _cost(qy, qn, b) - _cost(yes ? qy - s : qy, yes ? qn : qn - s, b);
        if (c <= int256(DUST)) return 0;
        return uint256(c) - DUST;
    }

    // ------------------------------------------------------------------
    // Markets
    // ------------------------------------------------------------------
    /// @param pYes starting chance of YES as a wad (0.05e18 .. 0.95e18)
    function createMarket(string calldata question, string calldata source, uint64 endTime, uint256 pYes)
        external
        nonReentrant
        returns (uint256 id)
    {
        uint256 qlen = bytes(question).length;
        require(qlen >= 15 && qlen <= 200, "Question length");
        require(bytes(source).length >= 4 && bytes(source).length <= 200, "Source length");
        require(endTime > block.timestamp + 1 hours && endTime <= block.timestamp + 730 days, "Bad end time");
        require(pYes >= 0.05e18 && pYes <= 0.95e18, "Start price 5%-95%");

        int256 b = defaultB;
        int256 p = int256(pYes);
        int256 q0Yes = sd(b).mul(ln(sd(p))).unwrap();
        int256 q0No = sd(b).mul(ln(sd(WAD - p))).unwrap();
        // subsidy = b * ln(1 / min(p, 1-p)) = -min(q0Yes, q0No), plus a little dust headroom
        uint256 subsidy = uint256(-(q0Yes < q0No ? q0Yes : q0No)) + 1e12;
        require(reserve >= subsidy, "Protocol reserve too low");
        reserve -= subsidy;

        if (bondAmount > 0) bondToken.safeTransferFrom(msg.sender, address(this), bondAmount);

        id = _markets.length;
        Market storage m = _markets.push();
        m.creator = msg.sender;
        m.endTime = endTime;
        m.b = b;
        m.qYes = q0Yes;
        m.qNo = q0No;
        m.q0Yes = q0Yes;
        m.q0No = q0No;
        m.pool = subsidy;
        m.bond = bondAmount;
        m.question = question;
        m.source = source;
        emit MarketCreated(id, msg.sender, question, endTime, pYes, b);
        emit ReserveChanged(reserve);
    }

    function buy(uint256 id, bool yes, uint256 amount, uint256 minShares) external nonReentrant returns (uint256 shares) {
        Market storage m = _open(id);
        require(amount > 0, "Zero amount");
        collateral.safeTransferFrom(msg.sender, address(this), amount);

        uint256 cFee = amount * creatorFeeBps / 10_000;
        uint256 pFee = amount * protocolFeeBps / 10_000;
        uint256 net = amount - cFee - pFee;
        shares = _sharesFor(m.qYes, m.qNo, m.b, yes, net);
        require(shares > 0 && shares >= minShares, "Price moved");

        if (yes) { m.qYes += int256(shares); yesShares[id][msg.sender] += shares; }
        else { m.qNo += int256(shares); noShares[id][msg.sender] += shares; }
        m.pool += net;
        m.volume += amount;
        m.creatorFees += cFee;
        protocolFees += pFee;
        emit Trade(id, msg.sender, yes, true, shares, amount, cFee + pFee, _priceYes(m.qYes, m.qNo, m.b));
    }

    function sell(uint256 id, bool yes, uint256 shares, uint256 minOut) external nonReentrant returns (uint256 out) {
        Market storage m = _open(id);
        require(shares > 0, "Zero shares");
        if (yes) { require(yesShares[id][msg.sender] >= shares, "Not enough shares"); yesShares[id][msg.sender] -= shares; }
        else { require(noShares[id][msg.sender] >= shares, "Not enough shares"); noShares[id][msg.sender] -= shares; }

        uint256 proceeds = _proceedsFor(m.qYes, m.qNo, m.b, yes, shares);
        if (yes) m.qYes -= int256(shares); else m.qNo -= int256(shares);
        require(m.pool >= proceeds, "Pool");
        m.pool -= proceeds;

        uint256 cFee = proceeds * creatorFeeBps / 10_000;
        uint256 pFee = proceeds * protocolFeeBps / 10_000;
        out = proceeds - cFee - pFee;
        require(out >= minOut, "Price moved");
        m.volume += proceeds;
        m.creatorFees += cFee;
        protocolFees += pFee;
        collateral.safeTransfer(msg.sender, out);
        emit Trade(id, msg.sender, yes, false, shares, out, cFee + pFee, _priceYes(m.qYes, m.qNo, m.b));
    }

    /// @notice Settle a market after it ends. Unused subsidy goes back to the reserve.
    /// @param slashBond true if the question was unclear or abusive (bond goes to the fee recipient)
    function resolve(uint256 id, bool outcomeYes, bool slashBond) external onlyResolver nonReentrant {
        Market storage m = _market(id);
        require(m.status == Status.Open, "Already resolved");
        require(block.timestamp >= m.endTime, "Not ended yet");
        m.status = Status.Resolved;
        m.outcomeYes = outcomeYes;
        m.bondSlashed = slashBond;

        uint256 owed = _sharesSold(m, outcomeYes);
        if (m.pool > owed) { reserve += m.pool - owed; m.pool = owed; }
        else if (m.pool < owed) { uint256 gap = owed - m.pool; require(reserve >= gap, "Reserve"); reserve -= gap; m.pool = owed; }

        if (m.bond > 0) bondToken.safeTransfer(slashBond ? feeRecipient : m.creator, m.bond);
        emit Resolved(id, outcomeYes, slashBond);
        emit ReserveChanged(reserve);
    }

    /// @notice Winners swap each winning share for 1 collateral token.
    function redeem(uint256 id) external nonReentrant returns (uint256 amount) {
        Market storage m = _market(id);
        require(m.status == Status.Resolved, "Not resolved");
        if (m.outcomeYes) { amount = yesShares[id][msg.sender]; yesShares[id][msg.sender] = 0; }
        else { amount = noShares[id][msg.sender]; noShares[id][msg.sender] = 0; }
        require(amount > 0, "Nothing to redeem");
        m.pool -= amount;
        collateral.safeTransfer(msg.sender, amount);
        emit Redeemed(id, msg.sender, amount);
    }

    function claimCreatorFees(uint256 id) external nonReentrant {
        Market storage m = _market(id);
        require(msg.sender == m.creator, "Not creator");
        uint256 amt = m.creatorFees;
        require(amt > 0, "Nothing to claim");
        m.creatorFees = 0;
        collateral.safeTransfer(msg.sender, amt);
        emit CreatorFeesClaimed(id, msg.sender, amt);
    }

    // ------------------------------------------------------------------
    // Views
    // ------------------------------------------------------------------
    function marketCount() external view returns (uint256) { return _markets.length; }

    function getMarket(uint256 id) external view returns (Market memory m, uint256 priceYes) {
        m = _market(id);
        priceYes = _priceYes(m.qYes, m.qNo, m.b);
    }

    function quoteBuy(uint256 id, bool yes, uint256 amount) external view returns (uint256 shares, uint256 fee) {
        Market storage m = _market(id);
        fee = amount * (creatorFeeBps + protocolFeeBps) / 10_000;
        shares = _sharesFor(m.qYes, m.qNo, m.b, yes, amount - fee);
    }

    function quoteSell(uint256 id, bool yes, uint256 shares) external view returns (uint256 out, uint256 fee) {
        Market storage m = _market(id);
        uint256 proceeds = _proceedsFor(m.qYes, m.qNo, m.b, yes, shares);
        fee = proceeds * (creatorFeeBps + protocolFeeBps) / 10_000;
        out = proceeds - fee;
    }

    function sharesOf(uint256 id, address user) external view returns (uint256 yes, uint256 no) {
        return (yesShares[id][user], noShares[id][user]);
    }

    // ------------------------------------------------------------------
    // Admin
    // ------------------------------------------------------------------
    function fundReserve(uint256 amount) external {
        collateral.safeTransferFrom(msg.sender, address(this), amount);
        reserve += amount;
        emit ReserveChanged(reserve);
    }

    function withdrawReserve(uint256 amount, address to) external onlyOwner {
        require(amount <= reserve, "Too much");
        reserve -= amount;
        collateral.safeTransfer(to, amount);
        emit ReserveChanged(reserve);
    }

    function withdrawProtocolFees() external {
        uint256 amt = protocolFees;
        require(amt > 0, "Nothing to withdraw");
        protocolFees = 0;
        collateral.safeTransfer(feeRecipient, amt);
    }

    function setFees(uint256 creatorBps, uint256 protocolBps) external onlyOwner {
        require(creatorBps + protocolBps <= MAX_FEE_BPS, "Fees too high");
        creatorFeeBps = creatorBps;
        protocolFeeBps = protocolBps;
    }

    function setBondAmount(uint256 amount) external onlyOwner { bondAmount = amount; }

    function setDefaultB(int256 b) external onlyOwner {
        require(b >= 100e18 && b <= 1_000_000e18, "Bad b");
        defaultB = b;
    }

    function setResolver(address r) external onlyOwner { resolver = r; }

    function setFeeRecipient(address r) external onlyOwner {
        require(r != address(0), "Zero address");
        feeRecipient = r;
    }

    // ------------------------------------------------------------------
    // Internal
    // ------------------------------------------------------------------
    function _market(uint256 id) internal view returns (Market storage) {
        require(id < _markets.length, "No such market");
        return _markets[id];
    }

    function _open(uint256 id) internal view returns (Market storage m) {
        m = _market(id);
        require(m.status == Status.Open && block.timestamp < m.endTime, "Market closed");
    }

    function _sharesSold(Market storage m, bool yes) internal view returns (uint256) {
        int256 s = yes ? m.qYes - m.q0Yes : m.qNo - m.q0No;
        return s > 0 ? uint256(s) : 0;
    }
}
