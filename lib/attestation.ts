// 156-byte verifier attestation. Byte layout is identical to the .split parse in
// contracts/SellacalidaEscrow.cash settle(). Locked by tests/attestation.test.ts and the mocknet
// settle tests. checkDataSig SHA-256s the message itself, so the raw 156 bytes are signed (not a hash).
import {
  binToHex,
  flattenBinArray,
  numberToBinUint32LE,
  secp256k1,
  sha256,
  utf8ToBin,
} from '@bitauth/libauth';
import { NETWORK_IDS, VERDICTS, type SellacalidaNetwork, type Verdict } from './constants';
import { toOutpointTxHash } from './tokenCategory';

export const ATTEST_PREFIX = 'SELLACALIDA-ATTEST-v1:'; // 22 bytes ASCII, trailing colon included
export const ATTEST_LENGTH = 156;
export const ATTEST_OFFSETS = {
  prefix: 0,
  networkId: 22,
  challengeId: 23,
  outpointTxid: 55,
  outpointIndex: 87,
  specHash: 91,
  verdict: 123,
  answerHash: 124,
} as const;

export const ZERO_HASH = new Uint8Array(32);

export interface AttestationFields {
  network: SellacalidaNetwork;
  challengeId: Uint8Array; // 32 bytes
  /** Escrow outpoint txid in explorer order (as wallets / electrum report it). */
  escrowTxid: string;
  escrowVout: number;
  specHash: Uint8Array; // 32 bytes
  verdict: Verdict;
  /** sha256(utf8(canonicalAnswer)) for PASS / FAIL; must be omitted or zero for NORESPONSE. */
  answerHash?: Uint8Array;
}

function expectLength(name: string, bytes: Uint8Array, length: number): void {
  if (bytes.length !== length) throw new Error(`${name} must be ${length} bytes, got ${bytes.length}`);
}

export function buildAttestation(f: AttestationFields): Uint8Array {
  expectLength('challengeId', f.challengeId, 32);
  expectLength('specHash', f.specHash, 32);
  if (!Number.isInteger(f.escrowVout) || f.escrowVout < 0 || f.escrowVout > 0xffffffff) {
    throw new Error(`escrowVout out of range: ${f.escrowVout}`);
  }
  const answerHash = f.answerHash ?? ZERO_HASH;
  expectLength('answerHash', answerHash, 32);
  const isZero = answerHash.every((b) => b === 0);
  if (f.verdict === 'NORESPONSE' && !isZero) {
    throw new Error('NORESPONSE requires a 32-zero answerHash');
  }
  if (f.verdict !== 'NORESPONSE' && isZero) {
    throw new Error(`${f.verdict} requires a committed (non-zero) answerHash`);
  }

  const message = flattenBinArray([
    utf8ToBin(ATTEST_PREFIX),
    Uint8Array.of(NETWORK_IDS[f.network]),
    f.challengeId,
    toOutpointTxHash(f.escrowTxid),
    numberToBinUint32LE(f.escrowVout),
    f.specHash,
    Uint8Array.of(VERDICTS[f.verdict]),
    answerHash,
  ]);
  expectLength('attestation', message, ATTEST_LENGTH);
  return message;
}

/** 64-byte Schnorr datasig over sha256(message), the form OP_CHECKDATASIG verifies. */
export function signAttestation(message: Uint8Array, verifierPrivateKey: Uint8Array): Uint8Array {
  expectLength('attestation', message, ATTEST_LENGTH);
  const sig = secp256k1.signMessageHashSchnorr(verifierPrivateKey, sha256.hash(message));
  if (typeof sig === 'string') throw new Error(`signing failed: ${sig}`);
  return sig;
}

export function verifyAttestation(message: Uint8Array, signature: Uint8Array, verifierPk: Uint8Array): boolean {
  return secp256k1.verifySignatureSchnorr(signature, verifierPk, sha256.hash(message));
}

export function sha256Utf8(text: string): Uint8Array {
  return sha256.hash(utf8ToBin(text));
}

export function describeAttestation(message: Uint8Array) {
  const o = ATTEST_OFFSETS;
  return {
    prefix: new TextDecoder().decode(message.slice(o.prefix, o.networkId)),
    networkId: message[o.networkId],
    challengeId: binToHex(message.slice(o.challengeId, o.outpointTxid)),
    outpointTxidVmOrder: binToHex(message.slice(o.outpointTxid, o.outpointIndex)),
    outpointIndexLE: binToHex(message.slice(o.outpointIndex, o.specHash)),
    specHash: binToHex(message.slice(o.specHash, o.verdict)),
    verdict: message[o.verdict],
    answerHash: binToHex(message.slice(o.answerHash, ATTEST_LENGTH)),
  };
}
