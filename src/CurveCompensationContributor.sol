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

/// @notice Permissionlessly funds compensation with sTokens through Votium or directly
///         through the compensation split contract.
contract CurveCompensationContributor is Ownable {
    using SafeERC20 for IERC20;

    // Curve treasury holding the sToken shares.
    address public constant TREASURY =
        0x6508eF65b0Bd57eaBD0f1D52685A70433B2d290B;

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

    // All budgets are denominated in 18-decimal underlying units, not shares or USD.
    uint256 public constant MAX_TOTAL_CONTRIBUTION = 740_000e18;

    address public manager = INITIAL_MANAGER;

    uint256 public contributionAmount;
    uint256 public totalContributed;

    // False means contribute through Votium.
    // True means send directly to the split contract.
    bool public directToSplit;

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

    event ManagerSet(
        address indexed oldManager,
        address indexed newManager
    );

    event DirectToSplitSet(bool directToSplit);
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

    modifier onlyManager() {
        require(msg.sender == manager, "not manager");
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

    /// @notice Contributes once during the current Votium active round.
    /// @param vault Must be either the sDOLA or sfrxUSD vault.
    function contribute(address vault) external {
        require(!killed, "killed");

        uint256 round = IVotium(VOTIUM).activeRound();

        require(
            !contributedInRound[round],
            "round already contributed"
        );

        uint256 remaining =
            MAX_TOTAL_CONTRIBUTION - totalContributed;

        require(remaining > 0, "cap reached");

        uint256 amount = contributionAmount;

        // Use only the remaining allocation in the final round.
        if (amount > remaining) {
            amount = remaining;
        }

        require(vault == SDOLA || vault == SFRXUSD, "invalid vault");

        // Convert the underlying budget to shares, rounding down. Never use
        // previewWithdraw: it rounds up and sfrxUSD withdrawals are disabled.
        uint256 shares = IERC4626(vault).convertToShares(amount);
        require(shares > 0, "zero shares");

        // Book the actual shares at their reported underlying value at execution.
        // These conversion rates are not market-price or redemption guarantees.
        uint256 assets = IERC4626(vault).convertToAssets(shares);
        require(assets > 0, "zero assets");
        require(assets <= amount, "conversion above budget");

        // Update accounting before transfers. A later revert rolls this back.
        contributedInRound[round] = true;
        totalContributed += assets;

        IERC20 token = IERC20(vault);
        token.safeTransferFrom(TREASURY, address(this), shares);

        bool isDirect = directToSplit;

        if (isDirect) {
            token.safeTransfer(SPLIT, shares);
        } else {
            // Votium pulls the fee and incentive in two transferFrom calls.
            token.forceApprove(VOTIUM, shares);

            IVotium(VOTIUM).depositIncentiveSimple(
                vault,
                shares,
                DONATION_GAUGE
            );
            token.forceApprove(VOTIUM, 0);
        }

        emit Contributed(
            round,
            vault,
            vault == SDOLA ? DOLA : FRXUSD,
            assets,
            shares,
            isDirect
        );
    }

    /// @notice Chooses between Votium and direct compensation.
    function setDirectToSplit(
        bool direct
    ) external onlyManager {
        directToSplit = direct;

        emit DirectToSplitSet(direct);
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
        require(
            token == SDOLA || token == SFRXUSD,
            "invalid token"
        );

        IERC20 stakedToken = IERC20(token);
        uint256 balanceBefore =
            stakedToken.balanceOf(address(this));

        IVotium(VOTIUM).withdrawUnprocessed(
            round,
            DONATION_GAUGE,
            incentive
        );

        uint256 recovered =
            stakedToken.balanceOf(address(this)) -
            balanceBefore;

        require(recovered > 0, "wrong token");

        stakedToken.safeTransfer(SPLIT, recovered);

        emit UnprocessedIncentiveRecovered(
            round,
            incentive,
            token,
            recovered
        );
    }

    /// @notice Returns any accidentally sent ERC20 to the Curve treasury.
    function rescue(address token) external onlyManager {
        IERC20 erc20 = IERC20(token);
        uint256 balance = erc20.balanceOf(address(this));

        require(balance > 0, "zero balance");

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
