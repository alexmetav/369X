// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

/// @title Referral369X
/// @notice On-chain referral codes and invites, plus Merkle-based reward claims.
///         1. Anyone registers one code. 2. A new user sets a referrer once.
///         3. Rewards are computed from public Trade events with a published
///            formula (anyone can recompute them); the owner publishes the
///            Merkle root of everyone's cumulative earnings; users claim USDT.
///         TESTNET VERSION: not audited. Do not use with real money.
contract Referral369X is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public immutable usdt;
    address public immutable market;     // the market whose trades earn rewards

    mapping(bytes32 => address) public codeOwner;   // keccak256(code) => owner
    mapping(address => string) public codeOf;
    mapping(address => address) public referrerOf;

    bytes32 public merkleRoot;
    uint64 public snapshotBlock;          // rewards include trades up to this block
    uint256 public totalPublished;        // sum of everyone's cumulative earnings at the snapshot
    uint256 public totalClaimed;
    mapping(address => uint256) public claimed;

    event CodeRegistered(address indexed user, string code);
    event ReferrerSet(address indexed user, address indexed referrer, string code);
    event RewardsPublished(bytes32 root, uint64 snapshotBlock, uint256 total);
    event Claimed(address indexed user, uint256 amount);

    constructor(IERC20 usdt_, address market_) Ownable(msg.sender) {
        usdt = usdt_;
        market = market_;
    }

    // ------------------------------------------------------------------ codes & invites
    function registerCode(string calldata code) external {
        require(bytes(codeOf[msg.sender]).length == 0, "You already have a code");
        _validate(code);
        bytes32 k = keccak256(bytes(code));
        require(codeOwner[k] == address(0), "That code is taken");
        codeOwner[k] = msg.sender;
        codeOf[msg.sender] = code;
        emit CodeRegistered(msg.sender, code);
    }

    function setReferrer(string calldata code) external {
        require(referrerOf[msg.sender] == address(0), "You already have a referrer");
        address r = codeOwner[keccak256(bytes(code))];
        require(r != address(0), "Unknown referral code");
        require(r != msg.sender, "You can't refer yourself");
        require(referrerOf[r] != msg.sender, "You can't refer your own referrer");
        referrerOf[msg.sender] = r;
        emit ReferrerSet(msg.sender, r, code);
    }

    // ------------------------------------------------------------------ rewards
    /// @param root   Merkle root of (account, cumulativeEarned) leaves
    /// @param snap   last block included in the calculation
    /// @param total  sum of all cumulative earnings in the tree
    function publish(bytes32 root, uint64 snap, uint256 total) external onlyOwner {
        require(snap <= block.number && snap >= snapshotBlock, "Bad snapshot block");
        require(total >= totalPublished, "Total can't go down");
        require(usdt.balanceOf(address(this)) + totalClaimed >= total, "Fund the reward pool first");
        merkleRoot = root;
        snapshotBlock = snap;
        totalPublished = total;
        emit RewardsPublished(root, snap, total);
    }

    /// @notice Claim everything earned so far. `cumulative` is your total lifetime earnings in the latest tree.
    function claim(uint256 cumulative, bytes32[] calldata proof) external nonReentrant returns (uint256 amount) {
        bytes32 leaf = keccak256(bytes.concat(keccak256(abi.encode(msg.sender, cumulative))));
        require(MerkleProof.verify(proof, merkleRoot, leaf), "Invalid proof");
        require(cumulative > claimed[msg.sender], "Nothing to claim");
        amount = cumulative - claimed[msg.sender];
        claimed[msg.sender] = cumulative;
        totalClaimed += amount;
        usdt.safeTransfer(msg.sender, amount);
        emit Claimed(msg.sender, amount);
    }

    /// @notice Owner can take back pool money that isn't owed to anyone.
    function withdrawExcess(uint256 amount, address to) external onlyOwner {
        uint256 owed = totalPublished - totalClaimed;
        require(usdt.balanceOf(address(this)) >= owed + amount, "That money is owed to users");
        usdt.safeTransfer(to, amount);
    }

    // ------------------------------------------------------------------ views
    function ownerOfCode(string calldata code) external view returns (address) { return codeOwner[keccak256(bytes(code))]; }

    function info(address user) external view returns (string memory code, address referrer, uint256 claimedSoFar) {
        return (codeOf[user], referrerOf[user], claimed[user]);
    }

    function pool() external view returns (uint256) { return usdt.balanceOf(address(this)); }

    // ------------------------------------------------------------------ internal
    function _validate(string calldata code) internal pure {
        bytes memory b = bytes(code);
        require(b.length >= 3 && b.length <= 20, "Use 3 to 20 characters");
        for (uint256 i = 0; i < b.length; i++) {
            bytes1 c = b[i];
            require((c >= "a" && c <= "z") || (c >= "0" && c <= "9") || c == "_" || c == "-", "Use lowercase letters, numbers, - or _");
        }
    }
}
