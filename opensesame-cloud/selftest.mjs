import assert from 'node:assert/strict';
import { encodeFunctionData } from 'viem';
import { Keypair, SystemProgram, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import { compilePolicy } from './policy-compiler.mjs';
import { buildAgentSoulPolicy, SOLANA_USDC_MINT } from './agentsoul-policy.mjs';
import { chainConfig } from './rpc.mjs';
import { executeMint } from './execute-mint.mjs';
import { autopilot } from './autopilot.mjs';
import { validateEvmCalldata, validateSolanaTransaction } from './transaction-validation.mjs';

const mintAbi = [{
  type: 'function',
  name: 'mint',
  stateMutability: 'nonpayable',
  inputs: [{ name: 'quantity', type: 'uint256' }],
  outputs: []
}];
const evmCandidate = {
  id: 'selftest',
  chainType: 'evm',
  chain: 'base-sepolia',
  walletAddress: '0x0000000000000000000000000000000000000001',
  transaction: {
    to: '0x0000000000000000000000000000000000000002',
    valueWei: '0',
    data: encodeFunctionData({ abi: mintAbi, functionName: 'mint', args: [1n] })
  },
  contractCall: {
    functionName: 'mint',
    abi: mintAbi,
    arguments: { quantity: '1' }
  }
};

const calldata = validateEvmCalldata(evmCandidate);
assert.equal(calldata.functionName, 'mint');
assert.equal(calldata.argumentCount, 1);
assert.throws(() => validateEvmCalldata({
  ...evmCandidate,
  contractCall: { ...evmCandidate.contractCall, arguments: { quantity: '2' } }
}), /calldata argument mismatch/);

const evmPolicy = compilePolicy(evmCandidate);
assert.equal(evmPolicy.chain_type, 'ethereum');
assert.equal(evmPolicy.rules.length, 1);
assert.equal(evmPolicy.rules[0].method, 'eth_sendTransaction');
assert.equal(evmPolicy.rules[0].action, 'ALLOW');
assert.ok(evmPolicy.rules[0].conditions.some((c) => c.field === 'chain_id' && c.value === '84532'));
assert.ok(evmPolicy.rules[0].conditions.some((c) => c.field === 'to' && c.value === evmCandidate.transaction.to));
assert.ok(evmPolicy.rules[0].conditions.some((c) => c.field === 'function_name' && c.value === 'mint'));
assert.ok(!evmPolicy.rules.some((r) => r.method === '*'));

const payer = Keypair.generate();
const recipient = Keypair.generate().publicKey;
const transferIx = SystemProgram.transfer({
  fromPubkey: payer.publicKey,
  toPubkey: recipient,
  lamports: 1
});
const solMessage = new TransactionMessage({
  payerKey: payer.publicKey,
  recentBlockhash: '11111111111111111111111111111111',
  instructions: [transferIx]
}).compileToV0Message();
const solTx = new VersionedTransaction(solMessage);
const solCandidate = {
  id: 'solana-selftest',
  chainType: 'solana',
  chain: 'devnet',
  walletAddress: payer.publicKey.toBase58(),
  transactionBase64: Buffer.from(solTx.serialize()).toString('base64'),
  allowedPrograms: [SystemProgram.programId.toBase58()],
  nativePayments: [{ recipient: recipient.toBase58(), maxLamports: '1' }],
  splPayments: []
};
const solValidation = await validateSolanaTransaction(solCandidate);
assert.ok(solValidation.requiredSigners.includes(payer.publicKey.toBase58()));
assert.deepEqual(solValidation.programs, [SystemProgram.programId.toBase58()]);
assert.equal(solValidation.payments.length, 1);
assert.equal(solValidation.payments[0].destination, recipient.toBase58());

const solMintPolicy = compilePolicy(solCandidate);
assert.equal(solMintPolicy.chain_type, 'solana');
const boundedSolRule = solMintPolicy.rules.find((rule) => rule.name === 'Allow bounded SOL payment 1');
assert.ok(boundedSolRule);
assert.ok(boundedSolRule.conditions.some((c) => c.field === 'Transfer.to' && c.value === recipient.toBase58()));
assert.ok(boundedSolRule.conditions.some((c) => c.field === 'Transfer.lamports' && c.value === '1'));
assert.ok(!solMintPolicy.rules.some((rule) => rule.method === '*' && rule.action === 'ALLOW'));

const badSigner = Keypair.generate().publicKey.toBase58();
await assert.rejects(
  () => validateSolanaTransaction({ ...solCandidate, walletAddress: badSigner }),
  /not a required signer/
);

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

assert.equal(chainConfig({ chainType: 'solana', chain: 'devnet' }).caip2, 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1');
assert.equal(typeof executeMint, 'function');
assert.equal(typeof autopilot, 'function');

console.log(JSON.stringify({
  ok: true,
  tests: [
    'evm-calldata-match',
    'evm-exact-mint-policy',
    'solana-required-signer',
    'solana-program-allowlist',
    'solana-bounded-transfer-policy',
    'agentsoul-usdc-policy',
    'no-wildcard-allow',
    'solana-caip2',
    'executor-module-load',
    'autopilot-module-load'
  ]
}, null, 2));
