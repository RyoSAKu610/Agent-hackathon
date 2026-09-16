import { PrivyClient } from '@privy-io/node';
import { buildAgentSoulPolicy } from './agentsoul-policy.mjs';

function env(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

const privy = new PrivyClient({
  appId: env('PRIVY_APP_ID'),
  appSecret: env('PRIVY_APP_SECRET')
});

const ownerId = env('PRIVY_ADMIN_OWNER_ID');
const agentSignerId = env('PRIVY_AGENT_SIGNER_ID');
const agentSoulPayTo = env('AGENTSOUL_PAYTO');

const evmLockPolicy = await privy.policies().create({
  name: 'OpenSesame EVM locked',
  version: '1.0',
  chain_type: 'ethereum',
  owner_id: ownerId,
  rules: [
    {
      name: 'Block private key export',
      method: 'exportPrivateKey',
      conditions: [],
      action: 'DENY'
    }
  ]
});

const solanaPolicy = await privy.policies().create(
  buildAgentSoulPolicy({ ownerId, payTo: agentSoulPayTo })
);

const evmWallet = await privy.wallets().create({
  chain_type: 'ethereum',
  external_id: 'opensesame-evm',
  display_name: 'OpenSesame EVM Mint Wallet',
  owner_id: ownerId,
  policy_ids: [],
  additional_signers: [
    { signer_id: agentSignerId, override_policy_ids: [evmLockPolicy.id] }
  ]
});

const solanaWallet = await privy.wallets().create({
  chain_type: 'solana',
  external_id: 'opensesame-solana',
  display_name: 'OpenSesame Solana Agent Wallet',
  owner_id: ownerId,
  policy_ids: [],
  additional_signers: [
    { signer_id: agentSignerId, override_policy_ids: [solanaPolicy.id] }
  ]
});

console.log(JSON.stringify({
  evm: {
    walletId: evmWallet.id,
    address: evmWallet.address,
    agentPolicyId: evmLockPolicy.id,
    state: 'LOCKED_DEFAULT_DENY'
  },
  solana: {
    walletId: solanaWallet.id,
    address: solanaWallet.address,
    agentPolicyId: solanaPolicy.id,
    state: 'AGENTSOUL_X402_ONLY'
  },
  note: 'Save only these IDs/addresses as runtime config. Never place admin authorization keys in source control.'
}, null, 2));
