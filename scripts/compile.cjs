const fs = require('node:fs');
const path = require('node:path');
const solc = require('solc');

function compile(includeTests = false) {
  const sources = {};
  for (const name of ['src/CurveCompensationContributor.sol', ...(includeTests ? ['test/Mocks.sol'] : [])]) {
    sources[name] = { content: fs.readFileSync(path.join(__dirname, '..', name), 'utf8') };
  }
  const output = JSON.parse(solc.compile(JSON.stringify({
    language: 'Solidity', sources,
    settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: 'shanghai',
      outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object'] } } }
  }), { import: name => {
    try { return { contents: fs.readFileSync(require.resolve(name), 'utf8') }; }
    catch { return { error: `Missing dependency: ${name}` }; }
  } }));
  const errors = (output.errors || []).filter(e => e.severity === 'error');
  if (errors.length) throw new Error(errors.map(e => e.formattedMessage).join('\n'));
  return output.contracts;
}
module.exports = { compile };
