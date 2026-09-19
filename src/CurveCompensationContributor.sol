// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

interface IVotium {
    function activeRound() external view returns (uint256);

    function depositIncentiveSimple(
        address token,
        uint256 amount,
        address gauge
    ) external;

    function withdrawUnprocessed(
        uint256 round,
        address gauge,
        uint256 incentive
    ) external;
}

interface IRewardGauge {
    function deposit_reward_token(
        address token,
        uint256 amount,
        uint256 epoch
    ) external;
}

/// @notice Atomically funds compensation and a matching Inverse-funded LLv2 incentive.
contract CurveCompensationContributor is Ownable {
    using SafeERC20 for IERC20;

    // Curve treasury holding the sToken shares.
    address public constant TREASURY =
        0x6508eF65b0Bd57eaBD0f1D52685A70433B2d290B;

    address public constant INVERSE_TREASURY =
        0x9D5Df30F475CEA915b1ed4C0CCa59255C897b61B;

    address public constant SDOLA_LLV2_GAUGE =
        0x3A55AAb28B4516ceB565a6e0577285C84F53520a;

    uint256 public constant INVERSE_REWARD_EPOCH = 3 weeks;

    // Supported sTokens with ERC4626 conversion views, and their underlyings.
    address public constant SDOLA =
        0xb45ad160634c528Cc3D2926d9807104FA3157305;

    address public constant DOLA =
        0x865377367054516e17014CcdED1e7d814EDC9ce4;

    address public constant SFRXUSD =
        0xcf62F905562626CfcDD2261162a51fd02Fc9c5b6;

    address public constant FRXUSD =
        0xCAcd6fd266aF91b8AeD52aCCc382b4e165586E29;

    // Votium and compensation destinations.
    address public constant VOTIUM =
        0x63942E31E98f1833A234077f47880A66136a2D1e;

    address public constant DONATION_GAUGE =
        0x93B823e54959635ccAbfcf1B313B2Ad2785BFe95;

    address public constant SPLIT =
        0xe04c7d284cB023bdD4bCa0FC848aBEb6F8B56d34;

    address public constant INITIAL_MANAGER =
        0xF90C888E3bB5e9fc90418e72cD2e2bcCFE358628;

    // Underlying-unit cap PER TREASURY. Each contribution books one matched amount,
    // so combined gross funding is twice totalContributed (maximum 1,400,000e18).
    uint256 public constant MAX_TOTAL_CONTRIBUTION = 700_000e18;

    address public manager = INITIAL_MANAGER;

    uint256 public contributionAmount;
    uint256 public totalContributed;

    // False means contribute through Votium.
    // True means send directly to the split contract.
    bool public directToSplit;

    // Independently selected by TWG: false = Votium; true = direct gauge rewards.
    bool public inverseDirectToGauge;

    // Once killed, contributions can never be restarted.
    bool public killed;

    mapping(uint256 round => bool contributed) public contributedInRound;

    event Contributed(
        uint256 indexed round,
        address indexed vault,
        address indexed underlying,
        uint256 assets,
        uint256 shares,
        bool directToSplit
    );

    event ContributionAmountSet(
        uint256 oldAmount,
        uint256 newAmount
    );

    event InverseContributed(
        uint256 indexed round,
        address indexed token,
        uint256 assets,
        uint256 shares,
        bool directToGauge
    );

    event ManagerSet(
        address indexed oldManager,
        address indexed newManager
    );

    event DirectToSplitSet(bool directToSplit);
    event InverseDirectToGaugeSet(bool directToGauge);
    event Killed();

    event UnprocessedIncentiveRecovered(
        uint256 indexed round,
        uint256 indexed incentive,
        address indexed token,
        uint256 amount
    );

    event TokenRescued(
        address indexed token,
        uint256 amount
    );

    event InverseUnprocessedIncentiveRecovered(
        uint256 indexed round,
        uint256 indexed incentive,
        address indexed token,
        uint256 shares
    );

    modifier onlyManager() {
        require(msg.sender == manager, "not manager");
        _;
    }

    modifier onlyInverseTreasury() {
        require(msg.sender == INVERSE_TREASURY, "not inverse treasury");
        _;
    }

    /// @param owner_ Curve DAO executor or other DAO-controlled owner.
    /// @param contributionAmount_ Initial underlying-unit budget per Votium round.
    constructor(
        address owner_,
        uint256 contributionAmount_
    ) Ownable(owner_) {
        require(contributionAmount_ > 0, "zero amount");
        require(
            contributionAmount_ <= MAX_TOTAL_CONTRIBUTION,
            "amount above cap"
        );

        contributionAmount = contributionAmount_;
    }

    /// @notice Atomically contributes equal sToken shares from both treasuries once per round.
    /// @param vault Must be either the sDOLA or sfrxUSD vault.
    function contribute(IERC4626 vault) external {
        require(!killed, "killed");

        uint256 round = IVotium(VOTIUM).activeRound();

        require(
            !contributedInRound[round],
            "round already contributed"
        );

        uint256 remaining =
            MAX_TOTAL_CONTRIBUTION - totalContributed;

        require(remaining > 0, "cap reached");

        // Use only the remaining allocation in the final round.
        uint256 amount = contributionAmount < remaining ? contributionAmount : remaining;

        require(address(vault) == SDOLA || address(vault) == SFRXUSD, "invalid vault");

        // Convert the underlying budget to shares, rounding down. Never use
        // previewWithdraw: it rounds up and sfrxUSD withdrawals are disabled.
        uint256 shares = vault.convertToShares(amount);
        require(shares > 0, "zero shares");

        // Book the actual shares at their reported underlying value at execution.
        // These conversion rates are not market-price or redemption guarantees.
        uint256 assets = vault.convertToAssets(shares);
        require(assets > 0, "zero assets");
        require(assets <= amount, "conversion above budget");

        // Update accounting before transfers. A later revert rolls this back.
        contributedInRound[round] = true;
        totalContributed += assets;

        // Snapshot routes so execution and events describe the same choices.
        bool isDirect = directToSplit;
        bool isInverseDirect = inverseDirectToGauge;
        IERC20 token = vault;
        token.safeTransferFrom(TREASURY, address(this), shares);
        token.safeTransferFrom(INVERSE_TREASURY, address(this), shares);

        if (isDirect) {
            token.safeTransfer(SPLIT, shares);
        } else {
            _depositVotium(token, shares, DONATION_GAUGE);
        }

        if (isInverseDirect) {
            token.forceApprove(SDOLA_LLV2_GAUGE, shares);
            IRewardGauge(SDOLA_LLV2_GAUGE).deposit_reward_token(
                address(vault),
                shares,
                INVERSE_REWARD_EPOCH
            );
            token.forceApprove(SDOLA_LLV2_GAUGE, 0);
        } else {
            _depositVotium(token, shares, SDOLA_LLV2_GAUGE);
        }

        emit Contributed(
            round,
            address(vault),
            address(vault) == SDOLA ? DOLA : FRXUSD,
            assets,
            shares,
            isDirect
        );
        emit InverseContributed(round, address(vault), assets, shares, isInverseDirect);
    }

    function _depositVotium(IERC20 token, uint256 shares, address gauge) private {
        // Each deposit pays its fee out of the gross share amount from that treasury.
        token.forceApprove(VOTIUM, shares);
        IVotium(VOTIUM).depositIncentiveSimple(address(token), shares, gauge);
    }

    /// @notice Chooses between Votium and direct compensation.
    function setDirectToSplit(
        bool direct
    ) external onlyManager {
        directToSplit = direct;

        emit DirectToSplitSet(direct);
    }

    /// @notice Only the fixed Inverse TWG multisig can choose its incentive route.
    function setInverseDirectToGauge(bool direct) external onlyInverseTreasury {
        inverseDirectToGauge = direct;
        emit InverseDirectToGaugeSet(direct);
    }

    /// @notice Permanently disables all future contributions.
    function kill() external onlyManager {
        require(!killed, "already killed");

        killed = true;

        emit Killed();
    }

    /// @notice Recovers an incentive that Votium did not process.
    /// @dev Recovered sToken shares are sent directly to the split.
    ///      Recovery does not reopen any of the gross contribution allowance.
    ///      The incentive index is available in Votium's NewIncentive event.
    function recoverUnprocessedIncentive(
        uint256 round,
        uint256 incentive,
        address token
    ) external onlyManager {
        uint256 recovered = _recoverUnprocessed(round, DONATION_GAUGE, incentive, token);
        IERC20(token).safeTransfer(SPLIT, recovered);

        emit UnprocessedIncentiveRecovered(round, incentive, token, recovered);
    }

    /// @notice Returns eligible unprocessed LLv2 Votium incentives to Inverse TWG.
    /// @dev Does not refund the Votium fee, change accounting, or permit another contribution.
    ///      Available after kill; Curve's manager cannot recover these incentives.
    function recoverInverseUnprocessedIncentive(
        uint256 round,
        uint256 incentive,
        address token
    ) external onlyInverseTreasury {
        uint256 recovered = _recoverUnprocessed(round, SDOLA_LLV2_GAUGE, incentive, token);
        IERC20(token).safeTransfer(INVERSE_TREASURY, recovered);

        emit InverseUnprocessedIncentiveRecovered(round, incentive, token, recovered);
    }

    function _recoverUnprocessed(
        uint256 round,
        address gauge,
        uint256 incentive,
        address token
    ) private returns (uint256 recovered) {
        require(
            token == SDOLA || token == SFRXUSD,
            "invalid token"
        );

        IERC20 stakedToken = IERC20(token);
        uint256 balanceBefore =
            stakedToken.balanceOf(address(this));

        // Votium enforces that this contract is the incentive's original depositor.
        IVotium(VOTIUM).withdrawUnprocessed(
            round,
            gauge,
            incentive
        );

        recovered =
            stakedToken.balanceOf(address(this)) -
            balanceBefore;

        require(recovered > 0, "wrong token");
    }

    /// @notice Returns any accidentally sent ERC20 to the Curve treasury.
    function rescue(address token) external onlyManager {
        IERC20 erc20 = IERC20(token);
        uint256 balance = erc20.balanceOf(address(this));

        erc20.safeTransfer(TREASURY, balance);

        emit TokenRescued(token, balance);
    }

    /// @notice Changes the regular contribution per round.
    function setContributionAmount(
        uint256 newAmount
    ) external onlyOwner {
        require(newAmount > 0, "zero amount");
        require(
            newAmount <= MAX_TOTAL_CONTRIBUTION,
            "amount above cap"
        );

        uint256 oldAmount = contributionAmount;
        contributionAmount = newAmount;

        emit ContributionAmountSet(
            oldAmount,
            newAmount
        );
    }

    /// @notice Changes the operational manager.
    function setManager(
        address newManager
    ) external onlyOwner {
        require(newManager != address(0), "zero address");

        address oldManager = manager;
        manager = newManager;

        emit ManagerSet(oldManager, newManager);
    }
}
