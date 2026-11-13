# Wallet spike report (milestone 1)

Spec: `SELLACALIDA_SPEC.md` section 11. Gate date: 16 November 2026 (WAT).

## Status

| Area | Status |
| --- | --- |
| Contracts on mocknet | **Green.** 183 vitest tests, `npm test`. |
| Spike flows with a simulated wallet | **Green on mocknet.** `tests/spikeFlows.test.ts` signs every `/connect` flow with a mock WizardConnect wallet (fills P2PKH and contract placeholders the way Paytaca is documented to). This is not a real wallet result. |
| Chipnet runs | **Not run yet.** The build container cannot reach Electrum (WSS on port 50004) or the WizardConnect relay, so chipnet has to be run from a normal machine. Commands below. |
| Real wallets (Paytaca, Selene) | **Not run yet.** Needs a phone or browser wallet. Fill in the tables below. |
| Funding path decision | **Pending the real-wallet rows.** Default plan: test token / PUSD through WizardConnect. Fallbacks in order: the other wallet, an XO template for the token send, then BCH-only bonds. |

Nothing in this file claims a wallet result that has not happened.

## How to run the chipnet part

```bash
npm install
npm run chipnet -- keygen      # throwaway keys into .env.local, prints the agent faucet address
# fund the agent address at https://apecs.dev/bch/faucets (about 30,000 sats for the full run)
npm run chipnet -- status
npm run chipnet -- all         # genesis, cancel, pass, fail, starts noresponse + timeout
npm run chipnet -- pending --wait   # NORESPONSE after 1 block, timeout after 19 blocks (~3 h)
```

Txids land in `data/chipnet-results.md` (gitignored). Paste the table below.
Dry run anywhere, no keys or network: `npm run chipnet -- all --network mocknet`.

## How to run the wallet part

```bash
npm run dev    # then open http://localhost:3000/connect
```

1. Pick chipnet. Paste the test token category (`CHIPNET_TOKEN_CATEGORY` from `.env.local`) and the verifier pubkey (`NEXT_PUBLIC_CHIPNET_VERIFIER_PK`; both prefill if `.env.local` is loaded by `next dev`).
2. Send some test token from the agent key to the wallet's token address first (any CashTokens wallet, or Cashonize on chipnet).
3. Press the numbered buttons in order. Every response or error goes to the log. Press "Copy as markdown" and paste it below.

## Checklist (fill in)

Wallet: ______  Version: ______  Network: ______  Date (WAT): ______

| # | Step | Result | Txid | Notes |
| --- | --- | --- | --- | --- |
| 1 | Connect over WizardConnect | | | |
| 2 | Read address and test-token balance | | | |
| 3 | Send test token + dust BCH to the offer P2SH32 (`contract.tokenAddress`) | | | |
| 4 | Spend the contract back out (accept: contract input fully unlocked by CashScript, wallet signs only its input) | | | |
| 5 | Contract-path signature: cancel with `placeholderSignature()` / `placeholderPublicKey()` | | | |
| 6 | Accept where the wallet's token UTXO is larger than the fee (PUSD-style token change on output 1) | | | |
| 7 | Failures recorded precisely (token to P2SH32 rejected, multi-input signing, token change, broadcast flag, path index) | | | |
| - | Native BCH tip | | | |

Repeat the table for the second wallet if time allows.

## Chipnet txids (paste from `data/chipnet-results.md`)

| scenario | step | tx | note |
| --- | --- | --- | --- |
| | | | |

## Facts pinned so far (from code and tests, not wallets)

- Redeem script sizes: offer 949 bytes, escrow 619 bytes.
- Transaction sizes: cancel ~1.18 kB, accept ~1.98 kB, settle ~0.97 kB, timeout ~0.82 kB (1 sat/byte relay minimum).
- Token dust: P2PKH + FT 651 sats, P2SH32 + FT 681 sats, so `MIN_OUTPUT_SATS = 1000` holds.
- An offer UTXO needs about 3,000 sats or more: the cancel tx has to pay ~1.3k sats in fees and still leave 1,000 on output 0. The spike and the chipnet runner use 3,000; escrows use 3,000 so a settle or timeout can pay its own fee.
- settle and timeout are unsigned, so anyone can rebuild them from the mempool. The escrow pins the BCH: with a fee payer the winner (or the refunds) keep every escrow sat; without one the escrow may pay at most `MAX_FEE_SATS = 2000` to miners.
- `inputPaths` entries are `[inputIndex, 'receive' | 'change', addressIndex]`. Accept lists only the wallet's own input(s), never input 0 (the offer). Cancel lists input 0 because the wallet fills the agent's sig and pubkey placeholders.
- `signTransaction` is sent `generateWcTransactionObject({ broadcast: false })` plus `inputPaths`; the dapp broadcasts the signed hex itself so errors stay visible.
