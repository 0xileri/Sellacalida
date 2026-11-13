'use client';

// WizardConnect wallet spike (spec section 11). Each button is one checklist step; every wallet
// response or error lands in the log, which copies out as markdown for SPIKE.md.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useWallet } from '../providers';
import { hexToBin, sha256, utf8ToBin } from '@bitauth/libauth';
import type { SpendableUtxo } from 'cashscript';
import { PUSD_CATEGORY_MAINNET, type SellacalidaNetwork } from '@/lib/constants';
import { makeOfferContract, type ChallengeTerms, type OfferParams } from '@/lib/contracts';
import { addressToLockingBytecode } from '@/lib/bch/address';
import { explorerTxUrl, makeProvider } from '@/lib/bch/network';
import {
  deriveAddresses, fetchWalletUtxos, signWithWallet, summarize, type WalletAddress, type WalletUtxo,
} from '@/lib/wallet/wizard';
import {
  buildAcceptFromWallet, buildBchTip, buildCancelWithPlaceholders, buildFundOffer, buildKeylessTimeout,
  type WalletTx,
} from '@/lib/wallet/spikeFlows';
import { fromJson, toJson } from '@/lib/serialize';

type Net = Exclude<SellacalidaNetwork, 'mocknet'>;

interface LogEntry {
  at: string;
  step: string;
  ok: boolean;
  detail: string;
  txid?: string;
}

interface SavedOffer {
  network: Net;
  offer: OfferParams;
  txid: string;
  vout: number;
  status: 'open' | 'cancelled' | 'accepted';
}

interface SavedEscrow {
  network: Net;
  offer: OfferParams;
  terms: ChallengeTerms;
  txid: string;
  status: 'locked' | 'refunded';
}

const STORE_KEY = 'sellacalida-spike-v1';

function loadStore(): { offers: SavedOffer[]; escrows: SavedEscrow[] } {
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    if (raw) return fromJson(raw);
  } catch {
    /* storage can be unavailable; the page still works for this visit */
  }
  return { offers: [], escrows: [] };
}

function saveStore(s: { offers: SavedOffer[]; escrows: SavedEscrow[] }) {
  try {
    window.localStorage.setItem(STORE_KEY, toJson(s));
  } catch {
    /* ignore */
  }
}

const defaults = {
  chipnet: {
    category: process.env.NEXT_PUBLIC_CHIPNET_TOKEN_CATEGORY ?? '',
    verifierPk: process.env.NEXT_PUBLIC_CHIPNET_VERIFIER_PK ?? '',
  },
  mainnet: {
    category: PUSD_CATEGORY_MAINNET,
    verifierPk: process.env.NEXT_PUBLIC_VERIFIER_PK ?? '',
  },
};

function short(s: string, n = 8) {
  return s.length > 2 * n + 3 ? `${s.slice(0, n)}...${s.slice(-n)}` : s;
}

export default function ConnectSpike() {
  // the app-wide WizardConnect session (app/providers.tsx), which also renders the QR dialog
  const { wc } = useWallet();
  const [network, setNetwork] = useState<Net>('chipnet');
  const [category, setCategory] = useState(defaults.chipnet.category);
  const [verifierPk, setVerifierPk] = useState(defaults.chipnet.verifierPk);
  const [bond, setBond] = useState('100');
  const [fee, setFee] = useState('20');
  const [tipTo, setTipTo] = useState('');
  const [tipSats, setTipSats] = useState('2000');
  const [addresses, setAddresses] = useState<WalletAddress[]>([]);
  const [utxos, setUtxos] = useState<WalletUtxo[]>([]);
  const [height, setHeight] = useState<number | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);
  // client-only component (ssr: false), so localStorage is available on first render
  const [store, setStore] = useState<{ offers: SavedOffer[]; escrows: SavedEscrow[] }>(loadStore);

  const provider = useMemo(() => makeProvider(network), [network]);

  function changeNetwork(next: Net) {
    setNetwork(next);
    setCategory(defaults[next].category);
    setVerifierPk(defaults[next].verifierPk);
    setAddresses([]);
    setUtxos([]);
    setHeight(null);
  }

  const push = useCallback((e: Omit<LogEntry, 'at'>) => {
    setLog((l) => [{ ...e, at: new Date().toISOString() }, ...l]);
  }, []);

  const updateStore = useCallback((f: (s: typeof store) => typeof store) => {
    setStore((s) => {
      const next = f(s);
      saveStore(next);
      return next;
    });
  }, []);

  const refresh = useCallback(async () => {
    if (!wc.manager) return;
    setBusy('refresh');
    try {
      const addrs = deriveAddresses(wc.manager, network);
      setAddresses(addrs);
      const [u, h] = await Promise.all([fetchWalletUtxos(provider, addrs), provider.getBlockHeight()]);
      setUtxos(u);
      setHeight(h);
      push({ step: 'read address + balances', ok: true, detail: `${addrs.length} addresses derived, ${u.length} UTXOs, height ${h}` });
    } catch (e) {
      push({ step: 'read address + balances', ok: false, detail: String(e instanceof Error ? e.message : e) });
    } finally {
      setBusy(null);
    }
  }, [wc.manager, network, provider, push]);

  useEffect(() => {
    if (wc.state !== 'connected' || !wc.manager) return;
    let cancelled = false;
    void (async () => {
      await Promise.resolve();
      if (cancelled) return;
      push({ step: 'connect', ok: true, detail: `connected to ${wc.walletName ?? 'wallet'}` });
      await refresh();
    })();
    return () => {
      cancelled = true;
    };
    // only on connection changes, not on every refresh identity change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wc.state, wc.manager]);

  const receive0 = addresses.find((a) => a.path === 'receive' && a.index === 0);
  const change0 = addresses.find((a) => a.path === 'change' && a.index === 0) ?? receive0;
  const summary = summarize(utxos);

  function currentOffer(): OfferParams {
    if (!receive0) throw new Error('connect and refresh first');
    if (!/^[0-9a-f]{64}$/.test(category)) throw new Error('token category must be 64 lowercase hex (explorer order)');
    if (!/^0[23][0-9a-f]{64}$/.test(verifierPk)) throw new Error('verifier pubkey must be 33-byte compressed hex');
    return {
      agentPkh: receive0.pkh,
      verifierPk: hexToBin(verifierPk),
      bondAmount: BigInt(bond),
      feeAmount: BigInt(fee),
      tokenCategory: category,
      network,
      maxDeadlineDelta: 144n,
      verifierGraceBlocks: 18n,
    };
  }

  async function run(step: string, make: () => Promise<WalletTx> | WalletTx, after?: (txid: string) => void) {
    if (!wc.manager) return;
    setBusy(step);
    try {
      const tx = await make();
      const signed = await signWithWallet(wc.manager, tx.builder, tx.walletInputs, `Sellacalida spike: ${step}`);
      const txid = await provider.sendRawTransaction(signed.signedTransaction);
      push({ step, ok: true, detail: `inputPaths ${JSON.stringify(tx.walletInputs.map((w) => [w.inputIndex, w.path, w.index]))}`, txid });
      after?.(txid);
      await refresh();
    } catch (e) {
      push({ step, ok: false, detail: String(e instanceof Error ? e.message : e) });
    } finally {
      setBusy(null);
    }
  }

  const fundOffer = () =>
    run('3. send token to P2SH32 (fund offer)', () => {
      const offer = currentOffer();
      return buildFundOffer({ provider, offer, walletUtxos: utxos, tokenChange: receive0!, bchChange: change0! });
    }, (txid) => {
      const offer = currentOffer();
      updateStore((s) => ({ ...s, offers: [{ network, offer, txid, vout: 0, status: 'open' }, ...s.offers] }));
    });

  function offerUtxo(o: SavedOffer): SpendableUtxo {
    const c = makeOfferContract(o.offer, provider);
    return {
      txid: o.txid, vout: o.vout, satoshis: 3000n, lockingBytecode: c.lockingBytecode,
      token: { category: o.offer.tokenCategory, amount: o.offer.bondAmount },
    };
  }

  const cancelOffer = (o: SavedOffer) =>
    run('5. cancel via contract checkSig (placeholders)', () => {
      if (!receive0) throw new Error('connect first');
      return buildCancelWithPlaceholders({ provider, offer: o.offer, offerUtxo: offerUtxo(o), agent: receive0 });
    }, () => updateStore((s) => ({ ...s, offers: s.offers.map((x) => (x.txid === o.txid ? { ...x, status: 'cancelled' } : x)) })));

  const acceptOffer = (o: SavedOffer) => {
    let terms: ChallengeTerms | undefined;
    return run('4+6. accept: contract input unlocked by CashScript, wallet signs token input (with change)', async () => {
      if (!receive0 || height === null) throw new Error('connect and refresh first');
      const r = buildAcceptFromWallet({
        provider, offer: o.offer, offerUtxo: offerUtxo(o), challenger: receive0, walletUtxos: utxos, locktime: height,
        terms: {
          challengeId: sha256.hash(utf8ToBin(`spike:${Date.now()}`)),
          specHash: sha256.hash(utf8ToBin('{"note":"wallet spike","templateId":"spike","version":1}')),
          expiryHeight: BigInt(height + 100),
        },
      });
      terms = r.terms;
      return r;
    }, (txid) => updateStore((s) => ({
      offers: s.offers.map((x) => (x.txid === o.txid ? { ...x, status: 'accepted' } : x)),
      escrows: [{ network, offer: o.offer, terms: terms!, txid, status: 'locked' }, ...s.escrows],
    })));
  };

  const tip = () =>
    run('BCH tip (native send)', () => {
      if (!change0) throw new Error('connect first');
      return buildBchTip({
        provider, walletUtxos: utxos, toLockingBytecode: addressToLockingBytecode(tipTo.trim()), amount: BigInt(tipSats), change: change0,
      });
    });

  async function refund(e: SavedEscrow) {
    setBusy('timeout');
    try {
      const b = buildKeylessTimeout({ provider, offer: e.offer, terms: e.terms, escrowTxid: e.txid });
      const sent = await b.send();
      push({ step: 'timeout refund (keyless)', ok: true, detail: 'refunded bond + fee', txid: sent.txid });
      updateStore((s) => ({ ...s, escrows: s.escrows.map((x) => (x.txid === e.txid ? { ...x, status: 'refunded' } : x)) }));
      await refresh();
    } catch (err) {
      push({ step: 'timeout refund (keyless)', ok: false, detail: String(err instanceof Error ? err.message : err) });
    } finally {
      setBusy(null);
    }
  }

  function copyReport() {
    const lines = [
      `### Wallet spike: ${wc.walletName ?? 'unknown wallet'} on ${network} (${new Date().toISOString().slice(0, 10)})`,
      '',
      '| time (UTC) | step | result | txid / detail |',
      '| --- | --- | --- | --- |',
      ...[...log].reverse().map((e) => {
        const url = e.txid ? explorerTxUrl(network, e.txid) : null;
        const res = e.txid ? `[${short(e.txid)}](${url}) ${e.detail}` : e.detail;
        return `| ${e.at.slice(11, 19)} | ${e.step} | ${e.ok ? 'ok' : 'FAILED'} | ${res.replaceAll('|', '/')} |`;
      }),
    ];
    void navigator.clipboard.writeText(lines.join('\n'));
  }

  const offers = store.offers.filter((o) => o.network === network);
  const escrows = store.escrows.filter((e) => e.network === network);
  const connected = wc.state === 'connected' && !!wc.manager;

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 text-sm">
      <h1 className="text-2xl font-semibold">Wallet spike</h1>
      <p className="mt-1 text-[var(--muted)]">
        Milestone 1 checklist from the spec, section 11. Use tiny amounts. Results go in SPIKE.md.
      </p>

      <section className="mt-6 grid gap-3 rounded-lg border border-[var(--line)] p-4">
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2">
            Network
            <select
              className="rounded border border-[var(--line)] bg-[var(--panel)] px-2 py-1"
              value={network}
              onChange={(e) => changeNetwork(e.target.value as Net)}
            >
              <option value="chipnet">chipnet</option>
              <option value="mainnet">mainnet</option>
            </select>
          </label>
          {!connected ? (
            <button className="btn" onClick={() => wc.connect()} disabled={wc.state === 'connecting' || wc.state === 'reconnecting'}>
              {wc.state === 'connecting' || wc.state === 'reconnecting' ? 'Waiting for wallet...' : '1. Connect wallet (WizardConnect)'}
            </button>
          ) : (
            <>
              <span>Connected: <b>{wc.walletName ?? 'wallet'}</b></span>
              <button className="btn-ghost" onClick={() => void refresh()} disabled={!!busy}>Refresh</button>
              <button className="btn-ghost" onClick={() => void wc.disconnect()}>Disconnect</button>
            </>
          )}
        </div>
        <p className="text-[var(--muted)]">
          Connection: <b>{wc.state}</b>
          {wc.state === 'disconnected' && ' (the relay or the wallet dropped the session; press connect to try again)'}
          {wc.state === 'reconnecting' && ' (relay connection lost, retrying)'}
        </p>
        {wc.error && <p className="text-[var(--bad)]">{wc.error}</p>}
        <label className="grid gap-1">
          Token category (explorer order){network === 'mainnet' && ' (PUSD mainnet-v1)'}
          <input className="field font-mono" value={category} onChange={(e) => setCategory(e.target.value.trim().toLowerCase())} />
        </label>
        <label className="grid gap-1">
          Verifier pubkey (33-byte hex, from <code>npm run chipnet -- keygen</code>)
          <input className="field font-mono" value={verifierPk} onChange={(e) => setVerifierPk(e.target.value.trim().toLowerCase())} />
        </label>
      </section>

      {connected && (
        <section className="mt-4 grid gap-2 rounded-lg border border-[var(--line)] p-4">
          <h2 className="font-semibold">2. Address and balances</h2>
          {receive0 ? (
            <>
              <div className="font-mono break-all">{receive0.tokenAddress}</div>
              <div className="text-[var(--muted)] font-mono break-all">{receive0.address}</div>
            </>
          ) : (
            <div className="text-[var(--muted)]">No receive path yet. Press Refresh after the wallet finishes connecting.</div>
          )}
          <div>
            BCH: <b>{summary.sats.toString()}</b> sats across {utxos.length} UTXOs; height {height ?? '...'}
          </div>
          {[...summary.tokens].map(([cat, amt]) => (
            <div key={cat} className="font-mono">
              {short(cat)}: {amt.toString()} base units{cat === category ? '  (selected)' : ''}
            </div>
          ))}
        </section>
      )}

      {connected && (
        <section className="mt-4 grid gap-3 rounded-lg border border-[var(--line)] p-4">
          <h2 className="font-semibold">3. Fund an offer (token into a P2SH32 contract)</h2>
          <div className="flex flex-wrap gap-3">
            <label className="grid gap-1">Bond (base units)<input className="field w-32" value={bond} onChange={(e) => setBond(e.target.value)} /></label>
            <label className="grid gap-1">Fee (base units)<input className="field w-32" value={fee} onChange={(e) => setFee(e.target.value)} /></label>
          </div>
          <button className="btn w-fit" onClick={() => void fundOffer()} disabled={!!busy}>Send bond to offer contract</button>

          {offers.length > 0 && (
            <div className="grid gap-2">
              <h3 className="font-semibold">Offers from this browser</h3>
              {offers.map((o) => (
                <div key={o.txid} className="flex flex-wrap items-center gap-2 rounded border border-[var(--line)] p-2">
                  <a className="font-mono underline" href={explorerTxUrl(network, o.txid) ?? '#'} target="_blank" rel="noreferrer">{short(o.txid)}</a>
                  <span>bond {o.offer.bondAmount.toString()} / fee {o.offer.feeAmount.toString()}</span>
                  <span className="text-[var(--muted)]">{o.status}</span>
                  {o.status === 'open' && (
                    <>
                      <button className="btn-ghost" onClick={() => void cancelOffer(o)} disabled={!!busy}>5. Cancel (placeholders)</button>
                      <button className="btn-ghost" onClick={() => void acceptOffer(o)} disabled={!!busy}>4+6. Accept (token change)</button>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}

          {escrows.length > 0 && (
            <div className="grid gap-2">
              <h3 className="font-semibold">Escrows from this browser</h3>
              {escrows.map((e) => (
                <div key={e.txid} className="flex flex-wrap items-center gap-2 rounded border border-[var(--line)] p-2">
                  <a className="font-mono underline" href={explorerTxUrl(network, e.txid) ?? '#'} target="_blank" rel="noreferrer">{short(e.txid)}</a>
                  <span>expiry {e.terms.expiryHeight.toString()}</span>
                  <span className="text-[var(--muted)]">{e.status}</span>
                  {e.status === 'locked' && (
                    <button
                      className="btn-ghost"
                      onClick={() => void refund(e)}
                      disabled={!!busy || height === null || BigInt(height) < e.terms.expiryHeight}
                    >
                      Refund after expiry
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {connected && (
        <section className="mt-4 grid gap-3 rounded-lg border border-[var(--line)] p-4">
          <h2 className="font-semibold">Native BCH tip</h2>
          <div className="flex flex-wrap gap-3">
            <label className="grid flex-1 gap-1">To (cashaddr)<input className="field font-mono" value={tipTo} onChange={(e) => setTipTo(e.target.value)} /></label>
            <label className="grid gap-1">Sats<input className="field w-28" value={tipSats} onChange={(e) => setTipSats(e.target.value)} /></label>
          </div>
          <button className="btn w-fit" onClick={() => void tip()} disabled={!!busy || !tipTo}>Send tip</button>
        </section>
      )}

      <section className="mt-4 grid gap-2 rounded-lg border border-[var(--line)] p-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">7. Log</h2>
          <button className="btn-ghost" onClick={copyReport} disabled={log.length === 0}>Copy as markdown</button>
        </div>
        {busy && <div className="text-[var(--muted)]">Working: {busy}...</div>}
        {log.length === 0 && <div className="text-[var(--muted)]">Nothing yet.</div>}
        {log.map((e) => (
          <div key={e.at + e.step} className="grid gap-0.5 border-t border-[var(--line)] pt-2">
            <div>
              <span className={e.ok ? 'text-[var(--good)]' : 'text-[var(--bad)]'}>{e.ok ? 'ok' : 'failed'}</span> {e.step}
            </div>
            {e.txid && (
              <a className="font-mono underline break-all" href={explorerTxUrl(network, e.txid) ?? '#'} target="_blank" rel="noreferrer">{e.txid}</a>
            )}
            <div className="font-mono break-all text-[var(--muted)]">{e.detail}</div>
          </div>
        ))}
      </section>

      <p className="mt-6 text-xs text-[var(--muted)]">
        Contract inputs never ask the wallet for keys except the cancel path, which uses placeholderSignature and
        placeholderPublicKey. Everything here is stored only in this browser.
      </p>
    </div>
  );
}
