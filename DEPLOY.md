# Deploying Sellacalida

The app is one long-running Node process (`next build` then `next start`). It holds the JSON store and runs the verifier loop in-process, so it must not run as serverless functions or with more than one replica.

## Current deployment: Railway, mocknet preview

- Project `sellacalida`, service `web`, deploys from `main` on every push.
- Builder: Railpack (Node from `package.json` `engines`), `npm install`, `npm run build`, `npm run start`.
- Health check: `GET /api/config`. Restart policy: on failure, 5 retries.

| Variable | Value | Why |
| --- | --- | --- |
| `NETWORK` | `mocknet` | in-memory chain with play money; resets on every restart |
| `MOCKNET_PUBLIC_CHALLENGES` | `1` | visitors can run play challenges through a throwaway challenger key |
| `MOCKNET_CHALLENGE_INTERVAL_MS` | `15000` | one play challenge at a time across all visitors |
| `MOCKNET_CHALLENGE_CAP` | `200` | per process, bounds LLM spend between restarts |
| `AUTO_OFFERS` | `3` | the agent keeps three bonds open |
| `VERIFIER_TICK_MS` | `5000` | verifier pass interval |
| `LLM_BASE_URL`, `LLM_MODEL_ID` | Orbio, `anthropic/claude-sonnet-5.5` | the live agent |
| `LLM_API_KEY` | **set by you in the Railway dashboard** | without it the agent is offline and play challenges never get an answer |
| `ADMIN_TOKEN` | random, in the Railway dashboard | guards `/api/admin/*` (publish / cancel bonds, force a verifier pass) |
| `NEXT_PUBLIC_REPO_URL` | the GitHub repo | home-page banner |

Banner and example transactions are read when the server starts (not baked into the client). Set `DECK_URL`, `REPO_URL`, and `EMBER_ADDRESS` when you have them. The `NEXT_PUBLIC_*` names for those three still work. After the first real pass and fail, set `SHOWCASE_PASS_TXID` and `SHOWCASE_FAIL_TXID` (64 hex characters) so the home page links them on the explorer.

## Switching to chipnet

Do this after the `SPIKE.md` chipnet run, from a machine with normal internet.

1. Create throwaway keys and a test token: `npm run chipnet -- keygen`, fund the agent address from the faucet, `npm run chipnet -- genesis`. Keep the values from `.env.local`.
2. Add a Railway volume mounted at `/app/data` so the store survives restarts.
3. Change these variables on the `web` service:

| Variable | Value |
| --- | --- |
| `NETWORK` | `chipnet` |
| `TOKEN_CATEGORY` | `CHIPNET_TOKEN_CATEGORY` from `.env.local` |
| `AGENT_WIF` | a funded chipnet key holding test tokens and tBCH |
| `VERIFIER_PRIVATE_KEY` | a fresh key (hex or WIF), never reused on mainnet |
| `FEE_WALLET_WIF` | optional, a small tBCH balance for settle fees |
| `DATA_DIR` | `/app/data` |
| `AUTO_OFFERS` | `1` |
| `MOCKNET_PUBLIC_CHALLENGES` | remove (ignored off mocknet anyway) |

On chipnet, challengers accept with their own wallet through WizardConnect; there is no dev challenger.

## Mainnet on Railway

Milestone 1 is already green (contracts, Paytaca, NORESPONSE, timeout). This is the app deploy. One Node process, one replica. The JSON store and the answer log have to survive restarts, so attach a volume before the first bond is published.

### 1. Volume

| Setting | Value |
| --- | --- |
| Mount path | `/app/data` |
| `DATA_DIR` | `/app/data` |

Railway: service `web` → volume → mount at `/app/data`. The process writes `mainnet-db.json` and `mainnet-answers.json` there. Do not scale past one replica. The health check stays `GET /api/config`.

### 2. Keys (once, in a terminal)

`npm run keys` prints a fresh mainnet agent key, verifier key, fee-wallet key, and admin token. It writes nothing to disk and refuses to run if stdout is redirected, so the values do not land in a file or a CI log. Paste them into Railway, then clear the terminal scrollback. Do not reuse the milestone runner's `MAINNET_*` keys.

Fund only the agent address the command prints. Stay under the hot-wallet cap: at most 1,000,000 sats and 20.00 PUSD (2000 base units). A practical start is a few thousand sats plus a little over 1.20 PUSD, enough for one 1.00 bond and the BCH that publishes it. Send a few thousand sats to the fee-wallet address as well; settle and timeout pay their miner fee from there. Without that wallet the escrow can still pay a small fee from its own sats.

### 3. Variables

Remove mocknet-only variables (`MOCKNET_PUBLIC_CHALLENGES`, `MOCKNET_CHALLENGE_INTERVAL_MS`, `MOCKNET_CHALLENGE_CAP`, `TOKEN_CATEGORY`, `TOKEN_SYMBOL`, `TOKEN_DECIMALS`). On mainnet the token is forced to PUSD mainnet-v1 with 2 decimals.

| Variable | Value |
| --- | --- |
| `NETWORK` | `mainnet` |
| `DATA_DIR` | `/app/data` |
| `AGENT_WIF` | from `npm run keys` |
| `VERIFIER_PRIVATE_KEY` | from `npm run keys` (mainnet WIF) |
| `FEE_WALLET_WIF` | from `npm run keys` |
| `ADMIN_TOKEN` | from `npm run keys` |
| `OFFER_BOND` | `100` (1.00 PUSD, the cap) |
| `OFFER_FEE` | `20` (0.20 PUSD, the demo fee) |
| `AUTO_OFFERS` | `1` |
| `VERIFIER_TICK_MS` | `20000` (minimum 1000) |
| `LLM_BASE_URL` | `https://api.orbio.so/api/v1` or another OpenAI-compatible gateway |
| `LLM_API_KEY` | set in the Railway dashboard |
| `LLM_MODEL_ID` | `anthropic/claude-sonnet-5.5` |
| `ELECTRUM_HOSTNAME` | leave unset to use `bch.imaginary.cash`. A chipnet server fails the height check and the loop publishes nothing |
| `DECK_URL` | Widget Factory deck, `https://…` |
| `REPO_URL` | `https://github.com/0xileri/Sellacalida` |
| `EMBER_ADDRESS` | mainnet `bitcoincash:` address for EMBER2026 votes |
| `SHOWCASE_PASS_TXID` | 64 hex chars, after a real pass |
| `SHOWCASE_FAIL_TXID` | 64 hex chars, after a real fail |
| `SHOWCASE_NORESPONSE_TXID` | optional |
| `SHOWCASE_TIP_TXID` | optional, the BCH tip |

`OFFER_BOND` and `OFFER_FEE` above 100 base units (1.00 PUSD) stop the process at startup. The defaults, if you leave them unset, are already 100 and 20.

`DECK_URL`, `REPO_URL`, and `EMBER_ADDRESS` are the banner. `NEXT_PUBLIC_DECK_URL`, `NEXT_PUBLIC_REPO_URL`, and `NEXT_PUBLIC_EMBER_ADDRESS` are accepted as aliases. The home page reads them from the server at runtime. A missing deck or vote address shows as "coming soon"; it does not hide the banner. Showcase txids are optional and always link to the mainnet explorer (`https://explorer.bch.ninja/tx/…`). Until a pass and a fail are set, the mainnet home page says they will appear once recorded.

### 4. What "up" looks like

After deploy, `GET /api/config` returns `"network": "mainnet"` and `"tokenSymbol": "PUSD"`. The log line says the verifier is on and names the model. Within a tick the agent publishes one open bond of 1.00 PUSD if the wallet is funded and under the cap. A wallet holding more than 1,000,000 sats or 20 PUSD is refused and the error is in the logs. Restarting the service keeps offers, answers, and verdicts because they live on the volume. The chain stays the source of truth if the files are lost.
