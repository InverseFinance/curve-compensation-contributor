const { test } = require('node:test');
const assert = require('node:assert/strict');
const ganache = require('ganache');
const { ethers } = require('ethers');
const { compile } = require('../scripts/compile.cjs');
const compiled = compile(true);
const unit = 10n ** 18n;
const cap = 700000n * unit;
const addresses = {
  treasury: '0x6508eF65b0Bd57eaBD0f1D52685A70433B2d290B',
  inverse: '0x9D5Df30F475CEA915b1ed4C0CCa59255C897b61B',
  llv2: '0x3A55AAb28B4516ceB565a6e0577285C84F53520a',
  sdola: '0xb45ad160634c528Cc3D2926d9807104FA3157305',
  sfrxusd: '0xcf62F905562626CfcDD2261162a51fd02Fc9c5b6',
  votium: '0x63942E31E98f1833A234077f47880A66136a2D1e',
  split: '0xe04c7d284cB023bdD4bCa0FC848aBEb6F8B56d34',
  gauge: '0x93B823e54959635ccAbfcf1B313B2Ad2785BFe95',
  dola: '0x865377367054516e17014CcdED1e7d814EDC9ce4'
};
async function tx(promise) { return (await promise).wait(); }
async function fixture(t, amount = 1000n * unit) {
  const chain = ganache.provider({ logging: { quiet: true },
    chain: { hardfork: 'shanghai' }, wallet: { deterministic: true, unlockedAccounts: [addresses.treasury, addresses.inverse] } });
  const provider = new ethers.BrowserProvider(chain);
  provider.pollingInterval = 10;
  const owner = await provider.getSigner(0);
  const manager = await provider.getSigner(1);
  const caller = await provider.getSigner(2);
  t.after(async () => { provider.destroy(); await chain.disconnect(); });
  const art = compiled['src/CurveCompensationContributor.sol'].CurveCompensationContributor;
  const contributor = await new ethers.ContractFactory(art.abi, art.evm.bytecode.object, owner).deploy(await owner.getAddress(), amount);
  await contributor.waitForDeployment();
  await tx(contributor.setManager(await manager.getAddress()));
  const tokenArt = compiled['test/Mocks.sol'].MockStakedToken;
  const votiumArt = compiled['test/Mocks.sol'].MockVotium;
  const gaugeArt = compiled['test/Mocks.sol'].MockRewardGauge;
  for (const addr of [addresses.sdola, addresses.sfrxusd]) {
    await provider.send('evm_setAccountCode', [addr, '0x' + tokenArt.evm.deployedBytecode.object]);
  }
  await provider.send('evm_setAccountCode', [addresses.votium, '0x' + votiumArt.evm.deployedBytecode.object]);
  await provider.send('evm_setAccountCode', [addresses.llv2, '0x' + gaugeArt.evm.deployedBytecode.object]);
  await provider.send('evm_setAccountBalance', [addresses.treasury, '0x56bc75e2d63100000']);
  await provider.send('evm_setAccountBalance', [addresses.inverse, '0x56bc75e2d63100000']);
  const treasury = await provider.getSigner(addresses.treasury);
  const inverse = await provider.getSigner(addresses.inverse);
  const sdola = new ethers.Contract(addresses.sdola, tokenArt.abi, owner);
  const sfrxusd = new ethers.Contract(addresses.sfrxusd, tokenArt.abi, owner);
  const votium = new ethers.Contract(addresses.votium, votiumArt.abi, owner);
  const gauge = new ethers.Contract(addresses.llv2, gaugeArt.abi, owner);
  for (const [token, rate] of [[sdola, 125n * unit / 100n], [sfrxusd, 150n * unit / 100n]]) {
    await tx(token.setRate(rate));
    await tx(token.mint(addresses.treasury, 2000000n * unit));
    await tx(token.connect(treasury).approve(await contributor.getAddress(), ethers.MaxUint256));
    await tx(token.mint(addresses.inverse, 2000000n * unit));
    await tx(token.connect(inverse).approve(await contributor.getAddress(), ethers.MaxUint256));
    await tx(votium.allowToken(await token.getAddress(), true));
    await tx(gauge.setDistributor(await token.getAddress(), await contributor.getAddress()));
  }
  await tx(votium.setRound(131));
  return { provider, owner, manager, caller, treasury, inverse, contributor, sdola, sfrxusd, votium, gauge };
}

for (const tokenName of ['sdola', 'sfrxusd']) {
  for (const direct of [false, true]) {
   for (const inverseDirect of [false, true]) {
    test(`${tokenName}: matched funding, Curve direct=${direct}, Inverse direct=${inverseDirect}`, async t => {
      const f = await fixture(t); const token = f[tokenName];
      if (direct) await tx(f.contributor.connect(f.manager).setDirectToSplit(true));
      if (inverseDirect) await tx(f.contributor.connect(f.inverse).setInverseDirectToGauge(true));
      const shares = await token.convertToShares(1000n * unit);
      const assets = await token.convertToAssets(shares);
      const before = await token.balanceOf(addresses.treasury);
      const inverseBefore = await token.balanceOf(addresses.inverse);
      const receipt = await tx(f.contributor.connect(f.caller).contribute(await token.getAddress()));
      assert.equal(before - await token.balanceOf(addresses.treasury), shares);
      assert.equal(inverseBefore - await token.balanceOf(addresses.inverse), shares);
      assert.equal(await f.contributor.totalContributed(), assets);
      assert.equal(await token.balanceOf(await f.contributor.getAddress()), 0n);
      assert.equal(await token.allowance(await f.contributor.getAddress(), addresses.votium), 0n);
      const netShares = shares - shares * 200n / 10000n;
      assert.equal(await token.balanceOf(addresses.votium), (direct ? 0n : netShares) + (inverseDirect ? 0n : netShares));
      assert.equal(await token.balanceOf(addresses.split), direct ? shares : 0n);
      assert.equal(await token.balanceOf(addresses.llv2), inverseDirect ? shares : 0n);
      assert.equal(await token.allowance(await f.contributor.getAddress(), addresses.llv2), 0n);
      if (!direct) {
        const incentive = await f.votium.incentives(131, addresses.gauge, 0);
        assert.equal(incentive.token, await token.getAddress()); assert.equal(incentive.amount, netShares);
      }
      if (!inverseDirect) {
        const incentive = await f.votium.incentives(131, addresses.llv2, 0);
        assert.equal(incentive.token, await token.getAddress()); assert.equal(incentive.amount, netShares);
      } else {
        assert.equal(await f.gauge.lastEpoch(), 21n * 86400n);
        const block = await f.provider.getBlock(receipt.blockNumber);
        assert.equal(await f.gauge.periodFinish(await token.getAddress()), BigInt(block.timestamp) + 21n * 86400n);
      }
      const event = receipt.logs.map(l => { try { return f.contributor.interface.parseLog(l); } catch {} }).find(e => e?.name === 'Contributed');
      assert.equal(event.args.assets, assets); assert.equal(event.args.shares, shares);
      const inverseEvent = receipt.logs.map(l => { try { return f.contributor.interface.parseLog(l); } catch {} }).find(e => e?.name === 'InverseContributed');
      assert.equal(inverseEvent.args.shares, shares); assert.equal(inverseEvent.args.assets, assets);
      assert.equal(inverseEvent.args.directToGauge, inverseDirect);
      await assert.rejects(f.contributor.connect(f.caller).contribute(tokenName === 'sdola' ? addresses.sfrxusd : addresses.sdola));
    });
   }
  }
}
test('uses the current exchange rate each round', async t => {
  const f = await fixture(t); await tx(f.contributor.connect(f.manager).setDirectToSplit(true));
  await tx(f.contributor.contribute(addresses.sdola));
  await tx(f.votium.setRound(132)); await tx(f.sdola.setRate(2n * unit));
  await tx(f.contributor.contribute(addresses.sdola));
  assert.equal(await f.sdola.balanceOf(addresses.split), 800n * unit + 500n * unit);
  assert.equal(await f.contributor.totalContributed(), 2000n * unit);
});
test('reduces the final contribution and never exceeds the gross cap', async t => {
  const f = await fixture(t, 400000n * unit);
  const inverseBefore = await f.sdola.balanceOf(addresses.inverse);
  const curveBefore = await f.sdola.balanceOf(addresses.treasury);
  await tx(f.contributor.contribute(addresses.sdola));
  await tx(f.votium.setRound(132)); await tx(f.contributor.contribute(addresses.sdola));
  assert.equal(await f.contributor.totalContributed(), cap);
  const expectedShares = cap * 4n / 5n;
  assert.equal(inverseBefore - await f.sdola.balanceOf(addresses.inverse), expectedShares);
  assert.equal(curveBefore - await f.sdola.balanceOf(addresses.treasury), expectedShares);
  await tx(f.votium.setRound(133)); await assert.rejects(f.contributor.contribute(addresses.sdola));
});
test('rounds down, books actual value, and leaves unspendable cap dust', async t => {
  const f = await fixture(t, cap); await tx(f.contributor.connect(f.manager).setDirectToSplit(true));
  await tx(f.sdola.setRate(3n * unit));
  await tx(f.contributor.contribute(addresses.sdola));
  const shares = cap / 3n; assert.equal(await f.sdola.balanceOf(addresses.split), shares);
  assert.equal(await f.contributor.totalContributed(), shares * 3n);
  await tx(f.votium.setRound(132)); await assert.rejects(f.contributor.contribute(addresses.sdola));
  assert.equal(await f.contributor.contributedInRound(132), false);
});
test('missing approval rolls back the round and cap', async t => {
  const f = await fixture(t);
  await tx(f.sdola.connect(f.treasury).approve(await f.contributor.getAddress(), 0));
  await assert.rejects(f.contributor.contribute(addresses.sdola));
  assert.equal(await f.contributor.totalContributed(), 0n);
  assert.equal(await f.contributor.contributedInRound(131), false);
});
test('missing token allowlisting rolls back the share transfer and accounting', async t => {
  const f = await fixture(t); const before = await f.sdola.balanceOf(addresses.treasury);
  await tx(f.votium.allowToken(addresses.sdola, false));
  await assert.rejects(f.contributor.contribute(addresses.sdola));
  assert.equal(await f.sdola.balanceOf(addresses.treasury), before);
  assert.equal(await f.contributor.totalContributed(), 0n);
  assert.equal(await f.contributor.contributedInRound(131), false);
});
test('rejects zero shares and inconsistent conversions before spending', async t => {
  const f = await fixture(t, 1n);
  await assert.rejects(f.contributor.contribute(addresses.sdola));
  await tx(f.contributor.setContributionAmount(1000n * unit));
  await tx(f.sdola.setOverBudget(true));
  await assert.rejects(f.contributor.contribute(addresses.sdola));
  assert.equal(await f.contributor.totalContributed(), 0n);
});
for (const tokenName of ['sdola', 'sfrxusd']) {
  test(`${tokenName}: recovers shares to the split without reopening the cap`, async t => {
    const f = await fixture(t); const token = f[tokenName];
    await tx(f.contributor.contribute(await token.getAddress()));
    const booked = await f.contributor.totalContributed();
    const incentive = await f.votium.incentives(131, addresses.gauge, 0);
    await tx(f.votium.setRound(132));
    const other = tokenName === 'sdola' ? addresses.sfrxusd : addresses.sdola;
    await assert.rejects(f.contributor.connect(f.manager).recoverUnprocessedIncentive(131, 0, other));
    await tx(token.setRate(2n * unit));
    await tx(f.contributor.connect(f.manager).kill());
    await tx(f.contributor.connect(f.manager).recoverUnprocessedIncentive(131, 0, await token.getAddress()));
    assert.equal(await token.balanceOf(addresses.split), incentive.amount);
    assert.equal(await f.contributor.totalContributed(), booked);
    await assert.rejects(f.contributor.connect(f.manager).recoverUnprocessedIncentive(131, 0, await token.getAddress()));
    await assert.rejects(f.contributor.connect(f.manager).recoverUnprocessedIncentive(131, 0, addresses.dola));
  });
}
test('preserves role restrictions and irreversible kill', async t => {
  const f = await fixture(t);
  await assert.rejects(f.contributor.connect(f.caller).setDirectToSplit(true));
  await assert.rejects(f.contributor.connect(f.caller).kill());
  await assert.rejects(f.contributor.connect(f.caller).recoverUnprocessedIncentive(131, 0, addresses.sdola));
  await assert.rejects(f.contributor.connect(f.manager).setContributionAmount(unit));
  for (const signer of [f.owner, f.manager, f.caller]) {
    await assert.rejects(f.contributor.connect(signer).setInverseDirectToGauge(true));
    await assert.rejects(f.contributor.connect(signer).recoverInverseUnprocessedIncentive(131, 0, addresses.sdola));
  }
  await assert.rejects(f.contributor.connect(f.inverse).setDirectToSplit(true));
  await tx(f.contributor.connect(f.inverse).setInverseDirectToGauge(true));
  await tx(f.contributor.connect(f.inverse).setInverseDirectToGauge(false));
  await tx(f.contributor.connect(f.manager).kill());
  await tx(f.contributor.setManager(await f.caller.getAddress()));
  await assert.rejects(f.contributor.contribute(addresses.sdola));
});

for (const failure of ['inverse allowance', 'inverse balance', 'inverse Votium', 'gauge distributor', 'gauge deposit']) {
  test(`${failure} failure rolls back both treasuries, destinations, cap and round`, async t => {
    const f = await fixture(t);
    if (failure.startsWith('gauge')) await tx(f.contributor.connect(f.inverse).setInverseDirectToGauge(true));
    if (failure === 'inverse allowance') await tx(f.sdola.connect(f.inverse).approve(await f.contributor.getAddress(), 0));
    if (failure === 'inverse balance') await tx(f.sdola.burn(addresses.inverse, await f.sdola.balanceOf(addresses.inverse)));
    if (failure === 'inverse Votium') await tx(f.votium.blockGauge(addresses.llv2, true));
    if (failure === 'gauge distributor') await tx(f.gauge.setDistributor(addresses.sdola, ethers.ZeroAddress));
    if (failure === 'gauge deposit') await tx(f.gauge.setRejectDeposit(true));
    const curveBefore = await f.sdola.balanceOf(addresses.treasury);
    const inverseBefore = await f.sdola.balanceOf(addresses.inverse);
    // Force a mined transaction rather than relying on gas-estimation failure.
    await assert.rejects(tx(f.contributor.contribute(addresses.sdola, { gasLimit: 3000000 })));
    assert.equal(await f.sdola.balanceOf(addresses.treasury), curveBefore);
    assert.equal(await f.sdola.balanceOf(addresses.inverse), inverseBefore);
    assert.equal(await f.sdola.balanceOf(addresses.votium), 0n);
    assert.equal(await f.sdola.balanceOf(addresses.llv2), 0n);
    assert.equal(await f.sdola.balanceOf(addresses.split), 0n);
    assert.equal(await f.sdola.balanceOf(await f.contributor.getAddress()), 0n);
    assert.equal(await f.contributor.totalContributed(), 0n);
    assert.equal(await f.contributor.contributedInRound(131), false);
    if (failure === 'inverse allowance') await tx(f.sdola.connect(f.inverse).approve(await f.contributor.getAddress(), ethers.MaxUint256));
    if (failure === 'inverse balance') await tx(f.sdola.mint(addresses.inverse, 2000000n * unit));
    if (failure === 'inverse Votium') await tx(f.votium.blockGauge(addresses.llv2, false));
    if (failure === 'gauge distributor') await tx(f.gauge.setDistributor(addresses.sdola, await f.contributor.getAddress()));
    if (failure === 'gauge deposit') await tx(f.gauge.setRejectDeposit(false));
    await tx(f.contributor.contribute(addresses.sdola, { gasLimit: 3000000 }));
    assert.equal(await f.contributor.contributedInRound(131), true);
  });
}
for (const tokenName of ['sdola', 'sfrxusd']) {
  test(`${tokenName}: TWG recovers only its LLv2 Votium incentive after kill`, async t => {
    const f = await fixture(t); const token = f[tokenName];
    await tx(f.contributor.contribute(await token.getAddress()));
    const compensation = await f.votium.incentives(131, addresses.gauge, 0);
    const matching = await f.votium.incentives(131, addresses.llv2, 0);
    const inverseBefore = await token.balanceOf(addresses.inverse);
    const booked = await f.contributor.totalContributed();
    await tx(f.votium.setRound(132));
    await tx(f.contributor.connect(f.manager).kill());
    const other = tokenName === 'sdola' ? addresses.sfrxusd : addresses.sdola;
    await assert.rejects(f.contributor.connect(f.inverse).recoverInverseUnprocessedIncentive(131, 0, other));
    await tx(f.contributor.connect(f.inverse).recoverInverseUnprocessedIncentive(131, 0, await token.getAddress()));
    assert.equal(await token.balanceOf(addresses.inverse) - inverseBefore, matching.amount);
    assert.equal(await token.balanceOf(addresses.split), 0n);
    assert.equal((await f.votium.incentives(131, addresses.gauge, 0)).amount, compensation.amount);
    assert.equal(await f.contributor.totalContributed(), booked);
    await assert.rejects(f.contributor.connect(f.inverse).recoverInverseUnprocessedIncentive(131, 0, await token.getAddress()));
    await tx(f.contributor.connect(f.manager).recoverUnprocessedIncentive(131, 0, await token.getAddress()));
    assert.equal(await token.balanceOf(addresses.split), compensation.amount);
  });
}
test('both direct routes work without Votium token allowlisting and TWG can switch next round', async t => {
  const f = await fixture(t);
  await tx(f.contributor.connect(f.manager).setDirectToSplit(true));
  await tx(f.contributor.connect(f.inverse).setInverseDirectToGauge(true));
  await tx(f.votium.allowToken(addresses.sdola, false));
  await tx(f.contributor.contribute(addresses.sdola));
  await tx(f.votium.setRound(132));
  await tx(f.contributor.connect(f.inverse).setInverseDirectToGauge(false));
  await tx(f.votium.allowToken(addresses.sdola, true));
  await tx(f.contributor.contribute(addresses.sdola));
  assert.equal(await f.sdola.balanceOf(addresses.split), 1600n * unit);
  assert.equal(await f.sdola.balanceOf(addresses.llv2), 800n * unit);
  assert.equal((await f.votium.incentives(132, addresses.llv2, 0)).amount, 784n * unit);
});
