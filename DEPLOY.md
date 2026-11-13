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

Still to set when you have them: `NEXT_PUBLIC_DECK_URL` (Widget Factory deck) and `NEXT_PUBLIC_EMBER_ADDRESS` (CashTokens address for EMBER2026 votes).

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

Only after chipnet is green (spec, cut list). Same as chipnet with `NETWORK=mainnet`, no `TOKEN_CATEGORY` (forced to PUSD mainnet-v1), tiny bonds, and new keys.
