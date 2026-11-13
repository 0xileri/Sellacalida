// Chipnet runner for the milestone 1 gate. Run on a machine with normal internet access
// (Electrum uses WSS on port 50004).
//
//   npm run chipnet -- keygen            create throwaway chipnet keys in .env.local, print the faucet address
//   npm run chipnet -- status            balances and height
//   npm run chipnet -- genesis           mint a fungible test token (records CHIPNET_TOKEN_CATEGORY)
//   npm run chipnet -- all               cancel, pass, fail, then start noresponse + timeout
//   npm run chipnet -- cancel|pass|fail|noresponse|timeout
//   npm run chipnet -- pending [--wait]  finish NORESPONSE (after 1 block) and timeout (after 19 blocks)
//
//   add --network mocknet to dry-run every step in memory (no keys, no internet).
//
// Writes data/chipnet-state.json (pending escrows) and data/chipnet-results.{json,md} (txids for SPIKE.md).
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  binToHex, decodePrivateKeyWif, encodePrivateKeyWif, generatePrivateKey, hash160, secp256k1,
} from '@bitauth/libauth';
import { MockNetworkProvider, SignatureTemplate } from 'cashscript';
import { makeProvider } from '../../lib/bch/network';
import { fromJson, toJson } from '../../lib/serialize';
import { pkhToCashAddress } from '../../lib/bch/address';
import { p2pkhLockingBytecode } from '../../lib/bch/transactions';
import type { SellacalidaNetwork } from '../../lib/constants';
import {
  finishPending, genesis, scenarioCancel, scenarioFail, scenarioPass, scenarioStartShort, seedMocknet,
  type FlowContext, type Key, type PendingEscrow, type StepResult,
} from './flows';

const ROOT = process.cwd();
const ENV_FILE = join(ROOT, '.env.local');
const DATA = join(ROOT, 'data');
const STATE_FILE = join(DATA, 'chipnet-state.json');
const RESULTS_JSON = join(DATA, 'chipnet-results.json');
const RESULTS_MD = join(DATA, 'chipnet-results.md');

const args = process.argv.slice(2);
const command = args.find((a) => !a.startsWith('--')) ?? 'status';
const network: SellacalidaNetwork = args.includes('--network') ? (args[args.indexOf('--network') + 1] as SellacalidaNetwork) : 'chipnet';
const wait = args.includes('--wait');
if (network === 'mainnet') throw new Error('this runner is chipnet / mocknet only; mainnet comes after chipnet is green');

// ---- env + keys --------------------------------------------------------------------------------

function loadEnv(): Record<string, string> {
  if (!existsSync(ENV_FILE)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(ENV_FILE, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
}

function setEnv(key: string, value: string) {
  const env = loadEnv();
  if (env[key] === value) return;
  if (key in env) {
    const text = readFileSync(ENV_FILE, 'utf8').replace(new RegExp(`^${key}=.*$`, 'm'), `${key}=${value}`);
    writeFileSync(ENV_FILE, text);
  } else {
    appendFileSync(ENV_FILE, `${existsSync(ENV_FILE) ? '' : '# local secrets: never commit (gitignored)\n'}${key}=${value}\n`);
  }
}

function keyFromPriv(label: string, priv: Uint8Array): Key {
  const pk = secp256k1.derivePublicKeyCompressed(priv) as Uint8Array;
  const pkh = hash160(pk);
  return { label, priv, pk, pkh, lock: p2pkhLockingBytecode(pkh), template: new SignatureTemplate(priv) };
}

const ROLES = ['AGENT', 'CHALLENGER', 'VERIFIER', 'FEE_WALLET'] as const;

function loadKeys(): Record<(typeof ROLES)[number], Key> {
  if (network === 'mocknet') {
    return Object.fromEntries(ROLES.map((r) => [r, keyFromPriv(r, generatePrivateKey())])) as Record<(typeof ROLES)[number], Key>;
  }
  const env = loadEnv();
  const out = {} as Record<(typeof ROLES)[number], Key>;
  for (const r of ROLES) {
    const wif = env[`CHIPNET_${r}_WIF`];
    if (!wif) throw new Error(`missing CHIPNET_${r}_WIF in .env.local: run "npm run chipnet -- keygen" first`);
    const d = decodePrivateKeyWif(wif);
    if (typeof d === 'string') throw new Error(`CHIPNET_${r}_WIF: ${d}`);
    out[r] = keyFromPriv(r, d.privateKey);
  }
  return out;
}

// ---- state (bigint / bytes safe JSON) ------------------------------------------------------------

function loadState(): { pending: PendingEscrow[] } {
  if (network === 'mocknet' || !existsSync(STATE_FILE)) return { pending: [] };
  return fromJson(readFileSync(STATE_FILE, 'utf8'));
}

function saveState(state: { pending: PendingEscrow[] }) {
  if (network === 'mocknet') return;
  mkdirSync(DATA, { recursive: true });
  writeFileSync(STATE_FILE, toJson(state, 2));
}

function saveResults(results: StepResult[]) {
  if (network === 'mocknet' || results.length === 0) return;
  mkdirSync(DATA, { recursive: true });
  const prior: StepResult[] = existsSync(RESULTS_JSON) ? JSON.parse(readFileSync(RESULTS_JSON, 'utf8')) : [];
  const all = [...prior, ...results];
  writeFileSync(RESULTS_JSON, JSON.stringify(all, null, 2));
  const rows = all.map((r) => `| ${r.scenario} | ${r.step} | [${r.txid.slice(0, 12)}...](${r.url}) | ${r.note ?? ''} |`);
  writeFileSync(RESULTS_MD, ['| scenario | step | tx | note |', '| --- | --- | --- | --- |', ...rows].join('\n') + '\n');
}

// ---- main ----------------------------------------------------------------------------------------

async function main() {
  if (command === 'keygen') {
    if (network === 'mocknet') throw new Error('keygen is for chipnet');
    const env = loadEnv();
    for (const r of ROLES) {
      if (!env[`CHIPNET_${r}_WIF`]) setEnv(`CHIPNET_${r}_WIF`, encodePrivateKeyWif(generatePrivateKey(), 'testnet'));
    }
    const keys = loadKeys();
    setEnv('NEXT_PUBLIC_CHIPNET_VERIFIER_PK', binToHex(keys.VERIFIER.pk));
    console.log('Throwaway chipnet keys are in .env.local (gitignored). Fund ONLY the agent address:\n');
    console.log(`  agent      ${pkhToCashAddress(keys.AGENT.pkh, 'chipnet')}   <- faucet: https://apecs.dev/bch/faucets`);
    console.log(`  challenger ${pkhToCashAddress(keys.CHALLENGER.pkh, 'chipnet')}`);
    console.log(`  fee wallet ${pkhToCashAddress(keys.FEE_WALLET.pkh, 'chipnet')}`);
    console.log(`  verifier pubkey ${binToHex(keys.VERIFIER.pk)}`);
    console.log('\nThe full "all" run needs about 30,000 chipnet sats on the agent (several faucet drips).');
    return;
  }

  const keys = loadKeys();
  const provider = makeProvider(network, loadEnv().ELECTRUM_HOSTNAME);
  if (provider instanceof MockNetworkProvider) {
    provider.setBlockHeight(300_000);
    seedMocknet(provider, keys.AGENT);
  }

  const ctx: FlowContext = {
    network, provider,
    agent: keys.AGENT, challenger: keys.CHALLENGER, verifier: keys.VERIFIER, feeWallet: keys.FEE_WALLET,
    category: network === 'mocknet' ? undefined : loadEnv().CHIPNET_TOKEN_CATEGORY || undefined,
    log: (l) => console.log(l),
    results: [],
    reachHeight: async (h) => {
      if (provider instanceof MockNetworkProvider) {
        if ((await provider.getBlockHeight()) < h) provider.setBlockHeight(h);
        return true;
      }
      for (;;) {
        const now = await provider.getBlockHeight();
        if (now >= h) return true;
        if (!wait) {
          console.log(`  height ${now} < ${h}: run "npm run chipnet -- pending" again later (or add --wait)`);
          return false;
        }
        console.log(`  height ${now}, waiting for ${h}...`);
        await new Promise((r) => setTimeout(r, 60_000));
      }
    },
  };

  const state = loadState();
  try {
    const needToken = ['all', 'cancel', 'pass', 'fail', 'noresponse', 'timeout'].includes(command);
    if ((command === 'genesis' || needToken) && !ctx.category) {
      const category = await genesis(ctx);
      if (network !== 'mocknet') setEnv('CHIPNET_TOKEN_CATEGORY', category);
    }
    switch (command) {
      case 'status': {
        const h = await provider.getBlockHeight();
        console.log(`network ${network}, height ${h}, token ${ctx.category ?? '(none yet)'}`);
        for (const k of [keys.AGENT, keys.CHALLENGER, keys.FEE_WALLET]) {
          const u = await provider.getUtxosForLockingBytecode(k.lock);
          const sats = u.reduce((a, x) => a + x.satoshis, 0n);
          const tokens = u.filter((x) => x.token?.category === ctx.category).reduce((a, x) => a + x.token!.amount, 0n);
          console.log(`  ${k.label.padEnd(10)} ${pkhToCashAddress(k.pkh, network === 'mocknet' ? 'mocknet' : 'chipnet')}  ${sats} sats, ${tokens} tokens`);
        }
        console.log(`  pending escrows: ${state.pending.length}`);
        break;
      }
      case 'genesis':
        break;
      case 'cancel': await scenarioCancel(ctx); break;
      case 'pass': await scenarioPass(ctx); break;
      case 'fail': await scenarioFail(ctx); break;
      case 'noresponse':
      case 'timeout':
        state.pending.push(await scenarioStartShort(ctx, command));
        break;
      case 'all':
        await scenarioCancel(ctx);
        await scenarioPass(ctx);
        await scenarioFail(ctx);
        state.pending.push(await scenarioStartShort(ctx, 'noresponse'));
        state.pending.push(await scenarioStartShort(ctx, 'timeout'));
        break;
      case 'pending':
        break;
      default:
        throw new Error(`unknown command "${command}"`);
    }
    if (['all', 'pending', 'noresponse', 'timeout'].includes(command) && (command === 'pending' || network === 'mocknet')) {
      const left: PendingEscrow[] = [];
      for (const p of state.pending) if (!(await finishPending(ctx, p))) left.push(p);
      state.pending = left;
    }
  } finally {
    saveState(state);
    saveResults(ctx.results);
  }
  if (ctx.results.length && network !== 'mocknet') console.log(`\nresults appended to ${RESULTS_MD}`);
  if (network === 'mocknet') console.log(`\nmocknet dry run OK: ${ctx.results.length} transactions accepted by the VM`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
