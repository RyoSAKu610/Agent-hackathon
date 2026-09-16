import { decodeFunctionData } from 'viem';
import {
  Connection,
  PublicKey,
  SystemProgram,
  VersionedTransaction
} from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';
import { rpcUrls } from './rpc.mjs';

function comparable(value, abiType = '') {
  if (Array.isArray(value)) return value.map((item) => comparable(item, abiType.replace(/\[[^\]]*\]$/, '')));
  if (typeof value === 'bigint') return value.toString();
  if (/^u?int/.test(abiType)) return String(value);
  if (abiType === 'address' || abiType.startsWith('bytes')) return String(value).toLowerCase();
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, comparable(v)]));
  }
  return value;
}

export function validateEvmCalldata(candidate) {
  const tx = candidate.transaction || {};
  const call = candidate.contractCall || {};
  if (!Array.isArray(call.abi) || !call.functionName) throw new Error('contractCall ABI/functionName required');
  if (!/^0x[0-9a-fA-F]*$/.test(tx.data || '')) throw new Error('transaction.data must be hex calldata');

  const decoded = decodeFunctionData({ abi: call.abi, data: tx.data });
  if (decoded.functionName !== call.functionName) {
    throw new Error(`calldata function mismatch: expected ${call.functionName}, decoded ${decoded.functionName}`);
  }

  const fn = call.abi.find((item) => item?.type === 'function' && item?.name === call.functionName);
  if (!fn) throw new Error(`function ${call.functionName} missing from ABI`);
  const inputs = fn.inputs || [];
  const decodedArgs = decoded.args || [];
  if (decodedArgs.length !== inputs.length) throw new Error('decoded calldata argument count mismatch');

  for (let i = 0; i < inputs.length; i += 1) {
    const input = inputs[i];
    const expected = Array.isArray(call.args)
      ? call.args[i]
      : call.arguments?.[input.name];
    if (expected === undefined) {
      throw new Error(`candidate is missing expected argument ${input.name || i}`);
    }
    const actualComparable = comparable(decodedArgs[i], input.type);
    const expectedComparable = comparable(expected, input.type);
    if (JSON.stringify(actualComparable) !== JSON.stringify(expectedComparable)) {
      throw new Error(`calldata argument mismatch for ${input.name || i}`);
    }
  }

  return { functionName: decoded.functionName, argumentCount: inputs.length };
}

function readU64LE(buffer, offset) {
  if (buffer.length < offset + 8) throw new Error('instruction data too short for u64');
  return buffer.readBigUInt64LE(offset);
}

function matchNativePayment(candidate, destination, lamports) {
  const rules = candidate.nativePayments || [];
  return rules.some((rule) =>
    String(rule.recipient) === destination && lamports <= BigInt(rule.maxLamports)
  );
}

function matchSplPayment(candidate, destination, amount, mint = null) {
  const rules = candidate.splPayments || [];
  return rules.some((rule) => {
    if (String(rule.destinationTokenAccount) !== destination) return false;
    if (mint && rule.mint && String(rule.mint) !== mint) return false;
    return amount <= BigInt(rule.maxRawAmount);
  });
}

async function resolveAccountKeys(candidate, message) {
  const lookups = message.addressTableLookups || [];
  if (!lookups.length) return message.getAccountKeys();

  const connection = new Connection(rpcUrls(candidate)[0], 'confirmed');
  const tables = [];
  for (const lookup of lookups) {
    const { value } = await connection.getAddressLookupTable(lookup.accountKey);
    if (!value) throw new Error(`missing address lookup table ${lookup.accountKey.toBase58()}`);
    tables.push(value);
  }
  return message.getAccountKeys({ addressLookupTableAccounts: tables });
}

export async function validateSolanaTransaction(candidate) {
  if (!candidate.transactionBase64) throw new Error('transactionBase64 is required');
  if (!Array.isArray(candidate.allowedPrograms) || candidate.allowedPrograms.length === 0) {
    throw new Error('allowedPrograms is required');
  }

  const raw = Buffer.from(candidate.transactionBase64, 'base64');
  const tx = VersionedTransaction.deserialize(raw);
  const message = tx.message;
  const accountKeys = await resolveAccountKeys(candidate, message);
  const allowed = new Set(candidate.allowedPrograms.map(String));
  const programs = new Set();
  const payments = [];

  for (const ix of message.compiledInstructions) {
    const programKey = accountKeys.get(ix.programIdIndex);
    if (!programKey) throw new Error(`cannot resolve Solana program at index ${ix.programIdIndex}`);
    const programId = programKey.toBase58();
    programs.add(programId);
    if (!allowed.has(programId)) throw new Error(`transaction invokes unapproved Solana program ${programId}`);

    const data = Buffer.from(ix.data);
    const accounts = ix.accountKeyIndexes.map((index) => accountKeys.get(index));

    if (programKey.equals(SystemProgram.programId) && data.length >= 4) {
      const instruction = data.readUInt32LE(0);
      if (instruction === 2) {
        const destination = accounts[1]?.toBase58();
        const lamports = readU64LE(data, 4);
        if (!destination || !matchNativePayment(candidate, destination, lamports)) {
          throw new Error(`unapproved SOL transfer to ${destination || 'unknown'} for ${lamports} lamports`);
        }
        payments.push({ type: 'SOL', destination, amount: lamports.toString() });
      }
    }

    if (programKey.equals(TOKEN_PROGRAM_ID) || programKey.equals(TOKEN_2022_PROGRAM_ID)) {
      const instruction = data[0];
      if ([4, 6, 13].includes(instruction)) {
        throw new Error(`unsafe SPL Token authority/approval instruction ${instruction} is not allowed`);
      }
      if (instruction === 3) {
        const destination = accounts[1]?.toBase58();
        const amount = readU64LE(data, 1);
        if (!destination || !matchSplPayment(candidate, destination, amount)) {
          throw new Error(`unapproved SPL transfer to ${destination || 'unknown'} for ${amount}`);
        }
        payments.push({ type: 'SPL', destination, amount: amount.toString() });
      }
      if (instruction === 12) {
        const mint = accounts[1]?.toBase58();
        const destination = accounts[2]?.toBase58();
        const amount = readU64LE(data, 1);
        if (!destination || !matchSplPayment(candidate, destination, amount, mint)) {
          throw new Error(`unapproved SPL TransferChecked to ${destination || 'unknown'} for ${amount}`);
        }
        payments.push({ type: 'SPL', mint, destination, amount: amount.toString() });
      }
    }
  }

  return { programs: [...programs], payments };
}
