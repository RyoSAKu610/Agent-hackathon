const endpoint = 'https://agentsoul.art/api/v1/agents/register';
const response = await fetch(endpoint, {
  method: 'POST',
  headers: {'content-type': 'application/json'},
  body: JSON.stringify({
    walletAddress: '11111111111111111111111111111111',
    name: 'OpenSesameProbe'
  })
});

const header = response.headers.get('payment-required') || response.headers.get('PAYMENT-REQUIRED');
let requirements = null;
if (header) {
  try {
    requirements = JSON.parse(Buffer.from(header, 'base64').toString('utf8'));
  } catch (error) {
    requirements = {decodeError: error.message};
  }
}

const text = await response.text();
let body = text;
try { body = JSON.parse(text); } catch {}

const accepts = requirements?.accepts ?? body?.accepts ?? [];
const safe = accepts.map((r) => ({
  scheme: r.scheme,
  network: r.network,
  asset: r.asset,
  amount: r.amount ?? r.maxAmountRequired,
  payTo: r.payTo,
  maxTimeoutSeconds: r.maxTimeoutSeconds
}));

console.log(JSON.stringify({
  status: response.status,
  hasPaymentRequiredHeader: Boolean(header),
  x402Version: requirements?.x402Version ?? body?.x402Version ?? null,
  accepts: safe,
  body: typeof body === 'object' ? body : String(body).slice(0, 300)
}, null, 2));

if (response.status !== 402) {
  throw new Error(`Expected 402 from unpaid probe, received ${response.status}`);
}
if (!safe.length) {
  throw new Error('No x402 payment requirements found');
}
