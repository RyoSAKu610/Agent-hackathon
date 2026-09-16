import assert from 'node:assert/strict';
import { compilePolicy } from './policy-compiler.mjs';
import { buildAgentSoulPolicy, SOLANA_USDC_MINT } from './agentsoul-policy.mjs';
import { chainConfig } from './rpc.mjs';
import { executeMint } from './execute-mint.mjs';
import { autopilot } from './autopilot.mjs';

const evmCandidate = {
  id: 'selftest',
  chainType: 'evm',
  chain: 'base-sepolia',
  transaction: {
    to: '0x0000000000000000000000000000000000000002',
    valueWei: '0',
    data: '0x12345678'
  },
  contractCall: {
    functionName: 'mint',
    abi: [{type:'function',name:'mint',stateMutability:'nonpayable',inputs:[],outputs:[]}],
    arguments: {}
  }
};

const evmPolicy = compilePolicy(evmCandidate);
assert.equal(evmPolicy.chain_type, 'ethereum');
assert.equal(evmPolicy.rules.length, 1);
assert.equal(evmPolicy.rules[0].method, 'eth_sendTransaction');
assert.equal(evmPolicy.rules[0].action, 'ALLOW');
assert.ok(evmPolicy.rules[0].conditions.some((c) => c.field === 'chain_id' && c.value === '84532'));
assert.ok(evmPolicy.rules[0].conditions.some((c) => c.field === 'to' && c.value === evmCandidate.transaction.to));
assert.ok(evmPolicy.rules[0].conditions.some((c) => c.field === 'function_name' && c.value === 'mint'));
assert.ok(!evmPolicy.rules.some((r) => r.method === '*'));

const solPolicy = buildAgentSoulPolicy({
  ownerId: 'owner_selftest',
  payTo: '2wKupLR9q6wXYppw8Gr2NvWxKBUqm4PPJKkQfoxHEBg4'
});
assert.equal(solPolicy.chain_type, 'solana');
assert.ok(solPolicy.rules.some((r) => r.method === 'exportPrivateKey' && r.action === 'DENY'));
const transferRule = solPolicy.rules.find((r) => r.name === 'Allow bounded AgentSoul USDC');
assert.ok(transferRule);
assert.ok(transferRule.conditions.some((c) => c.field === 'TransferChecked.mint' && c.value === SOLANA_USDC_MINT));
assert.ok(transferRule.conditions.some((c) => c.field === 'TransferChecked.destination'));
assert.ok(transferRule.conditions.some((c) => c.field === 'TransferChecked.amount' && c.value === '100000'));
assert.ok(!solPolicy.rules.some((r) => r.method === '*' && r.action === 'ALLOW'));

assert.equal(chainConfig({chainType:'solana', chain:'devnet'}).caip2, 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1');
assert.equal(typeof executeMint, 'function');
assert.equal(typeof autopilot, 'function');

console.log(JSON.stringify({
  ok:true,
  tests:[
    'evm-exact-mint-policy',
    'agentsoul-usdc-policy',
    'no-wildcard-allow',
    'solana-caip2',
    'executor-module-load',
    'autopilot-module-load'
  ]
}, null, 2));
