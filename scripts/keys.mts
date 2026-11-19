// Print fresh keys for the deployed app (mainnet by default):
//
//   npm run keys                      mainnet
//   npm run keys -- --network chipnet
//
// Nothing is written to disk. Copy each secret straight into the host's environment variables
// (Railway > service > Variables). Never paste them into a chat, an issue or a commit.
import { makeAppKeys } from './appKeys';

const args = process.argv.slice(2);
const i = args.indexOf('--network');
const network = i >= 0 ? args[i + 1] : 'mainnet';
if (network !== 'mainnet' && network !== 'chipnet') throw new Error('--network must be mainnet or chipnet');

const k = makeAppKeys(network);
console.log(`Fresh ${network} keys for the deployed app. Shown once, saved nowhere.

SECRETS: paste each into Railway > web > Variables. Never into a chat, an issue or a commit.

  AGENT_WIF=${k.AGENT_WIF}
  VERIFIER_PRIVATE_KEY=${k.VERIFIER_PRIVATE_KEY}
  FEE_WALLET_WIF=${k.FEE_WALLET_WIF}

PUBLIC: safe to share.

  agent (fund with PUSD and BCH)   ${k.agentTokenAddress}
  agent, plain form for BCH sends  ${k.agentAddress}
  fee wallet (optional, BCH only)  ${k.feeWalletAddress}
  verifier public key              ${k.verifierPk}

Keep the agent tiny: the app refuses to publish bonds while it holds more than 1,000,000 sats or 20 PUSD.
`);
