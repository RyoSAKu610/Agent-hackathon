import fs from 'node:fs';
import { Connection, PublicKey, VersionedTransaction } from '@solana/web3.js';
import { chainConfig, rpcAny } from './rpc.mjs';
import { preflight, canonicalHash } from './preflight.mjs';
import { executeMint } from './execute-mint.mjs';
import { validateSolanaTransaction } from './transaction-validation.mjs';

function usage() {
  throw new Error('usage: npm run autopilot -- GO <candidate.json>');
}

function solanaMessageBase64(candidate) {
  const tx = VersionedTransaction.deserialize(Buffer.from(candidate.transactionBase64, 'base64'));
  return Buffer.from(tx.message.serialize()).toString('base64');
}

async function deriveSolanaRequiredLamports(candidate, localValidation) {
  const feeResult = await rpcAny(candidate, 'getFeeForMessage', [solanaMessageBase64(candidate), { commitment: 'confirmed' }]);
  if (feeResult?.value == null) {
    return { ok: false, action: 'REFRESH_SOLANA_TRANSACTION_BLOCKHASH' };
  }
  const feeLamports = BigInt(feeResult.value);
  const wallet = String(candidate.walletAddress);
  const transactionDebits = (localValidation.fundingDebits || [])
    .filter((debit) => debit.source === wallet)
    .reduce((sum, debit) => sum + BigInt(debit.amount), 0n);
  return {
    ok: true,
    feeLamports,
    transactionDebits,
    requiredLamports: feeLamports + transactionDebits
  };
}

async function ensureSolanaDevnetFunds(candidate) {
  const address = new PublicKey(candidate.walletAddress);
  const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
  let balance = BigInt(await connection.getBalance(address, 'confirmed'));
  if (balance > 0n) return { funded: true, balanceLamports: balance.toString(), faucetUsed: false };

  const localValidation = await validateSolanaTransaction(candidate);
  const derived = await deriveSolanaRequiredLamports(candidate, localValidation);
  if (!derived.ok) {
    return { funded: false, faucetUsed: false, ...derived };
  }

  const requested = candidate.faucetLamports !== undefined
    ? BigInt(candidate.faucetLamports)
    : derived.requiredLamports;
  if (requested < derived.requiredLamports) {
    return {
      funded: false,
      faucetUsed: false,
      action: 'FAUCET_AMOUNT_BELOW_TRANSACTION_REQUIREMENT',
      requestedLamports: requested.toString(),
      requiredLamports: derived.requiredLamports.toString()
    };
  }
  if (requested <= 0n) {
    return {
      funded: false,
      faucetUsed: false,
      action: 'NO_SOLANA_FAUCET_REQUIRED_AMOUNT',
      requiredLamports: derived.requiredLamports.toString()
    };
  }

  const signature = await connection.requestAirdrop(address, Number(requested));
  await connection.confirmTransaction(signature, 'confirmed');
  balance = BigInt(await connection.getBalance(address, 'confirmed'));
  return {
    funded: balance >= derived.requiredLamports,
    balanceLamports: balance.toString(),
    requiredLamports: derived.requiredLamports.toString(),
    requestedLamports: requested.toString(),
    faucetUsed: true,
    faucetSignature: signature
  };
}

async function ensureEvmTestnetFunds(candidate) {
  const cfg = chainConfig(candidate);
  const balanceHex = await rpcAny(candidate, 'eth_getBalance', [candidate.walletAddress, 'latest']);
  const balanceWei = BigInt(balanceHex);
  if (balanceWei > 0n) return { funded: true, balanceWei: balanceWei.toString(), faucetUsed: false };

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
  return { funded: false, faucetUsed: false, action: 'NO_AUTOMATIC_FAUCET' };
}

async function checkEvmFunding(candidate, check) {
  const balanceWei = BigInt(await rpcAny(candidate, 'eth_getBalance', [candidate.walletAddress, 'latest']));
  const measuredGasPriceWei = BigInt(await rpcAny(candidate, 'eth_gasPrice'));
  const gasPriceWei = candidate.maxFeePerGasWei !== undefined
    ? BigInt(candidate.maxFeePerGasWei)
    : measuredGasPriceWei;
  const gasWei = BigInt(check.gasEstimate) * gasPriceWei;
  const valueWei = BigInt(candidate.transaction.valueWei || 0);
  const requiredWei = valueWei + gasWei;

  return {
    funded: balanceWei >= requiredWei,
    asset: 'native',
    balanceWei: balanceWei.toString(),
    requiredWei: requiredWei.toString(),
    valueWei: valueWei.toString(),
    estimatedGasWei: gasWei.toString(),
    gasPriceWei: gasPriceWei.toString(),
    action: balanceWei >= requiredWei ? null : (chainConfig(candidate).testnet ? 'TESTNET_FUNDS_REQUIRED' : 'MAINNET_FUNDS_REQUIRED')
  };
}

async function checkSolanaFunding(candidate, check) {
  const balanceResult = await rpcAny(candidate, 'getBalance', [candidate.walletAddress, { commitment: 'confirmed' }]);
  const balanceLamports = BigInt(balanceResult?.value ?? 0);
  const derived = await deriveSolanaRequiredLamports(candidate, check.localValidation);
  if (!derived.ok) return { funded: false, asset: 'SOL/SPL', ...derived };

  const tokenRequirements = new Map();
  for (const payment of check.localValidation?.payments || []) {
    if (payment.type !== 'SPL' || !payment.source) continue;
    tokenRequirements.set(payment.source, (tokenRequirements.get(payment.source) || 0n) + BigInt(payment.amount));
  }

  const tokenChecks = [];
  for (const [source, requiredRaw] of tokenRequirements.entries()) {
    const tokenBalance = await rpcAny(candidate, 'getTokenAccountBalance', [source, { commitment: 'confirmed' }]);
    const balanceRaw = BigInt(tokenBalance?.value?.amount ?? 0);
    tokenChecks.push({ source, balanceRaw: balanceRaw.toString(), requiredRaw: requiredRaw.toString(), funded: balanceRaw >= requiredRaw });
  }

  const nativeFunded = balanceLamports >= derived.requiredLamports;
  const tokensFunded = tokenChecks.every((item) => item.funded);
  return {
    funded: nativeFunded && tokensFunded,
    asset: 'SOL/SPL',
    balanceLamports: balanceLamports.toString(),
    requiredLamports: derived.requiredLamports.toString(),
    feeLamports: derived.feeLamports.toString(),
    transactionDebitsLamports: derived.transactionDebits.toString(),
    tokenChecks,
    action: nativeFunded && tokensFunded
      ? null
      : (chainConfig(candidate).testnet ? 'TESTNET_FUNDS_REQUIRED' : 'MAINNET_FUNDS_REQUIRED')
  };
}

async function postPreflightFunding(candidate, check) {
  if (candidate.chainType === 'evm') return checkEvmFunding(candidate, check);
  if (candidate.chainType === 'solana') return checkSolanaFunding(candidate, check);
  throw new Error(`unsupported chainType: ${candidate.chainType}`);
}

export async function autopilot(candidate) {
  if (process.env.OPENSESAME_WRITE_ENABLED !== 'true') {
    throw new Error('OPENSESAME_WRITE_ENABLED=true is required for GO');
  }

  const cfg = chainConfig(candidate);
  let faucet = { funded: true, faucetUsed: false, skipped: true };

  if (cfg.testnet && candidate.chainType === 'solana' && candidate.chain === 'devnet') {
    faucet = await ensureSolanaDevnetFunds(candidate);
  } else if (cfg.testnet && candidate.chainType === 'evm') {
    faucet = await ensureEvmTestnetFunds(candidate);
  }

  if (!faucet.funded) {
    return {
      ok: false,
      stage: 'faucet',
      funding: faucet,
      candidateHash: canonicalHash(candidate)
    };
  }

  const check = await preflight(candidate);
  const funding = await postPreflightFunding(candidate, check);
  if (!funding.funded) {
    return {
      ok: false,
      stage: 'funding',
      faucet,
      funding,
      candidateHash: check.candidateHash
    };
  }

  const result = await executeMint(candidate, {
    approvalHash: check.candidateHash,
    preflightResult: check
  });
  return {
    ok: true,
    mode: 'GO',
    faucet,
    funding,
    preflight: {
      ok: check.ok,
      candidateHash: check.candidateHash,
      gasEstimate: check.gasEstimate ?? null,
      unitsConsumed: check.unitsConsumed ?? null,
      localValidation: check.localValidation ?? null
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
