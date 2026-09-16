# OpenSesame Cloud

Agent-native NFT discovery/control plane for Base + Solana.

## What is live in this branch

- Read-only radar for AgentSea, agentsmint, Agent Soul, and Metaplex Agent Registry
- Vercel-compatible `/api/status` endpoint
- Human-readable dashboard (`index.html`)
- Default-deny signing contract in `config/agent-policy.json`
- GitHub Actions manual/push check

No private key or API secret is stored in this repository.

## Vercel

Import this repository and set **Root Directory** to `opensesame-cloud`.
No environment variables are needed for the read-only phase.

## Signer integration

For writes, use a signer whose policy is enforced outside this Vercel/GitHub runtime. Privy and Turnkey both provide wallet policy engines capable of contract/program allowlisting and transaction constraints. Do not enable write paths until the exact target contract/program and allowed method/instruction are known.

Metaplex Agent Registry execution delegation remains disabled because an active execution delegate can forward arbitrary instructions through the Core Execute hook; it is broader than the scoped permission model required here.
