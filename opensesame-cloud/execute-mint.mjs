import fs from 'node:fs';
import { PrivyClient } from '@privy-io/node';
import { preflight, canonicalHash } from './preflight.mjs';
import { chainConfig } from './rpc.mjs';

function env(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function assertWriteEnabled() {
  if (process.env.OPENSESAME_WRITE_ENABLED !== 'true') {
    throw new Error('Writes disabled. Set OPENSESAME_WRITE_ENABLED=true for the intended mint run.');
  }
}

export async function executeMint(candidate, {approvalHash} = {}) {
  assertWriteEnabled();
  const check = await preflight(candidate);
  const expected = canonicalHash(candidate);
  const supplied = approvalHash || process.env.MINT_APPROVAL_SHA256;
  if (supplied !== expected || check.candidateHash !== expected) {
    throw new Error(`Mint approval mismatch. Required hash: ${expected}`);
  }

  const privy = new PrivyClient({
    appId: env('PRIVY_APP_ID'),
    appSecret: env('PRIVY_APP_SECRET')
  });
  const authorization_context = {
    authorization_private_keys: [env('PRIVY_AGENT_AUTHORIZATION_KEY')]
  };

  if (candidate.chainType === 'evm') {
    const cfg = chainConfig(candidate);
    const walletId = env('PRIVY_EVM_WALLET_ID');
    const tx = candidate.transaction;
    const result = await privy.wallets().ethereum().sendTransaction(walletId, {
      caip2: cfg.caip2,
      params: {
        transaction: {
          to: tx.to,
          value: `0x${BigInt(tx.valueWei).toString(16)}`,
          data: tx.data,
          chain_id: cfg.chainId
        }
      },
      authorization_context
    });
    return {
      ok: true,
      chain: candidate.chain,
      candidateHash: expected,
      transactionHash: result.hash ?? result?.data?.hash ?? null,
      raw: result
    };
  }

  if (candidate.chainType === 'solana') {
    const cfg = chainConfig(candidate);
    const walletId = env('PRIVY_SOLANA_WALLET_ID');
    const result = await privy.wallets().solana().signAndSendTransaction(walletId, {
      caip2: cfg.caip2,
      params: {
        transaction: candidate.transactionBase64,
        encoding: 'base64'
      },
      authorization_context
    });
    return {
      ok: true,
      chain: candidate.chain,
      candidateHash: expected,
      transactionHash: result.hash ?? result?.data?.hash ?? null,
      raw: result
    };
  }

  throw new Error(`unsupported chainType: ${candidate.chainType}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const path = process.argv[2];
  if (!path) throw new Error('usage: npm run mint:execute -- <candidate.json>');
  const candidate = JSON.parse(fs.readFileSync(path, 'utf8'));
  console.log(JSON.stringify(await executeMint(candidate), null, 2));
}
