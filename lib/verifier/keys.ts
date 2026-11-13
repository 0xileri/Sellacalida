// Server-side key loading. Keys come only from the environment (.env.local), never from the repo
// or the client bundle. Nothing under app/ with "use client" may import lib/verifier.
import { decodePrivateKeyWif, hash160, hexToBin, secp256k1 } from '@bitauth/libauth';
import { SignatureTemplate } from 'cashscript';
import { p2pkhLockingBytecode } from '../bch/transactions';

function decodeKey(name: string, value: string): Uint8Array {
  const v = value.trim();
  if (/^[0-9a-f]{64}$/i.test(v)) {
    const key = hexToBin(v.toLowerCase());
    if (!secp256k1.validatePrivateKey(key)) throw new Error(`${name} is not a valid private key`);
    return key;
  }
  const d = decodePrivateKeyWif(v);
  if (typeof d === 'string') throw new Error(`${name}: ${d}`);
  return d.privateKey;
}

export function loadVerifierKeys(env: Record<string, string | undefined> = process.env) {
  const raw = env.VERIFIER_PRIVATE_KEY;
  if (!raw) throw new Error('VERIFIER_PRIVATE_KEY is not set (put it in .env.local)');
  const verifierPrivateKey = decodeKey('VERIFIER_PRIVATE_KEY', raw);
  let feeWallet: { template: SignatureTemplate; lock: Uint8Array } | undefined;
  if (env.FEE_WALLET_WIF) {
    const priv = decodeKey('FEE_WALLET_WIF', env.FEE_WALLET_WIF);
    const pk = secp256k1.derivePublicKeyCompressed(priv) as Uint8Array;
    feeWallet = { template: new SignatureTemplate(priv), lock: p2pkhLockingBytecode(hash160(pk)) };
  }
  return { verifierPrivateKey, feeWallet };
}
