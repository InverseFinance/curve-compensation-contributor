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

/// @notice Permissionlessly funds compensation through Votium or directly
///         through the compensation split contract.
contract CurveCompensationContributor is Ownable {
    using SafeERC20 for IERC20;

    // Curve treasury holding the ERC4626 vault shares.
    address public constant TREASURY =
        0x6508ef65b0bd57eabd0f1d52685a70433b2d290b;

    // Supported ERC4626 vaults and their underlying assets.
    address public constant SDOLA =
        0xb45ad160634c528cc3d2926d9807104fa3157305;

    address public constant DOLA =
        0x865377367054516e17014ccded1e7d814edc9ce4;

    address public constant SFRXUSD =
        0xcf62f905562626cfcdd2261162a51fd02fc9c5b6;

    address public constant FRXUSD =
        0xcacd6fd266af91b8aed52accc382b4e165586e29;

    // Votium and compensation destinations.
    address public constant VOTIUM =
        0x63942e31e98f1833a234077f47880a66136a2d1e;

    address public constant DONATION_GAUGE =
        0x93b823e54959635ccabfcf1b313b2ad2785bfe95;

    address public constant SPLIT =
        0xe04c7d284cb023bdd4bca0fc848abeb6f8b56d34;

    address public constant INITIAL_MANAGER =
        0xf90c888e3bb5e9fc90418e72cd2e2bccfe358628;

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
        address indexed token,
        uint256 amount,
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
    /// @param contributionAmount_ Initial contribution per Votium round.
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

        address token;

        if (vault == SDOLA) {
            token = DOLA;
        } else if (vault == SFRXUSD) {
            token = FRXUSD;
        } else {
            revert("invalid vault");
        }

        // Update accounting before external calls.
        // Any later revert rolls these changes back.
        contributedInRound[round] = true;
        totalContributed += amount;

        // Burns treasury vault shares and sends the underlying here.
        IERC4626(vault).withdraw(
            amount,
            address(this),
            TREASURY
        );

        bool isDirect = directToSplit;

        if (isDirect) {
            IERC20(token).safeTransfer(SPLIT, amount);
        } else {
            // Votium pulls the fee and incentive in two transferFrom calls.
            IERC20(token).forceApprove(VOTIUM, amount);

            IVotium(VOTIUM).depositIncentiveSimple(
                token,
                amount,
                DONATION_GAUGE
            );
        }

        emit Contributed(
            round,
            vault,
            token,
            amount,
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
    /// @dev The recovered underlying is sent directly to the split.
    ///      The incentive index is available in Votium's NewIncentive event.
    function recoverUnprocessedIncentive(
        uint256 round,
        uint256 incentive,
        address token
    ) external onlyManager {
        require(
            token == DOLA || token == FRXUSD,
            "invalid token"
        );

        IERC20 underlying = IERC20(token);
        uint256 balanceBefore =
            underlying.balanceOf(address(this));

        IVotium(VOTIUM).withdrawUnprocessed(
            round,
            DONATION_GAUGE,
            incentive
        );

        uint256 recovered =
            underlying.balanceOf(address(this)) -
            balanceBefore;

        require(recovered > 0, "wrong token");

        underlying.safeTransfer(SPLIT, recovered);

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
