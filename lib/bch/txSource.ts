// Fetch a raw transaction and prove it is the one asked for. The raw hex goes into the evidence blob,
// so anyone can re-run a checker without trusting the Electrum server that supplied it.
//
// libauth decoding returns token categories in explorer order (decodeTokenPrefix reverses the
// serialized bytes), matching the explorer-order ids used in challenge params.
import { decodeTransaction, hashTransaction, hexToBin, type TransactionCommon } from '@bitauth/libauth';

export interface RawTxReader {
  getRawTransaction(txid: string): Promise<string>;
}

/** Decode raw tx hex and require that it hashes to `txid` (explorer order). */
export function decodeVerified(txid: string, rawHex: string): TransactionCommon {
  if (!/^[0-9a-f]+$/i.test(rawHex) || rawHex.length % 2 !== 0) throw new Error('raw transaction is not hex');
  const bin = hexToBin(rawHex.toLowerCase());
  const actual = hashTransaction(bin);
  if (actual !== txid) throw new Error(`raw transaction hashes to ${actual}, not ${txid}`);
  const tx = decodeTransaction(bin);
  if (typeof tx === 'string') throw new Error(`cannot decode transaction ${txid}: ${tx}`);
  return tx;
}

export async function fetchVerifiedTx(reader: RawTxReader, txid: string) {
  const rawHex = (await reader.getRawTransaction(txid)).toLowerCase();
  return { rawHex, tx: decodeVerified(txid, rawHex) };
}
