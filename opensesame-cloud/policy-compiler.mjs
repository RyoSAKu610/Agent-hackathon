import fs from 'node:fs';

const chains = JSON.parse(fs.readFileSync(new URL('./config/chains.json', import.meta.url)));

export function compilePolicy(candidate) {
  if (!candidate?.chainType || !candidate?.chain) throw new Error('candidate.chainType and candidate.chain are required');

  if (candidate.chainType === 'evm') {
    const chain = chains.evm[candidate.chain];
    if (!chain) throw new Error(`unsupported EVM chain: ${candidate.chain}`);
    const tx = candidate.transaction || {};
    const call = candidate.contractCall || {};
    if (!/^0x[a-fA-F0-9]{40}$/.test(tx.to || '')) throw new Error('valid transaction.to required');
    if (!/^0x[a-fA-F0-9]*$/.test(tx.data || '')) throw new Error('hex transaction.data required');
    if (tx.valueWei === undefined) throw new Error('transaction.valueWei required');
    if (!call.functionName || !Array.isArray(call.abi)) throw new Error('contractCall.functionName and ABI required');

    const conditions = [
      { field_source: 'ethereum_transaction', field: 'chain_id', operator: 'eq', value: String(chain.chainId) },
      { field_source: 'ethereum_transaction', field: 'to', operator: 'eq', value: tx.to },
      { field_source: 'ethereum_transaction', field: 'value', operator: 'lte', value: String(tx.valueWei) },
      { field_source: 'ethereum_calldata', field: 'function_name', abi: call.abi, operator: 'eq', value: call.functionName }
    ];

    for (const [name, value] of Object.entries(call.arguments || {})) {
      conditions.push({
        field_source: 'ethereum_calldata',
        field: `${call.functionName}.${name}`,
        abi: call.abi,
        operator: 'eq',
        value: typeof value === 'bigint' ? value.toString() : value
      });
    }

    return {
      version: '1.0',
      name: `Mint ${candidate.chain} ${String(candidate.id || 'candidate').slice(0, 25)}`.slice(0, 50),
      chain_type: 'ethereum',
      rules: [{
        name: 'Allow exact mint call',
        method: 'eth_sendTransaction',
        conditions,
        action: 'ALLOW'
      }]
    };
  }

  if (candidate.chainType === 'solana') {
    const chain = chains.solana[candidate.chain];
    if (!chain) throw new Error(`unsupported Solana cluster: ${candidate.chain}`);
    const programs = candidate.allowedPrograms;
    if (!Array.isArray(programs) || programs.length === 0) throw new Error('allowedPrograms is required for Solana');

    return {
      version: '1.0',
      name: `Mint solana ${String(candidate.id || 'candidate').slice(0, 25)}`.slice(0, 50),
      chain_type: 'solana',
      rules: [
        {
          name: 'Allow mint transaction programs',
          method: 'signAndSendTransaction',
          conditions: [{
            field_source: 'solana_program_instruction',
            field: 'programId',
            operator: 'in',
            value: programs
          }],
          action: 'ALLOW'
        },
        {
          name: 'Deny direct SOL transfers',
          method: 'signAndSendTransaction',
          conditions: [{
            field_source: 'solana_system_program_instruction',
            field: 'instructionName',
            operator: 'eq',
            value: 'Transfer'
          }],
          action: 'DENY'
        },
        {
          name: 'Deny direct SPL transfers',
          method: 'signAndSendTransaction',
          conditions: [{
            field_source: 'solana_token_program_instruction',
            field: 'instructionName',
            operator: 'in',
            value: ['Transfer', 'TransferChecked', 'Approve', 'ApproveChecked', 'SetAuthority']
          }],
          action: 'DENY'
        }
      ]
    };
  }

  throw new Error(`unsupported chainType: ${candidate.chainType}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const path = process.argv[2];
  if (!path) throw new Error('usage: npm run policy:compile -- <candidate.json>');
  const candidate = JSON.parse(fs.readFileSync(path, 'utf8'));
  console.log(JSON.stringify(compilePolicy(candidate), null, 2));
}
