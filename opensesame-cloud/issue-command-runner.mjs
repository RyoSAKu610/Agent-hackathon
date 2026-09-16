import fs from 'node:fs';

const OWNER = 'RyoSAKu610';
const eventPath = process.env.GITHUB_EVENT_PATH;
if (!eventPath) throw new Error('GITHUB_EVENT_PATH is required');

const event = JSON.parse(fs.readFileSync(eventPath, 'utf8'));
const issue = event.issue;
if (!issue) throw new Error('GitHub event contains no issue');
if (event.repository?.owner?.login !== OWNER) throw new Error('repository owner mismatch');
if (issue.user?.login !== OWNER) throw new Error('only the repository owner may issue OpenSesame commands');

let request;
try {
  request = JSON.parse(issue.body || '{}');
} catch {
  throw new Error('OpenSesame command body must be valid JSON');
}

let result;
if (issue.title === '[OpenSesame TEST] ping') {
  result = { ok: true, operation: 'TEST_PING' };
} else if (issue.title === '[OpenSesame GO] agentsoul') {
  if (typeof request.title !== 'string' || typeof request.prompt !== 'string') {
    throw new Error('Agent Soul command requires JSON fields: title, prompt');
  }
  const { runAgentSoulGo } = await import('./agentsoul.mjs');
  result = await runAgentSoulGo({ title: request.title, prompt: request.prompt });
} else if (issue.title === '[OpenSesame GO] mint') {
  if (!request.candidate || typeof request.candidate !== 'object') {
    throw new Error('Generic mint command requires JSON field: candidate');
  }
  const { autopilot } = await import('./autopilot.mjs');
  result = await autopilot(request.candidate);
} else {
  throw new Error(`unsupported OpenSesame issue command: ${issue.title}`);
}

const safeResult = {
  ok: Boolean(result?.ok),
  operation: result?.operation || result?.mode || null,
  chain: result?.mint?.chain || null,
  transactionHash: result?.mint?.transactionHash || result?.mint?.mint?.transactionHash || null,
  mintAddress: result?.mint?.mintAddress || result?.mintAddress || null,
  stage: result?.stage || null,
  funding: result?.funding || null
};

fs.writeFileSync('command-result.json', JSON.stringify(safeResult, null, 2));
console.log(JSON.stringify(safeResult, null, 2));
if (!safeResult.ok) process.exitCode = 2;
