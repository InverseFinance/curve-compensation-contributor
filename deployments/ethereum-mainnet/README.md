# Ethereum mainnet deployment

Contract: [`0xE15841FAf70Dc0D8e84Ab709F8A65dDDA217449b`](https://etherscan.io/address/0xE15841FAf70Dc0D8e84Ab709F8A65dDDA217449b#code), chain ID `1`.

Deployment transaction: [`0x6b240ab23f44b24e5e7652c7bf4138c1aea81a2d6f02bcf5d09a9932e2f91e13`](https://etherscan.io/tx/0x6b240ab23f44b24e5e7652c7bf4138c1aea81a2d6f02bcf5d09a9932e2f91e13), block `26,243,273`.

The contract is verified on Etherscan with 11 separate Solidity source files, Solidity `0.8.37+commit.f401782d`, optimization enabled with `200` runs, EVM target `shanghai`, and IR disabled.

## Files

- [`deployment.json`](deployment.json) records the deployment transaction, compiler settings, constructor input, bytecode hashes, source reference and initial state readback.
- [`standard-input.json`](standard-input.json) preserves the exact compiler input used for Etherscan verification, including all source contents and their original line endings. It contains public contract source and settings; no API key or RPC endpoint is included.

The constructor input and state readback are historical facts. The contribution amount remains owner-configurable within the contract's limits. These records do not establish approved programme terms or authorize either treasury to spend. Read live configuration before preparing governance execution or contributions.

## Reproduce the deployment build

From the repository root, with the dependencies installed as described in the main README:

```sh
node scripts/check-deployment.cjs
```

This offline check compiles the archived input and verifies the complete creation and runtime bytecode hashes, including compiler metadata, and the deployment transaction's input hash including constructor arguments. It also compiles the repository source and checks that its executable code and ABI match the archived build. The recorded onchain comparison and initial state snapshot are anchored to the block in `deployment.json`; this command does not fetch or revalidate live state.

## Relationship to repository source

The normal npm imports in [`src/CurveCompensationContributor.sol`](../../src/CurveCompensationContributor.sol) remain unchanged. The Remix source uses `@openzeppelin/contracts@5.3.0/...` imports, while the project pins the same version in `package.json` and `pnpm-lock.yaml`. The imported dependency sources match. Source paths and line endings also differ.

These source differences alter compiler metadata. The archived compiler input reproduces the exact deployed build; the normal project build produces the same executable creation/runtime code and ABI, with different metadata.

An earlier flattened, unoptimized deployment is identified in `deployment.json` for traceability. Use the optimized address above in the planned governance proposal and treasury authorization payloads. No claim is made that the earlier deployment has been disabled.
