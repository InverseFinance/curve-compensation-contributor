# Curve Compensation Contributor

Draft smart contract for the LlamaLend sDOLA exploit compensation programme.

The contract allows the Curve DAO treasury to make a permissionless contribution once per active Votium round. Each contribution transfers sDOLA or sfrxUSD shares held by the Curve treasury. Budgets and the lifetime cap remain denominated in underlying DOLA/frxUSD units. The contract does not redeem shares or call vault withdrawal functions.

The contribution can be routed either:

* Through Votium as an sToken incentive for the compensation donation gauge; or
* Directly to the compensation split contract, also in sTokens.

The route is selected by a manager multisig. The Curve DAO owns the contract and may change the manager or the contribution amount.

## Status

This contract is a draft and has not been audited or approved for deployment. Votium must allowlist **sDOLA and sfrxUSD themselves** before the Votium route can execute. Allowlisting DOLA/frxUSD does not cover their sTokens. The split's distribution process must support both sTokens.

## Addresses

| Role               | Address                                      |
| ------------------ | -------------------------------------------- |
| Curve treasury     | `0x6508eF65b0Bd57eaBD0f1D52685A70433B2d290B` |
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
2. The Curve treasury approves the contract to spend its sDOLA and sfrxUSD vault shares.
3. Any address may call `contribute` with either supported vault.
4. The contract checks that no contribution has been made during the current Votium active round.
5. The contract caps the budget at the remaining allocation and calls `convertToShares(budget)`, rounding down.
6. The contract values those shares using `convertToAssets(shares)`, rejects zero value or a value above the budget, and books that underlying value against the cap.
7. The round is marked as contributed, then the shares are transferred from the treasury and forwarded to Votium or the split. A later revert rolls back both transfers and accounting.
8. The `Contributed` event records the sToken, underlying asset, underlying value and actual share amount.

Only one contribution can be made during each Votium active round, regardless of which sToken or route is selected. This does not impose a minimum elapsed time between contributions on opposite sides of a round boundary.

## Contribution cap

The contract may contribute no more than:

```text
740,000 underlying tokens
```

The final contribution budget is reduced automatically if the remaining allocation is smaller than the configured contribution amount.

For each contribution:
```text
budget = min(contributionAmount, MAX_TOTAL_CONTRIBUTION - totalContributed)
shares = selectedSToken.convertToShares(budget)
assets = selectedSToken.convertToAssets(shares)
totalContributed += assets
```

The cap measures the reported underlying value of gross shares transferred from the treasury, including any Votium fee paid in shares. It is not a USD market-value cap. Both supported underlyings have 18 decimals; their units are added at nominal parity without an oracle or a depeg adjustment.

Conversion rounds down, so the amount booked can be slightly below the budget. An allocation too small to buy a positive-value share cannot be spent; that call reverts without consuming the round. Votium also rejects deposits whose rounded platform fee is zero. Such dust may remain below the cap; the contract never rounds up to exhaust it.

Share value is recorded once, at contribution execution, using the sToken's conversion views. Subsequent yield, share-price changes or incentive recovery do not change historical accounting or reopen the allocation. These views are trusted valuation inputs, not guaranteed redemption proceeds.

Example: with a 1,000 underlying-unit budget and 1.25 underlying units per share, the contract transfers 800 sTokens and books 1,000 underlying units.

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

## Asset custody

The contract is not intended to retain assets between transactions.

During a successful contribution, sToken shares are transferred from the treasury and forwarded to Votium or the compensation split in the same transaction. Votium allowance is cleared after a successful deposit. Recovery forwards only the newly recovered sToken balance to the split and remains available after the kill switch is used.

## Required approvals

Before contributions can be executed, the Curve treasury must approve this contract to spend:

* sDOLA vault shares
* sfrxUSD vault shares

The treasury does not need to approve DOLA or frxUSD.

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

Tests run against a local EVM with mock sTokens whose withdrawal and redemption functions always revert. Coverage includes both tokens and routes, changing share rates, downward rounding, cap exhaustion and dust, transfer/allowlist failures, role restrictions, and recovery after kill. The Votium mock models fees and depositor recovery; it is not a substitute for validating the deployed Votium contract's full processing rules on a mainnet fork.

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

## Licence

MIT

