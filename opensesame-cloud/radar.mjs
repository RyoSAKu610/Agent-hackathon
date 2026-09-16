const targets = [
  ["AgentSea", "https://www.agentsea.io/"],
  ["agentsmint", "https://agentsmint.com/api/v1/stats"],
  ["Agent Soul", "https://agentsoul.art/api/v1/activity?limit=1&offset=0"],
  ["Metaplex Agent Registry", "https://www.metaplex.com/docs/smart-contracts/mpl-agent"]
];

const results = [];
for (const [name, url] of targets) {
  const started = Date.now();
  try {
    const response = await fetch(url, {
      headers: { "user-agent": "OpenSesame-Agent-Radar/1.0" },
      signal: AbortSignal.timeout(15000)
    });
    results.push({
      name,
      url,
      ok: response.ok,
      status: response.status,
      latencyMs: Date.now() - started
    });
  } catch (error) {
    results.push({
      name,
      url,
      ok: false,
      status: null,
      latencyMs: Date.now() - started,
      error: error.message
    });
  }
}

console.log(JSON.stringify({ checkedAt: new Date().toISOString(), mode: "read-only", results }, null, 2));
if (results.every((item) => !item.ok)) process.exitCode = 1;
