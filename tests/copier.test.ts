// settle() and timeout() carry no signature, so anyone who sees one in the mempool can rebuild it.
// These tests act as that copier and check the escrow's BCH cannot be redirected (spec section 3.2,
// tightened: the winner / refunds keep the escrow's sats, minus at most MAX_FEE_SATS of miner fee).
import { describe, expect, it } from 'vitest';
import { TransactionBuilder } from 'cashscript';
import { buildAttestation, sha256Utf8, signAttestation } from '@/lib/attestation';
import { buildSettle, buildTimeout } from '@/lib/bch/transactions';
import { MAX_FEE_SATS, MIN_OUTPUT_SATS } from '@/lib/constants';
import { addUtxo, agent, baseOffer, baseTerms, challenger, feeWallet, fundedEscrow, newProvider, stranger, verifier } from './helpers';

const offer = baseOffer();
const terms = baseTerms();
const EXPIRY = Number(terms.expiryHeight);
const ESCROW = 5000n;
const total = { category: offer.tokenCategory, amount: offer.bondAmount + offer.feeAmount };

function passVerdict(e: ReturnType<typeof fundedEscrow>) {
  const message = buildAttestation({
    network: 'mocknet', challengeId: e.terms.challengeId, escrowTxid: e.escrowUtxo.txid, escrowVout: 0,
    specHash: e.terms.specHash, verdict: 'PASS', answerHash: sha256Utf8('42'),
  });
  return { message, signature: signAttestation(message, verifier.priv) };
}

describe('settle: a copier cannot take the escrow BCH', () => {
  it('rebuilding a settle with a second output to themselves fails (no input of their own)', async () => {
    const provider = newProvider();
    const e = fundedEscrow(provider, offer, terms, ESCROW);
    const { message, signature } = passVerdict(e);
    const b = new TransactionBuilder({ provider });
    b.addInput(e.escrowUtxo, e.escrowContract.unlock.settle(signature, message, stranger.lock));
    b.addOutput({ to: agent.lock, amount: MIN_OUTPUT_SATS, token: total });
    b.addOutput({ to: stranger.lock, amount: ESCROW - MIN_OUTPUT_SATS - 1200n });
    await expect(b.send()).rejects.toThrow('require(tx.outputs[0].value >= tx.inputs[0].value);');
  });

  it('adding their own input does not let them shrink the winner output either', async () => {
    const provider = newProvider();
    const e = fundedEscrow(provider, offer, terms, ESCROW);
    const theirs = addUtxo(provider, stranger.lockHex, 5000n);
    const { message, signature } = passVerdict(e);
    const b = new TransactionBuilder({ provider });
    b.addInput(e.escrowUtxo, e.escrowContract.unlock.settle(signature, message, stranger.lock));
    b.addInput(theirs, stranger.template.unlockP2PKH());
    b.addOutput({ to: agent.lock, amount: MIN_OUTPUT_SATS, token: total });
    b.addOutput({ to: stranger.lock, amount: ESCROW + 5000n - MIN_OUTPUT_SATS - 1500n });
    await expect(b.send()).rejects.toThrow('require(tx.outputs[0].value >= tx.inputs[0].value);');
  });

  it('a single-output settle may not burn more than MAX_FEE_SATS to miners', async () => {
    const provider = newProvider();
    const e = fundedEscrow(provider, offer, terms, ESCROW);
    const b = buildSettle({
      provider, escrowContract: e.escrowContract, escrowUtxo: e.escrowUtxo, escrowArgs: e.escrowArgs,
      tokenCategory: offer.tokenCategory, winnerPkh: agent.pkh, ...passVerdict(e),
      tamper: (t) => { t.outputs[0].amount = ESCROW - MAX_FEE_SATS - 1n; },
    });
    await expect(b.send()).rejects.toThrow('require(tx.outputs[0].value >= tx.inputs[0].value - MAX_FEE_SATS);');
  });

  it('a single-output settle paying exactly MAX_FEE_SATS is fine', async () => {
    const provider = newProvider();
    const e = fundedEscrow(provider, offer, terms, ESCROW);
    const b = buildSettle({
      provider, escrowContract: e.escrowContract, escrowUtxo: e.escrowUtxo, escrowArgs: e.escrowArgs,
      tokenCategory: offer.tokenCategory, winnerPkh: agent.pkh, ...passVerdict(e),
      tamper: (t) => { t.outputs[0].amount = ESCROW - MAX_FEE_SATS; },
    });
    await b.send();
  });

  it('the honest fee-payer shape leaves every escrow sat with the winner', async () => {
    const provider = newProvider();
    const e = fundedEscrow(provider, offer, terms, ESCROW);
    const fee = addUtxo(provider, feeWallet.lockHex, 5000n);
    const b = buildSettle({
      provider, escrowContract: e.escrowContract, escrowUtxo: e.escrowUtxo, escrowArgs: e.escrowArgs,
      tokenCategory: offer.tokenCategory, winnerPkh: agent.pkh, ...passVerdict(e),
      feeLockingBytecode: feeWallet.lock,
      bchFeeInput: { utxo: fee, unlocker: feeWallet.template.unlockP2PKH() },
    });
    expect(b.outputs[0].amount).toBe(ESCROW);
    await b.send();
  });
});

describe('timeout: a broadcaster cannot take the escrow BCH', () => {
  it('refunds that leave escrow sats for a third output fail', async () => {
    const provider = newProvider(EXPIRY);
    const e = fundedEscrow(provider, offer, terms, ESCROW);
    const theirs = addUtxo(provider, stranger.lockHex, 5000n);
    const b = new TransactionBuilder({ provider });
    b.addInput(e.escrowUtxo, e.escrowContract.unlock.timeout(stranger.lock));
    b.addInput(theirs, stranger.template.unlockP2PKH());
    b.addOutput({ to: agent.lock, amount: MIN_OUTPUT_SATS, token: { category: offer.tokenCategory, amount: offer.bondAmount } });
    b.addOutput({ to: challenger.lock, amount: MIN_OUTPUT_SATS, token: { category: offer.tokenCategory, amount: offer.feeAmount } });
    b.addOutput({ to: stranger.lock, amount: ESCROW + 5000n - 2n * MIN_OUTPUT_SATS - 1500n });
    b.setLocktime(EXPIRY);
    await expect(b.send()).rejects.toThrow('require(refunded >= tx.inputs[0].value);');
  });

  it('a two-output timeout may not burn more than MAX_FEE_SATS to miners', async () => {
    const provider = newProvider(EXPIRY);
    const e = fundedEscrow(provider, offer, terms, ESCROW);
    const b = buildTimeout({
      provider, escrowContract: e.escrowContract, escrowUtxo: e.escrowUtxo, escrowArgs: e.escrowArgs,
      tokenCategory: offer.tokenCategory, locktime: EXPIRY,
      tamper: (t) => { t.outputs[0].amount = ESCROW - MIN_OUTPUT_SATS - MAX_FEE_SATS - 1n; },
    });
    await expect(b.send()).rejects.toThrow('require(refunded >= tx.inputs[0].value - MAX_FEE_SATS);');
  });

  it('the honest broadcaster shape refunds every escrow sat', async () => {
    const provider = newProvider(EXPIRY);
    const e = fundedEscrow(provider, offer, terms, ESCROW);
    const fee = addUtxo(provider, feeWallet.lockHex, 5000n);
    const b = buildTimeout({
      provider, escrowContract: e.escrowContract, escrowUtxo: e.escrowUtxo, escrowArgs: e.escrowArgs,
      tokenCategory: offer.tokenCategory, locktime: EXPIRY,
      feeLockingBytecode: feeWallet.lock,
      bchFeeInput: { utxo: fee, unlocker: feeWallet.template.unlockP2PKH() },
    });
    expect(b.outputs[0].amount + b.outputs[1].amount).toBe(ESCROW);
    await b.send();
  });
});
