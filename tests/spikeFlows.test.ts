// The /connect spike flows, signed by a mock WizardConnect wallet (tests/mockWallet.ts) and
// validated by the mocknet VM: wallet -> P2SH32 token send, placeholder cancel, accept with token
// change, BCH tip, and a keyless timeout.
import { describe, expect, it } from 'vitest';
import { binToHex, decodeTransaction, encodeTransaction, hash160, hexToBin, sha256, utf8ToBin, type TransactionCommon } from '@bitauth/libauth';
import type { MockNetworkProvider } from 'cashscript';
import { pkhToCashAddress, withNetworkPrefix } from '@/lib/bch/address';
import { makeEscrowContract, makeOfferContract, escrowArgsFor } from '@/lib/contracts';
import {
  buildAcceptFromWallet, buildBchTip, buildCancelWithPlaceholders, buildFundOffer, buildKeylessTimeout,
  SPIKE_OFFER_SATS,
} from '@/lib/wallet/spikeFlows';
import { relaySignRequest, signWithWallet, type WalletAddress, type WalletUtxo } from '@/lib/wallet/wizard';
import { parseExtendedJson } from '@wizardconnect/core';
import { p2pkhLockingBytecode } from '@/lib/bch/transactions';
import { mockWalletSign } from './mockWallet';
import { CATEGORY, START_HEIGHT, addUtxo, baseOffer, newProvider, party, stranger, verifier, type Party } from './helpers';

const keys: Record<string, Party> = {
  'receive/0': party('wallet-r0'),
  'receive/1': party('wallet-r1'),
  'change/0': party('wallet-c0'),
};

function walletAddress(path: 'receive' | 'change', index: number): WalletAddress {
  const p = keys[`${path}/${index}`];
  return {
    path, index, pubkey: p.pk, pkh: hash160(p.pk), lock: p.lock,
    address: pkhToCashAddress(p.pkh, 'mocknet'), tokenAddress: pkhToCashAddress(p.pkh, 'mocknet', true),
  };
}

const r0 = walletAddress('receive', 0);
const r1 = walletAddress('receive', 1);
const c0 = walletAddress('change', 0);

async function walletUtxos(provider: MockNetworkProvider): Promise<WalletUtxo[]> {
  const out: WalletUtxo[] = [];
  for (const a of [r0, r1, c0]) {
    for (const u of await provider.getUtxosForLockingBytecode(a.lock)) out.push({ ...u, path: a.path, index: a.index, address: a.address });
  }
  return out;
}

/**
 * The real path a sign request takes: the dapp builds it with signWithWallet, the relay sends it
 * with plain JSON.stringify (as @wizardconnect/core's RelayClient does), and the wallet decodes it
 * with WizardConnect's parseExtendedJson before signing.
 */
const relayWallet = {
  async signTransaction(request: object) {
    const wire = JSON.stringify({ action: 'sign_transaction_request', time: 0, sequence: 1, ...request });
    const decoded = parseExtendedJson(wire) as { transaction: Parameters<typeof mockWalletSign>[0]; inputPaths: [number, string, number][] };
    const signedTransaction = mockWalletSign(decoded.transaction, decoded.inputPaths, (path, index) => keys[`${path}/${index}`].template);
    return { signedTransaction };
  },
} as unknown as Parameters<typeof signWithWallet>[0];

async function signAndSend(provider: MockNetworkProvider, tx: { builder: Parameters<typeof signWithWallet>[1]; walletInputs: Parameters<typeof signWithWallet>[2] }) {
  const signed = await signWithWallet(relayWallet, tx.builder, tx.walletInputs, 'test');
  return provider.sendRawTransaction(signed.signedTransaction);
}

function setup() {
  const provider = newProvider();
  addUtxo(provider, r0.lock.reduce((s, b) => s + b.toString(16).padStart(2, '0'), ''), 2000n, { category: CATEGORY, amount: 1000n });
  addUtxo(provider, binToHex(r0.lock), 20_000n);
  addUtxo(provider, binToHex(r1.lock), 6000n, { category: CATEGORY, amount: 55n });
  addUtxo(provider, binToHex(c0.lock), 20_000n);
  const offer = baseOffer({ agentPkh: r0.pkh, verifierPk: verifier.pk });
  return { provider, offer };
}

describe('wallet spike flows (mock WizardConnect wallet, mocknet VM)', () => {
  it('step 3: wallet sends the bond token + dust BCH into the offer P2SH32', async () => {
    const { provider, offer } = setup();
    const tx = buildFundOffer({ provider, offer, walletUtxos: await walletUtxos(provider), tokenChange: r0, bchChange: c0 });
    expect(tx.walletInputs.length).toBeGreaterThan(0);
    await signAndSend(provider, tx);
    const offerUtxos = await makeOfferContract(offer, provider).getUtxos();
    expect(offerUtxos).toHaveLength(1);
    expect(offerUtxos[0].token).toEqual({ category: CATEGORY, amount: 100n });
    expect(offerUtxos[0].satoshis).toBe(SPIKE_OFFER_SATS);
  });

  it('step 5: cancel fills placeholderSignature / placeholderPublicKey inside the contract input', async () => {
    const { provider, offer } = setup();
    await signAndSend(provider, buildFundOffer({ provider, offer, walletUtxos: await walletUtxos(provider), tokenChange: r0, bchChange: c0 }));
    const [offerUtxo] = await makeOfferContract(offer, provider).getUtxos();
    const tx = buildCancelWithPlaceholders({ provider, offer, offerUtxo, agent: r0 });
    expect(tx.walletInputs).toEqual([{ inputIndex: 0, path: 'receive', index: 0 }]);
    await signAndSend(provider, tx);
    expect(await makeOfferContract(offer, provider).getUtxos()).toHaveLength(0);
  });

  it('a placeholder cancel signed by the wrong wallet key is rejected', async () => {
    const { provider, offer } = setup();
    await signAndSend(provider, buildFundOffer({ provider, offer, walletUtxos: await walletUtxos(provider), tokenChange: r0, bchChange: c0 }));
    const [offerUtxo] = await makeOfferContract(offer, provider).getUtxos();
    const tx = buildCancelWithPlaceholders({ provider, offer, offerUtxo, agent: r1 });
    await expect(signAndSend(provider, tx)).rejects.toThrow();
  });

  it('steps 4 + 6: accept with token change; the contract input is fully unlocked, wallet signs only input 1', async () => {
    const { provider, offer } = setup();
    // agent wallet funds the offer, a challenger at receive/1 (55 tokens) accepts it
    await signAndSend(provider, buildFundOffer({ provider, offer, walletUtxos: await walletUtxos(provider), tokenChange: r0, bchChange: c0 }));
    const [offerUtxo] = await makeOfferContract(offer, provider).getUtxos();
    const tx = buildAcceptFromWallet({
      provider, offer, offerUtxo, challenger: r1, walletUtxos: await walletUtxos(provider), locktime: START_HEIGHT,
      terms: {
        challengeId: sha256.hash(utf8ToBin('spike')), specHash: sha256.hash(utf8ToBin('spec')),
        expiryHeight: BigInt(START_HEIGHT + 100),
      },
    });
    expect(tx.walletInputs[0]).toEqual({ inputIndex: 1, path: 'receive', index: 1 });
    expect(tx.walletInputs.some((w) => w.inputIndex === 0)).toBe(false);
    await signAndSend(provider, tx);
    const escrowUtxos = await makeEscrowContract(escrowArgsFor(offer, tx.terms), provider).getUtxos();
    expect(escrowUtxos[0].token).toEqual({ category: CATEGORY, amount: 120n });
    const change = (await provider.getUtxosForLockingBytecode(r1.lock)).find((u) => u.token);
    expect(change?.token?.amount).toBe(35n);

    // then anyone can refund after expiry with no keys at all
    provider.setBlockHeight(START_HEIGHT + 100);
    await buildKeylessTimeout({ provider, offer, terms: tx.terms, escrowTxid: escrowUtxos[0].txid }).send();
    const agentTokens = (await provider.getUtxosForLockingBytecode(r0.lock)).filter((u) => u.token);
    expect(agentTokens.some((u) => u.token!.amount === 100n)).toBe(true);
  });

  it('native BCH tip: one output to the recipient, change back to the sender', async () => {
    const { provider } = setup();
    const tx = buildBchTip({
      provider, walletUtxos: await walletUtxos(provider), toLockingBytecode: stranger.lock, amount: 5000n, change: c0,
    });
    await signAndSend(provider, tx);
    const got = await provider.getUtxosForLockingBytecode(p2pkhLockingBytecode(stranger.pkh));
    expect(got.map((u) => u.satoshis)).toEqual([5000n]);
  });
});

describe('sign requests survive the WizardConnect relay (17 Nov: "Do not know how to serialize a BigInt")', () => {
  it('the raw CashScript request cannot be sent as JSON; the relay-encoded one round-trips exactly', async () => {
    const { provider, offer } = setup();
    const tx = buildFundOffer({ provider, offer, walletUtxos: await walletUtxos(provider), tokenChange: r0, bchChange: c0 });
    const raw = tx.builder.generateWcTransactionObject({ broadcast: false, userPrompt: 'x' });
    expect(() => JSON.stringify({ transaction: raw })).toThrow(/serialize a BigInt/); // what the page did before
    const request = relaySignRequest(tx.builder, tx.walletInputs, 'x');
    const wire = JSON.stringify(request);
    expect(wire).toMatch(/<bigint: \d+n>/);
    expect(wire).toMatch(/<Uint8Array: 0x[0-9a-f]+>/);
    const decoded = parseExtendedJson(wire) as { transaction: { transaction: unknown; sourceOutputs: unknown }; inputPaths: unknown };
    // the unsigned transaction travels as hex (Paytaca decodes it as hex); the rest round-trips exactly
    expect(decoded.transaction.transaction).toBe(binToHex(encodeTransaction(raw.transaction as TransactionCommon)));
    expect(decoded.transaction.sourceOutputs).toEqual(raw.sourceOutputs);
    expect(decoded.inputPaths).toEqual(tx.walletInputs.map((w) => [w.inputIndex, w.path, w.index]));
  });

  it('hex-decoding an object gives zero bytes: exactly the 19 Nov Paytaca error, so the wallet reads hex', () => {
    const fromObject = decodeTransaction(hexToBin({ inputs: [] } as unknown as string));
    expect(fromObject).toBe('Error reading transaction. Error reading Uint32LE: requires 4 bytes. Remaining bytes: 0');
  });

  it('a typed address without its prefix still works (17 Nov tip: "prefix:payload")', () => {
    expect(withNetworkPrefix('  qzul2y8c9t00n5q20ywk2fwtpepx6fhk059s6dptln ', 'mainnet')).toBe('bitcoincash:qzul2y8c9t00n5q20ywk2fwtpepx6fhk059s6dptln');
    expect(withNetworkPrefix('bitcoincash:qzul2y8c9t00n5q20ywk2fwtpepx6fhk059s6dptln', 'mainnet')).toBe('bitcoincash:qzul2y8c9t00n5q20ywk2fwtpepx6fhk059s6dptln');
    expect(withNetworkPrefix('qq', 'chipnet')).toBe('bchtest:qq');
  });
});
