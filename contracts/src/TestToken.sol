// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title TestToken
/// @notice Testnet-only ERC-20 with a public faucet. It has no value.
///         369X uses one for test USDT and one for test $369X.
contract TestToken is ERC20, Ownable {
    uint256 public constant FAUCET_COOLDOWN = 1 days;
    uint256 public immutable faucetAmount;
    mapping(address => uint256) public lastFaucet;

    constructor(string memory name_, string memory symbol_, uint256 faucetAmount_, uint256 initialSupply)
        ERC20(name_, symbol_)
        Ownable(msg.sender)
    {
        faucetAmount = faucetAmount_;
        _mint(msg.sender, initialSupply);
    }

    /// @notice Anyone can claim `faucetAmount` once every 24 hours.
    function faucet() external {
        require(block.timestamp >= lastFaucet[msg.sender] + FAUCET_COOLDOWN, "Faucet: try again later");
        lastFaucet[msg.sender] = block.timestamp;
        _mint(msg.sender, faucetAmount);
    }

    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }
}
