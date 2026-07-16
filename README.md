# Curve Compensation Contributor

Draft smart contract for the LlamaLend sDOLA exploit compensation programme.

The contract allows the Curve DAO treasury to make a permissionless contribution once per active Votium round. Each contribution is funded by withdrawing underlying assets from yield-bearing ERC-4626 vault shares held by the Curve treasury.

The contribution can be routed either:

* Through Votium as an incentive for the compensation donation gauge; or
* Directly to the compensation split contract.

The route is selected by a manager multisig. The Curve DAO owns the contract and may change the manager or the contribution amount.

## Status

This contract is a draft and has not been audited or approved for deployment.

## Addresses

| Role               | Address                                      |
| ------------------ | -------------------------------------------- |
| Curve treasury     | `0x6508eF65b0Bd57eaBD0f1D52685A70433B2d290B` |
| Initial manager    | `0xF90C888E3bB5e9fc90418e72cD2e2bcCFE358628` |
| Donation gauge     | `0x93B823e54959635ccAbfcf1B313B2Ad2785BFe95` |
| Compensation split | `0xe04c7d284cB023bdD4bCa0FC848aBEb6F8B56d34` |
| Votium             | `0x63942E31E98f1833A234077f47880A66136a2D1e` |
| sDOLA              | `0xB45ad160634c528Cc3D2926d9807104FA3157305` |
| sfrxUSD            | `0xcf62F905562626CfcDD2261162a51fd02Fc9c5b6` |
| DOLA               | `0x865377367054516e17014CcdED1e7D814EDC9ce4` |
| frxUSD             | `0xCAcd6fd266aF91b8AeD52aCCc382b4e165586E29` |

## Contribution lifecycle

1. The Curve DAO sets a contribution amount.
2. The Curve treasury approves the contract to spend its sDOLA and sfrxUSD vault shares.
3. Any address may call `contribute` with either supported vault.
4. The contract checks that no contribution has been made during the current Votium active round.
5. The contract withdraws the configured amount of DOLA or frxUSD from the selected vault.
6. The underlying is either deposited into Votium for the donation gauge or transferred directly to the compensation split.
7. The round is marked as contributed.

Only one contribution can be made during each Votium active round, regardless of which vault is selected.

## Contribution cap

The contract may contribute no more than:

```text
740,000 underlying tokens
```

The final contribution is reduced automatically if the remaining allocation is smaller than the configured contribution amount.

The cap measures the gross amount withdrawn from the Curve treasury. Any Votium platform fee is therefore included in the amount counted toward the cap.

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
* Recover eligible unprocessed Votium incentives
* Return accidentally transferred ERC-20 tokens to the Curve treasury

### Permissionless caller

Any address may execute an available contribution. The caller cannot choose the amount, recipient, gauge or Votium parameters.

## Asset custody

The contract is not intended to retain assets between transactions.

During a successful contribution, underlying assets are withdrawn from the selected ERC-4626 vault and forwarded to Votium or the compensation split in the same transaction.

## Required approvals

Before contributions can be executed, the Curve treasury must approve this contract to spend:

* sDOLA vault shares
* sfrxUSD vault shares

The treasury does not need to approve DOLA or frxUSD.

## Dependencies

* Solidity `0.8.24`
* OpenZeppelin Contracts 5.x
* Votium incentive contract
* ERC-4626-compatible sDOLA and sfrxUSD vaults

The exact OpenZeppelin version must be pinned before deployment.

## Review scope

Reviewers should verify:

* All hardcoded addresses
* The Curve DAO owner address used at deployment
* ERC-4626 withdrawal and allowance behaviour
* Votium token allowlisting
* Votium round and unprocessed-incentive behaviour
* Cap accounting
* Role permissions
* Behaviour at the Votium round boundary
* Behaviour when the treasury has insufficient shares or allowance
* Behaviour when the final contribution is smaller than the configured amount

## Licence

MIT
