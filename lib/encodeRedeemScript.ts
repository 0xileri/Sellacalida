// Independent encoder for the SellacalidaEscrow redeem script.
//
// Verified against cashscript@0.14.0 source (node_modules/@cashscript/utils/dist/script.js):
//   redeem script = [...encodedConstructorArgs].reverse() each pushed with libauth encodeDataPush,
//                   followed by the artifact bytecode (asmToBytecode).
//   ints are encoded with bigIntToVmNumber (minimal VM number) before the push.
//
// SellacalidaOffer.accept() rebuilds the same bytes on-chain. tests/encodeRedeemScript.test.ts fails
// the build if hash256(encode(args) || escrowBody) differs from the SDK Contract's redeem script.
import {
  bigIntToVmNumber,
  encodeDataPush,
  flattenBinArray,
  hash256,
  hexToBin,
} from '@bitauth/libauth';
import { utils } from 'cashscript';
import escrowArtifact from '../contracts/artifacts/SellacalidaEscrow.json';

export interface EscrowArgs {
  agentPkh: Uint8Array; // 20
  challengerPkh: Uint8Array; // 20
  verifierPk: Uint8Array; // 33, compressed
  bondAmount: bigint; // token base units, > 0
  feeAmount: bigint; // token base units, > 0
  tokenCategory: Uint8Array; // 32, VM (unreversed) order
  networkId: Uint8Array; // 1 byte
  challengeId: Uint8Array; // 32
  specHash: Uint8Array; // 32
  expiryHeight: bigint;
  verifierGraceBlocks: bigint;
}

/** Constructor order of SellacalidaEscrow. Locked against the artifact by tests. */
export const ESCROW_ARG_ORDER = [
  'agentPkh',
  'challengerPkh',
  'verifierPk',
  'bondAmount',
  'feeAmount',
  'tokenCategory',
  'networkId',
  'challengeId',
  'specHash',
  'expiryHeight',
  'verifierGraceBlocks',
] as const satisfies readonly (keyof EscrowArgs)[];

const FIXED_LENGTHS: Partial<Record<keyof EscrowArgs, number>> = {
  agentPkh: 20,
  challengerPkh: 20,
  verifierPk: 33,
  tokenCategory: 32,
  networkId: 1,
  challengeId: 32,
  specHash: 32,
};

/** Escrow bytecode without constructor args, exactly as in the artifact. */
export function escrowBody(): Uint8Array {
  return utils.asmToBytecode(escrowArtifact.bytecode);
}

/** The ordered SDK constructor args, for `new Contract(escrowArtifact, escrowSdkArgs(a), ...)`. */
export function escrowSdkArgs(a: EscrowArgs) {
  return ESCROW_ARG_ORDER.map((k) => a[k]) as [
    Uint8Array, Uint8Array, Uint8Array, bigint, bigint, Uint8Array, Uint8Array,
    Uint8Array, Uint8Array, bigint, bigint,
  ];
}

export function encodeEscrowConstructorArgs(a: EscrowArgs): Uint8Array {
  const encoded = ESCROW_ARG_ORDER.map((k) => {
    const v = a[k];
    if (typeof v === 'bigint') return bigIntToVmNumber(v);
    const want = FIXED_LENGTHS[k];
    if (want !== undefined && v.length !== want) {
      throw new Error(`escrow arg ${k} must be ${want} bytes, got ${v.length}`);
    }
    return v;
  });
  return flattenBinArray(encoded.slice().reverse().map((bytes) => encodeDataPush(bytes)));
}

export function buildEscrowRedeemScript(a: EscrowArgs): Uint8Array {
  return flattenBinArray([encodeEscrowConstructorArgs(a), escrowBody()]);
}

/** OP_HASH256 <32-byte hash256(redeemScript)> OP_EQUAL */
export function p2sh32LockingBytecode(redeemScript: Uint8Array): Uint8Array {
  return flattenBinArray([hexToBin('aa20'), hash256(redeemScript), hexToBin('87')]);
}

export function escrowLockingBytecode(a: EscrowArgs): Uint8Array {
  return p2sh32LockingBytecode(buildEscrowRedeemScript(a));
}
