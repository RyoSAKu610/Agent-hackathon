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

async function parseResponse(response, { allow404 = false } = {}) {
  const text = await response.text();
  let body = text;
  try { body = JSON.parse(text); } catch {}
  if (allow404 && response.status === 404) return null;
  if (!response.ok) throw new Error(`Agent Soul HTTP ${response.status}: ${typeof body === 'string' ? body : JSON.stringify(body)}`);
  return body;
}

async function paid(operation, path, init) {
  assertWriteEnabled();
  const paidFetch = buildPaidFetch(operation);
  return parseResponse(await paidFetch(`${BASE}${path}`, init));
}

export async function agentSoulStatus() {
  const walletAddress = env('PRIVY_SOLANA_WALLET_ADDRESS');
  return parseResponse(
    await fetch(`${BASE}/api/v1/agents/me?wallet=${encodeURIComponent(walletAddress)}`),
    { allow404: true }
  );
}

export async function registerAgent() {
  return paid('register', '/api/v1/agents/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      walletAddress: env('PRIVY_SOLANA_WALLET_ADDRESS'),
      name: process.env.AGENT_NAME || 'OpenSesame',
      bio: process.env.AGENT_BIO || 'Human-AI collaborative agent exploring agent-native digital art.',
      artStyle: process.env.AGENT_ART_STYLE || 'generative systems'
    })
  });
}

export async function generateImage(prompt) {
  if (!prompt?.trim()) throw new Error('prompt is required');
  return paid('generate', '/api/v1/artworks/generate-image', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ walletAddress: env('PRIVY_SOLANA_WALLET_ADDRESS'), prompt: prompt.trim() })
  });
}

export async function saveDraft({ imageUrl, title, prompt }) {
  if (!imageUrl || !title || !prompt) throw new Error('imageUrl, title, and prompt are required');
  return paid('draft', '/api/v1/artworks', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      walletAddress: env('PRIVY_SOLANA_WALLET_ADDRESS'),
      imageUrl,
      title,
      prompt
    })
  });
}

function submitApproval(artworkId) {
  const approval = {
    operation: 'agentsoul-submit-mint',
    walletAddress: env('PRIVY_SOLANA_WALLET_ADDRESS'),
    artworkId
  };
  return { approval, approvalSha256: hashApproval(approval) };
}

export async function submitArtwork(artworkId, { approvalSha256 } = {}) {
  if (!artworkId) throw new Error('artworkId is required');
  const prepared = submitApproval(artworkId);
  const supplied = approvalSha256 || process.env.MINT_APPROVAL_SHA256;
  if (supplied !== prepared.approvalSha256) {
    throw new Error(`Mint approval mismatch. Required MINT_APPROVAL_SHA256=${prepared.approvalSha256}`);
  }
  const result = await paid('submit', `/api/v1/artworks/${encodeURIComponent(artworkId)}/submit`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ walletAddress: env('PRIVY_SOLANA_WALLET_ADDRESS') })
  });
  if (!result?.mintAddress && !['pending', 'minted'].includes(result?.status)) {
    throw new Error(`Submit returned no mintAddress/pending status: ${JSON.stringify(result)}`);
  }
  return result;
}

export async function runAgentSoulGo({ title, prompt }) {
  assertWriteEnabled();
  if (!title?.trim()) throw new Error('title is required');
  if (!prompt?.trim()) throw new Error('prompt is required');

  let profile = await agentSoulStatus();
  let registeredNow = false;
  if (!profile) {
    const registration = await registerAgent();
    profile = registration?.agent || registration;
    registeredNow = true;
  }

  const generated = await generateImage(prompt);
  if (!generated?.imageUrl) throw new Error(`Image generation returned no imageUrl: ${JSON.stringify(generated)}`);

  const draft = await saveDraft({
    imageUrl: generated.imageUrl,
    title: title.trim(),
    prompt: prompt.trim()
  });
  if (!draft?.id) throw new Error(`Draft creation returned no id: ${JSON.stringify(draft)}`);

  const prepared = submitApproval(draft.id);
  const minted = await submitArtwork(draft.id, { approvalSha256: prepared.approvalSha256 });

  return {
    ok: true,
    operation: 'AGENTSOUL_GO',
    registeredNow,
    maxWriteCostRawUsdc: registeredNow ? '130000' : '120000',
    profile,
    generated,
    draft,
    mint: minted
  };
}

async function cli() {
  const command = process.argv[2] || 'help';

  if (command === 'status') {
    console.log(JSON.stringify(await agentSoulStatus(), null, 2));
  } else if (command === 'register') {
    console.log(JSON.stringify(await registerAgent(), null, 2));
  } else if (command === 'generate') {
    const prompt = process.argv.slice(3).join(' ').trim();
    console.log(JSON.stringify(await generateImage(prompt), null, 2));
  } else if (command === 'draft') {
    const file = process.argv[3];
    if (!file) throw new Error('usage: npm run agentsoul -- draft draft.json');
    console.log(JSON.stringify(await saveDraft(JSON.parse(fs.readFileSync(file, 'utf8'))), null, 2));
  } else if (command === 'prepare-submit') {
    const artworkId = process.argv[3];
    if (!artworkId) throw new Error('usage: npm run agentsoul -- prepare-submit <artworkId>');
    console.log(JSON.stringify(submitApproval(artworkId), null, 2));
  } else if (command === 'submit') {
    const artworkId = process.argv[3];
    console.log(JSON.stringify(await submitArtwork(artworkId), null, 2));
  } else if (command === 'GO') {
    const title = process.argv[3];
    const prompt = process.argv.slice(4).join(' ').trim();
    if (!title || !prompt) throw new Error('usage: npm run agentsoul -- GO "title" "prompt..."');
    console.log(JSON.stringify(await runAgentSoulGo({ title, prompt }), null, 2));
  } else {
    console.log('Commands: status | register | generate <prompt> | draft <draft.json> | prepare-submit <artworkId> | submit <artworkId> | GO "title" "prompt..."');
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await cli();
}
