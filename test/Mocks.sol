// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

// Implements only share transfers and conversion views. Redemption always fails,
// so passing contribution tests cannot accidentally rely on ERC-4626 withdrawal.
contract MockStakedToken is ERC20 {
    uint256 public rate;
    bool public overBudget;
    constructor() ERC20("Mock staked token", "sMOCK") {}
    function setRate(uint256 value) external { rate = value; }
    function setOverBudget(bool value) external { overBudget = value; }
    function mint(address to, uint256 amount) external { _mint(to, amount); }
    function burn(address from, uint256 amount) external { _burn(from, amount); }
    function convertToShares(uint256 assets) external view returns (uint256) {
        return assets * 1e18 / rate;
    }
    function convertToAssets(uint256 shares) external view returns (uint256) {
        return shares * rate / 1e18 + (overBudget ? 1e18 : 0);
    }
    function withdraw(uint256, address, address) external pure { revert("withdraw disabled"); }
    function redeem(uint256, address, address) external pure { revert("redeem disabled"); }
}

contract MockVotium {
    uint256 public activeRound;
    mapping(address => bool) public tokenAllowed;
    mapping(address => bool) public gaugeBlocked;
    struct Incentive { address token; uint256 amount; address depositor; }
    mapping(uint256 => mapping(address => Incentive[])) public incentives;
    function setRound(uint256 round) external { activeRound = round; }
    function allowToken(address token, bool allowed) external { tokenAllowed[token] = allowed; }
    function blockGauge(address gauge, bool blocked) external { gaugeBlocked[gauge] = blocked; }
    function depositIncentiveSimple(address token, uint256 amount, address gauge) external {
        require(tokenAllowed[token], "!allowlist");
        require(!gaugeBlocked[gauge], "gauge blocked");
        uint256 fee = amount * 200 / 10000;
        require(fee > 0, "!amount");
        require(IERC20(token).transferFrom(msg.sender, address(0xFEE), fee));
        require(IERC20(token).transferFrom(msg.sender, address(this), amount - fee));
        incentives[activeRound][gauge].push(Incentive(token, amount - fee, msg.sender));
    }
    function withdrawUnprocessed(uint256 round, address gauge, uint256 index) external {
        require(round < activeRound, "round active");
        Incentive storage incentive = incentives[round][gauge][index];
        require(incentive.depositor == msg.sender, "!depositor");
        uint256 amount = incentive.amount;
        require(amount > 0, "!zero");
        incentive.amount = 0;
        require(IERC20(incentive.token).transfer(msg.sender, amount));
    }
}

contract MockRewardGauge {
    mapping(address => address) public distributor;
    mapping(address => uint256) public rewardRemaining;
    mapping(address => uint256) public rewardRate;
    mapping(address => uint256) public periodFinish;
    uint256 public lastEpoch;
    bool public rejectDeposit;
    function setDistributor(address token, address sender) external { distributor[token] = sender; }
    function setRejectDeposit(bool value) external { rejectDeposit = value; }
    function deposit_reward_token(address token, uint256 amount, uint256 epoch) external {
        require(msg.sender == distributor[token], "not distributor");
        require(epoch >= 3 days && epoch <= 48 weeks, "Epoch duration");
        require(!rejectDeposit, "deposit rejected");
        uint256 remaining;
        if (periodFinish[token] > block.timestamp) {
            remaining = (periodFinish[token] - block.timestamp) * rewardRate[token];
        }
        require(IERC20(token).transferFrom(msg.sender, address(this), amount));
        rewardRemaining[token] = remaining + amount;
        rewardRate[token] = rewardRemaining[token] / epoch;
        periodFinish[token] = block.timestamp + epoch;
        lastEpoch = epoch;
    }
}
