// A minimal stand-in for a WizardConnect wallet (Paytaca-style) used only in tests:
// signs the inputs named in `inputPaths`, filling P2PKH placeholders and contract
// placeholderSignature() / placeholderPublicKey() bytes. It lets the browser flows run end to end
// on mocknet. Real wallet behaviour is still what SPIKE.md records.
import {
  binToHex,
  encodeDataPush,
  encodeTransaction,
  flattenBinArray,
  generateSigningSerializationBCH,
  hash256,
  type Input,
  type Output,
  type TransactionCommon,
} from '@bitauth/libauth';
import type { SignatureTemplate } from 'cashscript';

const SIGHASH_ALL_UTXOS_FORKID = 0x61;

interface WcObject {
  transaction: TransactionCommon;
  sourceOutputs: (Input & Output & { contract?: { redeemScript: Uint8Array } })[];
}

function replaceOnce(haystack: Uint8Array, needle: Uint8Array, replacement: Uint8Array): Uint8Array {
  const h = binToHex(haystack);
  const n = binToHex(needle);
  const at = h.indexOf(n);
  if (at < 0 || at % 2 !== 0) throw new Error('placeholder not found in unlocking bytecode');
  const next = h.slice(0, at) + binToHex(replacement) + h.slice(at + n.length);
  return Uint8Array.from(next.match(/../g)!.map((b) => parseInt(b, 16)));
}

export function mockWalletSign(
  wc: WcObject,
  inputPaths: [number, string, number][],
  keyFor: (path: string, index: number) => SignatureTemplate,
): string {
  const transaction: TransactionCommon = {
    ...wc.transaction,
    inputs: wc.transaction.inputs.map((i) => ({ ...i, unlockingBytecode: i.unlockingBytecode.slice() })),
  };
  const sourceOutputs = wc.sourceOutputs;
  const signed = new Map<number, Uint8Array>();
  for (const [inputIndex, path, index] of inputPaths) {
    const key = keyFor(path, index);
    const so = sourceOutputs[inputIndex];
    const coveredBytecode = so.contract ? so.contract.redeemScript : so.lockingBytecode;
    const preimage = generateSigningSerializationBCH(
      { inputIndex, sourceOutputs, transaction },
      { coveredBytecode, signingSerializationType: Uint8Array.of(SIGHASH_ALL_UTXOS_FORKID) },
    );
    const sig = flattenBinArray([key.signMessageHash(hash256(preimage)), Uint8Array.of(SIGHASH_ALL_UTXOS_FORKID)]);
    if (so.contract) {
      let u = transaction.inputs[inputIndex].unlockingBytecode;
      u = replaceOnce(u, encodeDataPush(new Uint8Array(65)), encodeDataPush(sig));
      u = replaceOnce(u, encodeDataPush(new Uint8Array(33)), encodeDataPush(key.publicKey));
      signed.set(inputIndex, u);
    } else {
      signed.set(inputIndex, flattenBinArray([encodeDataPush(sig), encodeDataPush(key.publicKey)]));
    }
  }
  for (const [i, u] of signed) transaction.inputs[i].unlockingBytecode = u;
  return binToHex(encodeTransaction(transaction));
}
