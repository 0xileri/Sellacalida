// Transaction builders for every contract path. Shared by mocknet tests, chipnet scripts, the app
// (WizardConnect placeholder unlockers) and the server verifier (fee-wallet SignatureTemplate).
//
// User-owned P2PKH inputs take an `Unlocker`: SignatureTemplate.unlockP2PKH() in tests and server
// code, placeholderP2PKHUnlocker(address) when the wallet signs through WizardConnect.
import { encodeTransaction, type Transaction } from '@bitauth/libauth';
import {
  TransactionBuilder,
  type Contract,
  type NetworkProvider,
  type SignatureTemplate,
  type Unlocker,
  type SpendableUtxo,
} from 'cashscript';

type TransactionBuilderOptions = ConstructorParameters<typeof TransactionBuilder>[0];
import { MIN_OUTPUT_SATS } from '../constants';
import type { ChallengeTerms, OfferParams } from '../contracts';
import { buildEscrowRedeemScript, escrowLockingBytecode, type EscrowArgs } from '../encodeRedeemScript';

export const DEFAULT_FEE_RATE = 1.1; // sats per byte, a little over the 1 sat/byte relay minimum
/** Bytes a wallet adds when it replaces an empty placeholder P2PKH unlocking script (sig + pubkey). */
export const P2PKH_UNLOCK_BYTES = 1 + 65 + 1 + 33;

export interface UserInput {
  utxo: SpendableUtxo;
  unlocker: Unlocker;
  /** true when unlocking bytecode is filled in later by a wallet (WizardConnect placeholder) */
  placeholder?: boolean;
}

export function p2pkhLockingBytecode(pkh: Uint8Array): Uint8Array {
  if (pkh.length !== 20) throw new Error('pkh must be 20 bytes');
  return Uint8Array.from([0x76, 0xa9, 0x14, ...pkh, 0x88, 0xac]);
}

/**
 * Two-pass fee: build with a provisional fee, measure, then rebuild with the real fee.
 * `placeholders` adds the bytes a wallet will insert into placeholder inputs.
 */
export function withFee(
  make: (fee: bigint) => TransactionBuilder,
  placeholders: number,
  feeRate: number,
): { builder: TransactionBuilder; fee: bigint } {
  // Measure a draft without the builder's fee / dust checks; output values do not change tx size.
  const draft = make(0n) as unknown as { buildLibauthTransaction(skipChecks: boolean): Transaction };
  const size = encodeTransaction(draft.buildLibauthTransaction(true)).length + placeholders * P2PKH_UNLOCK_BYTES;
  const fee = BigInt(Math.ceil(size * feeRate)) + 2n;
  return { builder: make(fee), fee };
}

// ---------------------------------------------------------------------------------------------
// Offer: cancel
// ---------------------------------------------------------------------------------------------

export interface CancelInput {
  provider: NetworkProvider;
  /** test hook, e.g. { allowImplicitFungibleTokenBurn: true } so a contract check fires first */
  builderOptions?: Partial<TransactionBuilderOptions>;
  offer: OfferParams;
  offerContract: Contract;
  offerUtxo: SpendableUtxo;
  agentPk: Uint8Array;
  /** SignatureTemplate (server / tests) or placeholderSignature() bytes (wallet fills it) */
  agentSig: SignatureTemplate | Uint8Array;
  bchFeeInput?: UserInput;
  feeRate?: number;
  /** test hook: mutate the builder before it is returned */
  tamper?: (b: TransactionBuilder) => void;
}

export function buildCancel(i: CancelInput): TransactionBuilder {
  const inSats = i.offerUtxo.satoshis + (i.bchFeeInput?.utxo.satoshis ?? 0n);
  const placeholders = i.bchFeeInput?.placeholder ? 1 : 0;
  const { builder } = withFee(
    (fee) => {
      const b = new TransactionBuilder({ provider: i.provider, ...i.builderOptions });
      b.addInput(i.offerUtxo, i.offerContract.unlock.cancel(i.agentPk, i.agentSig));
      if (i.bchFeeInput) b.addInput(i.bchFeeInput.utxo, i.bchFeeInput.unlocker);
      b.addOutput({
        to: p2pkhLockingBytecode(i.offer.agentPkh),
        amount: inSats - fee,
        token: { category: i.offer.tokenCategory, amount: i.offer.bondAmount },
      });
      i.tamper?.(b);
      return b;
    },
    placeholders,
    i.feeRate ?? DEFAULT_FEE_RATE,
  );
  return builder;
}

// ---------------------------------------------------------------------------------------------
// Offer: accept
// ---------------------------------------------------------------------------------------------

export interface AcceptInput {
  provider: NetworkProvider;
  /** test hook, e.g. { allowImplicitFungibleTokenBurn: true } so a contract check fires first */
  builderOptions?: Partial<TransactionBuilderOptions>;
  offer: OfferParams;
  offerContract: Contract;
  offerUtxo: SpendableUtxo;
  terms: ChallengeTerms;
  /** challenger token UTXO at P2PKH(challengerPkh), amount >= feeAmount */
  challengerTokenInput: UserInput;
  bchFeeInput?: UserInput;
  escrowSatoshis: bigint;
  /** nLocktime; must be <= current height to be mined, and >= expiryHeight - maxDeadlineDelta */
  locktime: number;
  feeRate?: number;
  tamper?: (b: TransactionBuilder) => void;
  /** test hook: override the redeem script passed as the accept argument (defaults to escrowArgs) */
  escrowRedeemScriptOverride?: Uint8Array;
  /** test hook: skip app-side sanity checks so the covenant is what rejects */
  unsafeSkipAppChecks?: boolean;
}

export function buildAccept(i: AcceptInput & { escrowArgs: EscrowArgs }): TransactionBuilder {
  const tokenIn = i.challengerTokenInput.utxo.token;
  if (!i.unsafeSkipAppChecks) {
    if (!tokenIn || tokenIn.category !== i.offer.tokenCategory || tokenIn.nft) {
      throw new Error('challenger token input must carry the offer token category (fungible only)');
    }
    if (tokenIn.amount < i.offer.feeAmount) throw new Error('challenger token input is below the fee');
  }
  const changeAmount = (tokenIn?.amount ?? 0n) - i.offer.feeAmount;

  const redeemScript = i.escrowRedeemScriptOverride ?? buildEscrowRedeemScript(i.escrowArgs);
  const escrowLock = escrowLockingBytecode(i.escrowArgs);
  const challengerLock = p2pkhLockingBytecode(i.terms.challengerPkh);

  const inSats =
    i.offerUtxo.satoshis + i.challengerTokenInput.utxo.satoshis + (i.bchFeeInput?.utxo.satoshis ?? 0n);
  const placeholders =
    (i.challengerTokenInput.placeholder ? 1 : 0) + (i.bchFeeInput?.placeholder ? 1 : 0);

  const { builder, fee } = withFee(
    (fee) => {
      const b = new TransactionBuilder({ provider: i.provider, ...i.builderOptions });
      b.addInput(
        i.offerUtxo,
        i.offerContract.unlock.accept(
          i.terms.challengerPkh,
          i.terms.challengeId,
          i.terms.specHash,
          i.terms.expiryHeight,
          i.escrowSatoshis,
          redeemScript,
        ),
      );
      b.addInput(i.challengerTokenInput.utxo, i.challengerTokenInput.unlocker);
      if (i.bchFeeInput) b.addInput(i.bchFeeInput.utxo, i.bchFeeInput.unlocker);
      b.addOutput({
        to: escrowLock,
        amount: i.escrowSatoshis,
        token: { category: i.offer.tokenCategory, amount: i.offer.bondAmount + i.offer.feeAmount },
      });
      // clamp while measuring so a short wallet gets the clear "not enough BCH" error below,
      // not a dust error from the builder (unsafe test builds keep the raw amount)
      const change = inSats - i.escrowSatoshis - fee;
      b.addOutput({
        to: challengerLock,
        amount: i.unsafeSkipAppChecks || change >= MIN_OUTPUT_SATS ? change : MIN_OUTPUT_SATS,
        ...(changeAmount > 0n ? { token: { category: i.offer.tokenCategory, amount: changeAmount } } : {}),
      });
      b.setLocktime(i.locktime);
      i.tamper?.(b);
      return b;
    },
    placeholders,
    i.feeRate ?? DEFAULT_FEE_RATE,
  );
  if (!i.unsafeSkipAppChecks && inSats - i.escrowSatoshis - fee < MIN_OUTPUT_SATS) {
    throw new Error(
      `not enough BCH: challenger change would be ${inSats - i.escrowSatoshis - fee} sats (< ${MIN_OUTPUT_SATS}); add a BCH input`,
    );
  }
  return builder;
}

// ---------------------------------------------------------------------------------------------
// Escrow: settle and timeout (server side; fee input signed by the server fee wallet)
// ---------------------------------------------------------------------------------------------

export interface SettleInput {
  provider: NetworkProvider;
  /** test hook, e.g. { allowImplicitFungibleTokenBurn: true } so a contract check fires first */
  builderOptions?: Partial<TransactionBuilderOptions>;
  escrowContract: Contract;
  escrowUtxo: SpendableUtxo;
  escrowArgs: EscrowArgs;
  /** explorer-order hex of the escrow token category */
  tokenCategory: string;
  winnerPkh: Uint8Array;
  message: Uint8Array;
  signature: Uint8Array;
  /** BCH change destination for output 1; omit for the 1-output shape */
  feeLockingBytecode?: Uint8Array;
  bchFeeInput?: UserInput;
  feeRate?: number;
  /** nLocktime; NORESPONSE needs >= expiryHeight - verifierGraceBlocks */
  locktime?: number;
  tamper?: (b: TransactionBuilder) => void;
}

export function buildSettle(i: SettleInput): TransactionBuilder {
  const total = i.escrowArgs.bondAmount + i.escrowArgs.feeAmount;
  const inSats = i.escrowUtxo.satoshis + (i.bchFeeInput?.utxo.satoshis ?? 0n);
  const feeLock = i.feeLockingBytecode ?? new Uint8Array();
  const { builder } = withFee(
    (fee) => {
      const b = new TransactionBuilder({ provider: i.provider, ...i.builderOptions });
      b.addInput(i.escrowUtxo, i.escrowContract.unlock.settle(i.signature, i.message, feeLock));
      if (i.bchFeeInput) b.addInput(i.bchFeeInput.utxo, i.bchFeeInput.unlocker);
      if (i.feeLockingBytecode) {
        // winner keeps the escrow's own sats, the fee payer gets its change back
        b.addOutput({
          to: p2pkhLockingBytecode(i.winnerPkh),
          amount: i.escrowUtxo.satoshis,
          token: { category: i.tokenCategory, amount: total },
        });
        b.addOutput({ to: i.feeLockingBytecode, amount: inSats - i.escrowUtxo.satoshis - fee });
      } else {
        b.addOutput({
          to: p2pkhLockingBytecode(i.winnerPkh),
          amount: inSats - fee,
          token: { category: i.tokenCategory, amount: total },
        });
      }
      if (i.locktime !== undefined) b.setLocktime(i.locktime);
      i.tamper?.(b);
      return b;
    },
    i.bchFeeInput?.placeholder ? 1 : 0,
    i.feeRate ?? DEFAULT_FEE_RATE,
  );
  return builder;
}

export interface TimeoutInput {
  provider: NetworkProvider;
  /** test hook, e.g. { allowImplicitFungibleTokenBurn: true } so a contract check fires first */
  builderOptions?: Partial<TransactionBuilderOptions>;
  escrowContract: Contract;
  escrowUtxo: SpendableUtxo;
  escrowArgs: EscrowArgs;
  tokenCategory: string;
  /** must be >= expiryHeight (and the tx only relays once the chain reaches it) */
  locktime: number;
  feeLockingBytecode?: Uint8Array;
  bchFeeInput?: UserInput;
  feeRate?: number;
  tamper?: (b: TransactionBuilder) => void;
}

export function buildTimeout(i: TimeoutInput): TransactionBuilder {
  const a = i.escrowArgs;
  const inSats = i.escrowUtxo.satoshis + (i.bchFeeInput?.utxo.satoshis ?? 0n);
  const feeLock = i.feeLockingBytecode ?? new Uint8Array();
  const { builder } = withFee(
    (fee) => {
      const b = new TransactionBuilder({ provider: i.provider, ...i.builderOptions });
      b.addInput(i.escrowUtxo, i.escrowContract.unlock.timeout(feeLock));
      if (i.bchFeeInput) b.addInput(i.bchFeeInput.utxo, i.bchFeeInput.unlocker);
      // the agent refund carries the escrow's spare sats: all of them when a fee payer joins,
      // otherwise whatever is left after the miner fee (the contract caps that fee)
      const spare = i.feeLockingBytecode
        ? i.escrowUtxo.satoshis - 2n * MIN_OUTPUT_SATS
        : inSats - 2n * MIN_OUTPUT_SATS - fee;
      b.addOutput({
        to: p2pkhLockingBytecode(a.agentPkh),
        amount: MIN_OUTPUT_SATS + (spare > 0n ? spare : 0n),
        token: { category: i.tokenCategory, amount: a.bondAmount },
      });
      b.addOutput({
        to: p2pkhLockingBytecode(a.challengerPkh),
        amount: MIN_OUTPUT_SATS,
        token: { category: i.tokenCategory, amount: a.feeAmount },
      });
      if (i.feeLockingBytecode) {
        const refunds = i.escrowUtxo.satoshis > 2n * MIN_OUTPUT_SATS ? i.escrowUtxo.satoshis : 2n * MIN_OUTPUT_SATS;
        b.addOutput({ to: i.feeLockingBytecode, amount: inSats - refunds - fee });
      }
      b.setLocktime(i.locktime);
      i.tamper?.(b);
      return b;
    },
    i.bchFeeInput?.placeholder ? 1 : 0,
    i.feeRate ?? DEFAULT_FEE_RATE,
  );
  return builder;
}

