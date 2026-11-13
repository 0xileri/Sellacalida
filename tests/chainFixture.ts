// A real (mocknet) transaction with a known mix of outputs, used by the checker and verifier tests.
//
//   out0  alice P2PKH        1000 sats  FT  cat A x50
//   out1  bob   P2PKH        2000 sats  NFT cat A commitment aa
//   out2  alice P2PKH        3000 sats  (no token)
//   out3  P2SH32             1500 sats  NFT cat A commitment bb
//   out4  carol P2PKH        1000 sats  FT  cat B x7
//   out5  dave  P2PKH        change     (no token)
import { binToHex, sha256, utf8ToBin } from '@bitauth/libauth';
import { TransactionBuilder, type MockNetworkProvider } from 'cashscript';
import { pkhToCashAddress, lockingBytecodeToAddress } from '@/lib/bch/address';
import { p2sh32LockingBytecode } from '@/lib/encodeRedeemScript';
import { addUtxo, party } from './helpers';

export const alice = party('fixture-alice');
export const bob = party('fixture-bob');
export const carol = party('fixture-carol');
export const dave = party('fixture-dave');
export const CAT_A = binToHex(sha256.hash(utf8ToBin('fixture-category-A')));
export const CAT_B = binToHex(sha256.hash(utf8ToBin('fixture-category-B')));
export const CAT_C = binToHex(sha256.hash(utf8ToBin('fixture-category-C')));
export const P2SH32_LOCK = p2sh32LockingBytecode(utf8ToBin('fixture redeem script'));

export async function makeFixtureTx(provider: MockNetworkProvider) {
  const inA = addUtxo(provider, alice.lockHex, 2000n, {
    category: CAT_A, amount: 50n, nft: { capability: 'minting', commitment: '' },
  });
  const inB = addUtxo(provider, alice.lockHex, 2000n, { category: CAT_B, amount: 7n });
  const inBch = addUtxo(provider, alice.lockHex, 20_000n);
  const b = new TransactionBuilder({ provider });
  for (const u of [inA, inB, inBch]) b.addInput(u, alice.template.unlockP2PKH());
  b.addOutput({ to: alice.lock, amount: 1000n, token: { category: CAT_A, amount: 50n } });
  b.addOutput({ to: bob.lock, amount: 2000n, token: { category: CAT_A, amount: 0n, nft: { capability: 'none', commitment: 'aa' } } });
  b.addOutput({ to: alice.lock, amount: 3000n });
  b.addOutput({ to: P2SH32_LOCK, amount: 1500n, token: { category: CAT_A, amount: 0n, nft: { capability: 'none', commitment: 'bb' } } });
  b.addOutput({ to: carol.lock, amount: 1000n, token: { category: CAT_B, amount: 7n } });
  b.addOutput({ to: dave.lock, amount: 24_000n - 8500n - 1500n });
  const { txid } = await b.send();
  return {
    txid,
    rawHex: await provider.getRawTransaction(txid),
    addresses: {
      alice: pkhToCashAddress(alice.pkh, 'mocknet'),
      aliceTokenAware: pkhToCashAddress(alice.pkh, 'mocknet', true),
      bob: pkhToCashAddress(bob.pkh, 'mocknet'),
      nobody: pkhToCashAddress(sha256.hash(utf8ToBin('nobody')).slice(0, 20), 'mocknet'),
      p2sh32: lockingBytecodeToAddress(P2SH32_LOCK, 'mocknet'),
    },
  };
}
