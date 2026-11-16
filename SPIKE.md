# Wallet spike report (milestone 1)

Spec: `SELLACALIDA_SPEC.md` section 11. Gate date: 16 November 2026 (WAT).

## Status

| Area | Status |
| --- | --- |
| Contracts on mocknet | **Green.** Full vitest suite, `npm test`. |
| Spike flows with a simulated wallet | **Green on mocknet.** `tests/spikeFlows.test.ts` signs every `/connect` flow with a mock WizardConnect wallet (fills P2PKH and contract placeholders the way Paytaca is documented to). This is not a real wallet result. |
| Chipnet runs | **Skipped (decision below).** Keys were generated and the dry run passed on 13 Nov, but no chipnet faucet paid out by 16 Nov, so the agent was never funded. |
| Mainnet run (replaces chipnet) | **Not run yet.** Capped mainnet mode of the same runner: `npm run mainnet -- ...`, PUSD bonds of 0.05, a y/N prompt before every broadcast. Waiting on ~30,000 sats and ~0.35 PUSD. Dry-run in CI (`tests/chipnetFlows.test.ts`). |
| Real wallets (Paytaca, Selene) | **Not run yet.** Needs a phone or browser wallet. Fill in the tables below. |
| Funding path decision | **Pending the real-wallet rows.** Default plan: test token / PUSD through WizardConnect. Fallbacks in order: the other wallet, an XO template for the token send, then BCH-only bonds. |

Nothing in this file claims a wallet result that has not happened.

## Decision, 16 Nov: a capped mainnet run replaces the chipnet run

The spec puts "Mainnet before chipnet is green" on the cut list and gates mainnet work on milestone 1. On 13 Nov the chipnet keys were generated and the dry run passed on the builder's Windows machine, but the faucets did not pay out (apecs.dev first, then the alternatives), and no chipnet coins arrived by 15 Nov. ileri chose on 14 Nov to give chipnet until 15 Nov and otherwise switch to a tiny mainnet run, with the reason written here. This is a deliberate deviation from the spec, not an oversight.

What limits the risk:

- Same runner, same scenarios, same contracts as the chipnet plan. The only change is the network and the amounts.
- PUSD only on mainnet (no test token), bonds of 5 base units (0.05 PUSD) and fees of 1 (0.01). A full run moves about 0.35 PUSD and ~30,000 sats.
- The runner refuses to spend from an agent holding more than 250,000 sats or 10 PUSD, and refuses bonds above 0.10 PUSD.
- Every broadcast prints its outputs (amounts, PUSD, addresses) and waits for `y`. `--yes` turns the prompt off.
- Separate `MAINNET_*` keys; a testnet key is refused on a mainnet run. `sweep` sends whatever is left on the throwaway keys back to your own wallet.
- The worst case for a bug that tests missed is a bond sitting in escrow until the timeout path refunds it, and that path is the one the timeout scenario proves.

## How to run the mainnet part

```bash
npm install
npm run mainnet -- keygen      # separate throwaway MAINNET_* keys in .env.local
# send ~30,000 sats and ~0.35 PUSD to the agent's bitcoincash:z... address
npm run mainnet -- status
npm run mainnet -- all         # cancel, pass, fail, starts noresponse + timeout; asks before each broadcast
npm run mainnet -- pending --wait   # NORESPONSE after 1 block, timeout after 19 blocks (~3 h)
npm run mainnet -- sweep bitcoincash:z...   # your own wallet: everything left comes back
```

On Windows PowerShell use `npm.cmd` in place of `npm`. Txids land in `data/mainnet-results.md` (gitignored). Paste the table below.
Dry run of the mainnet amounts, no keys or network: `npm run chipnet -- all --network mocknet --mainnet-amounts`.

## How to run the chipnet part (if chipnet coins turn up later)

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

1. Pick mainnet (or chipnet if you have chipnet coins). On mainnet the category is PUSD and the verifier pubkey prefills from `NEXT_PUBLIC_MAINNET_VERIFIER_PK` (written by `npm run mainnet -- keygen`). On chipnet paste `CHIPNET_TOKEN_CATEGORY` and `NEXT_PUBLIC_CHIPNET_VERIFIER_PK`.
2. The wallet needs a little PUSD (or test token) and BCH. On mainnet the page switches the bond and fee to 5 and 1 base units (0.05 and 0.01 PUSD).
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

## Mainnet txids (paste from `data/mainnet-results.md`)

| scenario | step | tx | note |
| --- | --- | --- | --- |
| | | | |

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
