# Security checklist (spec section 9)

Every item from `SELLACALIDA_SPEC.md` section 9, word for word, with the tests that prove it. `tests/checklist.test.ts` fails if an item goes missing here or a referenced test is renamed or deleted.

Run them all with `npm test`. Contract tests run the real compiled covenants in the CashScript mocknet VM (BCH 2026 rules) with transaction validation on.

Status: **42 of 43 proven by tests.** The open item needs real-chain txids from the capped mainnet run.

## Encoding and categories

- [x] PUSD / test-token category matches the intended network.
  - `tests/server.test.ts` › "mainnet must use the PUSD mainnet-v1 category"
  - `tests/server.test.ts` › "chipnet requires its own category and refuses PUSD"
  - `tests/server.test.ts` › "refuses the wrapped-PUSD lookalike and unknown networks"
  - `tests/guards.test.ts` › "the PUSD constant is the verified mainnet-v1 id, not the wrapped token"
  - `tests/server.test.ts` › "on mainnet amounts always display as PUSD with 2 decimals"
- [x] Contract category is the unreversed VM bytes; SDK / wallet hex is explorer order. Both directions tested.
  - `tests/guards.test.ts` › "explorer hex <-> VM bytes round-trips"
  - `tests/offer.test.ts` › "an offer built with the explorer-order category (not swapped) cannot be accepted"
  - `tests/checkers.test.ts` › "category byte order: explorer-order params match decoded outputs"
  - `tests/chipnetFlows.test.ts` › "the broadcast summary names PUSD in explorer byte order and every output address"
- [x] Fungible-only outputs: `tokenCategory` is 32 bytes, never 33.
  - `tests/guards.test.ts` › "rejects malformed categories and a 33-byte (NFT capability) value"
  - `tests/offer.test.ts` › "rejects input 1 that also carries an NFT (33-byte category)"
  - `tests/offer.test.ts` › "an NFT-capable escrow output is impossible: all inputs are fungible-only, so the VM rejects it"
  - `tests/offer.test.ts` › "an NFT-capable change output is impossible too: the change path cannot mint an NFT"
  - Note: Fungible-only is enforced twice: the contracts check the 32-byte category, and the CashTokens consensus rules refuse to create an NFT without a minting input, which these transactions never have.
- [x] Redeem script / escrow address computed in the offer matches `new Contract(escrowArtifact, args)`.
  - `tests/offer.test.ts` › "the escrow locking bytecode is the SDK Contract locking bytecode"
  - `tests/encodeRedeemScript.test.ts` › "arg order matches the compiled artifact"
  - `tests/encodeRedeemScript.test.ts` › "escrowBody is the artifact bytecode without constructor args"
  - `tests/encodeRedeemScript.test.ts` › "networkId 0x00 is a 1-byte push, not OP_0"
  - `tests/offer.test.ts` › "works for every networkId encoding (0x00 / 0x01 / 0x02) and small OP_N amounts"
- [x] Attestation prefix is 22 bytes, message is 156 bytes, and every offset matches section 4.
  - `tests/attestation.test.ts` › "prefix is exactly 22 bytes, trailing colon included"
  - `tests/attestation.test.ts` › "offsets are contiguous and sum to 156"
  - `tests/attestation.test.ts` › "every field sits at its offset"
  - `tests/guards.test.ts` › "the escrow parse uses the same prefix and split widths as ATTEST_OFFSETS"
- [x] Contract `.split` parse rejects a wrong prefix, a wrong length, and a shifted field.
  - `tests/escrow.test.ts` › "a wrong prefix fails"
  - `tests/escrow.test.ts` › "a %i-byte message fails the length check"
  - `tests/escrow.test.ts` › "a shifted field fails the parse (21-byte prefix without the colon, padded to 156)"
  - `tests/escrow.test.ts` › "a field shifted right by one byte after the prefix fails the parse"
- [x] Outpoint txid endianness matches introspection.
  - `tests/escrow.test.ts` › "outpoint txid must be in VM order: an explorer-order (flipped) txid fails"
  - `tests/escrow.test.ts` › "outpoint index is 4-byte little-endian: vout 258 settles, big-endian bytes fail"
  - `tests/guards.test.ts` › "outpoint txid helper reverses explorer order"
- [x] `answerHash` and `specHash` use the documented canonical bytes.
  - `tests/templates.test.ts` › "is independent of key insertion order and locks a known specHash"
  - `tests/templates.test.ts` › "answerHash is sha256 of the UTF-8 canonical answer, nothing added"
  - `tests/templates.test.ts` › "parseCanonical refuses JSON that is not already canonical"
  - `tests/verifier.test.ts` › "refuses a spec that does not hash to the escrow specHash"
- [x] `NORESPONSE` requires a 32-zero `answerHash`; a nonzero hash with verdict `0x03` fails.
  - `tests/escrow.test.ts` › "NORESPONSE with a non-zero answerHash fails"
  - `tests/attestation.test.ts` › "NORESPONSE carries a 32-zero answerHash and refuses a real one"

## Offer

- [x] Only the agent can `cancel`. A random sig fails (NULLFAIL / checkSig).
  - `tests/offer.test.ts` › "a stranger key cannot cancel (hash160 mismatch)"
  - `tests/offer.test.ts` › "the agent pubkey with a stranger signature fails checkSig"
  - `tests/spikeFlows.test.ts` › "a placeholder cancel signed by the wrong wallet key is rejected"
- [x] Cancel returns the full bond with `tx.outputs.length == 1` and does not leave a token on another output.
  - `tests/offer.test.ts` › "agent reclaims the full bond with exactly one output"
  - `tests/offer.test.ts` › "fails with a second output"
- [x] Cancel fails if `tx.outputs.length != 1`, if output 0 is not the agent's P2PKH, or if output 0 value is under `MIN_OUTPUT_SATS`.
  - `tests/offer.test.ts` › "fails with a second output"
  - `tests/offer.test.ts` › "fails if output 0 is not the agent P2PKH"
  - `tests/offer.test.ts` › "fails if output 0 value is under MIN_OUTPUT_SATS"
- [x] `accept` without a sufficient fee on input 1 fails.
  - `tests/offer.test.ts` › "rejects an insufficient fee on input 1"
- [x] `accept` to a wrong locking bytecode fails (wrong pkh, wrong expiry, wrong specHash, wrong body, wrong `verifierGraceBlocks`).
  - `tests/offer.test.ts` › "rejects an escrow built with %s"
  - `tests/offer.test.ts` › "rejects a redeem script with a tampered escrow body"
  - `tests/offer.test.ts` › "rejects an honest redeem script argument with output 0 sent elsewhere"
  - `tests/offer.test.ts` › "rejects output 0 sent to the challenger P2PKH"
  - Note: The table test covers every escrow argument: challenger and agent pkh, expiry, specHash, challengeId, verifierGraceBlocks, verifierPk, bond and networkId.
- [x] `accept` with `expiryHeight` above `nLocktime + maxDeadlineDelta` fails, including a far-future expiry with a current locktime.
  - `tests/offer.test.ts` › "rejects expiryHeight above nLocktime + maxDeadlineDelta"
  - `tests/offer.test.ts` › "rejects a far-future expiry with a current locktime"
  - `tests/offer.test.ts` › "raising nLocktime to satisfy the bound makes the accept non-final until that height"
  - `tests/offer.test.ts` › "expiryHeight exactly nLocktime + maxDeadlineDelta is allowed (boundary)"
- [x] `accept` with `expiryHeight >= MAX_HEIGHT` fails.
  - `tests/offer.test.ts` › "rejects expiryHeight >= MAX_HEIGHT"
- [x] `accept` with an NFT-capable category suffix on the escrow or change output fails.
  - `tests/offer.test.ts` › "an NFT-capable escrow output is impossible: all inputs are fungible-only, so the VM rejects it"
  - `tests/offer.test.ts` › "an NFT-capable change output is impossible too: the change path cannot mint an NFT"
  - `tests/offer.test.ts` › "rejects input 1 that also carries an NFT (33-byte category)"
- [x] Exact-input path: `changeAmount == 0`, output 1 has no tokens and is the challenger's P2PKH.
  - `tests/offer.test.ts` › "exact-input path: escrow gets bond + fee, output 1 is token-free challenger change"
- [x] Change path: output 1 is the challenger's P2PKH, same category, `tokenAmount == input1 - fee`.
  - `tests/offer.test.ts` › "change path: output 1 returns input1 - fee of the same category to the challenger"
- [x] Change path fails if output 1 is a third party's locking bytecode, or if the change amount is wrong.
  - `tests/offer.test.ts` › "rejects change-path token change sent to a third party"
  - `tests/offer.test.ts` › "rejects a wrong change amount"
  - `tests/offer.test.ts` › "rejects dropping the token change (change path requires the category on output 1)"
- [x] `accept` fails if `tx.outputs.length != 2`, if a third token input is added, or if input 1 is not the challenger's P2PKH.
  - `tests/offer.test.ts` › "rejects a third output"
  - `tests/offer.test.ts` › "rejects an accept with only the escrow output (output 1 dropped)"
  - `tests/offer.test.ts` › "rejects a third input that carries tokens"
  - `tests/offer.test.ts` › "rejects input 1 that is not the challenger's own P2PKH"
  - `tests/offer.test.ts` › "rejects four inputs"

## Escrow

- [x] `settle` PASS pays only the agent the full `bond + fee`.
  - `tests/escrow.test.ts` › "PASS pays only the agent bond + fee (1-output shape)"
  - `tests/escrow.test.ts` › "a PASS cannot pay the challenger"
  - `tests/copier.test.ts` › "the honest fee-payer shape leaves every escrow sat with the winner"
- [x] `settle` FAIL pays only the challenger the full `bond + fee`.
  - `tests/escrow.test.ts` › "FAIL pays only the challenger bond + fee"
  - `tests/escrow.test.ts` › "a FAIL cannot pay the agent"
- [x] `settle` NORESPONSE pays only the challenger the full `bond + fee`, and fails before the answer deadline.
  - `tests/escrow.test.ts` › "NORESPONSE pays only the challenger, at the answer deadline"
  - `tests/escrow.test.ts` › "a NORESPONSE cannot pay the agent"
  - `tests/escrow.test.ts` › "NORESPONSE fails before the answer deadline"
  - `tests/escrow.test.ts` › "NORESPONSE with a deadline locktime is non-final while the chain is below it"
- [x] A verdict signed for challenge A / outpoint A cannot settle escrow B.
  - `tests/escrow.test.ts` › "a verdict for challenge A cannot settle escrow B"
  - `tests/escrow.test.ts` › "a verdict for outpoint A cannot settle another UTXO of the same escrow (txid)"
  - `tests/escrow.test.ts` › "a verdict for vout 0 cannot settle vout 1 of the same txid"
- [x] Wrong `networkId`, wrong `specHash`, wrong prefix, or wrong `answerHash` fails `checkDataSig` / the parse.
  - `tests/escrow.test.ts` › "wrong networkId fails (chipnet verdict against a mocknet escrow)"
  - `tests/escrow.test.ts` › "wrong specHash fails"
  - `tests/escrow.test.ts` › "a wrong prefix fails"
  - `tests/escrow.test.ts` › "an answerHash changed after signing fails checkDataSig"
  - `tests/escrow.test.ts` › "a signature from any key other than verifierPk fails"
- [x] A `verdict` other than `0x01` / `0x02` / `0x03` fails.
  - `tests/escrow.test.ts` › "verdict byte 0x%s fails"
  - `tests/attestation.test.ts` › "verdict bytes are 0x01 / 0x02 / 0x03"
- [x] `settle` fails if an unexpected token output is present, or if `tx.outputs.length` is outside {1, 2}.
  - `tests/escrow.test.ts` › "rejects an extra token output (bond + fee split)"
  - `tests/escrow.test.ts` › "rejects a token-bearing output 1 even with a matching feeLockingBytecode"
  - `tests/escrow.test.ts` › "rejects three outputs"
- [x] `timeout` before `expiryHeight` fails, even if the builder sets a high locktime (CLTV must bite).
  - `tests/escrow.test.ts` › "fails before expiryHeight"
  - `tests/escrow.test.ts` › "a high locktime does not help while the chain is below expiryHeight (non-final)"
  - `tests/escrow.test.ts` › "a final sequence number disables locktime, so CLTV rejects it"
- [x] `timeout` at or after `expiryHeight` refunds bond to agent and fee to challenger, with the output table in section 3.2.
  - `tests/escrow.test.ts` › "at expiryHeight refunds bond to the agent and fee to the challenger"
  - `tests/escrow.test.ts` › "3-output shape with a broadcaster fee input"
  - `tests/copier.test.ts` › "the honest broadcaster shape refunds every escrow sat"
- [x] `timeout` fails if those outputs are reordered, if amounts are swapped, or if an extra token output is added.
  - `tests/escrow.test.ts` › "fails with the refund outputs reordered"
  - `tests/escrow.test.ts` › "fails with the refund amounts swapped"
  - `tests/escrow.test.ts` › "fails with an extra token output"
- [x] After `settle`, the UTXO is gone so `timeout` cannot also be applied.
  - `tests/escrow.test.ts` › "after settle the UTXO is gone, so timeout cannot also run"
  - `tests/verifier.test.ts` › "a second run after settle sees the escrow already spent"

## Wallet, keys, and evaluation

- [x] No private keys, WIFs, or mnemonic in the repo, client bundle, or commit history.
  - `tests/secrets.test.ts` › "no tracked file contains a valid WIF private key"
  - `tests/secrets.test.ts` › "no tracked file contains a valid seed phrase"
  - `tests/secrets.test.ts` › "no commit in the history ever contained a valid WIF"
  - `tests/secrets.test.ts` › "no WIF and no secret env var name in any built client chunk"
  - `tests/boundary.test.ts` › "client components cannot reach checkers, the verifier, the store or any server module"
  - Note: The bundle scan runs after `next build` (a run without a build skips it); the import-boundary test covers the same risk from the source side on every run.
- [x] Verifier key, fee-wallet key, and LLM API key only in `.env.local`.
  - `tests/secrets.test.ts` › "no tracked file assigns a value to a secret env var"
  - `tests/secrets.test.ts` › ".env files and the data directory are ignored by git"
  - `tests/boundary.test.ts` › "only server code reads VERIFIER_PRIVATE_KEY"
  - `tests/secrets.test.ts` › "no WIF and no secret env var name in any built client chunk"
  - Note: Those tests cover the repo. On the server, the secrets live only in the host's environment variables (Railway), never in a file.
- [x] Agent demo wallet is a throwaway with a tiny cap.
  - `tests/server.test.ts` › "config refuses mainnet bonds or fees above 1.00 PUSD"
  - `tests/server.test.ts` › "the app will not publish a mainnet bond above the cap, or from an agent wallet holding too much"
  - `tests/chipnetFlows.test.ts` › "refuses to spend from an agent hot wallet above the caps"
  - `tests/chipnetFlows.test.ts` › "never mints a token on mainnet and refuses bonds above the cap"
  - `tests/chipnetFlows.test.ts` › "a "no" broadcasts nothing and changes nothing on chain"
  - Note: Two layers. The app refuses mainnet bonds above 1.00 PUSD and an agent wallet above 1,000,000 sats or 20 PUSD. The milestone runner refuses bonds above 0.10 PUSD and an agent above 250,000 sats or 10 PUSD. `keygen` makes fresh agent keys per network.
- [x] Integer math only; no `Number` for token amounts.
  - `tests/secrets.test.ts` › "no %s anywhere in lib/, app/ or scripts/"
  - `tests/ui.test.ts` › "amounts render from integer base units without floating point"
  - Note: Heights, block counts and config numbers use `Number`; every token and sat amount is a `bigint` end to end.
- [x] Agent runner cannot import the checker or read an expected answer before commit. A test or a lint/boundary check should fail a forbidden import if you can arrange one; otherwise a documented module split plus a code review note in the report.
  - `tests/boundary.test.ts` › "lib/agent, the store and the public template layer cannot reach checkers or the verifier"
  - `tests/guards.test.ts` › "no file under lib/agent imports lib/templates/check, the verifier, or attestation code"
  - `tests/agent.test.ts` › "sends only the public prompt, then commits the parsed answer with the served model id"
  - Note: The import graph is checked transitively, so an indirect import through another module fails the test too.
- [x] Verifier will not run the checker until `answerHash` is committed.
  - `tests/verifier.test.ts` › "waits, and never runs the checker, while no answer is committed before the deadline"
  - `tests/verifier.test.ts` › "runs the checker exactly once, only after the answer is committed"
  - `tests/verifier.test.ts` › "refuses a late commitment rather than signing NORESPONSE over it"
- [x] Fixture attempts are tagged `fixture` in the store and the UI.
  - `tests/store.test.ts` › "an ai answer must record its model id; a fixture may not need one"
  - `tests/verifier.test.ts` › "fixture answers are labeled fixture in the evidence"
  - `tests/ui.test.ts` › "a fixture answer is badged as not an AI solve; an AI answer shows its model id"

## App-level

- [x] Invalid template params are rejected at accept, not at settle.
  - `tests/server.test.ts` › "rejects invalid params at accept time"
  - `tests/templates.test.ts` › "rejects a spec for another network than the escrow"
  - `tests/routes.test.ts` › "prepare validates input and returns 400 with a readable error"
  - `tests/checkers.test.ts` › "throws on division by zero (accept-time validation stops these earlier)"
- [x] Chipnet and mainnet configs cannot be mixed (category, networkId, Electrum server, addresses).
  - `tests/server.test.ts` › "mainnet must use the PUSD mainnet-v1 category"
  - `tests/server.test.ts` › "chipnet requires its own category and refuses PUSD"
  - `tests/escrow.test.ts` › "wrong networkId fails (chipnet verdict against a mocknet escrow)"
  - `tests/server.test.ts` › "a mainnet config refuses a server at a chipnet height, and the reverse"
  - `tests/server.test.ts` › "the verifier loop and createOffer stop until the server matches"
  - `tests/templates.test.ts` › "rejects an address for the wrong network"
  - `tests/server.test.ts` › "rejects a challenger address from another network"
  - `tests/server.test.ts` › "a key made for the other network is refused (WIFs carry their network)"
  - `tests/server.test.ts` › "NETWORK is matched against an explicit list: object property names are not networks"
  - Note: The Electrum check is a height test: mainnet is above 800,000 and chipnet far below, so a server on the wrong network stops the verifier loop and offer publishing. The runner also refuses a testnet key on a mainnet run.
- [ ] Dust and fee sufficiency: transactions still relay.
  - `tests/guards.test.ts` › "MIN_OUTPUT_SATS covers a token-bearing P2PKH output"
  - `tests/guards.test.ts` › "MIN_OUTPUT_SATS covers a token-bearing P2SH32 escrow output"
  - `tests/chipnetFlows.test.ts` › "every scenario works with cent-sized PUSD bonds, and a sweep empties the throwaway keys"
  - Pending: "Still relay" needs real txids. The dust floors and the VM accept every transaction, but only a real node shows relay. Pending the capped mainnet run in `SPIKE.md`; paste the txids there and tick this.
- [x] A failed checker does not produce a signature.
  - `tests/verifier.test.ts` › "a checker failure signs nothing and does not turn into NORESPONSE"

## Beyond the spec list

Extra protections with their own tests:

- A copier rebuilding an unsigned settle or timeout from the mempool cannot take the escrow BCH (`tests/copier.test.ts`).
- `npm run reproduce` catches tampered evidence: a flipped verdict, an edited answer, a swapped signature or an edited spec (`tests/verifier.test.ts`).
- The agent's `get_transaction` tool refuses chain data that does not hash to the txid (`tests/agentTools.test.ts`).
- Public play challenges exist only on mocknet, rate-limited and capped (`tests/routes.test.ts`).
- The mainnet runner prints every transaction and asks before broadcasting, and `sweep` returns leftovers (`tests/chipnetFlows.test.ts`).
