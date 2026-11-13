# Sellacalida

> AI agents can claim they're intelligent. Sellacalida makes them prove it with their own money.

BCH BLAZE 2026, mainnet track. Solo build by [0xileri](https://github.com/0xileri).

An AI agent locks a bond (PUSD, or a chipnet test token) in a CashScript offer covenant. A challenger accepts in a single transaction from their own wallet, adding a fee and a parameterized, objectively checkable challenge. A verifier runs a deterministic test and signs pass, fail or no-response. The escrow contract pays the agent on pass, pays the challenger on fail or no-response, and refunds both sides if no attestation arrives before the block-height deadline.

The full design is in [`SELLACALIDA_SPEC.md`](./SELLACALIDA_SPEC.md). Wallet spike results go in [`SPIKE.md`](./SPIKE.md).

## Trust boundary

The BCH contract holds the money and enforces the payout. An independent verifier runs a fixed, published test and signs pass, fail, or no-response. You can re-run the test from the evidence, but you do have to trust this verifier's key to be the one that signed it, and to sign no-response only when the agent really did not commit an answer by the deadline. This is not a fully trustless judgment of the AI. If the verifier never signs, both sides are refunded at the expiry height.

What the verifier cannot do: send the funds anywhere except the agent or the challenger. What it can do: sign a wrong verdict. Every verdict is public evidence, so a bad one can be seen.

## Status

Milestone 1 (contracts + wallet spike) is in progress:

- `contracts/SellacalidaOffer.cash`, `contracts/SellacalidaEscrow.cash`: written, compiled with cashc 0.14.0, green on mocknet.
- Chipnet runner and `/connect` wallet spike page: built and dry-run on mocknet; real chipnet and real-wallet runs are pending (see `SPIKE.md`).
- Product UI, templates, verifier service and agent runner come after the milestone 1 gate.

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
lib/agent/                 LLM runner (later; may never import checkers or the verifier)
lib/templates/check/       deterministic checkers (later)
app/connect/               wallet spike page
scripts/chipnet/           chipnet runner (keygen, genesis, every contract path)
tests/                     vitest suites (mocknet)
```

## Run

```bash
npm install
npm test                 # 183 tests, MockNetworkProvider with vmTarget BCH_2026_05
npm run compile          # recompile contracts/*.cash (tests fail if artifacts are stale)
npm run dev              # http://localhost:3000, wallet spike at /connect
npm run chipnet -- all --network mocknet   # dry-run the chipnet flows in memory
```

Chipnet and wallet instructions: [`SPIKE.md`](./SPIKE.md).

## What the tests lock down

- The escrow redeem script built in TypeScript and rebuilt on-chain inside `accept` matches `new Contract(escrowArtifact, args)` byte for byte, across every push-encoding branch (OP_1..OP_16, 1 to 5-byte ints, sign-bit edges, networkId 0x00 / 0x01 / 0x02).
- Category byte order (contract uses `swapEndianness(explorerHex)`), outpoint txid byte order (VM order in the attestation), and 4-byte little-endian outpoint index.
- The 156-byte attestation: 22-byte prefix with the trailing colon, every offset, wrong prefix / length / shifted field / flipped txid / foreign key all rejected.
- Every row of the per-function input and output tables in spec section 3, with negative tests that assert the exact `require` that fails.
- Deadline bound: far-future expiry fails with a current locktime, and raising the locktime makes the accept non-final.
- Settle and timeout are unsigned, so a mempool copier could rebuild them. The escrow pins its BCH: with a fee payer, the winner (or the two refunds) keep every escrow sat; without one, at most `MAX_FEE_SATS` goes to miners. Copier attempts are tested.
- NORESPONSE only after the answer deadline with a zero answer hash; timeout only at expiry with a non-final sequence; settle and timeout cannot both happen.
- `MIN_OUTPUT_SATS` covers token dust for P2PKH and P2SH32 outputs; contract constants match TypeScript; artifacts are fresh.
- `lib/agent` cannot import checkers, the verifier, or attestation code.

## Secrets

`.env.local` only, never committed (see `.env.example` for names). The chipnet runner writes throwaway chipnet keys there. No private keys, WIFs or API keys belong in the repo, the client bundle or commit history.

## License

MIT, see [`LICENSE`](./LICENSE).
