import fs from 'node:fs';
import { PrivyClient } from '@privy-io/node';
import { preflight, canonicalHash } from './preflight.mjs';
import { chainConfig } from './rpc.mjs';
import { compilePolicy } from './policy-compiler.mjs';

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

function authorizationContext(keyName) {
  return { authorization_private_keys: [env(keyName)] };
}

function assertCandidateWallet(candidate) {
  if (candidate.chainType === 'evm') {
    const expected = env('PRIVY_EVM_WALLET_ADDRESS').toLowerCase();
    if (String(candidate.walletAddress || '').toLowerCase() !== expected) {
      throw new Error('candidate.walletAddress does not match PRIVY_EVM_WALLET_ADDRESS');
    }
    return;
  }
  if (candidate.chainType === 'solana') {
    if (String(candidate.walletAddress || '') !== env('PRIVY_SOLANA_WALLET_ADDRESS')) {
      throw new Error('candidate.walletAddress does not match PRIVY_SOLANA_WALLET_ADDRESS');
    }
    return;
  }
  throw new Error(`unsupported chainType: ${candidate.chainType}`);
}

async function attachSignerPolicy(privy, walletId, policyId) {
  await privy.wallets().update(walletId, {
    policy_ids: [],
    additional_signers: [{
      signer_id: env('PRIVY_AGENT_SIGNER_ID'),
      override_policy_ids: [policyId]
    }],
    authorization_context: authorizationContext('PRIVY_ADMIN_AUTHORIZATION_KEY')
  });
}

async function createExactPolicy(privy, candidate) {
  return privy.policies().create({
    ...compilePolicy(candidate),
    owner_id: env('PRIVY_ADMIN_OWNER_ID')
  });
}

async function sendMint(privy, candidate, expected) {
  const agentAuthorization = authorizationContext('PRIVY_AGENT_AUTHORIZATION_KEY');

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
      authorization_context: agentAuthorization
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
      authorization_context: agentAuthorization
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

export async function executeMint(candidate, { approvalHash, preflightResult } = {}) {
  assertWriteEnabled();
  assertCandidateWallet(candidate);

  const check = preflightResult || await preflight(candidate);
  const expected = canonicalHash(candidate);
  const supplied = approvalHash || process.env.MINT_APPROVAL_SHA256;
  if (!check?.ok || supplied !== expected || check.candidateHash !== expected) {
    throw new Error(`Mint approval mismatch. Required hash: ${expected}`);
  }

  const privy = new PrivyClient({
    appId: env('PRIVY_APP_ID'),
    appSecret: env('PRIVY_APP_SECRET')
  });

  const walletId = candidate.chainType === 'evm'
    ? env('PRIVY_EVM_WALLET_ID')
    : env('PRIVY_SOLANA_WALLET_ID');
  const lockPolicyId = candidate.chainType === 'evm'
    ? env('PRIVY_EVM_LOCK_POLICY_ID')
    : env('PRIVY_SOLANA_AGENTSOUL_POLICY_ID');

  const exactPolicy = await createExactPolicy(privy, candidate);
  let mintResult = null;
  let mintError = null;
  let relockError = null;

  try {
    await attachSignerPolicy(privy, walletId, exactPolicy.id);
    mintResult = await sendMint(privy, candidate, expected);
  } catch (error) {
    mintError = error;
  } finally {
    try {
      await attachSignerPolicy(privy, walletId, lockPolicyId);
    } catch (error) {
      relockError = error;
    }
  }

  if (relockError) {
    const txHash = mintResult?.transactionHash || 'unknown';
    throw new Error(`CRITICAL: wallet relock failed after mint attempt (tx=${txHash}): ${relockError.message}`);
  }
  if (mintError) throw mintError;

  return {
    ...mintResult,
    exactPolicyId: exactPolicy.id,
    relockedToPolicyId: lockPolicyId
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const path = process.argv[2];
  if (!path) throw new Error('usage: npm run mint:execute -- <candidate.json>');
  const candidate = JSON.parse(fs.readFileSync(path, 'utf8'));
  console.log(JSON.stringify(await executeMint(candidate), null, 2));
}
