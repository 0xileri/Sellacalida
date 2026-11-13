// BCH transaction-analysis checkers. Server side only. Every checker is a pure function of the
// decoded transaction, and records a per-output trace so the evidence shows how the answer was found.
import { binToHex, type TransactionCommon } from '@bitauth/libauth';
import { addressToLockingBytecode } from '../../bch/address';

export interface OutputTrace {
  index: number;
  valueSatoshis: string;
  lockingBytecode: string;
  /** explorer order, or null when the output carries no token */
  tokenCategory: string | null;
  tokenAmount: string | null;
  nftCapability: string | null;
  nftCommitment: string | null;
  matched: boolean;
}

function traceOutputs(tx: TransactionCommon, match: (o: TransactionCommon['outputs'][number]) => boolean): OutputTrace[] {
  return tx.outputs.map((o, index) => ({
    index,
    valueSatoshis: o.valueSatoshis.toString(),
    lockingBytecode: binToHex(o.lockingBytecode),
    tokenCategory: o.token ? binToHex(o.token.category) : null,
    tokenAmount: o.token ? o.token.amount.toString() : null,
    nftCapability: o.token?.nft ? o.token.nft.capability : null,
    nftCommitment: o.token?.nft ? binToHex(o.token.nft.commitment) : null,
    matched: match(o),
  }));
}

/** bch.output_token_count: outputs whose token prefix has `category` (FT, NFT, or both). */
export function checkOutputTokenCount(tx: TransactionCommon, category: string) {
  const outputs = traceOutputs(tx, (o) => !!o.token && binToHex(o.token.category) === category);
  return { expected: String(outputs.filter((o) => o.matched).length), outputs };
}

/** bch.total_sats_to_address: sum of output values locked to `address` (token-aware or plain). */
export function checkTotalSatsToAddress(tx: TransactionCommon, address: string) {
  const target = binToHex(addressToLockingBytecode(address));
  const outputs = traceOutputs(tx, (o) => binToHex(o.lockingBytecode) === target);
  const total = tx.outputs.reduce((acc, o) => (binToHex(o.lockingBytecode) === target ? acc + o.valueSatoshis : acc), 0n);
  return { expected: total.toString(), outputs, targetLockingBytecode: target };
}

/**
 * bch.nft_output_index: the unique output holding an NFT of `category` (and `commitment` when it is
 * non-empty). Zero or several matches -> "-1", the documented sentinel the agent is told to use.
 */
export function checkNftOutputIndex(tx: TransactionCommon, category: string, commitment: string) {
  const outputs = traceOutputs(
    tx,
    (o) =>
      !!o.token?.nft &&
      binToHex(o.token.category) === category &&
      (commitment === '' || binToHex(o.token.nft.commitment) === commitment),
  );
  const hits = outputs.filter((o) => o.matched);
  return { expected: hits.length === 1 ? String(hits[0].index) : '-1', outputs, matches: hits.length };
}
