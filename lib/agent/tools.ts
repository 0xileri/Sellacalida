// The agent's one tool: get_transaction. It returns public chain data, decoded from raw hex that
// must hash to the requested txid. It is generic decoding, not a checker: no counting, matching or
// answer logic lives here, and nothing here can reach lib/templates/check (tests/boundary.test.ts).
import { binToHex } from '@bitauth/libauth';
import { lockingBytecodeToAddress } from '../bch/address';
import { fetchVerifiedTx, type RawTxReader } from '../bch/txSource';
import type { SellacalidaNetwork } from '../constants';
import type { ToolDef } from './llm';

export const GET_TRANSACTION_TOOL: ToolDef = {
  type: 'function',
  function: {
    name: 'get_transaction',
    description:
      'Fetch a Bitcoin Cash transaction by txid (64 hex chars, explorer byte order) and return its decoded ' +
      'inputs and outputs. Each output lists its index, value in satoshis, locking bytecode hex, the plain ' +
      '(non-token-aware) cashaddr when the script is standard, and any CashToken prefix: category (explorer ' +
      'byte order), fungible amount, NFT capability and NFT commitment hex.',
    parameters: {
      type: 'object',
      properties: { txid: { type: 'string', description: '64 lowercase hex chars' } },
      required: ['txid'],
      additionalProperties: false,
    },
  },
};

export interface ToolContext {
  chain: RawTxReader;
  network: SellacalidaNetwork;
}

export function describeTransaction(tx: Awaited<ReturnType<typeof fetchVerifiedTx>>['tx'], txid: string, network: SellacalidaNetwork) {
  return {
    txid,
    version: tx.version,
    locktime: tx.locktime,
    inputs: tx.inputs.map((i, index) => ({
      index,
      outpointTxid: binToHex(i.outpointTransactionHash),
      outpointIndex: i.outpointIndex,
    })),
    outputs: tx.outputs.map((o, index) => {
      let address: string | null = null;
      try {
        address = lockingBytecodeToAddress(o.lockingBytecode, network);
      } catch {
        address = null; // nonstandard script
      }
      return {
        index,
        valueSatoshis: o.valueSatoshis.toString(),
        lockingBytecode: binToHex(o.lockingBytecode),
        address,
        token: o.token
          ? {
              category: binToHex(o.token.category),
              amount: o.token.amount.toString(),
              nft: o.token.nft ? { capability: o.token.nft.capability, commitment: binToHex(o.token.nft.commitment) } : null,
            }
          : null,
      };
    }),
  };
}

/** Run one tool call. Always returns a JSON string for the model; errors come back as {error}. */
export async function runTool(name: string, argsJson: string, ctx: ToolContext): Promise<string> {
  if (name !== GET_TRANSACTION_TOOL.function.name) return JSON.stringify({ error: `unknown tool ${name}` });
  let txid: unknown;
  try {
    txid = (JSON.parse(argsJson || '{}') as { txid?: unknown }).txid;
  } catch {
    return JSON.stringify({ error: 'arguments must be JSON like {"txid":"<64 hex>"}' });
  }
  if (typeof txid !== 'string' || !/^[0-9a-fA-F]{64}$/.test(txid)) {
    return JSON.stringify({ error: 'txid must be 64 hex characters' });
  }
  const id = txid.toLowerCase();
  try {
    const { tx } = await fetchVerifiedTx(ctx.chain, id);
    return JSON.stringify(describeTransaction(tx, id, ctx.network));
  } catch (e) {
    return JSON.stringify({ error: `could not fetch ${id}: ${e instanceof Error ? e.message : String(e)}` });
  }
}
