# Wallet spike report (milestone 1)

Spec: `SELLACALIDA_SPEC.md` section 11. Gate date: 16 November 2026 (WAT).

## Status

| Area | Status |
| --- | --- |
| Contracts on mocknet | **Green.** Full vitest suite, `npm test`. |
| Spike flows with a simulated wallet | **Green on mocknet.** `tests/spikeFlows.test.ts` signs every `/connect` flow with a mock WizardConnect wallet (fills P2PKH and contract placeholders the way Paytaca is documented to). This is not a real wallet result. |
| Chipnet runs | **Skipped (decision below).** Keys were generated and the dry run passed on 13 Nov, but no chipnet faucet paid out by 16 Nov, so the agent was never funded. |
| Mainnet run (replaces chipnet) | **Green, 19 Nov.** Every contract path broadcast and confirmed on mainnet with real PUSD: cancel, accept exact + settle PASS, accept with token change + settle FAIL (fee input), NORESPONSE after the answer deadline, timeout refund after expiry, plus a reclaim and the final sweep. 17 transactions, txids in the table below. In: 501,000 sats + 100 PUSD base units. Out: 479,309 sats + all 100 PUSD base units. Network fees: 21,691 sats. |
| Real wallets (Paytaca, Selene) | **In progress (Paytaca, mainnet, 19 Nov).** Connect over WizardConnect worked and the wallet's mainnet addresses and balances were read. The first sign requests failed in the dapp before reaching the wallet: the raw CashScript request holds BigInts the relay's JSON cannot carry. Fixed by sending it in the protocol's extended JSON; re-running. |
| Funding path decision | **Pending the real-wallet rows.** Default plan: test token / PUSD through WizardConnect. Fallbacks in order: the other wallet, an XO template for the token send, then BCH-only bonds. |

Nothing in this file claims a wallet result that has not happened.

## Decision, 16 Nov: a capped mainnet run replaces the chipnet run

The spec puts "Mainnet before chipnet is green" on the cut list and gates mainnet work on milestone 1. On 13 Nov the chipnet keys were generated and the dry run passed on the builder's Windows machine, but the faucets did not pay out (apecs.dev first, then the alternatives), and no chipnet coins arrived by 15 Nov. ileri chose on 14 Nov to give chipnet until 15 Nov and otherwise switch to a tiny mainnet run, with the reason written here. This is a deliberate deviation from the spec, not an oversight.

What limits the risk:

- Same runner, same scenarios, same contracts as the chipnet plan. The only change is the network and the amounts.
- PUSD only on mainnet (no test token), bonds of 5 base units (0.05 PUSD) and fees of 1 (0.01). A full run moves about 0.35 PUSD and ~30,000 sats.
- The runner refuses to spend from an agent holding more than 1,000,000 sats or 20 PUSD (the app's own mainnet hot-wallet cap), and refuses bonds above 0.10 PUSD.
- Every broadcast prints its outputs (amounts, PUSD, addresses) and waits for `y`. Anything else, or stdin running out, is a no and nothing is sent. `--yes` turns the prompt off and says so.
- Separate `MAINNET_*` keys; a testnet key is refused on a mainnet run. `sweep` sends whatever is left on the throwaway keys back to your own wallet, refuses to "sweep" into one of those keys, and sends PUSD only to a token-aware (`bitcoincash:z...`) address so a wallet without CashTokens support cannot burn it.
- The runner checks the Electrum server's block height against the network before anything else.
- The worst case for a bug that tests missed is a bond sitting in escrow until the timeout path refunds it, and that path is the one the timeout scenario proves.

## How to run the mainnet part

One scenario per command, so each step can be checked before the next. Every broadcast asks first.

```bash
npm install
npm run mainnet -- keygen            # separate throwaway MAINNET_* keys in .env.local
# send ~40,000 sats and 0.35 PUSD to the agent's bitcoincash:z... address
npm run mainnet -- status            # agent shows the sats and 35 token base units
npm run mainnet -- cancel            # 2 txs: fund offer, cancel
npm run mainnet -- pass              # 3 txs: fund offer, accept (exact), settle PASS
npm run mainnet -- fail              # 3 txs: fund offer, accept (change 2), settle FAIL with a fee input
npm run mainnet -- noresponse        # 2 txs: fund offer, accept; then wait 1 block
npm run mainnet -- timeout           # 2 txs: fund offer, accept; then wait 19 blocks
npm run mainnet -- pending           # settles NORESPONSE once it can, refunds the timeout once it can
npm run mainnet -- reclaim           # only if a run stopped between fund and accept: cancels the stranded bond
npm run mainnet -- sweep bitcoincash:z...   # your own token-aware address: everything left comes back
```

On Windows PowerShell use `npm.cmd` in place of `npm`. The runner also writes every txid to `data/mainnet-results.md` (gitignored).

Rehearse any step first with play money and the same prompts: `npm run chipnet -- pass --network mocknet --mainnet-amounts --confirm`.

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

## Mainnet txids (capped run)

Every row was shown to ileri as a list of outputs and broadcast only after a typed `y`. Explorer: explorer.bch.ninja.

| # | Scenario | Step | Tx | Result |
| --- | --- | --- | --- | --- |
| 1 | cancel | fund offer (bond into the offer P2SH32) | [2e9a10e893…](https://explorer.bch.ninja/tx/2e9a10e8930401bc1f4a23fe605c98ae8ee645a108fba4e10b932243dfe7ba0e) | Broadcast 17 Nov. 474 B, 2 in / 3 out: 5 PUSD + 3,000 sats into the offer `bitcoincash:pds8kexq…a0gp`, 95 PUSD and 496,476 sats change to the agent. |
| 2 | cancel | cancel (agent checkSig) | [e3e8d2fbff…](https://explorer.bch.ninja/tx/e3e8d2fbffaa09abfd0d8ec6ace4943a44c503e5b85fc2dcdcba2140da8830fa) | Broadcast 17 Nov. 1,174 B, 1 in / 1 out: the agent's checkSig path of the covenant; the 5 PUSD bond and 1,706 sats back to the agent. First real-chain covenant spend. |
| 3a | pass | fund offer, first attempt (stopped before the accept) | [cce14cd533…](https://explorer.bch.ninja/tx/cce14cd53355ccab32aec8a5052824e21fdb7953986ad6d5831a0fbc6fe4bb2d) | Broadcast 17 Nov. The run stopped after this tx, leaving the 5 PUSD bond in the offer and 1 PUSD + 4,000 sats at the challenger. Bond reclaimed in row R; the challenger's coin comes back with the sweep. |
| 3 | pass | fund offer | [a332da328f…](https://explorer.bch.ninja/tx/a332da328fce56526911229d6e1db9453d9a6918464ee8ed99e423386cfac4b9) | Broadcast 17 Nov. 543 B, 2 in / 4 out: 5 PUSD + 3,000 sats into the same offer `bitcoincash:pds8kexq…a0gp`, 1 PUSD + 4,000 sats to the challenger. |
| 4 | pass | accept (exact) | [5777c9dd6e…](https://explorer.bch.ninja/tx/5777c9dd6e753dcac57f5c41b46e4e346f77b64e59f09812b5d9efb96106744e) | Broadcast 17 Nov. 1,974 B, 2 in / 2 out: escrow `bitcoincash:p04grlhd…w982` gets 6 PUSD + 3,000 sats; 1,826 sats token-free change to the challenger. Expiry 978097. |
| 5 | pass | settle PASS (1-output) | [cebc678bf3…](https://explorer.bch.ninja/tx/cebc678bf3c40b353963a736d9d2ff4cf04feefec91d556a96a70e7a3cbf5d26) | Broadcast 17 Nov. 968 B, 1 in / 1 out: verifier attestation checked with checkDataSig on chain; bond + fee (6 PUSD) and 1,933 sats to the agent. |
| 6 | fail | fund offer | [fa172652ec…](https://explorer.bch.ninja/tx/fa172652ec90f61d47b7fc94d9a90e17eff82c3cbd35eb1753df1a87c39cb970) | Broadcast 19 Nov. 859 B, 4 in / 5 out: 5 PUSD into the offer, 3 PUSD + 4,000 sats to the challenger, 3,000 sats to the fee wallet. |
| 7 | fail | accept (change 2) | [58351b7f46…](https://explorer.bch.ninja/tx/58351b7f46e6ca2a1fef2d055c34749c7c7789cd6a0f36692854d875916258a3) | Broadcast 19 Nov. 2,009 B, 2 in / 2 out: escrow `bitcoincash:pdkvhamk…sy7` gets 6 PUSD + 3,000 sats; output 1 returns 2 PUSD + 1,788 sats change to the challenger (the PUSD-style change path). Expiry 978098. |
| 8 | fail | settle FAIL (2-output, fee input) | [d0a9dd0d9e…](https://explorer.bch.ninja/tx/d0a9dd0d9e0be40d42a2f9c9494b4c301e722d5ca9b6876d9e053c67cce7587a) | Broadcast 19 Nov. 1,168 B, 2 in / 2 out: bond + fee (6 PUSD) and all 3,000 escrow sats to the challenger; the fee wallet paid the network fee (1,713 sats change). |
| 9 | noresponse | fund offer | [b3ffb62f62…](https://explorer.bch.ninja/tx/b3ffb62f6218433ab6282e22bb641b120ac234e2c42603334542faa024b7e8a2) | Broadcast 19 Nov. 543 B, 2 in / 4 out: 5 PUSD into the short-window offer `bitcoincash:pdkr4put…gvgg7` (19-block deadline), 1 PUSD + 4,000 sats to the challenger. |
| 10 | noresponse | accept (exact) | [ee3bd76fdd…](https://explorer.bch.ninja/tx/ee3bd76fdd94103e49e353198e2de8ccd1f0103cfbbd0aee2294037174d9b5ed) | Broadcast 19 Nov. 1,973 B, 2 in / 2 out: escrow `bitcoincash:p0sd9ccr…24cy` gets 6 PUSD + 3,000 sats; 1,827 sats change to the challenger. Expiry 978017, answer deadline 977999. |
| 11 | noresponse | settle NORESPONSE (after 1 block) | [fc4ee62a4e…](https://explorer.bch.ninja/tx/fc4ee62a4ee0943d90eabab63c796926e07672aa2e85491a7f0372b0acca0a5b) | Broadcast 19 Nov. 968 B, 1 in / 1 out: the agent never answered; after the answer deadline the verifier's NORESPONSE attestation (zero answerHash) paid bond + fee (6 PUSD) and 1,933 sats to the challenger, the escrow paying its own fee. |
| 12 | timeout | fund offer | [ece893d6f5…](https://explorer.bch.ninja/tx/ece893d6f5d489b9a4af2b13165c456788b700b83db9c2b21d8bf3b75d2e7888) | Broadcast 19 Nov. 543 B, 2 in / 4 out: 5 PUSD into the same short-window offer, 2 PUSD + 4,000 sats to the challenger. |
| 13 | timeout | accept (change 1) | [75c2bda76d…](https://explorer.bch.ninja/tx/75c2bda76d009b003f81da8fe77db723c0e9f9005a13e92c0b561d716cab84f8) | Broadcast 19 Nov. 2,008 B, 2 in / 2 out: escrow `bitcoincash:p0smcv5n…9ur2` gets 6 PUSD + 3,000 sats; 1 PUSD + 1,789 sats change to the challenger. Expiry 978022: the refund cannot happen before that block. |
| 14 | timeout | timeout refund (after 19 blocks) | [b13c957949…](https://explorer.bch.ninja/tx/b13c957949f55d9cd9041881b3339124d69ac90cf3de741a2e3116f40bc2c5ac) | Broadcast 19 Nov at or after block 978022 (the escrow's expiry). 814 B, 1 in / 2 out, no verifier: 5 PUSD + 1,102 sats back to the agent, 1 PUSD + 1,000 sats back to the challenger. A first `pending --wait` lost its Electrum connection at 978021 and stopped without sending; rerunning `pending` finished it (the runner now retries dropped connections). |
| 15 | sweep | sweep to your own wallet | [b0fbb12df2…](https://explorer.bch.ninja/tx/b0fbb12df2915057cf6fa5fe488cf29183f89a9d8fe67afc8f353678ef5b42d3) | Broadcast 19 Nov. 1,805 B, 12 in / 2 out from the agent, challenger and fee wallet keys: all 100 PUSD base units + 1,000 sats and 478,309 sats to ileri's Paytaca token address. |
| R | reclaim | cancel the bond left in the offer by row 3a (`npm run mainnet -- reclaim`) | [ed5864bac8…](https://explorer.bch.ninja/tx/ed5864bac888e277aa0bfe33d77c57a6a283574c89085423eb5eb422410d5d97) | Broadcast 19 Nov. 1,174 B, 1 in / 1 out: spent `cce14cd5…:0` through the agent's cancel path; 5 PUSD + 1,706 sats back to the agent. A second real covenant cancel. |

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
