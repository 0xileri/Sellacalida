// Contract runner for the milestone 1 gate: chipnet, a capped mainnet run, or a mocknet dry run.
// Run on a machine with normal internet access (Electrum uses WSS on port 50004).
//
//   npm run chipnet -- keygen            create throwaway chipnet keys in .env.local, print the faucet address
//   npm run chipnet -- status            balances and height
//   npm run chipnet -- genesis           mint a fungible test token (records CHIPNET_TOKEN_CATEGORY)
//   npm run chipnet -- all               cancel, pass, fail, then start noresponse + timeout
//   npm run chipnet -- cancel|pass|fail|noresponse|timeout
//   npm run chipnet -- pending [--wait]  finish NORESPONSE (after 1 block) and timeout (after 19 blocks)
//   npm run chipnet -- reclaim           cancel any bond left in an offer contract by a stopped run
//   npm run chipnet -- sweep <address>   send everything the throwaway keys hold to your own wallet
//
//   npm run mainnet -- <same commands>   the same on mainnet with real PUSD (no genesis): bonds of
//                                        0.05 PUSD, hot-wallet caps, and a y/N prompt before every
//                                        broadcast (add --yes to skip the prompts)
//
//   add --network mocknet to dry-run every step in memory (no keys, no internet); add
//   --mainnet-amounts --confirm to rehearse a mainnet step, prompts included, with play money.
//
// Writes data/<network>-state.json (pending escrows) and data/<network>-results.{json,md} (txids for SPIKE.md).
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import {
  binToHex, decodePrivateKeyWif, encodePrivateKeyWif, generatePrivateKey, hash160, secp256k1,
} from '@bitauth/libauth';
import { MockNetworkProvider, SignatureTemplate } from 'cashscript';
import { assertChainMatchesNetwork, makeProvider } from '../../lib/bch/network';
import { fromJson, toJson } from '../../lib/serialize';
import { networkPrefix, pkhToCashAddress } from '../../lib/bch/address';
import { p2pkhLockingBytecode } from '../../lib/bch/transactions';
import { PUSD_CATEGORY_MAINNET, type SellacalidaNetwork } from '../../lib/constants';
import {
  CHIPNET_AMOUNTS, MAINNET_AMOUNTS, checkMainnetCaps, confirmingProvider, finishPending, genesis, parseSweepDestination,
  reclaimOffers, scenarioCancel, scenarioFail, scenarioPass, scenarioStartShort, seedMocknet, sweep, waitForHeight,
  type FlowContext, type Key, type PendingEscrow, type StepResult,
} from './flows';

// ---- arguments -----------------------------------------------------------------------------------

const positional: string[] = [];
const flags = new Set<string>();
let network: SellacalidaNetwork = 'chipnet';
{
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--network') network = argv[++i] as SellacalidaNetwork;
    else if (argv[i].startsWith('--')) flags.add(argv[i]);
    else positional.push(argv[i]);
  }
}
if (!['chipnet', 'mainnet', 'mocknet'].includes(network)) throw new Error(`unknown network "${network}"`);
const command = positional[0] ?? 'status';
const wait = flags.has('--wait');
const assumeYes = flags.has('--yes');
const rehearse = flags.has('--confirm');
const mainnet = network === 'mainnet';

const ROOT = process.cwd();
const ENV_FILE = join(ROOT, '.env.local');
const DATA = join(ROOT, 'data');
const STATE_FILE = join(DATA, `${network}-state.json`);
const RESULTS_JSON = join(DATA, `${network}-results.json`);
const RESULTS_MD = join(DATA, `${network}-results.md`);
/** chipnet and mainnet keys never mix: each network has its own CHIPNET_* / MAINNET_* entries */
const ENV_PREFIX = mainnet ? 'MAINNET' : 'CHIPNET';

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
    const name = `${ENV_PREFIX}_${r}_WIF`;
    const wif = env[name];
    if (!wif) throw new Error(`missing ${name} in .env.local: run "npm run ${mainnet ? 'mainnet' : 'chipnet'} -- keygen" first`);
    const d = decodePrivateKeyWif(wif);
    if (typeof d === 'string') throw new Error(`${name}: ${d}`);
    if (d.type !== (mainnet ? 'mainnet' : 'testnet')) throw new Error(`${name} is a ${d.type} key; this is a ${network} run`);
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

// ---- mainnet: ask before every broadcast ---------------------------------------------------------

// One reader for the whole run, with a queue: piped answers that arrive before a prompt are kept,
// and once stdin ends every further prompt is a "no" (never a hang, never a silent exit).
const answers: string[] = [];
let waiting: ((line: string | null) => void) | null = null;
let inputEnded = false;
let reader: ReturnType<typeof createInterface> | null = null;

function startReader() {
  if (reader) return;
  reader = createInterface({ input: process.stdin, output: process.stdout, terminal: Boolean(process.stdin.isTTY) });
  reader.on('line', (line) => {
    if (waiting) {
      const w = waiting;
      waiting = null;
      w(line);
    } else answers.push(line);
  });
  reader.on('close', () => {
    inputEnded = true;
    if (waiting) {
      const w = waiting;
      waiting = null;
      w(null);
    }
  });
}

/** y / yes broadcasts; anything else, or no input left, is a no. */
function ask(question: string): Promise<boolean> {
  startReader();
  // the reader's own prompt, so a redraw while typing (backspace) keeps the question on screen
  reader!.setPrompt(question);
  reader!.prompt(true);
  return new Promise((resolve) => {
    const done = (line: string | null) => {
      if (line === null) process.stdout.write('(no input: treated as no)\n');
      else if (!process.stdin.isTTY) process.stdout.write(`${line}\n`);
      resolve(line !== null && /^y(es)?$/i.test(line.trim()));
    };
    if (answers.length) done(answers.shift()!);
    else if (inputEnded) done(null);
    else waiting = done;
  });
}

// ---- main ----------------------------------------------------------------------------------------

async function main() {
  if (command === 'keygen') {
    if (network === 'mocknet') throw new Error('keygen is for chipnet or mainnet');
    const env = loadEnv();
    for (const r of ROLES) {
      const name = `${ENV_PREFIX}_${r}_WIF`;
      if (!env[name]) setEnv(name, encodePrivateKeyWif(generatePrivateKey(), mainnet ? 'mainnet' : 'testnet'));
    }
    const keys = loadKeys();
    setEnv(`NEXT_PUBLIC_${ENV_PREFIX}_VERIFIER_PK`, binToHex(keys.VERIFIER.pk));
    console.log(`Throwaway ${network} keys are in .env.local (gitignored). Fund ONLY the agent address:\n`);
    if (mainnet) {
      console.log(`  agent      ${pkhToCashAddress(keys.AGENT.pkh, network, true)}   <- ~30,000 sats of BCH and ~0.35 PUSD`);
      console.log(`             (same key, plain form for wallets that only send BCH: ${pkhToCashAddress(keys.AGENT.pkh, network)})`);
    } else {
      console.log(`  agent      ${pkhToCashAddress(keys.AGENT.pkh, network)}   <- faucet: https://apecs.dev/bch/faucets`);
    }
    console.log(`  challenger ${pkhToCashAddress(keys.CHALLENGER.pkh, network)}`);
    console.log(`  fee wallet ${pkhToCashAddress(keys.FEE_WALLET.pkh, network)}`);
    console.log(`  verifier pubkey ${binToHex(keys.VERIFIER.pk)}`);
    if (mainnet) {
      console.log('\nThese keys hold real money in a plaintext file. Keep the balance tiny: the runner refuses an agent');
      console.log('holding more than 1,000,000 sats or 20 PUSD. When you are done, run "npm run mainnet -- sweep <your address>".');
    } else {
      console.log('\nThe full "all" run needs about 30,000 chipnet sats on the agent (several faucet drips).');
    }
    return;
  }

  const keys = loadKeys();
  const raw = makeProvider(network, loadEnv().ELECTRUM_HOSTNAME);
  if (raw instanceof MockNetworkProvider) {
    raw.setBlockHeight(300_000);
    seedMocknet(raw, keys.AGENT);
  }
  await assertChainMatchesNetwork(raw, network);
  if (mainnet && assumeYes) console.log('--yes: mainnet broadcasts will NOT ask first');
  const provider = (mainnet && !assumeYes) || rehearse ? confirmingProvider(raw, network, ask) : raw;

  const ctx: FlowContext = {
    network, provider,
    agent: keys.AGENT, challenger: keys.CHALLENGER, verifier: keys.VERIFIER, feeWallet: keys.FEE_WALLET,
    category: mainnet ? PUSD_CATEGORY_MAINNET : network === 'mocknet' ? undefined : loadEnv().CHIPNET_TOKEN_CATEGORY || undefined,
    amounts: mainnet || flags.has('--mainnet-amounts') ? MAINNET_AMOUNTS : CHIPNET_AMOUNTS,
    log: (l) => console.log(l),
    results: [],
    reachHeight: async (h) => {
      if (raw instanceof MockNetworkProvider) {
        if ((await raw.getBlockHeight()) < h) raw.setBlockHeight(h);
        return true;
      }
      return waitForHeight(() => raw.getBlockHeight(), h, { wait, log: (l) => console.log(l) });
    },
  };

  const spends = ['all', 'cancel', 'pass', 'fail', 'noresponse', 'timeout', 'pending', 'reclaim'].includes(command);
  if (mainnet && spends) await checkMainnetCaps(ctx);

  const state = loadState();
  try {
    const needToken = ['all', 'cancel', 'pass', 'fail', 'noresponse', 'timeout'].includes(command);
    if ((command === 'genesis' || needToken) && !ctx.category) {
      const category = await genesis(ctx);
      if (network !== 'mocknet') setEnv('CHIPNET_TOKEN_CATEGORY', category);
    }
    switch (command) {
      case 'status': {
        const h = await raw.getBlockHeight();
        console.log(`network ${network}, height ${h}, token ${ctx.category ?? '(none yet)'}${mainnet ? ' (PUSD)' : ''}`);
        for (const k of [keys.AGENT, keys.CHALLENGER, keys.FEE_WALLET]) {
          const u = await raw.getUtxosForLockingBytecode(k.lock);
          const sats = u.reduce((a, x) => a + x.satoshis, 0n);
          const tokens = u.filter((x) => x.token?.category === ctx.category).reduce((a, x) => a + x.token!.amount, 0n);
          console.log(`  ${k.label.padEnd(10)} ${pkhToCashAddress(k.pkh, network)}  ${sats} sats, ${tokens} token base units`);
        }
        console.log(`  pending escrows: ${state.pending.length}`);
        break;
      }
      case 'genesis':
        if (mainnet) throw new Error('no genesis on mainnet: bonds are PUSD');
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
      case 'reclaim':
        await reclaimOffers(ctx);
        break;
      case 'sweep': {
        const to = positional[1];
        if (!to) throw new Error(`usage: sweep <your ${networkPrefix(network)}: address>`);
        const own = [keys.AGENT, keys.CHALLENGER, keys.FEE_WALLET, keys.VERIFIER];
        const dest = parseSweepDestination(to, network, own);
        if (state.pending.length) console.log(`  note: ${state.pending.length} escrow(s) still open; run "pending" first to get those back`);
        await sweep(ctx, [keys.AGENT, keys.CHALLENGER, keys.FEE_WALLET], dest);
        break;
      }
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
