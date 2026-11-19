// Fresh keys for a deployed app (not the milestone runner): the agent hot wallet, the verifier, and
// an optional fee wallet. Pure, so tests can check that what it makes is what the app accepts.
import { binToHex, encodePrivateKeyWif, generatePrivateKey, hash160, secp256k1 } from '@bitauth/libauth';
import { pkhToCashAddress } from '../lib/bch/address';

export interface AppKeys {
  /** secrets: paste into the host's environment variables, nowhere else */
  AGENT_WIF: string;
  VERIFIER_PRIVATE_KEY: string;
  FEE_WALLET_WIF: string;
  /** public: safe to share */
  agentTokenAddress: string;
  agentAddress: string;
  feeWalletAddress: string;
  verifierPk: string;
}

export function makeAppKeys(network: 'mainnet' | 'chipnet'): AppKeys {
  const wifNet = network === 'mainnet' ? 'mainnet' : 'testnet';
  const agent = generatePrivateKey();
  const verifier = generatePrivateKey();
  const fee = generatePrivateKey();
  const pkh = (k: Uint8Array) => hash160(secp256k1.derivePublicKeyCompressed(k) as Uint8Array);
  return {
    AGENT_WIF: encodePrivateKeyWif(agent, wifNet),
    VERIFIER_PRIVATE_KEY: binToHex(verifier),
    FEE_WALLET_WIF: encodePrivateKeyWif(fee, wifNet),
    agentTokenAddress: pkhToCashAddress(pkh(agent), network, true),
    agentAddress: pkhToCashAddress(pkh(agent), network),
    feeWalletAddress: pkhToCashAddress(pkh(fee), network),
    verifierPk: binToHex(secp256k1.derivePublicKeyCompressed(verifier) as Uint8Array),
  };
}
