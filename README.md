# Sellacalida

> AI agents can claim they're intelligent. Sellacalida makes them prove it with their own money.

BCH BLAZE 2026, mainnet track. Solo build by [0xileri](https://github.com/0xileri).

**Live (mainnet, real PUSD):** https://sellacalida.up.railway.app · **Play money, no wallet needed:** https://web-production-20dba597.up.railway.app

Live results so far (Claude Sonnet 5.5, 0.50 PUSD bond each, challenger signing in Paytaca over WizardConnect):

| Challenge | Verdict | Accept | Settle |
| --- | --- | --- | --- |
| (123456789 × −987654321) % 993 | PASS | [e2460741…](https://explorer.bch.ninja/tx/e246074142c8a0410c9ebdae596a8a49d053dc825eda6b83245e816b0d3a71b6) | [ddfa5384…](https://explorer.bch.ninja/tx/ddfa5384d090cd2bb0ba904e730fbe47681152346ac9a812dbb3b0ef54633c6d) |
| 48-digit product % 1000000007 | PASS | [f4e9d8c3…](https://explorer.bch.ninja/tx/f4e9d8c3777c5930210d62d26257acfd9efeea46999508f63dafdfe0f0dd5c85) | [1297f71d…](https://explorer.bch.ninja/tx/1297f71d4897d3ef9b0ad4851a2c8d88aade130e662491e134e601118de25013) |
| exact 89-digit product | FAIL (no parseable answer) | [a9a7f958…](https://explorer.bch.ninja/tx/a9a7f9583e0ab48d19286c3d32217be1552b4cbc639ef4bfbfc0ad2324519e95) | [7d247f96…](https://explorer.bch.ninja/tx/7d247f9646d6e18e21c2eb1b32fb8c5fc4131e186937579a57d256836b6d08a7) |

BCH tip to the agent from the agent page, signed in Paytaca: [8b165cd3…](https://explorer.bch.ninja/tx/8b165cd3022fa8fa839641f7bce636e46fcb4bc33a0e9573cdbae61f86a728b6)

An AI agent locks a bond (PUSD, or a chipnet test token) in a CashScript offer covenant. A challenger accepts in a single transaction from their own wallet, adding a fee and a parameterized, objectively checkable challenge. A verifier runs a deterministic test and signs pass, fail or no-response. The escrow contract pays the agent on pass, pays the challenger on fail or no-response, and refunds both sides if no attestation arrives before the block-height deadline.

The full design is in [`SELLACALIDA_SPEC.md`](./SELLACALIDA_SPEC.md). Wallet spike results go in [`SPIKE.md`](./SPIKE.md). The spec's security checklist, item by item with the tests that prove each one, is [`SECURITY_CHECKLIST.md`](./SECURITY_CHECKLIST.md).

## Trust boundary

The BCH contract holds the money and enforces the payout. An independent verifier runs a fixed, published test and signs pass, fail, or no-response. You can re-run the test from the evidence, but you do have to trust this verifier's key to be the one that signed it, and to sign no-response only when the agent really did not commit an answer by the deadline. This is not a fully trustless judgment of the AI. If the verifier never signs, both sides are refunded at the expiry height.

What the verifier cannot do: send the funds anywhere except the agent or the challenger. What it can do: sign a wrong verdict. Every verdict is public evidence, so a bad one can be seen.

## Status

Milestone 1 (contracts + wallet spike): **green on 19 Nov 2026**, three days after the 16 Nov gate (chipnet faucets never paid out, so the real-chain run moved to a capped mainnet run).

Done:

- `contracts/SellacalidaOffer.cash`, `contracts/SellacalidaEscrow.cash`: written, compiled with cashc 0.14.0, every path green on mocknet.
- 443 vitest tests passing (`npm test`), `tsc` clean.
- Security checklist (spec section 9): all 43 items proven by tests, see `SECURITY_CHECKLIST.md`.
- Contract runner (`npm run chipnet`, `npm run mainnet`): every scenario dry-run on mocknet, the capped mainnet mode rehearsed with its prompts. On mainnet it uses PUSD bonds of 0.05, caps the hot wallet, asks before every broadcast, and sweeps leftovers to a token-aware address.
- Challenge templates, checkers, the verifier core (decide, sign, settle, timeout), the write-once answer store and reproducible evidence: tested on mocknet and running live on the mocknet preview.
- Agent runner: calls a real LLM (default `anthropic/claude-sonnet-5.5`) through Orbio's OpenAI-compatible gateway (any compatible base URL works), parses the reply strictly, and commits it write-once with the model id that actually served it. For BCH templates it gets one tool, `get_transaction`, which returns outputs decoded from raw hex verified against the txid; every call is recorded in the commitment and the evidence. `npm run agent:try` asks it one challenge.
- App: pages `/`, `/arena`, `/challenge/[id]` and `/agent/[id]`, a JSON API, and an in-process verifier loop (started from `instrumentation.ts`). Tested end to end on mocknet with the live agent through the real UI, and deployed as a public mocknet preview. On mainnet it refuses bonds above 1.00 PUSD, an agent wallet above 1,000,000 sats or 20 PUSD, keys made for another network, and an Electrum server on the wrong network.
- Real-chain run on capped mainnet, 19 Nov (replaces chipnet; no chipnet faucet paid out, see the decision in `SPIKE.md`): every contract path broadcast with real PUSD, 17 transactions, all 100 PUSD base units returned. Txids in `SPIKE.md`.
- Mainnet app live since 19 Nov at https://sellacalida.up.railway.app (0.50 PUSD bonds, 0.10 fee, storage volume, play-money copy linked): 2 PASS and 1 FAIL from real challenges, listed at the top of this file.
- Real-wallet run, 19 Nov: Paytaca over WizardConnect on mainnet passed every spike checklist row (connect, balances, PUSD into the offer P2SH32, covenant cancel with placeholders, accept with PUSD change, BCH tip). Funding path decided: PUSD through WizardConnect. Txids in `SPIKE.md`.
- `/connect` wallet spike page: every flow also signed in tests by a simulated wallet, through the same JSON relay encoding a real wallet sees.

Pending:

- Refund the wallet spike's escrow after height 978185 (Refund on `/connect`, same browser). Selene not tried.
- The Widget Factory deck and EMBER2026 links on the banner, and the demo recording.

## Layout

```text
contracts/                 CashScript sources + compiled artifacts (json + typed .ts twin)
lib/constants.ts           MIN_OUTPUT_SATS, MAX_HEIGHT, MIN_VERIFIER_GRACE, network ids, verdicts, PUSD id
lib/attestation.ts         156-byte attestation layout, serializer, Schnorr datasig signer
lib/encodeRedeemScript.ts  escrow redeem-script encoder, locked byte-for-byte to the SDK
lib/tokenCategory.ts       explorer-order <-> VM-order helpers
lib/contracts.ts           contract factories and parameter types
lib/bch/                   tx builders for every contract path, addresses, providers
lib/wallet/                WizardConnect helpers and spike flows (browser)
lib/templates/public.ts    agent-safe: template ids, prompts, answer formats, shape checks
lib/templates/canonical.ts canonical spec JSON and specHash
lib/templates/check/       server only: accept-time validation and the four checkers
lib/store/answers.ts       write-once answer commitments (model id, raw response hash, answer hash)
lib/verifier/              server only: decide, sign, settle / timeout, evidence + reproduce, key loading
lib/agent/                 LLM runner: Orbio / OpenAI-compatible client, strict parser, ask-then-commit
lib/server/                config (network / token guards), JSON DB, service layer, HTTP helpers, verifier loop
lib/wire.ts                JSON shapes shared by the API and the browser
app/                       pages: / , /arena, /challenge/[id], /agent/[id]; /connect is the wallet spike
app/api/                   route handlers (public + /api/admin/*)
instrumentation.ts         starts the verifier loop once per Node server
scripts/chipnet/           contract runner for chipnet and capped mainnet (keygen, every contract path, sweep)
tests/                     vitest suites (mocknet)
```

## Run

```bash
npm install
npm test                 # 443 tests, MockNetworkProvider with vmTarget BCH_2026_05
npm run compile          # recompile contracts/*.cash (tests fail if artifacts are stale)
npm run dev              # http://localhost:3000, wallet spike at /connect
npm run chipnet -- all --network mocknet   # dry-run the chipnet flows in memory
npm run mainnet -- status                  # capped mainnet run with real PUSD (see SPIKE.md)
npm run chipnet -- pass --network mocknet --mainnet-amounts --confirm   # rehearse a mainnet step, prompts included
npm run agent:try        # ask the live agent one challenge (needs LLM_API_KEY, LLM_MODEL_ID)
npm run keys             # fresh mainnet keys for a deployed app, printed once (see DEPLOY.md)
npm run withdraw -- bitcoincash:z...   # send a deployed app's funds back to your wallet (see DEPLOY.md)
```

Chipnet and wallet instructions: [`SPIKE.md`](./SPIKE.md).

### Run the app

The app is one long-running Node process (`next build && next start`): it holds the JSON store and runs the verifier loop, so do not deploy it as serverless functions. Settings live in `.env.local` (see `.env.example`).

Local UI work without a wallet or chain access, on an in-memory mocknet:

```bash
NETWORK=mocknet LLM_API_KEY=<your Orbio key> npm run dev
```

```bash
curl -X POST localhost:3000/api/admin/offers
```

Then open `/arena`. On mocknet the accept button plays the challenger with a throwaway key; on chipnet and mainnet it signs through WizardConnect (Paytaca or Selene).

API:

| Route | Use |
| --- | --- |
| `GET /api/config`, `/api/stats`, `/api/offers`, `/api/agents/[id]` | public state, polled by the pages |
| `GET /api/challenges`, `/api/challenges/[id]`, `/api/challenges/[id]/evidence` | challenges and downloadable evidence |
| `POST /api/challenges` | validate a spec and get the accept bundle (invalid params are rejected here) |
| `POST /api/challenges/[id]/accepted` | report the broadcast accept; the server re-checks it from the raw tx |
| `POST /api/admin/offers`, `/api/admin/offers/[id]/cancel`, `/api/admin/tick` | `Authorization: Bearer $ADMIN_TOKEN` |
| `POST /api/admin/dev/challenge` | mocknet only: simulate a challenger |

## Challenge templates (v1)

| Template | Question | Answer |
| --- | --- | --- |
| `bch.output_token_count` | How many outputs of tx `txid` carry token category `category`? (FT, NFT or both) | non-negative integer |
| `bch.total_sats_to_address` | How many sats does tx `txid` send to `address`? (token-aware and plain encodings match) | non-negative integer |
| `bch.nft_output_index` | Which output of tx `txid` holds the NFT of `category` (and `commitment`, if given)? | index, or `-1` for zero or several matches |
| `math.exact_result` | Evaluate an integer expression tree exactly (`/` truncates toward zero, `%` takes the left sign) | integer |

A spec is canonical JSON (sorted keys, no whitespace) and `specHash = sha256(spec)`. Invalid params (bad hex, wrong-network address, division by zero) are rejected at accept time, never at settle time.

## How the verifier decides

1. No answer committed and the answer deadline not reached: wait. The checker does not run.
2. Answer committed (write-once, before the deadline): fetch the referenced transaction, check it hashes to its txid, compute the expected answer, compare, sign PASS or FAIL.
3. No answer by the deadline: sign NORESPONSE with a zero answer hash.
4. Expiry reached with nothing settled: broadcast `timeout()`, refunding both sides.

A fetch or checker failure signs nothing (it never turns into NORESPONSE). The verifier refuses to sign over a spec that does not hash to the escrow's `specHash`, with a key the escrow does not trust, or over an answer committed after the deadline.

## Reproduce a verdict from its evidence

Every signed verdict produces an evidence file: canonical spec, committed answer (source `ai` with model id, or `fixture`), raw response hash, the checker trace, the raw transaction hex, the 156-byte attestation, the signature and verifier pubkey, block heights and WAT timestamps.

```bash
npm run reproduce -- evidence.json
```

This re-runs the checker on the cached raw transaction (after checking it hashes to the txid), recomputes the verdict, rebuilds the attestation bytes from the evidence fields, and verifies the signature. It needs no server and no network.

## What the tests lock down

- The escrow redeem script built in TypeScript and rebuilt on-chain inside `accept` matches `new Contract(escrowArtifact, args)` byte for byte, across every push-encoding branch (OP_1..OP_16, 1 to 5-byte ints, sign-bit edges, networkId 0x00 / 0x01 / 0x02).
- Category byte order (contract uses `swapEndianness(explorerHex)`), outpoint txid byte order (VM order in the attestation), and 4-byte little-endian outpoint index.
- The 156-byte attestation: 22-byte prefix with the trailing colon, every offset, wrong prefix / length / shifted field / flipped txid / foreign key all rejected.
- Every row of the per-function input and output tables in spec section 3, with negative tests that assert the exact `require` that fails.
- Deadline bound: far-future expiry fails with a current locktime, and raising the locktime makes the accept non-final.
- Settle and timeout are unsigned, so a mempool copier could rebuild them. The escrow pins its BCH: with a fee payer, the winner (or the two refunds) keep every escrow sat; without one, at most `MAX_FEE_SATS` goes to miners. Copier attempts are tested.
- NORESPONSE only after the answer deadline with a zero answer hash; timeout only at expiry with a non-final sequence; settle and timeout cannot both happen.
- `MIN_OUTPUT_SATS` covers token dust for P2PKH and P2SH32 outputs; contract constants match TypeScript; artifacts are fresh.
- Templates: canonical bytes (locked hash vector), every shape rule, accept-time rejection, prompt text, answer formats.
- Checkers against a real decoded transaction with FT, NFT, P2PKH, token-aware and P2SH32 outputs; tampered raw hex is refused.
- Verifier end to end: commit-before-check, PASS / FAIL / NORESPONSE payouts, fixture labeling, checker failure signs nothing, timeout, untrusted key, spec mismatch, late commitment, and tampered evidence.
- The import graph: nothing reachable from `lib/agent`, the store or the public template layer touches checkers or the verifier, and client components cannot reach them or the store.

## Secrets

`.env.local` only, never committed (see `.env.example` for names). The runner writes throwaway `CHIPNET_*` and `MAINNET_*` keys there, kept apart per network. No private keys, WIFs or API keys belong in the repo, the client bundle or commit history.

## License

MIT, see [`LICENSE`](./LICENSE).
