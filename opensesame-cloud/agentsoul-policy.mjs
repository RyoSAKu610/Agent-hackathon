import { PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';

export const SOLANA_USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
export const COMPUTE_BUDGET_PROGRAM = 'ComputeBudget111111111111111111111111111111';
export const MEMO_PROGRAM = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';
export const AGENTSOUL_MAX_WRITE_MICRO_USDC = '100000'; // Agent Soul docs: image generation $0.10; other writes $0.01.

export function merchantUsdcAta(payTo, mint = SOLANA_USDC_MINT) {
  return getAssociatedTokenAddressSync(
    new PublicKey(mint),
    new PublicKey(payTo),
    true
  ).toBase58();
}

export function buildAgentSoulPolicy({ ownerId, payTo, mint = SOLANA_USDC_MINT }) {
  if (!ownerId) throw new Error('PRIVY_ADMIN_OWNER_ID is required');
  if (!payTo) throw new Error('AGENTSOUL_PAYTO is required; discover it with npm run agentsoul:probe');
  const destination = merchantUsdcAta(payTo, mint);

  return {
    name: 'OpenSesame AgentSoul x402',
    version: '1.0',
    chain_type: 'solana',
    owner_id: ownerId,
    rules: [
      {
        name: 'Allow x402 compute and memo',
        method: 'signTransaction',
        action: 'ALLOW',
        conditions: [{
          field_source: 'solana_program_instruction',
          field: 'programId',
          operator: 'in',
          value: [COMPUTE_BUDGET_PROGRAM, MEMO_PROGRAM]
        }]
      },
      {
        name: 'Allow bounded AgentSoul USDC',
        method: 'signTransaction',
        action: 'ALLOW',
        conditions: [
          {
            field_source: 'solana_token_program_instruction',
            field: 'TransferChecked.mint',
            operator: 'eq',
            value: mint
          },
          {
            field_source: 'solana_token_program_instruction',
            field: 'TransferChecked.destination',
            operator: 'eq',
            value: destination
          },
          {
            field_source: 'solana_token_program_instruction',
            field: 'TransferChecked.amount',
            operator: 'lte',
            value: AGENTSOUL_MAX_WRITE_MICRO_USDC
          }
        ]
      },
      {
        name: 'Block private key export',
        method: 'exportPrivateKey',
        conditions: [],
        action: 'DENY'
      }
    ]
  };
}
