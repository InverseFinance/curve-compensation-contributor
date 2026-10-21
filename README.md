# Curve Compensation Contributor

Smart contract for the LlamaLend sDOLA exploit compensation programme.

The contract pairs Curve DAO-funded compensation with an equal Inverse DAO-funded incentive for the sDOLA LLv2 gauge, once per active Votium round. Each execution transfers the **same sToken and exactly the same number of shares from each treasury**, atomically. Budgets and the lifetime cap remain denominated in underlying DOLA/frxUSD units per treasury. The contract does not redeem shares or call vault withdrawal functions.

Curve's compensation can be routed either:

* Through Votium as an sToken incentive for the compensation donation gauge; or
* Directly to the compensation split contract, also in sTokens.

The route is selected by a manager multisig. Ownership starts with the Curve DAO's Ownership Agent, which may change the manager or the contribution amount and transfer ownership later.

Inverse's matching contribution always targets the sDOLA LLv2 gauge. The fixed Inverse TWG multisig alone selects whether to deposit it into Votium or directly into the gauge through `deposit_reward_token(token, shares, 3 weeks)`. This toggle is independent of Curve's compensation route. Both routes default to Votium.

If either treasury transfer or either incentive leg fails, the entire transaction reverts, including both treasury debits, destination transfers, cap accounting and the round marker. Curve cannot contribute through this contract without Inverse's match, or vice versa.

## Status

The hardcoded initial Curve Ownership Agent and Solidity 0.8.37 upgrade are merged into `main`. Validation completed on 21 October 2026 includes 29 passing unit tests, 22 passing mainnet-fork scenarios with each compiler version, local deployment checks for the original and flattened sources, and delivery and withdrawal of both sTokens through all 15 split recipients. See the [current validation report](reviews/2026-10-21-solc-0.8.37.md).

The Ethereum mainnet contract is deployed and [verified on Etherscan](https://etherscan.io/address/0xE15841FAf70Dc0D8e84Ab709F8A65dDDA217449b#code) at `0xE15841FAf70Dc0D8e84Ab709F8A65dDDA217449b`. The [deployment record](deployments/ethereum-mainnet/) includes the transaction, compiler settings, bytecode hashes, exact verification input and initial state readback.

Use of the contributor, its contribution budget and Curve treasury funding require Curve DAO approval; Inverse's matching funding requires its own treasury authorization. Deployment and source verification do not grant either treasury a spending authorization. The constructor input records an initial onchain setting, not approved funding terms; the owner may change the contribution amount within the contract's limits.

## Mainnet deployment

| Item | Value |
| --- | --- |
| Network | Ethereum mainnet, chain ID `1` |
| Contributor | [`0xE15841FAf70Dc0D8e84Ab709F8A65dDDA217449b`](https://etherscan.io/address/0xE15841FAf70Dc0D8e84Ab709F8A65dDDA217449b#code) |
| Deployment transaction | [`0x6b240ab23f44b24e5e7652c7bf4138c1aea81a2d6f02bcf5d09a9932e2f91e13`](https://etherscan.io/tx/0x6b240ab23f44b24e5e7652c7bf4138c1aea81a2d6f02bcf5d09a9932e2f91e13) |
| Deployment block | `26,243,273` |
| Verification | Etherscan; 11 separate Solidity source files |
| Exact deployment files | [Deployment record](deployments/ethereum-mainnet/deployment.json) and [Standard JSON compiler input](deployments/ethereum-mainnet/standard-input.json) |

The repository retains its standard npm imports, with OpenZeppelin Contracts pinned to 5.3.0. Remix used explicit versioned import paths and different source paths/line endings. The executable creation/runtime code and ABI match the repository build; compiler metadata differs. The archived input reproduces the complete deployed bytecode, including metadata. Run `node scripts/check-deployment.cjs` after installing dependencies to check both builds offline.

## Build and initialization

| Setting | Value |
| --- | --- |
| Network | Ethereum mainnet, chain ID `1` |
| Solidity compiler | `0.8.37+commit.f401782d` |
| EVM target | `shanghai` |
| Optimizer | Enabled, 200 runs |
| IR pipeline | Disabled |
| Constructor input | `contributionAmount_`: a positive per-treasury budget in 18-decimal underlying units, at most `MAX_TOTAL_CONTRIBUTION` |
| Initial owner | Curve Ownership Agent, hardcoded as `INITIAL_OWNER` |
| Initial routes | Both Votium |
| ETH transaction value | `0`; deployment gas is paid separately |

The constructor takes only the contribution amount; the contract defines no default contribution budget. The initial amount is supplied at deployment, and the current owner may later change it with `setContributionAmount(uint256)`, within the contract's limits. The deployer receives no owner or manager permissions merely by deploying the contract. Both supported underlyings have 18 decimals; the configured amount is a nominal underlying-unit budget, not a USD price guarantee.

Shanghai reproduces the tested deployment artifacts. A separate Osaka compilation with the same compiler, optimizer and pipeline produced identical executable creation and runtime code after removing metadata; the verification metadata differs. The [validation report](reviews/2026-10-21-solc-0.8.37.md) records this comparison.

## Addresses

| Role               | Address                                      |
| ------------------ | -------------------------------------------- |
| Deployed contributor | [`0xE15841FAf70Dc0D8e84Ab709F8A65dDDA217449b`](https://etherscan.io/address/0xE15841FAf70Dc0D8e84Ab709F8A65dDDA217449b#code) |
| Initial owner (Curve Ownership Agent) | `0x40907540d8a6C65c637785e8f8B742ae6b0b9968` |
| Curve treasury     | `0x6508eF65b0Bd57eaBD0f1D52685A70433B2d290B` |
| Inverse TWG treasury | `0x9D5Df30F475CEA915b1ed4C0CCa59255C897b61B` |
| sDOLA LLv2 gauge    | `0x3A55AAb28B4516ceB565a6e0577285C84F53520a` |
| Initial manager    | `0xF90C888E3bB5e9fc90418e72cD2e2bcCFE358628` |
| Donation gauge     | `0x93B823e54959635ccAbfcf1B313B2Ad2785BFe95` |
| Compensation split | `0xe04c7d284cB023bdD4bCa0FC848aBEb6F8B56d34` |
| Votium             | `0x63942E31E98f1833A234077f47880A66136a2D1e` |
| sDOLA              | `0xb45ad160634c528Cc3D2926d9807104FA3157305` |
| sfrxUSD            | `0xcf62F905562626CfcDD2261162a51fd02Fc9c5b6` |
| DOLA               | `0x865377367054516e17014CcdED1e7d814EDC9ce4` |
| frxUSD             | `0xCAcd6fd266aF91b8AeD52aCCc382b4e165586E29` |

## Contribution lifecycle

1. An initial contribution budget in 18-decimal underlying units is supplied at deployment. The Curve DAO owner may change it later.
2. Both treasuries approve the contract to spend the sTokens they intend to use and hold enough shares for a matched contribution.
3. Any address may call `contribute` with either supported vault.
4. The contract checks that no contribution has been made during the current Votium active round.
5. The contract caps the budget at the remaining allocation and calls `convertToShares(budget)`, rounding down.
6. The contract values those shares using `convertToAssets(shares)`, rejects zero value or a value above the budget, and books that underlying value against the cap.
7. The round is marked as contributed, then exactly `shares` are pulled from each treasury. Curve's shares go to the donation-gauge Votium incentive or the compensation split. Inverse's shares go to the LLv2 Votium incentive or directly to LLv2 gauge rewards for three weeks. Any failure rolls back the whole transaction.
8. `Contributed` records Curve's sToken, underlying asset, underlying value and share amount; `InverseContributed` records the matched value and shares and Inverse's independently selected route.

Only one contribution can be made during each Votium active round, regardless of which sToken or route is selected. This does not impose a minimum elapsed time between contributions on opposite sides of a round boundary.

## Contribution cap

The contract may contribute no more than the following amount **from each treasury**:

```text
500,000 underlying tokens
```

`totalContributed` records the matched amount once, not twice. Gross combined funding is therefore `2 * totalContributed`, capped at 1,000,000 nominal underlying units. The same cap reduction and rounding apply to both treasury debits.

The cap was reduced from 700,000 to 500,000 per treasury on 30 September 2026. The cap is a ceiling, not a spending target or a guarantee of incentive efficiency. The remaining compensation target must be reconciled during operation. Once it is reached, the manager can permanently stop further contributions with `kill()`; the contract does not track the external compensation target automatically.

The final contribution budget is reduced automatically if the remaining allocation is smaller than the configured contribution amount.

For each contribution:
```text
budget = min(contributionAmount, MAX_TOTAL_CONTRIBUTION - totalContributed)
shares = selectedSToken.convertToShares(budget)
assets = selectedSToken.convertToAssets(shares)
totalContributed += assets
```

The cap measures the reported underlying value of gross shares transferred from each treasury, including any Votium fee paid in shares. The match is equal **gross shares**, not equal net rewards: a Votium leg pays the platform fee, whereas a direct leg deposits all of its shares. It is not a USD market-value cap. Both supported underlyings have 18 decimals; their units are added at nominal parity without an oracle or a depeg adjustment.

Conversion rounds down, so the amount booked can be slightly below the budget. An allocation too small to buy a positive-value share cannot be spent; that call reverts without consuming the round. Votium also rejects deposits whose rounded platform fee is zero. Such dust may remain below the cap; the contract never rounds up to exhaust it.

Share value is recorded once, at contribution execution, using the sToken's conversion views. Subsequent yield, share-price changes or incentive recovery do not change historical accounting or reopen the allocation. These views are trusted valuation inputs, not guaranteed redemption proceeds.

## Direct LLv2 reward schedule

The Inverse route calls the three-argument `deposit_reward_token` overload with a fixed epoch of **1,814,400 seconds (21 days)**. The verified gauge accepts this duration and combines any undistributed rewards with the new deposit, then sets `period_finish` to the current timestamp plus three weeks. A new contribution before expiry therefore reschedules the remaining rewards across a fresh three-week period; it does not create a separate independent tranche. This route rewards gauge depositors rather than Votium voters.

## Roles

### Curve DAO owner

Ownership starts at the hardcoded Curve Ownership Agent (`INITIAL_OWNER`), regardless of who deploys the contract. The constructor takes only the initial contribution amount. The current owner retains the inherited `transferOwnership(address)` function and can transfer ownership after deployment.

The owner may:

* Change the contribution amount to a positive value at most `MAX_TOTAL_CONTRIBUTION`
* Change the manager
* Transfer contract ownership

### Manager

The manager may:

* Select Votium or direct-to-split routing
* Permanently disable future contributions
* Recover eligible unprocessed Votium sToken incentives directly to the split
* Send idle ERC-20 balances to the Curve treasury, including accidental transfers and recovered direct-gauge reward residues

### Permissionless caller

Any address may execute an available contribution. The caller cannot choose the amount, recipient, gauge or Votium parameters.

The caller can choose either supported sToken, so both treasuries must fund and approve the selected token. Changing the Curve DAO's contribution amount also changes the required Inverse match. TWG controls its exposure through its share allowances and balances; a shortfall blocks both legs.

### Inverse TWG multisig

Only `INVERSE_TREASURY` may:

* Call `setInverseDirectToGauge(bool)` to select its Votium or direct LLv2 reward route
* Call `recoverInverseUnprocessedIncentive(round, index, token)` to return eligible unprocessed LLv2 Votium incentives to TWG

The Curve owner and manager cannot use these functions. TWG cannot change Curve's route, contribution amount, owner or manager. TWG's address is fixed and cannot be reassigned by Curve governance.

Inverse recovery is limited to the fixed LLv2 gauge and supported sTokens. It does not recover Curve's donation-gauge incentive, refund Votium's fee, reduce historical accounting or permit a replacement contribution. Curve's existing recovery remains manager-only and forwards recovered donation-gauge incentives to the split. Both recovery functions remain available after kill. Directly deposited gauge rewards are governed by the gauge's distribution mechanism; the Inverse recovery function covers Votium incentives only.

## Asset custody

The contract is not intended to retain assets between transactions.

During a successful contribution, equal sToken shares are transferred from both treasuries and forwarded to their fixed destinations in the same transaction. Each Votium or gauge allowance is cleared after its successful deposit. Recovery forwards only the newly recovered balance, to the split for Curve's incentive or to TWG for Inverse's incentive.

Accidental transfers and expired direct-gauge reward residues may leave idle tokens in the contributor. The manager's `rescue(token)` sends the full idle balance to Curve's treasury, including any Inverse-funded residue. This function remains available after `kill()`.

## Required approvals

Before contributions can be executed, both Curve's treasury and Inverse's TWG treasury must approve this contract to spend the chosen sToken:

* sDOLA vault shares
* sfrxUSD vault shares

Approve each sToken intended for use; approving both is not required to contribute with one. Neither treasury needs to approve DOLA or frxUSD. For the direct Inverse route, setting the contributor as the gauge's reward distributor is separate from these ERC-20 approvals.

Votium must allowlist **sDOLA and sfrxUSD themselves** for their Votium routes. Both were allowlisted at the latest reviewed mainnet snapshot, block 26,235,731; recheck the chosen token before activation. Allowlisting DOLA/frxUSD does not cover their sTokens. Direct Inverse rewards additionally require the chosen sToken to be registered on the LLv2 gauge with the deployed contributor as its authorized distributor. These are activation requirements; deploying the contributor does not perform them.

## Dependencies

* Solidity `0.8.37`
* OpenZeppelin Contracts 5.3.0
* Votium incentive contract
* ERC-20 sDOLA and sfrxUSD, with ERC-4626 conversion views

Dependencies are pinned in `package.json` and `pnpm-lock.yaml`.

## Build and tests

Install Node.js and pnpm 11.19.0, then run:

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm build
pnpm test
```

Run `pnpm test:fork` for integration checks against deployed contracts at mainnet block 26,028,833. Set `FORK_RPC_URL` to a read-only Ethereum RPC with historical state access if the default public endpoint cannot serve that block. This creates a local Ganache fork, impersonates accounts and supplies missing treasury funding and gauge registration only in that fork; it does not broadcast live transactions. Results are written to `artifacts/fork-review-results.json`.

The checked-in historical fork suite has 20 scenarios: 18 integration checks and two confirmations of the gauge-leftover routing behavior described under asset custody. It does not include individual split-recipient withdrawals. The additional 21 October upgrade review below extended that coverage to all 15 recipients for each sToken.

Build settings: Solidity 0.8.37, optimizer enabled with 200 runs, Shanghai EVM, IR disabled. The build writes compiler output to `artifacts/`.

The [0.8.37 upgrade validation](reviews/2026-10-21-solc-0.8.37.md) records 29 passing unit tests, an additional 22-scenario fork review at block 26,235,731 with both compiler versions, and local checks of both deployment formats. The fork covered both tokens across all four routes, recovery, failure rollback, and credit and withdrawal for all 15 split recipients. The 22 scenarios include two confirmations of direct-reward residue behavior. These results are dated snapshots, not claims about future governance changes.

Tests run against a local EVM with mock sTokens whose withdrawal and redemption functions always revert. Coverage includes both tokens and all four route combinations, equal treasury debits, changing share rates, downward rounding, cap exhaustion and dust, TWG-only controls, recovery isolation after kill, the three-week epoch, and whole-transaction rollback on missing Inverse funds/allowance, failed LLv2 Votium deposits and failed direct gauge deposits. The Votium and gauge mocks are not substitutes for validating the deployed contracts' full processing and reward-distribution rules on a mainnet fork.

## Review scope

### V12 recovery finding (F-282379)

The [V12 report](https://v12.sh/runs/8013/public) demonstrates third-party recovery only with a modified Votium mock that omits depositor access control. The configured Votium contract at `0x63942E31E98f1833A234077f47880A66136a2D1e` requires `incentives[round][gauge][index].depositor == msg.sender` in `withdrawUnprocessed()`. Its [Sourcify verification record](https://sourcify.dev/server/v2/contract/1/0x63942E31E98f1833A234077f47880A66136a2D1e?fields=all), checked on 2026-09-19, reports matching runtime bytecode. Recovery intentionally relies on that external ownership check; the finding does not apply to this deployment. Revalidate this dependency if changing Votium.

Unit regression tests exercise both recovery routes with third-party incentives for each supported token: withdrawals revert with `!depositor`, balances and accounting remain unchanged, and the original depositor can still recover. The additional mainnet-fork review also checked third-party recovery rejection against the real Votium contract for both tokens. The existing balance-delta check reverts the entire withdrawal if the supplied token is wrong.

Do not apply the report's sample getter interface unchanged: production `incentives()` returns `(token, amount, maxPerVote, distributed, recycled, depositor)`, not `(token, amount, depositor)`.

### Review history

The [22 September integration review](reviews/2026-09-22.md) preserves its historical commit, compiler, cap and test results. The [21 October upgrade validation](reviews/2026-10-21-solc-0.8.37.md) records the current compiler and expanded coverage. Historical recommendations are retained as evidence; the implementation and governance status are described above.

## Deployment and activation

1. Supply the intended initial contribution amount when deploying the current merged source with the documented build settings. Verify the source using the actual compiler version, settings and constructor input used for deployment. Governance approval of the programme, contribution budget and funding is separate from deploying the contract.
2. Check the deployed runtime and fixed addresses against the compiled artifact. Read back `owner()`, `manager()`, `contributionAmount()`, `MAX_TOTAL_CONTRIBUTION()`, `totalContributed()`, both route flags and `killed()`. The initial accounting is zero, both routes are Votium, and the contract is not killed.
3. Obtain the required governance and treasury authorizations, then arrange the chosen sToken's spending approval from each treasury to the deployed contributor. The Curve DAO owner can update the contribution amount after deployment. Check current share balances, conversions, Votium allowlisting and platform fee before the first contribution.
4. If using direct Inverse rewards, complete reward-token registration and distributor setup on the LLv2 gauge. If using direct Curve compensation, use the existing split configuration and supported distribution process.
5. Simulate the actual treasury approval payloads and first contribution with the recorded mainnet address before execution. Preserve the deployment and verification evidence in this repository; update the relevant records if a replacement deployment is adopted.
6. Execute and reconcile contributions by active Votium round. Monitor the external compensation target and use `kill()` when the programme is complete. The code cap does not automatically track completion of compensation.

## Licence

MIT
