import { describe, expect, it } from 'vitest';
import { binToHex, hexToBin, secp256k1, sha256, utf8ToBin } from '@bitauth/libauth';
import {
  ATTEST_LENGTH,
  ATTEST_OFFSETS,
  ATTEST_PREFIX,
  ZERO_HASH,
  buildAttestation,
  describeAttestation,
  sha256Utf8,
  signAttestation,
  verifyAttestation,
} from '@/lib/attestation';
import { verifier } from './helpers';

const challengeId = sha256.hash(utf8ToBin('c'));
const specHash = sha256.hash(utf8ToBin('s'));
const answerHash = sha256Utf8('3');
const txid = 'aa'.repeat(31) + '01'; // explorer order, last byte 0x01

function sample(verdict: 'PASS' | 'FAIL' | 'NORESPONSE' = 'PASS') {
  return buildAttestation({
    network: 'chipnet',
    challengeId,
    escrowTxid: txid,
    escrowVout: 0x01020304,
    specHash,
    verdict,
    answerHash: verdict === 'NORESPONSE' ? undefined : answerHash,
  });
}

describe('attestation layout (spec section 4)', () => {
  it('prefix is exactly 22 bytes, trailing colon included', () => {
    expect(ATTEST_PREFIX.length).toBe(22);
    expect(Buffer.byteLength(ATTEST_PREFIX, 'ascii')).toBe(22);
    expect(Buffer.byteLength(ATTEST_PREFIX, 'utf8')).toBe(22);
    expect(ATTEST_PREFIX.endsWith(':')).toBe(true);
    expect('SELLACALIDA-ATTEST-v1'.length).toBe(21);
  });

  it('offsets are contiguous and sum to 156', () => {
    const o = ATTEST_OFFSETS;
    expect(o.prefix).toBe(0);
    expect(o.networkId).toBe(o.prefix + 22);
    expect(o.challengeId).toBe(o.networkId + 1);
    expect(o.outpointTxid).toBe(o.challengeId + 32);
    expect(o.outpointIndex).toBe(o.outpointTxid + 32);
    expect(o.specHash).toBe(o.outpointIndex + 4);
    expect(o.verdict).toBe(o.specHash + 32);
    expect(o.answerHash).toBe(o.verdict + 1);
    expect(o.answerHash + 32).toBe(ATTEST_LENGTH);
    expect(ATTEST_LENGTH).toBe(156);
    expect(o).toEqual({
      prefix: 0, networkId: 22, challengeId: 23, outpointTxid: 55,
      outpointIndex: 87, specHash: 91, verdict: 123, answerHash: 124,
    });
  });

  it('every field sits at its offset', () => {
    const m = sample('FAIL');
    const o = ATTEST_OFFSETS;
    expect(m.length).toBe(156);
    expect(new TextDecoder().decode(m.slice(0, 22))).toBe(ATTEST_PREFIX);
    expect(m[o.networkId]).toBe(0x01);
    expect(binToHex(m.slice(o.challengeId, o.challengeId + 32))).toBe(binToHex(challengeId));
    // outpoint txid is stored in VM (serialized) order: the explorer txid reversed
    expect(binToHex(m.slice(o.outpointTxid, o.outpointTxid + 32))).toBe('01' + 'aa'.repeat(31));
    // outpoint index is 4-byte little-endian
    expect(binToHex(m.slice(o.outpointIndex, o.outpointIndex + 4))).toBe('04030201');
    expect(binToHex(m.slice(o.specHash, o.specHash + 32))).toBe(binToHex(specHash));
    expect(m[o.verdict]).toBe(0x02);
    expect(binToHex(m.slice(o.answerHash, o.answerHash + 32))).toBe(binToHex(answerHash));
    expect(describeAttestation(m).prefix).toBe(ATTEST_PREFIX);
  });

  it('verdict bytes are 0x01 / 0x02 / 0x03', () => {
    expect(sample('PASS')[123]).toBe(1);
    expect(sample('FAIL')[123]).toBe(2);
    expect(sample('NORESPONSE')[123]).toBe(3);
  });

  it('NORESPONSE carries a 32-zero answerHash and refuses a real one', () => {
    const m = sample('NORESPONSE');
    expect(m.slice(124).every((b) => b === 0)).toBe(true);
    expect(() =>
      buildAttestation({
        network: 'chipnet', challengeId, escrowTxid: txid, escrowVout: 0, specHash,
        verdict: 'NORESPONSE', answerHash,
      }),
    ).toThrow(/32-zero/);
  });

  it('PASS / FAIL refuse a missing (zero) answerHash', () => {
    expect(() =>
      buildAttestation({
        network: 'chipnet', challengeId, escrowTxid: txid, escrowVout: 0, specHash,
        verdict: 'PASS', answerHash: ZERO_HASH,
      }),
    ).toThrow(/committed/);
  });

  it('rejects wrong-length fields', () => {
    expect(() =>
      buildAttestation({
        network: 'chipnet', challengeId: challengeId.slice(1), escrowTxid: txid, escrowVout: 0,
        specHash, verdict: 'PASS', answerHash,
      }),
    ).toThrow(/challengeId/);
  });

  it('signs a 64-byte Schnorr datasig over sha256(message) that verifies', () => {
    const m = sample('PASS');
    const sig = signAttestation(m, verifier.priv);
    expect(sig.length).toBe(64);
    expect(verifyAttestation(m, sig, verifier.pk)).toBe(true);
    const flipped = m.slice();
    flipped[123] = 0x02;
    expect(verifyAttestation(flipped, sig, verifier.pk)).toBe(false);
    expect(secp256k1.verifySignatureSchnorr(sig, verifier.pk, sha256.hash(m))).toBe(true);
    expect(hexToBin(binToHex(sig)).length).toBe(64);
  });
});
