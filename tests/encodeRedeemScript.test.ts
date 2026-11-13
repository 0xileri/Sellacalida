// Gate from spec section 3.1: the TS encoder must match the CashScript 0.14 SDK byte-for-byte.
import { describe, expect, it } from 'vitest';
import { binToHex, hash256, sha256, utf8ToBin } from '@bitauth/libauth';
import { MockNetworkProvider } from 'cashscript';
import {
  ESCROW_ARG_ORDER,
  buildEscrowRedeemScript,
  encodeEscrowConstructorArgs,
  escrowBody,
  escrowLockingBytecode,
  type EscrowArgs,
} from '@/lib/encodeRedeemScript';
import { escrowArtifact, makeEscrowContract } from '@/lib/contracts';
import { agent, challenger, verifier, CATEGORY } from './helpers';
import { toContractCategory } from '@/lib/tokenCategory';

const provider = new MockNetworkProvider();

function args(o: Partial<EscrowArgs> = {}): EscrowArgs {
  return {
    agentPkh: agent.pkh,
    challengerPkh: challenger.pkh,
    verifierPk: verifier.pk,
    bondAmount: 100n,
    feeAmount: 20n,
    tokenCategory: toContractCategory(CATEGORY),
    networkId: Uint8Array.of(0x01),
    challengeId: sha256.hash(utf8ToBin('id')),
    specHash: sha256.hash(utf8ToBin('spec')),
    expiryHeight: 300_000n,
    verifierGraceBlocks: 18n,
    ...o,
  };
}

describe('escrow redeem script encoder vs CashScript 0.14 SDK', () => {
  it('arg order matches the compiled artifact', () => {
    expect(escrowArtifact.constructorInputs.map((i) => i.name)).toEqual([...ESCROW_ARG_ORDER]);
  });

  it('escrowBody is the artifact bytecode without constructor args', () => {
    const sdk = makeEscrowContract(args(), provider);
    const full = sdk.bytecode;
    expect(full.endsWith(binToHex(escrowBody()))).toBe(true);
    expect(full.length).toBe(binToHex(encodeEscrowConstructorArgs(args())).length + binToHex(escrowBody()).length);
  });

  // Exercise every push-encoding branch: OP_1..OP_16, 1-byte, sign-bit 2-byte, 3/4/5-byte ints,
  // and all three networkId encodings (0x00 needs a real 1-byte push, 0x01/0x02 become OP_1/OP_2).
  const ints = [1n, 2n, 15n, 16n, 17n, 100n, 127n, 128n, 255n, 256n, 32_767n, 32_768n, 8_388_607n, 8_388_608n, 2_147_483_648n, 99_999_999_999n];
  const cases: [string, Partial<EscrowArgs>][] = [];
  for (const v of ints) cases.push([`bond=${v}`, { bondAmount: v }]);
  for (const v of ints) cases.push([`fee=${v}`, { feeAmount: v }]);
  for (const v of [19n, 127n, 128n, 300_000n, 950_123n, 499_999_999n]) cases.push([`expiry=${v}`, { expiryHeight: v }]);
  for (const v of [18n, 127n, 128n, 1000n]) cases.push([`grace=${v}`, { verifierGraceBlocks: v }]);
  for (const n of [0x00, 0x01, 0x02]) cases.push([`network=${n}`, { networkId: Uint8Array.of(n) }]);

  it.each(cases)('%s: hash256(encode(args) || body) == SDK redeem script', (_label, o) => {
    const a = args(o);
    const sdk = makeEscrowContract(a, provider);
    const ours = buildEscrowRedeemScript(a);
    expect(binToHex(ours)).toBe(sdk.bytecode);
    expect(binToHex(hash256(ours))).toBe(binToHex(hash256(Uint8Array.from(Buffer.from(sdk.bytecode, 'hex')))));
    expect(binToHex(escrowLockingBytecode(a))).toBe(sdk.lockingBytecode);
  });

  it('networkId 0x00 is a 1-byte push, not OP_0', () => {
    const enc = binToHex(encodeEscrowConstructorArgs(args({ networkId: Uint8Array.of(0) })));
    expect(enc).toContain('20' + binToHex(toContractCategory(CATEGORY)));
    expect(enc).toContain('0100' + '20' + binToHex(toContractCategory(CATEGORY)));
  });

  it('rejects wrong-length byte args', () => {
    expect(() => encodeEscrowConstructorArgs(args({ agentPkh: agent.pkh.slice(1) }))).toThrow(/agentPkh/);
    expect(() => encodeEscrowConstructorArgs(args({ tokenCategory: new Uint8Array(33) }))).toThrow(/tokenCategory/);
  });
});
