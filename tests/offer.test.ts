// Mocknet tests for SellacalidaOffer (spec section 3.1 + the "Offer" block of section 9).
import { describe, expect, it } from 'vitest';
import { binToHex, flattenBinArray, sha256, utf8ToBin } from '@bitauth/libauth';
import { Contract, type TransactionBuilder } from 'cashscript';
import { buildAccept, buildCancel, type AcceptInput } from '@/lib/bch/transactions';
import { escrowArgsFor, makeEscrowContract, offerArtifact, offerSdkArgs, type ChallengeTerms, type OfferParams } from '@/lib/contracts';
import { MAX_HEIGHT } from '@/lib/constants';
import { encodeEscrowConstructorArgs, escrowBody, escrowLockingBytecode, p2sh32LockingBytecode } from '@/lib/encodeRedeemScript';
import {
  CATEGORY, OTHER_CATEGORY, START_HEIGHT, addUtxo, agent, baseOffer, baseTerms, challenger,
  fundedOffer, newProvider, stranger,
} from './helpers';

const unlockChallenger = () => challenger.template.unlockP2PKH();

async function expectRequire(b: TransactionBuilder | Promise<unknown>, statement: string) {
  const p = 'send' in (b as TransactionBuilder) ? (b as TransactionBuilder).send() : b;
  await expect(p).rejects.toThrow(statement);
}

// ---------------------------------------------------------------------------------------------
// cancel
// ---------------------------------------------------------------------------------------------

describe('SellacalidaOffer.cancel', () => {
  function setup(offerOverrides: Partial<OfferParams> = {}) {
    const provider = newProvider();
    const f = fundedOffer(provider, baseOffer(offerOverrides));
    const base = { provider, ...f, agentPk: agent.pk, agentSig: agent.template };
    return { provider, ...f, base };
  }

  it('agent reclaims the full bond with exactly one output', async () => {
    const { provider, offer, base } = setup();
    const b = buildCancel(base);
    expect(b.outputs.length).toBe(1);
    await b.send();
    const utxos = await provider.getUtxosForLockingBytecode(agent.lock);
    const tokenUtxo = utxos.find((u) => u.token);
    expect(tokenUtxo?.token).toEqual({ category: offer.tokenCategory, amount: offer.bondAmount });
  });

  it('works with an extra BCH-only fee input', async () => {
    const { provider, base } = setup();
    const bch = addUtxo(provider, agent.lockHex, 3000n);
    await buildCancel({ ...base, bchFeeInput: { utxo: bch, unlocker: agent.template.unlockP2PKH() } }).send();
  });

  it('a stranger key cannot cancel (hash160 mismatch)', async () => {
    const { base } = setup();
    await expectRequire(
      buildCancel({ ...base, agentPk: stranger.pk, agentSig: stranger.template }),
      'require(hash160(agentPk) == agentPkh);',
    );
  });

  it('the agent pubkey with a stranger signature fails checkSig', async () => {
    const { base } = setup();
    await expectRequire(buildCancel({ ...base, agentSig: stranger.template }), 'require(checkSig(agentSig, agentPk));');
  });

  it('fails with a second output', async () => {
    const { base } = setup();
    const b = buildCancel({
      ...base,
      tamper: (t) => { t.outputs[0].amount -= 1000n; t.addOutput({ to: stranger.lock, amount: 1000n }); },
    });
    await expectRequire(b, 'require(tx.outputs.length == 1);');
  });

  it('fails if output 0 is not the agent P2PKH', async () => {
    const { base } = setup();
    const b = buildCancel({ ...base, tamper: (t) => { t.outputs[0].to = stranger.lock; } });
    await expectRequire(b, 'require(tx.outputs[0].lockingBytecode == new LockingBytecodeP2PKH(agentPkh));');
  });

  it('fails if output 0 value is under MIN_OUTPUT_SATS', async () => {
    const { base } = setup();
    const b = buildCancel({ ...base, tamper: (t) => { t.outputs[0].amount = 999n; } });
    await expectRequire(b, 'require(tx.outputs[0].value >= MIN_OUTPUT_SATS);');
  });

  it('fails if input 1 carries tokens', async () => {
    const { provider, offer, base } = setup();
    const tokenFee = addUtxo(provider, agent.lockHex, 3000n, { category: offer.tokenCategory, amount: 5n });
    const b = buildCancel({
      ...base,
      bchFeeInput: { utxo: tokenFee, unlocker: agent.template.unlockP2PKH() },
      builderOptions: { allowImplicitFungibleTokenBurn: true },
    });
    await expectRequire(b, 'require(tx.inputs[1].tokenCategory == 0x);');
  });

  it('fails with three inputs', async () => {
    const { provider, base } = setup();
    const a = addUtxo(provider, agent.lockHex, 3000n);
    const c = addUtxo(provider, agent.lockHex, 3000n);
    const b = buildCancel({
      ...base,
      bchFeeInput: { utxo: a, unlocker: agent.template.unlockP2PKH() },
      tamper: (t) => { t.addInput(c, agent.template.unlockP2PKH()); },
    });
    await expectRequire(b, 'require(tx.inputs.length == 1 || tx.inputs.length == 2);');
  });
});

// ---------------------------------------------------------------------------------------------
// accept
// ---------------------------------------------------------------------------------------------

interface AcceptSetup {
  offer?: Partial<OfferParams>;
  terms?: Partial<ChallengeTerms>;
  challengerTokens?: bigint;
  challengerCategory?: string;
  withBch?: boolean;
}

function acceptSetup(o: AcceptSetup = {}) {
  const provider = newProvider();
  const { offer, offerContract, offerUtxo } = fundedOffer(provider, baseOffer(o.offer));
  const terms = baseTerms(o.terms);
  const challengerTokenUtxo = addUtxo(provider, challenger.lockHex, 10_000n, {
    category: o.challengerCategory ?? offer.tokenCategory,
    amount: o.challengerTokens ?? offer.feeAmount,
  });
  const bch = o.withBch ? addUtxo(provider, challenger.lockHex, 10_000n) : undefined;
  const escrowArgs = escrowArgsFor(offer, terms);
  const input: AcceptInput & { escrowArgs: typeof escrowArgs } = {
    provider, offer, offerContract, offerUtxo, terms, escrowArgs,
    challengerTokenInput: { utxo: challengerTokenUtxo, unlocker: unlockChallenger() },
    ...(bch ? { bchFeeInput: { utxo: bch, unlocker: unlockChallenger() } } : {}),
    escrowSatoshis: 5000n,
    locktime: START_HEIGHT,
  };
  return { provider, offer, terms, escrowArgs, input };
}

describe('SellacalidaOffer.accept: happy paths', () => {
  it('exact-input path: escrow gets bond + fee, output 1 is token-free challenger change', async () => {
    const { provider, offer, escrowArgs, input } = acceptSetup();
    const b = buildAccept(input);
    expect(b.outputs.length).toBe(2);
    expect(b.outputs[1].token).toBeUndefined();
    await b.send();

    const escrow = makeEscrowContract(escrowArgs, provider);
    const escrowUtxos = await escrow.getUtxos();
    expect(escrowUtxos).toHaveLength(1);
    expect(escrowUtxos[0].satoshis).toBe(5000n);
    expect(escrowUtxos[0].token).toEqual({ category: offer.tokenCategory, amount: 120n });
    const change = await provider.getUtxosForLockingBytecode(challenger.lock);
    expect(change.some((u) => u.token)).toBe(false);
  });

  it('change path: output 1 returns input1 - fee of the same category to the challenger', async () => {
    const { provider, offer, input } = acceptSetup({ challengerTokens: 55n });
    const b = buildAccept(input);
    expect(b.outputs[1].token).toEqual({ category: offer.tokenCategory, amount: 35n });
    await b.send();
    const change = await provider.getUtxosForLockingBytecode(challenger.lock);
    expect(change.find((u) => u.token)?.token).toEqual({ category: offer.tokenCategory, amount: 35n });
  });

  it('works with an optional BCH-only third input', async () => {
    const { input } = acceptSetup({ withBch: true, challengerTokens: 21n });
    await buildAccept(input).send();
  });

  it('expiryHeight exactly nLocktime + maxDeadlineDelta is allowed (boundary)', async () => {
    const { input } = acceptSetup({ terms: { expiryHeight: BigInt(START_HEIGHT + 144) } });
    await buildAccept(input).send();
  });

  it('the escrow locking bytecode is the SDK Contract locking bytecode', () => {
    const { provider, escrowArgs } = acceptSetup();
    expect(binToHex(escrowLockingBytecode(escrowArgs))).toBe(makeEscrowContract(escrowArgs, provider).lockingBytecode);
  });

  it('works for every networkId encoding (0x00 / 0x01 / 0x02) and small OP_N amounts', async () => {
    for (const network of ['mainnet', 'chipnet', 'mocknet'] as const) {
      for (const [bond, fee] of [[1n, 1n], [16n, 17n], [100n, 20n], [40_000n, 128n]] as const) {
        const { input } = acceptSetup({ offer: { network, bondAmount: bond, feeAmount: fee } });
        await buildAccept(input).send();
      }
    }
  });
});

describe('SellacalidaOffer.accept: deadline bound', () => {
  it('rejects expiryHeight above nLocktime + maxDeadlineDelta', async () => {
    const { input } = acceptSetup({ terms: { expiryHeight: BigInt(START_HEIGHT + 145) } });
    await expectRequire(buildAccept(input), 'require(tx.time >= expiryHeight - maxDeadlineDelta);');
  });

  it('rejects a far-future expiry with a current locktime', async () => {
    const { input } = acceptSetup({ terms: { expiryHeight: BigInt(START_HEIGHT + 100_000) } });
    await expectRequire(buildAccept(input), 'require(tx.time >= expiryHeight - maxDeadlineDelta);');
  });

  it('raising nLocktime to satisfy the bound makes the accept non-final until that height', async () => {
    const far = START_HEIGHT + 100_000;
    const { input } = acceptSetup({ terms: { expiryHeight: BigInt(far) } });
    const b = buildAccept({ ...input, locktime: far - 144 });
    await expect(b.send()).rejects.toThrow(/non-final/);
  });

  it('rejects expiryHeight >= MAX_HEIGHT', async () => {
    const { input } = acceptSetup({ terms: { expiryHeight: BigInt(MAX_HEIGHT) } });
    await expectRequire(buildAccept(input), 'require(expiryHeight < MAX_HEIGHT);');
  });

  it('rejects an offer whose verifierGraceBlocks is below the minimum', async () => {
    const { input } = acceptSetup({ offer: { verifierGraceBlocks: 17n } });
    await expectRequire(buildAccept(input), 'require(verifierGraceBlocks >= MIN_VERIFIER_GRACE);');
  });

  it('rejects an offer whose maxDeadlineDelta is not above verifierGraceBlocks', async () => {
    const { input } = acceptSetup({ offer: { maxDeadlineDelta: 18n, verifierGraceBlocks: 18n } });
    await expectRequire(buildAccept(input), 'require(maxDeadlineDelta > verifierGraceBlocks);');
  });

  it('rejects expiryHeight <= verifierGraceBlocks', async () => {
    const { input } = acceptSetup({ terms: { expiryHeight: 18n } });
    await expectRequire(buildAccept(input), 'require(expiryHeight > verifierGraceBlocks);');
  });
});

describe('SellacalidaOffer.accept: escrow address binding', () => {
  const mismatch = 'require(escrowRedeemScript == expectedRedeemScript);';

  it.each<[string, (a: ReturnType<typeof escrowArgsFor>) => void]>([
    ['wrong challengerPkh', (a) => { a.challengerPkh = stranger.pkh; }],
    ['wrong agentPkh', (a) => { a.agentPkh = stranger.pkh; }],
    ['wrong expiryHeight', (a) => { a.expiryHeight = a.expiryHeight + 1n; }],
    ['wrong specHash', (a) => { a.specHash = sha256.hash(utf8ToBin('other spec')); }],
    ['wrong challengeId', (a) => { a.challengeId = sha256.hash(utf8ToBin('other id')); }],
    ['wrong verifierGraceBlocks', (a) => { a.verifierGraceBlocks = a.verifierGraceBlocks + 1n; }],
    ['wrong verifierPk', (a) => { a.verifierPk = stranger.pk; }],
    ['wrong bondAmount', (a) => { a.bondAmount = a.bondAmount + 1n; }],
    ['wrong networkId', (a) => { a.networkId = Uint8Array.of(0x00); }],
  ])('rejects an escrow built with %s', async (_label, mutate) => {
    const { offer, terms, input } = acceptSetup();
    const bad = escrowArgsFor(offer, terms);
    mutate(bad);
    // wrong redeem script + matching output: the on-chain rebuild catches it
    const b = buildAccept({ ...input, escrowArgs: bad, builderOptions: { allowImplicitFungibleTokenBurn: true } });
    await expectRequire(b, mismatch);
  });

  it('rejects a redeem script with a tampered escrow body', async () => {
    const { escrowArgs, input } = acceptSetup();
    const body = escrowBody().slice();
    body[body.length - 1] ^= 0x01;
    const badScript = flattenBinArray([encodeEscrowConstructorArgs(escrowArgs), body]);
    const b = buildAccept({
      ...input,
      escrowRedeemScriptOverride: badScript,
      tamper: (t) => { t.outputs[0].to = p2sh32LockingBytecode(badScript); },
    });
    await expectRequire(b, mismatch);
  });

  it('rejects an honest redeem script argument with output 0 sent elsewhere', async () => {
    const { offer, terms, input } = acceptSetup();
    const other = escrowArgsFor(offer, { ...terms, expiryHeight: terms.expiryHeight + 5n });
    const b = buildAccept({ ...input, tamper: (t) => { t.outputs[0].to = escrowLockingBytecode(other); } });
    await expectRequire(b, 'require(tx.outputs[0].lockingBytecode == new LockingBytecodeP2SH32(hash256(escrowRedeemScript)));');
  });

  it('rejects output 0 sent to the challenger P2PKH', async () => {
    const { input } = acceptSetup();
    const b = buildAccept({ ...input, tamper: (t) => { t.outputs[0].to = challenger.lock; } });
    await expectRequire(b, 'require(tx.outputs[0].lockingBytecode == new LockingBytecodeP2SH32(hash256(escrowRedeemScript)));');
  });
});

describe('SellacalidaOffer.accept: inputs', () => {
  it('rejects an insufficient fee on input 1', async () => {
    const { offer, input } = acceptSetup({ challengerTokens: 19n });
    const b = buildAccept({
      ...input,
      unsafeSkipAppChecks: true,
      tamper: (t) => { t.outputs[0].token = { category: offer.tokenCategory, amount: 119n }; },
    });
    await expectRequire(b, 'require(tx.inputs[1].tokenAmount >= feeAmount);');
  });

  it('rejects input 1 of another category', async () => {
    const { input } = acceptSetup({ challengerCategory: OTHER_CATEGORY });
    const b = buildAccept({ ...input, unsafeSkipAppChecks: true, builderOptions: { allowImplicitFungibleTokenBurn: true } });
    await expectRequire(b, 'require(tx.inputs[1].tokenCategory == tokenCategory);');
  });

  it('rejects input 1 that also carries an NFT (33-byte category)', async () => {
    const provider = newProvider();
    const { offer, offerContract, offerUtxo } = fundedOffer(provider);
    const terms = baseTerms();
    const nftUtxo = addUtxo(provider, challenger.lockHex, 10_000n, {
      category: offer.tokenCategory, amount: 20n, nft: { capability: 'mutable', commitment: '' },
    });
    const b = buildAccept({
      provider, offer, offerContract, offerUtxo, terms, escrowArgs: escrowArgsFor(offer, terms),
      challengerTokenInput: { utxo: nftUtxo, unlocker: unlockChallenger() },
      escrowSatoshis: 5000n, locktime: START_HEIGHT, unsafeSkipAppChecks: true,
    });
    await expect(b.send()).rejects.toThrow('require(tx.inputs[1].tokenCategory == tokenCategory);');
  });

  it("rejects input 1 that is not the challenger's own P2PKH", async () => {
    const provider = newProvider();
    const { offer, offerContract, offerUtxo } = fundedOffer(provider);
    const terms = baseTerms();
    const strangerTokens = addUtxo(provider, stranger.lockHex, 10_000n, { category: offer.tokenCategory, amount: 20n });
    const b = buildAccept({
      provider, offer, offerContract, offerUtxo, terms, escrowArgs: escrowArgsFor(offer, terms),
      challengerTokenInput: { utxo: strangerTokens, unlocker: stranger.template.unlockP2PKH() },
      escrowSatoshis: 5000n, locktime: START_HEIGHT,
    });
    await expectRequire(b, 'require(tx.inputs[1].lockingBytecode == challengerLock);');
  });

  it('rejects a third input that carries tokens', async () => {
    const { provider, offer, input } = acceptSetup();
    const extraTokens = addUtxo(provider, challenger.lockHex, 5000n, { category: offer.tokenCategory, amount: 7n });
    const b = buildAccept({
      ...input,
      bchFeeInput: { utxo: extraTokens, unlocker: unlockChallenger() },
      builderOptions: { allowImplicitFungibleTokenBurn: true },
    });
    await expectRequire(b, 'require(tx.inputs[2].tokenCategory == 0x);');
  });

  it('rejects four inputs', async () => {
    const { provider, input } = acceptSetup({ withBch: true });
    const extra = addUtxo(provider, challenger.lockHex, 5000n);
    const b = buildAccept({ ...input, tamper: (t) => { t.addInput(extra, unlockChallenger()); } });
    await expectRequire(b, 'require(tx.inputs.length == 2 || tx.inputs.length == 3);');
  });

  it('rejects the offer at an input index other than 0', async () => {
    const { input } = acceptSetup();
    const b = buildAccept({ ...input, tamper: (t) => { t.inputs.reverse(); } });
    await expectRequire(b, 'require(this.activeInputIndex == 0);');
  });
});

describe('SellacalidaOffer.accept: outputs', () => {
  it('rejects a third output', async () => {
    const { input } = acceptSetup();
    const b = buildAccept({
      ...input,
      tamper: (t) => { t.outputs[1].amount -= 1000n; t.addOutput({ to: stranger.lock, amount: 1000n }); },
    });
    await expectRequire(b, 'require(tx.outputs.length == 2);');
  });

  it('rejects change-path token change sent to a third party', async () => {
    const { input } = acceptSetup({ challengerTokens: 55n });
    const b = buildAccept({ ...input, tamper: (t) => { t.outputs[1].to = stranger.lock; } });
    await expectRequire(b, 'require(tx.outputs[1].lockingBytecode == challengerLock);');
  });

  it('rejects a wrong change amount', async () => {
    const { offer, input } = acceptSetup({ challengerTokens: 55n });
    const b = buildAccept({
      ...input,
      builderOptions: { allowImplicitFungibleTokenBurn: true },
      tamper: (t) => { t.outputs[1].token = { category: offer.tokenCategory, amount: 34n }; },
    });
    await expectRequire(b, 'require(tx.outputs[1].tokenAmount == changeAmount);');
  });

  it('rejects dropping the token change (change path requires the category on output 1)', async () => {
    const { input } = acceptSetup({ challengerTokens: 55n });
    const b = buildAccept({
      ...input,
      builderOptions: { allowImplicitFungibleTokenBurn: true },
      tamper: (t) => { delete t.outputs[1].token; },
    });
    await expectRequire(b, 'require(tx.outputs[1].tokenCategory == tokenCategory);');
  });

  it('rejects a wrong escrow token amount', async () => {
    const { offer, input } = acceptSetup({ challengerTokens: 55n });
    const b = buildAccept({
      ...input,
      builderOptions: { allowImplicitFungibleTokenBurn: true },
      tamper: (t) => { t.outputs[0].token = { category: offer.tokenCategory, amount: 119n }; },
    });
    await expectRequire(b, 'require(tx.outputs[0].tokenAmount == bondAmount + feeAmount);');
  });

  it('rejects escrow sats that differ from escrowSatoshis', async () => {
    const { input } = acceptSetup();
    const b = buildAccept({ ...input, tamper: (t) => { t.outputs[0].amount = 4999n; } });
    await expectRequire(b, 'require(tx.outputs[0].value == escrowSatoshis);');
  });

  it('rejects escrowSatoshis below MIN_OUTPUT_SATS', async () => {
    const { input } = acceptSetup();
    const b = buildAccept({ ...input, escrowSatoshis: 999n });
    await expectRequire(b, 'require(escrowSatoshis >= MIN_OUTPUT_SATS);');
  });

  it('rejects output 1 under MIN_OUTPUT_SATS', async () => {
    const { input } = acceptSetup();
    const b = buildAccept({ ...input, tamper: (t) => { t.outputs[1].amount = 999n; } });
    await expectRequire(b, 'require(tx.outputs[1].value >= MIN_OUTPUT_SATS);');
  });

  it('an NFT-capable escrow output is impossible: all inputs are fungible-only, so the VM rejects it', async () => {
    const { offer, input } = acceptSetup();
    const b = buildAccept({
      ...input,
      tamper: (t) => {
        t.outputs[0].token = { category: offer.tokenCategory, amount: 120n, nft: { capability: 'none', commitment: '' } };
      },
    });
    await expect(b.send()).rejects.toThrow();
  });
});

describe('SellacalidaOffer: category byte order (spec section 2 caveat)', () => {
  it('an offer built with the explorer-order category (not swapped) cannot be accepted', async () => {
    const provider = newProvider();
    const offer = baseOffer();
    const a = offerSdkArgs(offer);
    const explorerOrder = Uint8Array.from(Buffer.from(CATEGORY, 'hex')); // explorer order baked in: wrong
    const wrongOffer = new Contract(offerArtifact, [a[0], a[1], a[2], a[3], explorerOrder, a[5], a[6], a[7], a[8]], {
      provider, contractType: 'p2sh32',
    });
    const offerUtxo = addUtxo(provider, wrongOffer.lockingBytecode, 5000n, { category: CATEGORY, amount: 100n });
    const terms = baseTerms();
    const tokenUtxo = addUtxo(provider, challenger.lockHex, 10_000n, { category: CATEGORY, amount: 20n });
    const b = buildAccept({
      provider, offer, offerContract: wrongOffer, offerUtxo, terms, escrowArgs: escrowArgsFor(offer, terms),
      challengerTokenInput: { utxo: tokenUtxo, unlocker: unlockChallenger() },
      escrowSatoshis: 5000n, locktime: START_HEIGHT,
    });
    await expectRequire(b, 'require(tx.inputs[0].tokenCategory == tokenCategory);');
  });
});
