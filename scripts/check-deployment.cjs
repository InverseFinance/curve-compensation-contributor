const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const solc = require('solc');
const { keccak256 } = require('ethers');
const { compile } = require('./compile.cjs');

const root = path.join(__dirname, '..');
const directory = path.join(root, 'deployments/ethereum-mainnet');
const record = JSON.parse(fs.readFileSync(path.join(directory, 'deployment.json'), 'utf8'));
const inputBytes = fs.readFileSync(path.join(directory, record.verification.standardJsonInput));
const input = JSON.parse(inputBytes);
assert.equal(crypto.createHash('sha256').update(inputBytes).digest('hex'), record.verification.inputSha256);
assert(solc.version() === record.compiler.version || solc.version().startsWith(record.compiler.version + '.'));
assert.deepEqual(input.settings.optimizer, record.compiler.optimizer);
assert.equal(input.settings.evmVersion, record.compiler.evmVersion);
assert.equal(Boolean(input.settings.viaIR), record.compiler.viaIR);
assert.equal(Object.keys(input.sources).length, record.verification.sourceFileCount);

const output = JSON.parse(solc.compile(inputBytes.toString('utf8')));
const errors = (output.errors || []).filter(item => item.severity === 'error');
assert.equal(errors.length, 0, errors.map(item => item.formattedMessage).join('\n'));
const [source, name] = record.source.verifiedContract.split(':');
const archived = output.contracts[source][name];
const creation = '0x' + archived.evm.bytecode.object;
const runtime = '0x' + archived.evm.deployedBytecode.object;
assert.equal(keccak256(creation), record.bytecode.creationKeccak256);
assert.equal(keccak256(runtime), record.bytecode.runtimeKeccak256);
assert.equal(keccak256(creation + record.constructor.encodedArguments.slice(2)), record.bytecode.deploymentInputKeccak256);
assert.equal(archived.evm.deployedBytecode.object.length / 2, record.bytecode.runtimeBytes);
assert.equal(BigInt(record.constructor.encodedArguments).toString(), record.constructor.arguments.contributionAmount_);

// Repository import paths remain standard npm paths. Only metadata changes.
const current = compile()['src/CurveCompensationContributor.sol'].CurveCompensationContributor;
const executable = hex => hex.slice(0, -(parseInt(hex.slice(-4), 16) + 2) * 2);
assert.equal(executable(current.evm.bytecode.object), executable(archived.evm.bytecode.object));
assert.equal(executable(current.evm.deployedBytecode.object), executable(archived.evm.deployedBytecode.object));
assert.deepEqual(current.abi, archived.abi);

console.log('Archived verification input reproduces the recorded creation, runtime and deployment-input hashes.');
console.log('Current repository source matches the archived executable bytecode and ABI. No network requests were made.');
