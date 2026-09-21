const fs = require('node:fs');
const assert = require('node:assert/strict');
const ganache = require('ganache');
const { ethers } = require('ethers');
const { compile } = require('../scripts/compile.cjs');
const pre = require('./fixtures/mainnet-26028833.json');
const A = pre.addresses;
const gaugeAbi = pre.gaugeAbi;
const votiumAbi = pre.votiumAbi;
const tokenAbi = ['function balanceOf(address) view returns(uint256)','function transfer(address,uint256) returns(bool)','function approve(address,uint256) returns(bool)','function allowance(address,address) view returns(uint256)','function convertToAssets(uint256) view returns(uint256)','function convertToShares(uint256) view returns(uint256)'];
const results = [];
async function tx(p) {return (await p).wait();}
async function main() {
 const chain = ganache.provider({fork:{url:process.env.FORK_RPC_URL || 'https://ethereum-rpc.publicnode.com',blockNumber:pre.block},logging:{quiet:true},chain:{hardfork:'shanghai'},wallet:{deterministic:true,unlockedAccounts:[A.curve,A.inverse,pre.gauge.manager,pre.votium.owner]}});
 const provider = new ethers.BrowserProvider(chain); provider.pollingInterval=10;
 try {
  const owner=await provider.getSigner(0), manager=await provider.getSigner(1), caller=await provider.getSigner(2);
  const art=compile()['src/CurveCompensationContributor.sol'].CurveCompensationContributor;
  const contributor=await new ethers.ContractFactory(art.abi,art.evm.bytecode.object,owner).deploy(await owner.getAddress(),ethers.parseEther('1000'));
  await contributor.waitForDeployment(); const ca=await contributor.getAddress();
  await tx(contributor.setManager(await manager.getAddress()));
  for(const addr of [A.curve,A.inverse,pre.gauge.manager,pre.votium.owner]) await provider.send('evm_setAccountBalance',[addr,ethers.toQuantity(ethers.parseEther('100'))]);
  const curve=await provider.getSigner(A.curve), inverse=await provider.getSigner(A.inverse), gm=await provider.getSigner(pre.gauge.manager);
  const votium=new ethers.Contract(A.votium,votiumAbi,owner), gauge=new ethers.Contract(A.gauge,gaugeAbi,owner);
  const tokens={};
  for(const name of ['sdola','sfrxusd']) {
   const token=new ethers.Contract(A[name],tokenAbi,owner); tokens[name]=token;
   // Fund and approve only on this local fork. No live transaction is submitted.
   await tx(token.connect(curve).transfer(A.inverse,ethers.parseEther('20000')));
   await tx(token.connect(curve).approve(ca,ethers.MaxUint256));
   await tx(token.connect(inverse).approve(ca,ethers.MaxUint256));
   await tx(gauge.connect(gm).add_reward(A[name],ca));
  }
  console.log('Fork setup ready at mainnet block',pre.block);
  let snapshot=await provider.send('evm_snapshot',[]);
  async function reset() {assert(await provider.send('evm_revert',[snapshot])); snapshot=await provider.send('evm_snapshot',[]);}
  async function advance(days) {await provider.send('evm_increaseTime',[days*86400]);await provider.send('evm_mine',[]);}
  function events(receipt,contract,eventName) {return receipt.logs.flatMap(l=>{try{const e=contract.interface.parseLog(l);return e?.name===eventName?[e]:[];}catch{return [];}});}
  async function check(name,run) {await reset();await run();results.push({name,passed:true}); console.log('PASS',name);}
  if(!process.env.FORK_EXTRA_ONLY) for(const name of ['sdola','sfrxusd']) for(const direct of [false,true]) for(const inverseDirect of [false,true]) {
   await check(`${name}: real contracts Curve direct=${direct}, Inverse direct=${inverseDirect}`,async()=>{
    const token=tokens[name];
    await tx(contributor.connect(manager).setDirectToSplit(direct));
    await tx(contributor.connect(inverse).setInverseDirectToGauge(inverseDirect));
    const curveBefore=await token.balanceOf(A.curve), inverseBefore=await token.balanceOf(A.inverse), splitBefore=await token.balanceOf(A.split), gaugeBefore=await token.balanceOf(A.gauge);
    const receipt=await tx(contributor.connect(caller).contribute(A[name]));
    const e=events(receipt,contributor,'Contributed')[0].args;
    assert(e.assets>0n && e.assets<=ethers.parseEther('1000'));
    assert.equal(curveBefore-await token.balanceOf(A.curve),e.shares);
    assert.equal(inverseBefore-await token.balanceOf(A.inverse),e.shares);
    assert.equal(await token.balanceOf(A.split)-splitBefore,direct?e.shares:0n);
    assert.equal(await token.balanceOf(A.gauge)-gaugeBefore,inverseDirect?e.shares:0n);
    assert.equal(await token.balanceOf(ca),0n);
    assert.equal(await token.allowance(ca,A.votium),0n);
    assert.equal(await token.allowance(ca,A.gauge),0n);
    assert.equal(await contributor.totalContributed(),e.assets);
    const deposits=events(receipt,votium,'NewIncentive');
    assert.equal(deposits.length,Number(!direct)+Number(!inverseDirect));
    for(const d of deposits) {
     const data=await votium.incentives(e.round,d.args._gauge,d.args._index);
     assert.equal(data.depositor,ca);assert.equal(data.amount,e.shares-e.shares*200n/10000n);
    }
    if(inverseDirect) {const rd=await gauge.reward_data(A[name]);const b=await provider.getBlock(receipt.blockNumber);assert.equal(rd.period_finish,BigInt(b.timestamp)+21n*86400n);}
    await assert.rejects(contributor.contribute.staticCall(A[name]),/round already contributed/);
   });
  }
  if(!process.env.FORK_EXTRA_ONLY) for(const name of ['sdola','sfrxusd']) {
   await check(`${name}: real Votium recovery and third-party ownership`,async()=>{
    const token=tokens[name];
    const receipt=await tx(contributor.contribute(A[name]));
    const e=events(receipt,contributor,'Contributed')[0].args;
    const ds=events(receipt,votium,'NewIncentive');
    const third=await caller.getAddress();
    await tx(token.connect(curve).transfer(third,ethers.parseEther('100')));
    await tx(token.connect(caller).approve(A.votium,ethers.MaxUint256));
    const bads=[];
    for(const g of [A.donation,A.gauge]) {const r=await tx(votium.connect(caller).depositIncentiveSimple(A[name],ethers.parseEther('20'),g));bads.push(events(r,votium,'NewIncentive')[0]);}
    await advance(57);await tx(contributor.connect(manager).kill());
    await assert.rejects(contributor.connect(manager).recoverUnprocessedIncentive.staticCall(e.round,bads[0].args._index,A[name]),/!depositor/);
    await assert.rejects(contributor.connect(inverse).recoverInverseUnprocessedIncentive.staticCall(e.round,bads[1].args._index,A[name]),/!depositor/);
    const other=name==='sdola'?A.sfrxusd:A.sdola;
    await assert.rejects(contributor.connect(manager).recoverUnprocessedIncentive.staticCall(e.round,ds[0].args._index,other),/wrong token/);
    const s0=await token.balanceOf(A.split),i0=await token.balanceOf(A.inverse);
    await tx(contributor.connect(manager).recoverUnprocessedIncentive(e.round,ds[0].args._index,A[name]));
    await tx(contributor.connect(inverse).recoverInverseUnprocessedIncentive(e.round,ds[1].args._index,A[name]));
    assert.equal(await token.balanceOf(A.split)-s0,e.shares-e.shares*200n/10000n);
    assert.equal(await token.balanceOf(A.inverse)-i0,e.shares-e.shares*200n/10000n);
    assert.equal(await contributor.totalContributed(),e.assets);
    for(const b of bads) await tx(votium.connect(caller).withdrawUnprocessed(e.round,b.args._gauge,b.args._index));
   });
   await check(`${name}: direct reward top-up and leftover destination`,async()=>{
    const token=tokens[name];
    await tx(contributor.connect(manager).setDirectToSplit(true));
    await tx(contributor.connect(inverse).setInverseDirectToGauge(true));
    await tx(contributor.contribute(A[name]));await advance(14);
    const r=await tx(contributor.contribute(A[name]));const b=await provider.getBlock(r.blockNumber);
    assert.equal((await gauge.reward_data(A[name])).period_finish,BigInt(b.timestamp)+21n*86400n);
    await advance(22);await tx(gauge.connect(caller).recover_remaining(A[name]));
    const leftover=await token.balanceOf(ca),curveBefore=await token.balanceOf(A.curve);
    assert(leftover>0n);
    await tx(contributor.connect(manager).rescue(A[name]));
    assert.equal(await token.balanceOf(A.curve)-curveBefore,leftover);
    console.log('CONFIRMED: Inverse-funded leftover rescued to Curve:',name,leftover.toString(),'share wei');
    results.push({name:`${name} leftover misrouting`,shareWei:leftover.toString()});
   });
  }
  for(const name of ['sdola','sfrxusd']) {
   await check(`${name}: real split accepts warehouse funding`,async()=>{
    const token=tokens[name];
    await tx(contributor.connect(manager).setDirectToSplit(true));
    const r=await tx(contributor.contribute(A[name]));
    const amount=events(r,contributor,'Contributed')[0].args.shares;
    const split=new ethers.Contract(A.split,pre.splitAbi,caller);
    const warehouse=new ethers.Contract(await split.SPLITS_WAREHOUSE(),['function balanceOf(address,uint256) view returns(uint256)'],caller);
    const before=await warehouse.balanceOf(A.split,BigInt(A[name]));
    await tx(split.depositToWarehouse(A[name],amount));
    assert.equal(await warehouse.balanceOf(A.split,BigInt(A[name]))-before,amount);
   });
   await check(`${name}: real vault conversion bounds`,async()=>{
    for(const amount of [1n,2n,1000n,10n**12n,10n**18n,1000n*10n**18n,700000n*10n**18n]) {
     const shares=await tokens[name].convertToShares(amount);const assets=await tokens[name].convertToAssets(shares);
     assert(assets<=amount);assert(assets>=0n);
    }
   });
   for(const failure of ['Inverse allowance','gauge distributor']) await check(`${name}: real ${failure} failure atomically rolls back`,async()=>{
    const token=tokens[name];
    await tx(contributor.connect(manager).setDirectToSplit(true));
    await tx(contributor.connect(inverse).setInverseDirectToGauge(true));
    if(failure==='Inverse allowance')await tx(token.connect(inverse).approve(ca,0));
    else await tx(gauge.connect(gm).set_reward_distributor(A[name],await owner.getAddress()));
    const before=await Promise.all([A.curve,A.inverse,A.split,A.gauge,ca].map(a=>token.balanceOf(a)));
    const round=await votium.activeRound();
    await assert.rejects(tx(contributor.contribute(A[name],{gasLimit:3000000})));
    const after=await Promise.all([A.curve,A.inverse,A.split,A.gauge,ca].map(a=>token.balanceOf(a)));
    assert.deepEqual(after,before);assert.equal(await contributor.totalContributed(),0n);assert.equal(await contributor.contributedInRound(round),false);
   });
  }
 } finally {provider.destroy();await chain.disconnect();fs.mkdirSync(__dirname+'/../artifacts',{recursive:true});fs.writeFileSync(__dirname+'/../artifacts/fork-review-results.json',JSON.stringify({block:pre.block,results},null,2));}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
