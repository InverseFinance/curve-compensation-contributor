const fs = require('node:fs');
const path = require('node:path');
const { compile } = require('./compile.cjs');
const artifacts = path.join(__dirname, '..', 'artifacts');
fs.mkdirSync(artifacts, { recursive: true });
fs.writeFileSync(path.join(artifacts, 'contracts.json'), JSON.stringify(compile(), null, 2));
console.log('Compiled with Solidity 0.8.24, OpenZeppelin 5.3.0; optimizer 200 runs, Shanghai EVM.');
