import crypto from 'node:crypto';
import fs from 'node:fs';
import { PrivyClient } from '@privy-io/node';
import { createX402Client } from '@privy-io/node/x402';
import { wrapFetchWithPayment } from '@x402/fetch';
import { SOLANA_USDC_MINT } from './agentsoul-policy.mjs';

const BASE = 'https://agentsoul.art';
const COSTS = {
  register: 10_000n,
  generate: 100_000n,
  draft: 10_000n,
  submit: 10_000n
};

function env(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
}

function hashApproval(value) {
  return crypto.createHash('sha256').update(stableStringify(value)).digest('hex');
}

function assertWriteEnabled() {
  if (process.env.OPENSESAME_WRITE_ENABLED !== 'true') {
    throw new Error('Writes disabled. Set OPENSESAME_WRITE_ENABLED=true only for the intended operation.');
  }
}

function buildPaidFetch(operation) {
  const expectedMax = COSTS[operation];
  if (expectedMax === undefined) throw new Error(`Unknown paid operation: ${operation}`);

  const appId = env('PRIVY_APP_ID');
  const appSecret = env('PRIVY_APP_SECRET');
  const walletId = env('PRIVY_SOLANA_WALLET_ID');
  const address = env('PRIVY_SOLANA_WALLET_ADDRESS');
  const agentKey = env('PRIVY_AGENT_AUTHORIZATION_KEY');
  const payTo = env('AGENTSOUL_PAYTO');
  const network = env('AGENTSOUL_X402_NETWORK');
  const asset = process.env.AGENTSOUL_USDC_MINT || SOLANA_USDC_MINT;

  const privy = new PrivyClient({ appId, appSecret });
  const x402 = createX402Client(privy, {
    walletId,
    address,
    authorizationContext: {
      authorization_private_keys: [agentKey]
    }
  });

  x402.registerPolicy((_version, requirements) => requirements.filter((r) => {
    const rawAmount = r.amount ?? r.maxAmountRequired;
    if (rawAmount == null) return false;
    let amount;
    try { amount = BigInt(rawAmount); } catch { return false; }
    return r.scheme === 'exact'
      && r.network === network
      && r.asset === asset
      && r.payTo === payTo
      && amount <= expectedMax;
  }));

  return wrapFetchWithPayment(fetch, x402);
}

async function jsonResponse(response) {
  const text = await response.text();
  let body = text;
  try { body = JSON.parse(text); } catch {}
  if (!response.ok) throw new Error(`Agent Soul HTTP ${response.status}: ${typeof body === 'string' ? body : JSON.stringify(body)}`);
  return body;
}

async function paid(operation, path, init) {
  assertWriteEnabled();
  const paidFetch = buildPaidFetch(operation);
  return jsonResponse(await paidFetch(`${BASE}${path}`, init));
}

const command = process.argv[2] || 'help';
const walletAddress = process.env.PRIVY_SOLANA_WALLET_ADDRESS;

if (command === 'status') {
  if (!walletAddress) throw new Error('PRIVY_SOLANA_WALLET_ADDRESS is required');
  const r = await fetch(`${BASE}/api/v1/agents/me?wallet=${encodeURIComponent(walletAddress)}`);
  const text = await r.text();
  console.log(text);
} else if (command === 'register') {
  const result = await paid('register', '/api/v1/agents/register', {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify({
      walletAddress: env('PRIVY_SOLANA_WALLET_ADDRESS'),
      name: process.env.AGENT_NAME || 'OpenSesame',
      bio: process.env.AGENT_BIO || 'Human-AI collaborative agent exploring agent-native digital art.',
      artStyle: process.env.AGENT_ART_STYLE || 'generative systems'
    })
  });
  console.log(JSON.stringify(result, null, 2));
} else if (command === 'generate') {
  const prompt = process.argv.slice(3).join(' ').trim();
  if (!prompt) throw new Error('usage: npm run agentsoul -- generate "prompt"');
  const result = await paid('generate', '/api/v1/artworks/generate-image', {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify({ walletAddress: env('PRIVY_SOLANA_WALLET_ADDRESS'), prompt })
  });
  console.log(JSON.stringify(result, null, 2));
} else if (command === 'draft') {
  const file = process.argv[3];
  if (!file) throw new Error('usage: npm run agentsoul -- draft draft.json');
  const input = JSON.parse(fs.readFileSync(file, 'utf8'));
  const result = await paid('draft', '/api/v1/artworks', {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify({
      walletAddress: env('PRIVY_SOLANA_WALLET_ADDRESS'),
      imageUrl: input.imageUrl,
      title: input.title,
      prompt: input.prompt
    })
  });
  console.log(JSON.stringify(result, null, 2));
} else if (command === 'prepare-submit') {
  const artworkId = process.argv[3];
  if (!artworkId) throw new Error('usage: npm run agentsoul -- prepare-submit <artworkId>');
  const approval = {
    operation: 'agentsoul-submit-mint',
    walletAddress: env('PRIVY_SOLANA_WALLET_ADDRESS'),
    artworkId
  };
  console.log(JSON.stringify({ ...approval, approvalSha256: hashApproval(approval) }, null, 2));
} else if (command === 'submit') {
  const artworkId = process.argv[3];
  if (!artworkId) throw new Error('usage: npm run agentsoul -- submit <artworkId>');
  const approval = {
    operation: 'agentsoul-submit-mint',
    walletAddress: env('PRIVY_SOLANA_WALLET_ADDRESS'),
    artworkId
  };
  const expectedHash = hashApproval(approval);
  if (process.env.MINT_APPROVAL_SHA256 !== expectedHash) {
    throw new Error(`Mint approval mismatch. Required MINT_APPROVAL_SHA256=${expectedHash}`);
  }
  const result = await paid('submit', `/api/v1/artworks/${encodeURIComponent(artworkId)}/submit`, {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify({ walletAddress: env('PRIVY_SOLANA_WALLET_ADDRESS') })
  });
  if (!result?.mintAddress && result?.status !== 'pending') {
    throw new Error(`Submit returned no mintAddress: ${JSON.stringify(result)}`);
  }
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log('Commands: status | register | generate <prompt> | draft <draft.json> | prepare-submit <artworkId> | submit <artworkId>');
}
