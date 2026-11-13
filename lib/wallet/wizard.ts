// WizardConnect helpers (browser). The wallet shares xpubs for its receive / change paths; the dapp
// derives addresses, finds UTXOs, builds transactions with CashScript placeholders, and asks the
// wallet to sign only the inputs listed in `inputPaths` ([inputIndex, pathName, addressIndex]).
import { binToHex, hash160 } from '@bitauth/libauth';
import type { DappConnectionManager } from '@wizardconnect/dapp';
import type { SignTransactionRequest } from '@wizardconnect/core';
import type { NetworkProvider, SpendableUtxo, TransactionBuilder } from 'cashscript';
import type { SellacalidaNetwork } from '../constants';
import { pkhToCashAddress } from '../bch/address';
import { p2pkhLockingBytecode } from '../bch/transactions';

export type WalletPath = 'receive' | 'change';
const CHILD_INDEX: Record<WalletPath, number> = { receive: 0, change: 1 };

export interface WalletAddress {
  path: WalletPath;
  index: number;
  pubkey: Uint8Array;
  pkh: Uint8Array;
  lock: Uint8Array;
  address: string;
  tokenAddress: string;
}

export interface WalletUtxo extends SpendableUtxo {
  path: WalletPath;
  index: number;
  address: string;
}

export function deriveAddresses(
  manager: DappConnectionManager,
  network: SellacalidaNetwork,
  counts: Record<WalletPath, number> = { receive: 10, change: 5 },
): WalletAddress[] {
  const out: WalletAddress[] = [];
  for (const path of ['receive', 'change'] as const) {
    for (let index = 0; index < counts[path]; index += 1) {
      const pubkey = manager.getPubkey(CHILD_INDEX[path], BigInt(index));
      if (!pubkey) continue;
      const pkh = hash160(pubkey);
      out.push({
        path, index, pubkey, pkh, lock: p2pkhLockingBytecode(pkh),
        address: pkhToCashAddress(pkh, network),
        tokenAddress: pkhToCashAddress(pkh, network, true),
      });
    }
  }
  return out;
}

export async function fetchWalletUtxos(provider: NetworkProvider, addresses: WalletAddress[]): Promise<WalletUtxo[]> {
  const lists = await Promise.all(
    addresses.map(async (a) => {
      const utxos = await provider.getUtxosForLockingBytecode(a.lock);
      return utxos.map((u) => ({ ...u, path: a.path, index: a.index, address: a.address }));
    }),
  );
  return lists.flat();
}

export function summarize(utxos: WalletUtxo[]) {
  const sats = utxos.reduce((a, u) => a + u.satoshis, 0n);
  const tokens = new Map<string, bigint>();
  for (const u of utxos) {
    if (u.token && u.token.amount > 0n) tokens.set(u.token.category, (tokens.get(u.token.category) ?? 0n) + u.token.amount);
  }
  return { sats, tokens };
}

export interface SignedResult {
  signedTransaction: string;
  txid?: string;
  request: unknown;
}

/**
 * Ask the wallet to sign, then broadcast ourselves (broadcast: false keeps error reporting in the
 * dapp). `walletInputs` maps each input index the wallet must sign to its HD path and index.
 */
export async function signWithWallet(
  manager: DappConnectionManager,
  builder: TransactionBuilder,
  walletInputs: { inputIndex: number; path: WalletPath; index: number }[],
  userPrompt: string,
): Promise<SignedResult> {
  const transaction = builder.generateWcTransactionObject({ broadcast: false, userPrompt });
  const inputPaths: [number, string, number][] = walletInputs.map((w) => [w.inputIndex, w.path, w.index]);
  const request = { transaction, inputPaths };
  const response = await manager.signTransaction(
    request as unknown as Pick<SignTransactionRequest, 'transaction' | 'inputPaths'>,
  );
  if (response.error) throw new Error(`wallet refused: ${response.error}`);
  if (!response.signedTransaction) throw new Error('wallet returned no signed transaction');
  return { signedTransaction: response.signedTransaction, request: { userPrompt, inputPaths } };
}

export function pubkeyHex(a: WalletAddress) {
  return binToHex(a.pubkey);
}
