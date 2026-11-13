// Mocknet tests for SellacalidaEscrow (spec section 3.2, section 4, and the "Escrow" block of section 9).
import { describe, expect, it } from 'vitest';
import { binToHex, flattenBinArray, hexToBin, secp256k1, sha256, utf8ToBin } from '@bitauth/libauth';
import type { MockNetworkProvider, TransactionBuilder } from 'cashscript';
import { buildAccept, buildSettle, buildTimeout, type SettleInput } from '@/lib/bch/transactions';
import { ATTEST_OFFSETS, buildAttestation, sha256Utf8, signAttestation, type AttestationFields } from '@/lib/attestation';
import { escrowArgsFor, makeEscrowContract } from '@/lib/contracts';
import type { Verdict } from '@/lib/constants';
import {
  START_HEIGHT, addUtxo, agent, baseOffer, baseTerms, challenger, feeWallet, fundedEscrow, fundedOffer,
  newProvider, stranger, verifier,
} from './helpers';

const ANSWER = sha256Utf8('42');
const offer = baseOffer();
const terms = baseTerms();
const EXPIRY = Number(terms.expiryHeight); // START + 100
const ANSWER_DEADLINE = EXPIRY - Number(offer.verifierGraceBlocks); // START + 82

type Escrow = ReturnType<typeof fundedEscrow>;

function message(e: Escrow, verdict: Verdict, o: Partial<AttestationFields> = {}) {
  return buildAttestation({
    network: 'mocknet',
    challengeId: e.terms.challengeId,
    escrowTxid: e.escrowUtxo.txid,
    escrowVout: e.escrowUtxo.vout,
    specHash: e.terms.specHash,
    verdict,
    answerHash: verdict === 'NORESPONSE' ? undefined : ANSWER,
    ...o,
  });
}

function settleWith(
  provider: MockNetworkProvider,
  e: Escrow,
  msg: Uint8Array,
  winnerPkh: Uint8Array,
  o: Partial<SettleInput> = {},
) {
  return buildSettle({
    provider,
    escrowContract: e.escrowContract,
    escrowUtxo: e.escrowUtxo,
    escrowArgs: e.escrowArgs,
    tokenCategory: e.offer.tokenCategory,
    winnerPkh,
    message: msg,
    ...o,
    signature: o.signature ?? signAttestation(msg, verifier.priv),
  });
}

/** Overwrite bytes of a message and re-sign with the real verifier key (so only the parse can catch it). */
function patched(msg: Uint8Array, offset: number, bytes: Uint8Array): Uint8Array {
  const m = msg.slice();
  m.set(bytes, offset);
  return m;
}

async function expectRequire(b: TransactionBuilder, statement: string) {
  await expect(b.send()).rejects.toThrow(statement);
}

async function tokenAt(provider: MockNetworkProvider, lock: Uint8Array) {
  const utxos = await provider.getUtxosForLockingBytecode(lock);
  return utxos.filter((u) => u.token).map((u) => u.token!.amount).reduce((a, b) => a + b, 0n);
}

// ---------------------------------------------------------------------------------------------
// settle: payouts
// ---------------------------------------------------------------------------------------------

describe('SellacalidaEscrow.settle: payouts', () => {
  it('PASS pays only the agent bond + fee (1-output shape)', async () => {
    const provider = newProvider();
    const e = fundedEscrow(provider, offer, terms);
    const b = settleWith(provider, e, message(e, 'PASS'), agent.pkh);
    expect(b.outputs.length).toBe(1);
    await b.send();
    expect(await tokenAt(provider, agent.lock)).toBe(120n);
    expect(await tokenAt(provider, challenger.lock)).toBe(0n);
  });

  it('FAIL pays only the challenger bond + fee', async () => {
    const provider = newProvider();
    const e = fundedEscrow(provider, offer, terms);
    await settleWith(provider, e, message(e, 'FAIL'), challenger.pkh).send();
    expect(await tokenAt(provider, challenger.lock)).toBe(120n);
    expect(await tokenAt(provider, agent.lock)).toBe(0n);
  });

  it('NORESPONSE pays only the challenger, at the answer deadline', async () => {
    const provider = newProvider(ANSWER_DEADLINE);
    const e = fundedEscrow(provider, offer, terms);
    await settleWith(provider, e, message(e, 'NORESPONSE'), challenger.pkh, { locktime: ANSWER_DEADLINE }).send();
    expect(await tokenAt(provider, challenger.lock)).toBe(120n);
  });

  it('2-output shape: server fee input, BCH change to feeLockingBytecode', async () => {
    const provider = newProvider();
    const e = fundedEscrow(provider, offer, terms, 1000n);
    const fee = addUtxo(provider, feeWallet.lockHex, 5000n);
    const b = settleWith(provider, e, message(e, 'PASS'), agent.pkh, {
      feeLockingBytecode: feeWallet.lock,
      bchFeeInput: { utxo: fee, unlocker: feeWallet.template.unlockP2PKH() },
    });
    expect(b.outputs.length).toBe(2);
    await b.send();
    expect(await tokenAt(provider, agent.lock)).toBe(120n);
    const change = await provider.getUtxosForLockingBytecode(feeWallet.lock);
    expect(change.length).toBe(1);
    expect(change[0].token).toBeUndefined();
  });

  it('end to end: accept on the offer, then settle the escrow it created', async () => {
    const provider = newProvider();
    const { offerContract, offerUtxo } = fundedOffer(provider, offer);
    const escrowArgs = escrowArgsFor(offer, terms);
    const tokenUtxo = addUtxo(provider, challenger.lockHex, 10_000n, { category: offer.tokenCategory, amount: 20n });
    const acceptTx = await buildAccept({
      provider, offer, offerContract, offerUtxo, terms, escrowArgs,
      challengerTokenInput: { utxo: tokenUtxo, unlocker: challenger.template.unlockP2PKH() },
      escrowSatoshis: 5000n, locktime: START_HEIGHT,
    }).send();
    const escrowContract = makeEscrowContract(escrowArgs, provider);
    const [escrowUtxo] = await escrowContract.getUtxos();
    expect(escrowUtxo.txid).toBe(acceptTx.txid);
    expect(escrowUtxo.vout).toBe(0);
    const e: Escrow = { offer, terms, escrowArgs, escrowContract, escrowUtxo };
    await settleWith(provider, e, message(e, 'FAIL'), challenger.pkh).send();
    expect(await tokenAt(provider, challenger.lock)).toBe(120n);
  });
});

// ---------------------------------------------------------------------------------------------
// settle: verdict rules
// ---------------------------------------------------------------------------------------------

describe('SellacalidaEscrow.settle: verdict rules', () => {
  const winnerCheck = 'require(tx.outputs[0].lockingBytecode == new LockingBytecodeP2PKH(winnerPkh));';

  it('a PASS cannot pay the challenger', async () => {
    const provider = newProvider();
    const e = fundedEscrow(provider, offer, terms);
    await expectRequire(settleWith(provider, e, message(e, 'PASS'), challenger.pkh), winnerCheck);
  });

  it('a FAIL cannot pay the agent', async () => {
    const provider = newProvider();
    const e = fundedEscrow(provider, offer, terms);
    await expectRequire(settleWith(provider, e, message(e, 'FAIL'), agent.pkh), winnerCheck);
  });

  it('a NORESPONSE cannot pay the agent', async () => {
    const provider = newProvider(ANSWER_DEADLINE);
    const e = fundedEscrow(provider, offer, terms);
    await expectRequire(
      settleWith(provider, e, message(e, 'NORESPONSE'), agent.pkh, { locktime: ANSWER_DEADLINE }),
      winnerCheck,
    );
  });

  it('NORESPONSE fails before the answer deadline', async () => {
    const provider = newProvider();
    const e = fundedEscrow(provider, offer, terms);
    await expectRequire(
      settleWith(provider, e, message(e, 'NORESPONSE'), challenger.pkh, { locktime: ANSWER_DEADLINE - 1 }),
      'require(tx.time >= expiryHeight - verifierGraceBlocks);',
    );
  });

  it('NORESPONSE with a deadline locktime is non-final while the chain is below it', async () => {
    const provider = newProvider(ANSWER_DEADLINE - 1);
    const e = fundedEscrow(provider, offer, terms);
    const b = settleWith(provider, e, message(e, 'NORESPONSE'), challenger.pkh, { locktime: ANSWER_DEADLINE });
    await expect(b.send()).rejects.toThrow(/non-final/);
  });

  it('NORESPONSE with a non-zero answerHash fails', async () => {
    const provider = newProvider(ANSWER_DEADLINE);
    const e = fundedEscrow(provider, offer, terms);
    const m = patched(message(e, 'PASS'), ATTEST_OFFSETS.verdict, Uint8Array.of(0x03));
    await expectRequire(
      settleWith(provider, e, m, challenger.pkh, { locktime: ANSWER_DEADLINE }),
      'require(answerHashB == 0x0000000000000000000000000000000000000000000000000000000000000000);',
    );
  });

  it.each([0x00, 0x04, 0xff])('verdict byte 0x%s fails', async (v) => {
    const provider = newProvider(EXPIRY);
    const e = fundedEscrow(provider, offer, terms);
    const m = patched(message(e, 'FAIL'), ATTEST_OFFSETS.verdict, Uint8Array.of(v));
    await expectRequire(settleWith(provider, e, m, challenger.pkh, { locktime: EXPIRY }), 'require(verdictB == 0x03);');
  });
});

// ---------------------------------------------------------------------------------------------
// settle: attestation binding and parse
// ---------------------------------------------------------------------------------------------

describe('SellacalidaEscrow.settle: attestation binding', () => {
  it('a verdict for challenge A cannot settle escrow B', async () => {
    const provider = newProvider();
    const a = fundedEscrow(provider, offer, terms);
    const b = fundedEscrow(provider, offer, baseTerms({ challengeId: sha256.hash(utf8ToBin('challenge-2')) }));
    const msgForA = message(a, 'PASS');
    await expectRequire(settleWith(provider, b, msgForA, agent.pkh), 'require(challengeIdB == challengeId);');
  });

  it('a verdict for outpoint A cannot settle another UTXO of the same escrow (txid)', async () => {
    const provider = newProvider();
    const a = fundedEscrow(provider, offer, terms);
    const b = fundedEscrow(provider, offer, terms); // same address, different txid
    await expectRequire(
      settleWith(provider, b, message(a, 'PASS'), agent.pkh),
      'require(outpointTxidB == tx.inputs[this.activeInputIndex].outpointTransactionHash);',
    );
  });

  it('a verdict for vout 0 cannot settle vout 1 of the same txid', async () => {
    const provider = newProvider();
    const a = fundedEscrow(provider, offer, terms, 5000n, 0);
    const b = fundedEscrow(provider, offer, terms, 5000n, 1);
    const sameTxid = { ...b, escrowUtxo: { ...b.escrowUtxo, txid: a.escrowUtxo.txid } };
    // register vout 1 under a's txid
    provider.addUtxo(b.escrowContract.lockingBytecode, { ...sameTxid.escrowUtxo });
    await expectRequire(
      settleWith(provider, sameTxid, message(a, 'PASS'), agent.pkh),
      'require(outpointIndexB == toPaddedBytes(tx.inputs[this.activeInputIndex].outpointIndex, 4));',
    );
  });

  it('outpoint txid must be in VM order: an explorer-order (flipped) txid fails', async () => {
    const provider = newProvider();
    const e = fundedEscrow(provider, offer, terms);
    const m = patched(message(e, 'PASS'), ATTEST_OFFSETS.outpointTxid, hexToBin(e.escrowUtxo.txid));
    await expectRequire(
      settleWith(provider, e, m, agent.pkh),
      'require(outpointTxidB == tx.inputs[this.activeInputIndex].outpointTransactionHash);',
    );
  });

  it('outpoint index is 4-byte little-endian: vout 258 settles, big-endian bytes fail', async () => {
    const provider = newProvider();
    const e = fundedEscrow(provider, offer, terms, 5000n, 258);
    const good = message(e, 'PASS');
    expect(binToHex(good.slice(ATTEST_OFFSETS.outpointIndex, ATTEST_OFFSETS.specHash))).toBe('02010000');
    const be = patched(good, ATTEST_OFFSETS.outpointIndex, hexToBin('00000102'));
    await expectRequire(
      settleWith(provider, e, be, agent.pkh),
      'require(outpointIndexB == toPaddedBytes(tx.inputs[this.activeInputIndex].outpointIndex, 4));',
    );
    await settleWith(provider, e, good, agent.pkh).send();
  });

  it('wrong networkId fails (chipnet verdict against a mocknet escrow)', async () => {
    const provider = newProvider();
    const e = fundedEscrow(provider, offer, terms);
    await expectRequire(
      settleWith(provider, e, message(e, 'PASS', { network: 'chipnet' }), agent.pkh),
      'require(networkIdB == networkId);',
    );
  });

  it('wrong specHash fails', async () => {
    const provider = newProvider();
    const e = fundedEscrow(provider, offer, terms);
    const m = message(e, 'PASS', { specHash: sha256.hash(utf8ToBin('another spec')) });
    await expectRequire(settleWith(provider, e, m, agent.pkh), 'require(specHashB == specHash);');
  });

  it('a wrong prefix fails', async () => {
    const provider = newProvider();
    const e = fundedEscrow(provider, offer, terms);
    const m = patched(message(e, 'PASS'), 0, utf8ToBin('SELLACALIDA-ATTEST-v2:'));
    await expectRequire(settleWith(provider, e, m, agent.pkh), "require(prefix == bytes('SELLACALIDA-ATTEST-v1:'));");
  });

  it.each([155, 157])('a %i-byte message fails the length check', async (len) => {
    const provider = newProvider();
    const e = fundedEscrow(provider, offer, terms);
    const full = message(e, 'PASS');
    const m = len < 156 ? full.slice(0, len) : flattenBinArray([full, Uint8Array.of(0)]);
    // the TS signer refuses non-156-byte messages, so sign directly to reach the contract check
    const sig = secp256k1.signMessageHashSchnorr(verifier.priv, sha256.hash(m)) as Uint8Array;
    await expectRequire(settleWith(provider, e, m, agent.pkh, { signature: sig }), 'require(message.length == 156);');
  });

  it('a shifted field fails the parse (21-byte prefix without the colon, padded to 156)', async () => {
    const provider = newProvider();
    const e = fundedEscrow(provider, offer, terms);
    const full = message(e, 'PASS');
    const shifted = flattenBinArray([utf8ToBin('SELLACALIDA-ATTEST-v1'), full.slice(22), Uint8Array.of(0)]);
    expect(shifted.length).toBe(156);
    await expectRequire(settleWith(provider, e, shifted, agent.pkh), "require(prefix == bytes('SELLACALIDA-ATTEST-v1:'));");
  });

  it('a field shifted right by one byte after the prefix fails the parse', async () => {
    const provider = newProvider();
    const e = fundedEscrow(provider, offer, terms);
    const full = message(e, 'PASS');
    const shifted = flattenBinArray([full.slice(0, 22), Uint8Array.of(0x00), full.slice(22, 155)]);
    expect(shifted.length).toBe(156);
    await expectRequire(settleWith(provider, e, shifted, agent.pkh), 'require(networkIdB == networkId);');
  });

  it('an answerHash changed after signing fails checkDataSig', async () => {
    const provider = newProvider();
    const e = fundedEscrow(provider, offer, terms);
    const m = message(e, 'PASS');
    const sig = signAttestation(m, verifier.priv);
    const tampered = patched(m, ATTEST_OFFSETS.answerHash, sha256Utf8('43'));
    const b = settleWith(provider, e, tampered, agent.pkh, { signature: sig });
    await expectRequire(b, 'require(checkDataSig(verifierSig, message, verifierPk));');
  });

  it('a signature from any key other than verifierPk fails', async () => {
    const provider = newProvider();
    const e = fundedEscrow(provider, offer, terms);
    const m = message(e, 'PASS');
    const b = settleWith(provider, e, m, agent.pkh, { signature: signAttestation(m, stranger.priv) });
    await expectRequire(b, 'require(checkDataSig(verifierSig, message, verifierPk));');
  });
});

// ---------------------------------------------------------------------------------------------
// settle: input / output tables
// ---------------------------------------------------------------------------------------------

describe('SellacalidaEscrow.settle: input and output tables', () => {
  it('rejects an extra token output (bond + fee split)', async () => {
    const provider = newProvider();
    const e = fundedEscrow(provider, offer, terms);
    const b = settleWith(provider, e, message(e, 'PASS'), agent.pkh, {
      tamper: (t) => {
        t.outputs[0].token = { category: offer.tokenCategory, amount: 119n };
        t.outputs[0].amount -= 1000n;
        t.addOutput({ to: stranger.lock, amount: 1000n, token: { category: offer.tokenCategory, amount: 1n } });
      },
    });
    await expectRequire(b, 'require(tx.outputs[0].tokenAmount == totalAmount);');
  });

  it('rejects a token-bearing output 1 even with a matching feeLockingBytecode', async () => {
    const provider = newProvider();
    const e = fundedEscrow(provider, offer, terms);
    const fee = addUtxo(provider, feeWallet.lockHex, 5000n, { category: offer.tokenCategory, amount: 3n });
    const b = settleWith(provider, e, message(e, 'PASS'), agent.pkh, {
      feeLockingBytecode: feeWallet.lock,
      bchFeeInput: { utxo: fee, unlocker: feeWallet.template.unlockP2PKH() },
      builderOptions: { allowImplicitFungibleTokenBurn: true },
    });
    await expectRequire(b, 'require(tx.inputs[1].tokenCategory == 0x);');
  });

  it('rejects three outputs', async () => {
    const provider = newProvider();
    const e = fundedEscrow(provider, offer, terms);
    const fee = addUtxo(provider, feeWallet.lockHex, 5000n);
    const b = settleWith(provider, e, message(e, 'PASS'), agent.pkh, {
      feeLockingBytecode: feeWallet.lock,
      bchFeeInput: { utxo: fee, unlocker: feeWallet.template.unlockP2PKH() },
      tamper: (t) => { t.outputs[1].amount -= 1000n; t.addOutput({ to: stranger.lock, amount: 1000n }); },
    });
    await expectRequire(b, 'require(tx.outputs.length == 1 || tx.outputs.length == 2);');
  });

  it('rejects output 1 that differs from the feeLockingBytecode argument', async () => {
    const provider = newProvider();
    const e = fundedEscrow(provider, offer, terms);
    const fee = addUtxo(provider, feeWallet.lockHex, 5000n);
    const b = settleWith(provider, e, message(e, 'PASS'), agent.pkh, {
      feeLockingBytecode: feeWallet.lock,
      bchFeeInput: { utxo: fee, unlocker: feeWallet.template.unlockP2PKH() },
      tamper: (t) => { t.outputs[1].to = stranger.lock; },
    });
    await expectRequire(b, 'require(tx.outputs[1].lockingBytecode == feeLockingBytecode);');
  });

  it('rejects output 1 under MIN_OUTPUT_SATS', async () => {
    const provider = newProvider();
    const e = fundedEscrow(provider, offer, terms);
    const fee = addUtxo(provider, feeWallet.lockHex, 5000n);
    const b = settleWith(provider, e, message(e, 'PASS'), agent.pkh, {
      feeLockingBytecode: feeWallet.lock,
      bchFeeInput: { utxo: fee, unlocker: feeWallet.template.unlockP2PKH() },
      tamper: (t) => { t.outputs[1].amount = 999n; },
    });
    await expectRequire(b, 'require(tx.outputs[1].value >= MIN_OUTPUT_SATS);');
  });

  it('rejects output 0 under MIN_OUTPUT_SATS', async () => {
    const provider = newProvider();
    const e = fundedEscrow(provider, offer, terms);
    const b = settleWith(provider, e, message(e, 'PASS'), agent.pkh, { tamper: (t) => { t.outputs[0].amount = 999n; } });
    await expectRequire(b, 'require(tx.outputs[0].value >= MIN_OUTPUT_SATS);');
  });

  it('rejects three inputs', async () => {
    const provider = newProvider();
    const e = fundedEscrow(provider, offer, terms);
    const f1 = addUtxo(provider, feeWallet.lockHex, 5000n);
    const f2 = addUtxo(provider, feeWallet.lockHex, 5000n);
    const b = settleWith(provider, e, message(e, 'PASS'), agent.pkh, {
      feeLockingBytecode: feeWallet.lock,
      bchFeeInput: { utxo: f1, unlocker: feeWallet.template.unlockP2PKH() },
      tamper: (t) => { t.addInput(f2, feeWallet.template.unlockP2PKH()); },
    });
    await expectRequire(b, 'require(tx.inputs.length == 1 || tx.inputs.length == 2);');
  });

  it('rejects the escrow at an input index other than 0', async () => {
    const provider = newProvider();
    const e = fundedEscrow(provider, offer, terms);
    const fee = addUtxo(provider, feeWallet.lockHex, 5000n);
    const b = settleWith(provider, e, message(e, 'PASS'), agent.pkh, {
      feeLockingBytecode: feeWallet.lock,
      bchFeeInput: { utxo: fee, unlocker: feeWallet.template.unlockP2PKH() },
      tamper: (t) => { t.inputs.reverse(); },
    });
    await expectRequire(b, 'require(this.activeInputIndex == 0);');
  });

  it('after settle the UTXO is gone, so timeout cannot also run', async () => {
    const provider = newProvider(EXPIRY);
    const e = fundedEscrow(provider, offer, terms);
    await settleWith(provider, e, message(e, 'PASS'), agent.pkh).send();
    const t = buildTimeout({
      provider, escrowContract: e.escrowContract, escrowUtxo: e.escrowUtxo, escrowArgs: e.escrowArgs,
      tokenCategory: offer.tokenCategory, locktime: EXPIRY,
    });
    await expect(t.send()).rejects.toThrow();
    expect(await e.escrowContract.getUtxos()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------------------------
// timeout
// ---------------------------------------------------------------------------------------------

describe('SellacalidaEscrow.timeout', () => {
  function timeoutFor(provider: MockNetworkProvider, e: Escrow, o: Partial<Parameters<typeof buildTimeout>[0]> = {}) {
    return buildTimeout({
      provider, escrowContract: e.escrowContract, escrowUtxo: e.escrowUtxo, escrowArgs: e.escrowArgs,
      tokenCategory: e.offer.tokenCategory, locktime: EXPIRY, ...o,
    });
  }

  it('at expiryHeight refunds bond to the agent and fee to the challenger', async () => {
    const provider = newProvider(EXPIRY);
    const e = fundedEscrow(provider, offer, terms);
    const b = timeoutFor(provider, e);
    expect(b.outputs.length).toBe(2);
    await b.send();
    expect(await tokenAt(provider, agent.lock)).toBe(100n);
    expect(await tokenAt(provider, challenger.lock)).toBe(20n);
  });

  it('3-output shape with a broadcaster fee input', async () => {
    const provider = newProvider(EXPIRY + 50);
    const e = fundedEscrow(provider, offer, terms, 2000n);
    const fee = addUtxo(provider, feeWallet.lockHex, 5000n);
    const b = timeoutFor(provider, e, {
      locktime: EXPIRY + 50,
      feeLockingBytecode: feeWallet.lock,
      bchFeeInput: { utxo: fee, unlocker: feeWallet.template.unlockP2PKH() },
    });
    expect(b.outputs.length).toBe(3);
    await b.send();
    expect(await tokenAt(provider, agent.lock)).toBe(100n);
    expect(await tokenAt(provider, challenger.lock)).toBe(20n);
  });

  it('fails before expiryHeight', async () => {
    const provider = newProvider(EXPIRY);
    const e = fundedEscrow(provider, offer, terms);
    await expectRequire(timeoutFor(provider, e, { locktime: EXPIRY - 1 }), 'require(tx.time >= expiryHeight);');
  });

  it('a high locktime does not help while the chain is below expiryHeight (non-final)', async () => {
    const provider = newProvider(EXPIRY - 1);
    const e = fundedEscrow(provider, offer, terms);
    await expect(timeoutFor(provider, e).send()).rejects.toThrow(/non-final/);
  });

  it('a final sequence number disables locktime, so CLTV rejects it', async () => {
    const provider = newProvider(EXPIRY);
    const e = fundedEscrow(provider, offer, terms);
    const b = timeoutFor(provider, e, { tamper: (t) => { t.inputs[0].options = { sequence: 0xffffffff }; } });
    await expect(b.send()).rejects.toThrow();
  });

  it('fails with the refund outputs reordered', async () => {
    const provider = newProvider(EXPIRY);
    const e = fundedEscrow(provider, offer, terms);
    const b = timeoutFor(provider, e, { tamper: (t) => { t.outputs.reverse(); } });
    await expectRequire(b, 'require(tx.outputs[0].lockingBytecode == new LockingBytecodeP2PKH(agentPkh));');
  });

  it('fails with the refund amounts swapped', async () => {
    const provider = newProvider(EXPIRY);
    const e = fundedEscrow(provider, offer, terms);
    const b = timeoutFor(provider, e, {
      tamper: (t) => {
        t.outputs[0].token = { category: offer.tokenCategory, amount: 20n };
        t.outputs[1].token = { category: offer.tokenCategory, amount: 100n };
      },
    });
    await expectRequire(b, 'require(tx.outputs[0].tokenAmount == bondAmount);');
  });

  it('fails with an extra token output', async () => {
    const provider = newProvider(EXPIRY);
    const e = fundedEscrow(provider, offer, terms);
    const b = timeoutFor(provider, e, {
      tamper: (t) => {
        t.outputs[1].token = { category: offer.tokenCategory, amount: 19n };
        t.outputs[0].amount -= 1000n;
        t.addOutput({ to: stranger.lock, amount: 1000n, token: { category: offer.tokenCategory, amount: 1n } });
      },
    });
    await expectRequire(b, 'require(tx.outputs[1].tokenAmount == feeAmount);');
  });

  it('fails with a token-free third output that is not feeLockingBytecode', async () => {
    const provider = newProvider(EXPIRY);
    const e = fundedEscrow(provider, offer, terms, 2000n);
    const fee = addUtxo(provider, feeWallet.lockHex, 5000n);
    const b = timeoutFor(provider, e, {
      feeLockingBytecode: feeWallet.lock,
      bchFeeInput: { utxo: fee, unlocker: feeWallet.template.unlockP2PKH() },
      tamper: (t) => { t.outputs[2].to = stranger.lock; },
    });
    await expectRequire(b, 'require(tx.outputs[2].lockingBytecode == feeLockingBytecode);');
  });

  it('fails with only one output', async () => {
    const provider = newProvider(EXPIRY);
    const e = fundedEscrow(provider, offer, terms);
    const b = timeoutFor(provider, e, {
      builderOptions: { allowImplicitFungibleTokenBurn: true },
      tamper: (t) => { t.outputs.pop(); },
    });
    await expectRequire(b, 'require(tx.outputs.length == 2 || tx.outputs.length == 3);');
  });

  it('fails if a refund output is under MIN_OUTPUT_SATS', async () => {
    const provider = newProvider(EXPIRY);
    const e = fundedEscrow(provider, offer, terms);
    const b = timeoutFor(provider, e, { tamper: (t) => { t.outputs[1].amount = 999n; } });
    await expectRequire(b, 'require(tx.outputs[1].value >= MIN_OUTPUT_SATS);');
  });
});
