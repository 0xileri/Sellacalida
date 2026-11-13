// Mocknet fixtures shared by the contract tests.
import { binToHex, hash160, secp256k1, sha256, utf8ToBin } from '@bitauth/libauth';
import { MockNetworkProvider, SignatureTemplate, type SpendableUtxo, type TokenDetails } from 'cashscript';
import { MIN_OUTPUT_SATS } from '@/lib/constants';
import { makeEscrowContract, makeOfferContract, escrowArgsFor, type OfferParams, type ChallengeTerms } from '@/lib/contracts';
import { p2pkhLockingBytecode } from '@/lib/bch/transactions';

export interface Party {
  priv: Uint8Array;
  pk: Uint8Array;
  pkh: Uint8Array;
  lock: Uint8Array;
  lockHex: string;
  template: SignatureTemplate;
}

export function party(label: string): Party {
  const priv = sha256.hash(utf8ToBin(`sellacalida-test-key:${label}`));
  if (!secp256k1.validatePrivateKey(priv)) throw new Error('bad test key');
  const pk = secp256k1.derivePublicKeyCompressed(priv) as Uint8Array;
  const pkh = hash160(pk);
  const lock = p2pkhLockingBytecode(pkh);
  return { priv, pk, pkh, lock, lockHex: binToHex(lock), template: new SignatureTemplate(priv) };
}

export const agent = party('agent');
export const challenger = party('challenger');
export const verifier = party('verifier');
export const stranger = party('stranger');
export const feeWallet = party('fee-wallet');

/** explorer-order hex of a made-up fungible test category */
export const CATEGORY = binToHex(sha256.hash(utf8ToBin('sellacalida-test-category')));
export const OTHER_CATEGORY = binToHex(sha256.hash(utf8ToBin('some-other-category')));

export const START_HEIGHT = 900_000;
/** Offer UTXO sats: the ~1.2 kB cancel tx must still leave >= MIN_OUTPUT_SATS on output 0. */
export const OFFER_SATS = 5000n;

let txCounter = 0;
export function fakeTxid(): string {
  txCounter += 1;
  return binToHex(sha256.hash(utf8ToBin(`fake-txid-${txCounter}`)));
}

export function newProvider(height = START_HEIGHT): MockNetworkProvider {
  const provider = new MockNetworkProvider({ validateTransactions: true, updateUtxoSet: true });
  provider.setBlockHeight(height);
  return provider;
}

export function baseOffer(overrides: Partial<OfferParams> = {}): OfferParams {
  return {
    agentPkh: agent.pkh,
    verifierPk: verifier.pk,
    bondAmount: 100n, // 1.00 PUSD
    feeAmount: 20n, // 0.20 PUSD
    tokenCategory: CATEGORY,
    network: 'mocknet',
    maxDeadlineDelta: 144n,
    verifierGraceBlocks: 18n,
    ...overrides,
  };
}

export function baseTerms(overrides: Partial<ChallengeTerms> = {}): ChallengeTerms {
  return {
    challengerPkh: challenger.pkh,
    challengeId: sha256.hash(utf8ToBin('challenge-1')),
    specHash: sha256.hash(utf8ToBin('{"templateId":"math.exact_result"}')),
    expiryHeight: BigInt(START_HEIGHT + 100),
    ...overrides,
  };
}

export function addUtxo(
  provider: MockNetworkProvider,
  lockingBytecodeHex: string,
  satoshis: bigint,
  token?: TokenDetails,
  vout = 0,
): SpendableUtxo {
  return provider.addUtxo(lockingBytecodeHex, { txid: fakeTxid(), vout, satoshis, ...(token ? { token } : {}) });
}

export function fundedOffer(provider: MockNetworkProvider, offer = baseOffer()) {
  const offerContract = makeOfferContract(offer, provider);
  const offerUtxo = addUtxo(provider, offerContract.lockingBytecode, OFFER_SATS, {
    category: offer.tokenCategory,
    amount: offer.bondAmount,
  });
  return { offer, offerContract, offerUtxo };
}

export function fundedEscrow(
  provider: MockNetworkProvider,
  offer = baseOffer(),
  terms = baseTerms(),
  escrowSats = 5000n,
  vout = 0,
) {
  const escrowArgs = escrowArgsFor(offer, terms);
  const escrowContract = makeEscrowContract(escrowArgs, provider);
  const escrowUtxo = addUtxo(
    provider,
    escrowContract.lockingBytecode,
    escrowSats,
    { category: offer.tokenCategory, amount: offer.bondAmount + offer.feeAmount },
    vout,
  );
  return { offer, terms, escrowArgs, escrowContract, escrowUtxo };
}

export { MIN_OUTPUT_SATS };
