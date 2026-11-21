// Send a deployed app's funds back to your own wallet:
//
//   npm run withdraw -- <your bitcoincash:z... address>
//   options: --site https://sellacalida.up.railway.app   where to find the agent's open bonds
//            --network mainnet | chipnet                 (default mainnet)
//
// Before running it, stop the app posting new bonds: set AUTO_OFFERS=0 on its Railway service and let
// it redeploy. Otherwise the app can re-bond with the funds you are withdrawing.
//
// It asks for AGENT_WIF and FEE_WALLET_WIF with the input hidden (copy them from Railway > the mainnet
// service > Variables). They are used in memory for this run only: never saved, never in your shell
// history. Then it cancels the agent's open bonds back to the agent and sweeps the agent and the fee
// wallet (BCH and PUSD) to your address. Every broadcast shows its outputs and waits for "y".
import { decodePrivateKeyWif, hash160, secp256k1 } from '@bitauth/libauth';
import { SignatureTemplate } from 'cashscript';
import { pkhToCashAddress } from '../lib/bch/address';
import { assertChainMatchesNetwork, makeProvider } from '../lib/bch/network';
import { p2pkhLockingBytecode } from '../lib/bch/transactions';
import type { SellacalidaNetwork } from '../lib/constants';
import type { OfferView } from '../lib/wire';
import { confirmingProvider, parseSweepDestination, sweep, type FlowContext, type Key } from './chipnet/flows';
import { ask, askHidden } from './prompt';
import { bondsOf, cancelBonds } from './appWithdraw';

const argv = process.argv.slice(2);
const opt = (name: string) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined);
const network = (opt('--network') ?? 'mainnet') as SellacalidaNetwork;
const site = (opt('--site') ?? 'https://sellacalida.up.railway.app').replace(/\/+$/, '');
const dest = argv.find((a, i) => !a.startsWith('--') && !['--network', '--site'].includes(argv[i - 1] ?? ''));

function keyFromWif(label: string, wif: string): Key {
  const d = decodePrivateKeyWif(wif);
  if (typeof d === 'string') throw new Error(`${label}: ${d}`);
  const mainnetKey = d.type === 'mainnet' || d.type === 'mainnetUncompressed';
  if (mainnetKey !== (network === 'mainnet')) throw new Error(`${label} is a ${mainnetKey ? 'mainnet' : 'testnet'} key; this is ${network}`);
  const pk = secp256k1.derivePublicKeyCompressed(d.privateKey) as Uint8Array;
  const pkh = hash160(pk);
  return { label, priv: d.privateKey, pk, pkh, lock: p2pkhLockingBytecode(pkh), template: new SignatureTemplate(d.privateKey) };
}

async function main() {
  if (network !== 'mainnet' && network !== 'chipnet') throw new Error('--network must be mainnet or chipnet');
  if (!dest) throw new Error('usage: npm run withdraw -- <your bitcoincash:z... address> [--site URL]');

  console.log(`Withdraw the app's ${network} funds to ${dest}\n`);
  const agent = keyFromWif('AGENT_WIF', await askHidden('Paste AGENT_WIF (hidden): '));
  const feeWif = await askHidden('Paste FEE_WALLET_WIF, or press Enter to skip (hidden): ');
  const fee = feeWif ? keyFromWif('FEE_WALLET_WIF', feeWif) : null;
  const keys = fee ? [agent, fee] : [agent];
  const to = parseSweepDestination(dest, network, keys);

  const raw = makeProvider(network, process.env.ELECTRUM_HOSTNAME);
  await assertChainMatchesNetwork(raw, network);
  for (const k of keys) {
    const u = await raw.getUtxosForLockingBytecode(k.lock);
    const sats = u.reduce((a, x) => a + x.satoshis, 0n);
    const tokens = u.reduce((a, x) => a + (x.token?.amount ?? 0n), 0n);
    console.log(`  ${k.label.padEnd(15)} ${pkhToCashAddress(k.pkh, network)}  ${sats} sats, ${tokens} token base units`);
  }

  let offers: OfferView[] = [];
  try {
    const r = await fetch(`${site}/api/offers`);
    offers = ((await r.json()) as { open: OfferView[] }).open;
  } catch (e) {
    console.log(`  could not read ${site}/api/offers (${e instanceof Error ? e.message : e}); only the wallets will be swept`);
  }
  const bonds = bondsOf(offers, agent);
  console.log(`  open bonds posted by this agent on ${site}: ${bonds.length}`);

  if (!(await ask('\nHas the app stopped posting bonds (AUTO_OFFERS=0 on Railway, redeployed)? [y/N] '))) {
    console.log('Nothing sent. Set AUTO_OFFERS=0 on the app first, then run this again.');
    process.exit(0);
  }

  const ctx: FlowContext = {
    network, provider: confirmingProvider(raw, network, ask), agent, challenger: agent, verifier: agent, feeWallet: fee ?? agent,
    log: (l) => console.log(l), results: [], reachHeight: async () => true,
  };
  await cancelBonds(ctx, agent, bonds);
  await sweep(ctx, keys, to);
  console.log('\nDone. Transactions:');
  for (const r of ctx.results) console.log(`  ${r.step.padEnd(22)} ${r.url ?? r.txid}`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
