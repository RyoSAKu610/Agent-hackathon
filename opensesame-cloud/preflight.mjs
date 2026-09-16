import fs from 'node:fs';
import crypto from 'node:crypto';
import { chainConfig, rpcAny, rpcUrls } from './rpc.mjs';
import { compilePolicy } from './policy-compiler.mjs';
import { validateEvmCalldata, validateSolanaTransaction } from './transaction-validation.mjs';

function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}

export function canonicalHash(value) {
  return crypto.createHash('sha256').update(stableStringify(value)).digest('hex');
}

export async function preflight(candidate) {
  const cfg = chainConfig(candidate);
  const urls = rpcUrls(candidate);
  const policy = compilePolicy(candidate);

  if (candidate.chainType === 'evm') {
    const tx = candidate.transaction;
    const from = candidate.walletAddress;
    if (!/^0x[a-fA-F0-9]{40}$/.test(from || '')) throw new Error('walletAddress is required for EVM simulation');
    const calldata = validateEvmCalldata(candidate);
    const chainIdHex = await rpcAny(urls, 'eth_chainId');
    if (Number(BigInt(chainIdHex)) !== cfg.chainId) throw new Error(`RPC chain mismatch: expected ${cfg.chainId}, got ${chainIdHex}`);
    const code = await rpcAny(urls, 'eth_getCode', [tx.to, 'latest']);
    if (!code || code === '0x') throw new Error('mint target has no contract bytecode');

    const call = {
      from,
      to: tx.to,
      data: tx.data,
      value: `0x${BigInt(tx.valueWei).toString(16)}`
    };
    const gas = await rpcAny(urls, 'eth_estimateGas', [call]);
    await rpcAny(urls, 'eth_call', [call, 'latest']);

    return {
      ok: true,
      candidateHash: canonicalHash(candidate),
      chainId: cfg.chainId,
      gasEstimate: String(BigInt(gas)),
      targetCodePresent: true,
      calldata,
      policy
    };
  }

  if (candidate.chainType === 'solana') {
    const transaction = candidate.transactionBase64;
    if (!transaction) throw new Error('transactionBase64 is required for Solana simulation');
    const localValidation = await validateSolanaTransaction(candidate);
    const sim = await rpcAny(urls, 'simulateTransaction', [transaction, {
      encoding: 'base64',
      sigVerify: false,
      replaceRecentBlockhash: true,
      commitment: 'confirmed'
    }]);
    if (sim?.value?.err) throw new Error(`Solana simulation failed: ${JSON.stringify(sim.value.err)}`);
    return {
      ok: true,
      candidateHash: canonicalHash(candidate),
      unitsConsumed: sim?.value?.unitsConsumed ?? null,
      logs: sim?.value?.logs ?? [],
      localValidation,
      policy
    };
  }

  throw new Error('unsupported candidate');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const path = process.argv[2];
  if (!path) throw new Error('usage: npm run preflight -- <candidate.json>');
  const candidate = JSON.parse(fs.readFileSync(path, 'utf8'));
  console.log(JSON.stringify(await preflight(candidate), null, 2));
}
