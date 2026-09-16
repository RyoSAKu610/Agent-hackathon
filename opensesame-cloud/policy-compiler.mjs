import fs from 'node:fs';

const chains = JSON.parse(fs.readFileSync(new URL('./config/chains.json', import.meta.url)));
const SYSTEM_PROGRAM = '11111111111111111111111111111111';
const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN_2022_PROGRAM = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
const SENSITIVE_PROGRAMS = new Set([SYSTEM_PROGRAM, TOKEN_PROGRAM, TOKEN_2022_PROGRAM]);

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

    const rules = [];
    const ordinaryPrograms = programs.filter((program) => !SENSITIVE_PROGRAMS.has(String(program)));
    if (ordinaryPrograms.length) {
      rules.push({
        name: 'Allow exact non-payment programs',
        method: 'signAndSendTransaction',
        conditions: [{
          field_source: 'solana_program_instruction',
          field: 'programId',
          operator: 'in',
          value: ordinaryPrograms
        }],
        action: 'ALLOW'
      });
    }

    if (candidate.allowSystemCreate === true) {
      rules.push({
        name: 'Allow System Program Create used by this mint',
        method: 'signAndSendTransaction',
        conditions: [{
          field_source: 'solana_system_program_instruction',
          field: 'instructionName',
          operator: 'eq',
          value: 'Create'
        }],
        action: 'ALLOW'
      });
    }

    for (const [index, payment] of (candidate.nativePayments || []).entries()) {
      if (!payment?.recipient || payment.maxLamports === undefined) throw new Error(`nativePayments[${index}] requires recipient and maxLamports`);
      rules.push({
        name: `Allow bounded SOL payment ${index + 1}`,
        method: 'signAndSendTransaction',
        conditions: [
          {
            field_source: 'solana_system_program_instruction',
            field: 'instructionName',
            operator: 'eq',
            value: 'Transfer'
          },
          {
            field_source: 'solana_system_program_instruction',
            field: 'Transfer.to',
            operator: 'eq',
            value: String(payment.recipient)
          },
          {
            field_source: 'solana_system_program_instruction',
            field: 'Transfer.lamports',
            operator: 'lte',
            value: String(payment.maxLamports)
          }
        ],
        action: 'ALLOW'
      });
    }

    for (const [index, payment] of (candidate.splPayments || []).entries()) {
      if (!payment?.mint || !payment?.destinationTokenAccount || payment.maxRawAmount === undefined) {
        throw new Error(`splPayments[${index}] requires mint, destinationTokenAccount, and maxRawAmount`);
      }
      rules.push({
        name: `Allow bounded SPL TransferChecked ${index + 1}`,
        method: 'signAndSendTransaction',
        conditions: [
          {
            field_source: 'solana_token_program_instruction',
            field: 'instructionName',
            operator: 'eq',
            value: 'TransferChecked'
          },
          {
            field_source: 'solana_token_program_instruction',
            field: 'TransferChecked.mint',
            operator: 'eq',
            value: String(payment.mint)
          },
          {
            field_source: 'solana_token_program_instruction',
            field: 'TransferChecked.destination',
            operator: 'eq',
            value: String(payment.destinationTokenAccount)
          },
          {
            field_source: 'solana_token_program_instruction',
            field: 'TransferChecked.amount',
            operator: 'lte',
            value: String(payment.maxRawAmount)
          }
        ],
        action: 'ALLOW'
      });
    }

    if (!rules.length) throw new Error('Solana candidate compiles to no allowed instructions');

    return {
      version: '1.0',
      name: `Mint solana ${String(candidate.id || 'candidate').slice(0, 25)}`.slice(0, 50),
      chain_type: 'solana',
      rules
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
