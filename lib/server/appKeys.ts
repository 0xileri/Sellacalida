// Fresh mainnet keys for the long-running app (Railway). Pure: nothing here touches the disk.
// The milestone runner's keygen is separate and writes throwaway keys into .env.local.
import { binToHex, encodePrivateKeyWif, generatePrivateKey, hash160, secp256k1 } from '@bitauth/libauth';
import { randomBytes } from 'node:crypto';
import { pkhToCashAddress } from '../bch/address';

export interface AppKeys {
  agentWif: string;
  agentAddress: string;
  agentTokenAddress: string;
  verifierWif: string;
  verifierPk: string;
  feeWalletWif: string;
  feeWalletAddress: string;
  adminToken: string;
}

function wifKey() {
  const priv = generatePrivateKey();
  const pk = secp256k1.derivePublicKeyCompressed(priv);
  if (typeof pk === 'string') throw new Error(pk);
  return { wif: encodePrivateKeyWif(priv, 'mainnet'), pk, pkh: hash160(pk) };
}

/** New mainnet keys. Does not touch the filesystem. */
export function generateAppKeys(): AppKeys {
  const agent = wifKey();
  const verifier = wifKey();
  const fee = wifKey();
  return {
    agentWif: agent.wif,
    agentAddress: pkhToCashAddress(agent.pkh, 'mainnet'),
    agentTokenAddress: pkhToCashAddress(agent.pkh, 'mainnet', true),
    verifierWif: verifier.wif,
    verifierPk: binToHex(verifier.pk),
    feeWalletWif: fee.wif,
    feeWalletAddress: pkhToCashAddress(fee.pkh, 'mainnet'),
    adminToken: randomBytes(32).toString('hex'),
  };
}

export function formatAppKeys(k: AppKeys): string {
  return [
    'Sellacalida mainnet keys. Shown once. Not written to disk.',
    'Paste into the Railway service variables, then clear the terminal scrollback.',
    '',
    `AGENT_WIF=${k.agentWif}`,
    `VERIFIER_PRIVATE_KEY=${k.verifierWif}`,
    `FEE_WALLET_WIF=${k.feeWalletWif}`,
    `ADMIN_TOKEN=${k.adminToken}`,
    '',
    'Fund only the agent. Stay under 1,000,000 sats and 20.00 PUSD (2000 base units).',
    `Agent, PUSD send: ${k.agentTokenAddress}`,
    `Agent, plain BCH: ${k.agentAddress}`,
    `Fee wallet (plain BCH for settle fees): ${k.feeWalletAddress}`,
    `Verifier pubkey (public, not a secret): ${k.verifierPk}`,
    '',
    'Also set NETWORK=mainnet, DATA_DIR=/app/data, OFFER_BOND=100, OFFER_FEE=20.',
    'The bond cap is 1.00 PUSD and the demo fee is 0.20 PUSD. See DEPLOY.md.',
    '',
  ].join('\n');
}
