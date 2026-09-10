# Curve Compensation Contributor

Draft smart contract for the LlamaLend sDOLA exploit compensation programme.

The contract pairs Curve DAO-funded compensation with an equal Inverse DAO-funded incentive for the sDOLA LLv2 gauge, once per active Votium round. Each execution transfers the **same sToken and exactly the same number of shares from each treasury**, atomically. Budgets and the lifetime cap remain denominated in underlying DOLA/frxUSD units per treasury. The contract does not redeem shares or call vault withdrawal functions.

Curve's compensation can be routed either:

* Through Votium as an sToken incentive for the compensation donation gauge; or
* Directly to the compensation split contract, also in sTokens.

The route is selected by a manager multisig. The Curve DAO owns the contract and may change the manager or the contribution amount.

Inverse's matching contribution always targets the sDOLA LLv2 gauge. The fixed Inverse TWG multisig alone selects whether to deposit it into Votium or directly into the gauge through `deposit_reward_token(token, shares, 3 weeks)`. This toggle is independent of Curve's compensation route. Both routes default to Votium.

If either treasury transfer or either incentive leg fails, the entire transaction reverts, including both treasury debits, destination transfers, cap accounting and the round marker. Curve cannot contribute through this contract without Inverse's match, or vice versa.

## Status

This contract is a draft and has not been audited or approved for deployment. Votium must allowlist **sDOLA and sfrxUSD themselves** before either Votium route can execute. Allowlisting DOLA/frxUSD does not cover their sTokens. The split's distribution process must support both sTokens. For direct LLv2 rewards, each sToken must be registered on the gauge and this contributor must be its authorized reward distributor. These are deployment prerequisites, not enforced setup actions in this repository.

## Addresses

| Role               | Address                                      |
| ------------------ | -------------------------------------------- |
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

1. The Curve DAO sets a contribution budget in 18-decimal underlying units.
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
700,000 underlying tokens
```

`totalContributed` records the matched amount once, not twice. Gross combined funding is therefore `2 * totalContributed`, capped at 1,400,000 nominal underlying units. The same cap reduction and rounding apply to both treasury debits.

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

Example: with a 1,000 underlying-unit budget and 1.25 underlying units per share, the contract transfers 800 sTokens from Curve and 800 from Inverse, and increases `totalContributed` by 1,000. At a 2% Votium fee, each Votium leg deposits 784 net reward shares and pays 16 shares in fees; a direct leg deposits 800 shares.

## Direct LLv2 reward schedule

The Inverse route calls the three-argument `deposit_reward_token` overload with a fixed epoch of **1,814,400 seconds (21 days)**. The verified gauge accepts this duration and combines any undistributed rewards with the new deposit, then sets `period_finish` to the current timestamp plus three weeks. A new contribution before expiry therefore reschedules the remaining rewards across a fresh three-week period; it does not create a separate independent tranche. This route rewards gauge depositors rather than Votium voters.

## Roles

### Curve DAO owner

The owner may:

* Change the contribution amount
* Change the manager
* Transfer contract ownership

### Manager

The manager may:

* Select Votium or direct-to-split routing
* Permanently disable future contributions
* Recover eligible unprocessed Votium sToken incentives directly to the split
* Return accidentally transferred ERC-20 tokens to the Curve treasury

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

## Required approvals

Before contributions can be executed, both Curve's treasury and Inverse's TWG treasury must approve this contract to spend the chosen sToken:

* sDOLA vault shares
* sfrxUSD vault shares

Neither treasury needs to approve DOLA or frxUSD. For the direct Inverse route, setting the contributor as the gauge's reward distributor is separate from these ERC-20 approvals.

## Dependencies

* Solidity `0.8.24`
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

Build settings: Solidity 0.8.24, optimizer enabled with 200 runs, Shanghai EVM. The build writes compiler output to `artifacts/`.

Tests run against a local EVM with mock sTokens whose withdrawal and redemption functions always revert. Coverage includes both tokens and all four route combinations, equal treasury debits, changing share rates, downward rounding, cap exhaustion and dust, TWG-only controls, recovery isolation after kill, the three-week epoch, and whole-transaction rollback on missing Inverse funds/allowance, failed LLv2 Votium deposits and failed direct gauge deposits. The Votium and gauge mocks are not substitutes for validating the deployed contracts' full processing and reward-distribution rules on a mainnet fork.

## Review scope

Reviewers should verify:

* All hardcoded addresses
* The Curve DAO owner address used at deployment
* Share conversion, rounding and ERC-20 allowance behaviour
* Votium allowlisting and distribution support for sDOLA and sfrxUSD
* Votium round and unprocessed-incentive behaviour
* Cap accounting
* Role permissions
* Behaviour at the Votium round boundary
* Behaviour when the treasury has insufficient shares or allowance
* Behaviour when the final contribution is smaller than the configured amount
* Split distribution support for both sTokens
* Mainnet-fork execution against the intended deployment configuration
* Inverse TWG funding, approvals and route control
* LLv2 reward-token registration and distributor configuration for both sTokens
* Direct reward top-ups and the three-week distribution schedule

## Licence

MIT
