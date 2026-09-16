import fs from 'node:fs';
import { Connection, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { alchemyRpcUrl, chainConfig, rpc } from './rpc.mjs';
import { preflight, canonicalHash } from './preflight.mjs';
import { executeMint } from './execute-mint.mjs';

function usage() {
  throw new Error('usage: npm run autopilot -- GO <candidate.json>');
}

async function ensureSolanaDevnetFunds(candidate) {
  const address = new PublicKey(candidate.walletAddress);
  const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
  let balance = await connection.getBalance(address, 'confirmed');
  if (balance > 0) return {funded: true, balanceLamports: balance, faucetUsed: false};

  const signature = await connection.requestAirdrop(address, LAMPORTS_PER_SOL);
  await connection.confirmTransaction(signature, 'confirmed');
  balance = await connection.getBalance(address, 'confirmed');
  return {funded: balance > 0, balanceLamports: balance, faucetUsed: true, faucetSignature: signature};
}

async function ensureEvmTestnetFunds(candidate) {
  const cfg = chainConfig(candidate);
  const url = alchemyRpcUrl(candidate);
  const balanceHex = await rpc(url, 'eth_getBalance', [candidate.walletAddress, 'latest']);
  const balanceWei = BigInt(balanceHex);
  if (balanceWei > 0n) return {funded: true, balanceWei: balanceWei.toString(), faucetUsed: false};

  const alchemySupported = ['sepolia', 'base-sepolia', 'polygon-amoy', 'arbitrum-sepolia', 'optimism-sepolia', 'monad-testnet'];
  if (cfg.faucet === 'alchemy') {
    return {
      funded: false,
      faucetUsed: false,
      action: 'ALCHEMY_FAUCET_DRIP_REQUIRED',
      network: candidate.chain,
      address: candidate.walletAddress,
      supportedByAssistantConnector: alchemySupported.includes(candidate.chain)
    };
  }
  return {funded: false, faucetUsed: false, action: 'NO_AUTOMATIC_FAUCET'};
}

export async function autopilot(candidate) {
  if (process.env.OPENSESAME_WRITE_ENABLED !== 'true') {
    throw new Error('OPENSESAME_WRITE_ENABLED=true is required for GO');
  }

  const cfg = chainConfig(candidate);
  let funding = {funded: true, faucetUsed: false, skipped: true};

  if (cfg.testnet && candidate.chainType === 'solana' && candidate.chain === 'devnet') {
    funding = await ensureSolanaDevnetFunds(candidate);
  } else if (cfg.testnet && candidate.chainType === 'evm') {
    funding = await ensureEvmTestnetFunds(candidate);
  }

  if (!funding.funded) {
    return {
      ok: false,
      stage: 'funding',
      funding,
      candidateHash: canonicalHash(candidate)
    };
  }

  const check = await preflight(candidate);
  const result = await executeMint(candidate, {approvalHash: check.candidateHash});
  return {
    ok: true,
    mode: 'GO',
    funding,
    preflight: {
      ok: check.ok,
      candidateHash: check.candidateHash,
      gasEstimate: check.gasEstimate ?? null,
      unitsConsumed: check.unitsConsumed ?? null
    },
    mint: result
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (process.argv[2] !== 'GO') usage();
  const path = process.argv[3];
  if (!path) usage();
  const candidate = JSON.parse(fs.readFileSync(path, 'utf8'));
  console.log(JSON.stringify(await autopilot(candidate), null, 2));
}
