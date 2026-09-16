import fs from 'node:fs';

export const chains = JSON.parse(fs.readFileSync(new URL('./config/chains.json', import.meta.url)));

export function chainConfig(candidate) {
  const group = candidate.chainType === 'evm' ? chains.evm : candidate.chainType === 'solana' ? chains.solana : null;
  if (!group?.[candidate.chain]) throw new Error(`unsupported chain ${candidate.chainType}:${candidate.chain}`);
  return group[candidate.chain];
}

export function alchemyRpcUrl(candidate) {
  const cfg = chainConfig(candidate);
  const key = cfg.testnet ? process.env.ALCHEMY_TESTNET_API_KEY : process.env.ALCHEMY_MAINNET_API_KEY;
  if (!key) throw new Error(cfg.testnet ? 'ALCHEMY_TESTNET_API_KEY is required' : 'ALCHEMY_MAINNET_API_KEY is required');
  return `https://${cfg.alchemyNetwork}.g.alchemy.com/v2/${key}`;
}

function overrideEnvName(candidate) {
  return `RPC_OVERRIDE_${String(candidate.chain).toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;
}

export function rpcUrls(candidate) {
  const cfg = chainConfig(candidate);
  const urls = [];
  const override = process.env[overrideEnvName(candidate)];
  if (override) urls.push(override);
  urls.push(alchemyRpcUrl(candidate));
  for (const fallback of cfg.rpcFallbacks || []) {
    if (fallback && !urls.includes(fallback)) urls.push(fallback);
  }
  return urls;
}

export async function rpc(url, method, params = []) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify({jsonrpc: '2.0', id: 1, method, params})
  });
  let body;
  try {
    body = await response.json();
  } catch {
    throw new Error(`RPC HTTP ${response.status}: non-JSON response from ${url}`);
  }
  if (!response.ok) throw new Error(`RPC HTTP ${response.status}: ${JSON.stringify(body)}`);
  if (body.error) throw new Error(`RPC ${method}: ${JSON.stringify(body.error)}`);
  return body.result;
}

export async function rpcAny(urlsOrCandidate, method, params = []) {
  const urls = Array.isArray(urlsOrCandidate) ? urlsOrCandidate : rpcUrls(urlsOrCandidate);
  const errors = [];
  for (const url of urls) {
    try {
      return await rpc(url, method, params);
    } catch (error) {
      errors.push(`${url}: ${error.message}`);
    }
  }
  throw new Error(`All RPC endpoints failed for ${method}: ${errors.join(' | ')}`);
}
