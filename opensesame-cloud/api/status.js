const targets = [
  ["AgentSea", "https://www.agentsea.io/"],
  ["agentsmint", "https://agentsmint.com/api/v1/stats"],
  ["Agent Soul", "https://agentsoul.art/api/v1/activity?limit=1&offset=0"],
  ["Metaplex Agent Registry", "https://www.metaplex.com/docs/smart-contracts/mpl-agent"]
];

export default async function handler(_req, res) {
  const results = await Promise.all(targets.map(async ([name, url]) => {
    const started = Date.now();
    try {
      const response = await fetch(url, {
        headers: { "user-agent": "OpenSesame-Agent-Radar/1.0" },
        signal: AbortSignal.timeout(15000)
      });
      return { name, url, ok: response.ok, status: response.status, latencyMs: Date.now() - started };
    } catch (error) {
      return { name, url, ok: false, status: null, latencyMs: Date.now() - started, error: error.message };
    }
  }));

  res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=300");
  res.status(200).json({ checkedAt: new Date().toISOString(), mode: "read-only", results });
}
