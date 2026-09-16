# OpenSesame Cloud

Agent-native NFT discovery + scoped mint execution for EVM and Solana.

## Current state

The branch is split into two planes:

- **Discovery/control:** GitHub Actions + Vercel-compatible status UI/API.
- **Signing/execution:** Privy wallets with an agent signer whose policy is enforced outside GitHub/Vercel.

No raw wallet private key is stored in this repository.

### Supported chains

Mainnet RPC/data app:

- Ethereum
- Base
- X Layer
- Zora
- Robinhood Chain
- Polygon
- Arbitrum
- Optimism
- Solana

Testnet app:

- Ethereum Sepolia
- Base Sepolia
- Solana Devnet

Alchemy is the primary RPC provider. Verified public RPCs are configured as fallbacks for Base, X Layer, Zora, Robinhood Chain, Optimism and Solana. A per-chain `RPC_OVERRIDE_<CHAIN>` environment variable can take precedence without modifying source.

## Safety contract

`GO` does not mean unrestricted wallet access.

Before an NFT transaction is sent, OpenSesame:

1. binds the candidate to the configured Privy wallet;
2. verifies the chain and target contract/program;
3. decodes EVM calldata and compares the actual function + arguments with the declared mint;
4. parses Solana instructions, requires the configured wallet as a signer, rejects unknown programs and unapproved SOL/SPL transfers;
5. simulates the same transaction;
6. measures required native/token funding;
7. hashes the candidate;
8. creates an exact Privy policy for that candidate;
9. temporarily attaches that policy to the restricted agent signer;
10. sends the transaction;
11. re-locks the signer in `finally`, including failed mint attempts.

Private-key export is not part of any execution path.

## Setup

```bash
cd opensesame-cloud
cp .env.example .env
npm install
```

Fill the Alchemy and Privy credentials in your secret store, not in Git.

Create the isolated Privy wallets and base policies:

```bash
npm run privy:bootstrap
```

Save the returned wallet IDs, wallet addresses and policy IDs into the corresponding environment variables.

## Generic NFT mint — one command

Prepare a candidate JSON from the mint source, then:

```bash
OPENSESAME_WRITE_ENABLED=true npm run autopilot -- GO candidate.json
```

### EVM candidate contract

The candidate must contain:

- `chainType: "evm"`
- one supported `chain`
- the exact configured `walletAddress`
- `transaction.to`, `transaction.valueWei`, and ABI-encoded `transaction.data`
- `contractCall.abi`, `contractCall.functionName`, and the exact expected arguments

OpenSesame decodes `transaction.data`; a candidate whose declared arguments differ from the calldata is rejected before simulation/signing.

### Solana candidate contract

The candidate must contain:

- `chainType: "solana"`
- `chain: "mainnet"` or `"devnet"`
- the exact configured `walletAddress`
- serialized `transactionBase64`
- `allowedPrograms`
- any permitted direct SOL payments in `nativePayments`
- any permitted SPL payments in `splPayments`

Unknown programs, direct token approvals/authority changes, and transfers outside the declared destinations/amounts are rejected.

## Faucet behavior

### Solana Devnet

If the Devnet wallet is empty, OpenSesame parses the transaction and derives the faucet request from its measured transaction fee plus explicit System Program debits. It does not use a hard-coded SOL amount.

### Ethereum / Base testnets

If an EVM testnet wallet is empty, the autopilot returns a machine-readable `ALCHEMY_FAUCET_DRIP_REQUIRED` result containing the network and address. The Alchemy faucet action can then fund that exact wallet, after which the same candidate can be re-run.

Testnet assets never satisfy mainnet funding requirements.

## Agent Soul — full create + mint

Agent Soul is integrated as a dedicated Solana/x402 path. The signer policy pins the USDC mint, merchant destination and payment ceiling. Current platform pricing is $0.10 USDC for image generation and $0.01 for the other writes used in the flow.

After the Privy Solana wallet has enough mainnet SOL for fees and enough mainnet USDC for the API writes:

```bash
OPENSESAME_WRITE_ENABLED=true npm run agentsoul -- GO "Title" "your generation prompt"
```

The command performs:

```text
status -> register if needed -> generate -> save draft -> submit/mint
```

First-time maximum API write cost for that exact path is $0.13 USDC; if already registered, $0.12 USDC. The final `submit` publishes the draft and mints it as a Metaplex Core NFT.

`npm run agentsoul:probe` is diagnostic only. The external unpaid probe is non-blocking in CI because upstream error responses must not disable the rest of OpenSesame.

## Read-only radar

```bash
npm run radar
```

Currently checks AgentSea, agentsmint, Agent Soul and Metaplex Agent Registry without wallet writes.

## Verification

```bash
npm run selftest
```

The self-test verifies calldata binding, exact EVM policy construction, Solana required-signer enforcement, Solana program allowlisting, Agent Soul USDC constraints and absence of wildcard allow rules.

GitHub Actions runs the self-test and radar on pushes to the cloud branch. The Agent Soul upstream probe is reported separately and cannot make the core verification fail.
