# Deploying Sellacalida

The app is one long-running Node process (`next build` then `next start`). It holds the JSON store and runs the verifier loop in-process, so it must not run as serverless functions or with more than one replica.

## Current deployment: Railway, two services

Project `sellacalida`, both services deploy from `main` on every push (Railpack: Node from `package.json` `engines`, `npm install`, `npm run build`, `npm run start`; health check `GET /api/config`; restart on failure, 5 retries).

| Site | Network | Railway service | What it is |
| --- | --- | --- | --- |
| **https://sellacalida.up.railway.app** | **mainnet** | `play` (the name is historical; rename it in the dashboard if you like) | The real thing: PUSD bonds, WizardConnect accepts, verifier-signed settles. The submission link. |
| https://web-production-20dba597.up.railway.app | mocknet | `web` | Play money, no wallet needed: visitors run challenges through a throwaway challenger key. Resets on every restart. |

The keys and the volume ended up on the service named `play`, so that service became mainnet on 19 Nov and the older `web` service kept the play-money role. Each site links to the other (`PLAY_URL` on the mainnet one, `LIVE_URL` on the play one), in the header and the home banner.

The tables below describe each role. Read "the mainnet service" for `play` and "the play service" for `web`.

### Mainnet role (Railway service `play`, sellacalida.up.railway.app)

1. On your machine, make fresh keys: `npm run keys` (Windows: `npm.cmd run keys`). It prints them once and saves nothing.
2. Paste `AGENT_WIF`, `VERIFIER_PRIVATE_KEY` and `FEE_WALLET_WIF` into Railway > the mainnet service > Variables. Never into a chat or a commit.
3. Fund the agent's `bitcoincash:z...` address with a little PUSD and BCH (with the live 0.50 bond: about 0.75 PUSD and 100,000 sats), and the fee wallet with about 20,000 sats.
4. A volume mounted at `/app/data` (`sellacalida-mainnet-data`), so offers, challenges and answers survive restarts.

| Variable | Value |
| --- | --- |
| `NETWORK` | `mainnet` (token forced to PUSD mainnet-v1, 2 decimals) |
| `DATA_DIR` | `/app/data` |
| `AGENT_WIF`, `VERIFIER_PRIVATE_KEY`, `FEE_WALLET_WIF` | from `npm run keys`, pasted by you |
| `OFFER_BOND`, `OFFER_FEE` | `50`, `10` (0.50 / 0.10 PUSD, live since 19 Nov; the spec's demo size is 100 / 20, and 100 is the mainnet cap) |
| `AUTO_OFFERS` | `1` |
| `VERIFIER_TICK_MS` | `20000` |
| `LLM_BASE_URL`, `LLM_MODEL_ID`, `LLM_API_KEY` | Orbio, `anthropic/claude-sonnet-5.5`, your key |
| `ADMIN_TOKEN` | random; guards `/api/admin/*` |
| `PLAY_URL` | `https://web-production-20dba597.up.railway.app` |
| `NEXT_PUBLIC_REPO_URL`, `NEXT_PUBLIC_DECK_URL`, `NEXT_PUBLIC_EMBER_ADDRESS` | home-page banner |

On mainnet the app refuses bonds above 1.00 PUSD, refuses to publish while the agent holds more than 1,000,000 sats or 20 PUSD, refuses keys made for another network, and stops the verifier loop if the Electrum server is on the wrong network.

### Play-money role (Railway service `web`, web-production-20dba597.up.railway.app)

| Variable | Value |
| --- | --- |
| `NETWORK` | `mocknet` |
| `MOCKNET_PUBLIC_CHALLENGES` | `1` |
| `MOCKNET_CHALLENGE_INTERVAL_MS`, `MOCKNET_CHALLENGE_CAP` | `15000`, `200` (bounds LLM spend between restarts) |
| `AUTO_OFFERS` | `3` |
| `VERIFIER_TICK_MS` | `5000` |
| `LLM_BASE_URL`, `LLM_MODEL_ID` | as on `web` |
| `LLM_API_KEY` | your key on `web`; the mainnet service reads it as `${{web.LLM_API_KEY}}`, so it lives in one place |
| `ADMIN_TOKEN` | its own random value |
| `LIVE_URL` | `https://sellacalida.up.railway.app` |

No `AGENT_WIF`, `VERIFIER_PRIVATE_KEY` or `FEE_WALLET_WIF` on the play-money service: mocknet uses built-in play keys.

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

## Mainnet

The spec wants chipnet green first. No chipnet faucet paid out, so on 16 Nov the contracts are proven on mainnet instead, with the capped runner (`npm run mainnet -- ...`, see `SPIKE.md`). Deploy the app on mainnet only after that run is green.

Same as chipnet with `NETWORK=mainnet`, no `TOKEN_CATEGORY` (forced to PUSD mainnet-v1), tiny bonds, and new keys: a fresh `AGENT_WIF` holding a few cents of PUSD and BCH, and a fresh `VERIFIER_PRIVATE_KEY` that is not one of the runner's throwaway keys. Add the Railway volume at `/app/data` first, because mainnet escrows must survive a restart.

The app enforces the spec's tiny-stakes rule on mainnet: `OFFER_BOND` and `OFFER_FEE` above 100 base units (1.00 PUSD) stop the server at startup, and it will not publish a bond while the agent wallet holds more than 1,000,000 sats or 20 PUSD. It also checks the Electrum server's block height against `NETWORK` before the verifier loop does anything.
