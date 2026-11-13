# Sellacalida - trimmed build spec

BCH BLAZE 2026 | mainnet track | solo build for ileri (GitHub 0xileri)

> AI agents can claim they're intelligent. Sellacalida makes them prove it with their own money.

An AI agent pre-publishes a PUSD bond in an offer covenant. A challenger accepts in one transaction from their own wallet, adding a fee and a parameterized challenge. A verifier runs a deterministic test, signs a pass or fail, and the escrow contract pays the agent or the challenger. If nobody settles before the block-height deadline, both sides get their money back.

This is a 9-day solo build. Simple and working beats complex. Judges spend about two minutes per project.

---

## Changes from v1

v1 was written under the name HotSeat. Those files stay at `/workspace/hotseat/` and are not the build source. This document is the source of truth for Sellacalida.

1. **Attestation length.** The prefix is the ASCII string `SELLACALIDA-ATTEST-v1:` . It is **22 bytes** (counted with Python `len("SELLACALIDA-ATTEST-v1:")` and by encoding to UTF-8 / ASCII). The signed message is **156 bytes**. Every field offset was recomputed from that prefix. A unit test must assert the prefix length, the total length, and every offset. The escrow contract parses the message with `.split` at those offsets and checks the prefix before `checkDataSig`.
2. **Bounded deadline.** Each offer commits `maxDeadlineDelta` and `verifierGraceBlocks` in the `SellacalidaOffer` constructor. On `accept`, the covenant enforces `require(tx.time >= expiryHeight - maxDeadlineDelta)`. Because `tx.time` is the transaction's `nLocktime`, and a transaction cannot be mined before that locktime, this bounds `expiryHeight` to at most the mine height plus `maxDeadlineDelta`. A challenger cannot lock the agent's bond far into the future. `expiryHeight` is one of the escrow constructor arguments, so it is part of the escrow address. The offer recomputes that P2SH32 locking bytecode and requires output 0 to match.
3. **No-response vs verifier-down.** Verdict bytes are `PASS = 0x01`, `FAIL = 0x02`, `NORESPONSE = 0x03`. If the agent does not commit an answer by the answer deadline (`expiryHeight - verifierGraceBlocks`), the verifier signs `NORESPONSE`, and the contract pays the challenger the bond plus the fee, the same as a fail. If no attestation arrives by `expiryHeight`, `timeout()` refunds the bond to the agent and the fee to the challenger. A silent agent can no longer avoid a loss while the verifier is online.
4. **Constrained PUSD change.** Exact-value fee inputs stay a required milestone 1 test. Production accepts also allow tightly constrained PUSD change: output 1 must go to the challenger's own P2PKH locking bytecode, carry the same token category, and pay a remainder computed on-chain as `tx.inputs[1].tokenAmount - feeAmount`.
5. **Explicit output restrictions.** Every contract function has a per-function input and output table in this spec. The covenant enforces `tx.outputs.length`, index order, `lockingBytecode`, `tokenCategory`, `tokenAmount`, a minimum satoshi value, and a ban on unexpected token outputs. Negative tests must cover violations.
6. **AI evaluation integrity.** The agent runner must call a real LLM and must never have access to the checker or the expected answer (separate module or process, no shared imports). The verifier computes the expected answer only after the answer hash is committed. Scripted or test-fixture attempts are stored and shown as `fixture`, never as AI solves. The model ID and the raw response hash are recorded.

---

## 1. One-line pitch

AI agents can claim they're intelligent. Sellacalida makes them prove it with their own money.

Business framing for judges: independent, inspectable verification infrastructure for AI agents. Near-term income is evaluation fees. Longer-term income is enterprise testing, not gambling on chatbot answers.

---

## 2. Trimmed architecture

One Next.js app. No Supabase, no Realtime, no separate worker. The agent runner is an isolated module or process inside that app (or beside it) and is the one exception to "everything can import everything."

```
[Paytaca or Selene]
        |  WizardConnect (@wizardconnect/react)
        v
[Next.js App Router, TypeScript, Tailwind]
  pages + API routes + a small server-side store
        |
        +--> agent runner (separate module/process: LLM only, no checker)
        +--> CashScript TransactionBuilder (offers, accepts, settle, timeout, BCH tips)
        +--> ElectrumNetworkProvider / Fulcrum (chain reads, tx broadcast)
        +--> Verifier module (cannot be imported by the agent runner)
        v
[Bitcoin Cash]  offer UTXO --> accept tx --> escrow UTXO --> settle or timeout
```

Rules:

- The chain is the source of truth. The store is a display cache (challenge records, evidence, agent profiles, cached txids). If the store is lost, records can be rebuilt from published txids and evidence blobs.
- Store: SQLite via `better-sqlite3` on a single long-running Node process. A JSON file is acceptable if SQLite is awkward. Do not deploy this as Vercel-style serverless: the store needs a persistent filesystem and a single writer.
- Poll the chain and the store from the browser (SWR or a 2-3s `setInterval`). No websockets.
- Stack: Next.js App Router, TypeScript, Tailwind, CashScript `^0.14.0` (`pragma cashscript ^0.14.0`), `@bitauth/libauth`, `@wizardconnect/react`.
- All token math is integer base units (`bigint` in TypeScript, `int` in CashScript). Never use floating point for amounts.
- Secrets (`VERIFIER_PRIVATE_KEY`, any agent hot-wallet key, any LLM API key) live in `.env.local` and are never committed. The demo agent wallet holds only small experimental funds.

### Networks

| Network | Provider | Token |
| --- | --- | --- |
| mocknet | `MockNetworkProvider` (`validateTransactions: true`, default `vmTarget` is `BCH_2026_05`) | fake category in tests |
| chipnet | `ElectrumNetworkProvider` with `Network.CHIPNET` | a CashToken you mint yourself |
| mainnet | `ElectrumNetworkProvider` with `Network.MAINNET` | PUSD only, after chipnet works |

Chipnet tBCH: [apecs.dev/bch/faucets](https://apecs.dev/bch/faucets) drips 10,000 sats to a `bchtest:q…` P2PKH address, gated by a small proof-of-work. Confirm any other faucet before depending on it.

Minting a chipnet test token: spend a vout0 UTXO so the new category ID is the txid of the transaction that created that vout0 (the prevout txid of the genesis input). Practical tools: [CashTokens Studio on chipnet](https://chipnet.cashtokens.studio/), Cashonize pointed at chipnet, or a genesis transaction you build with CashScript / Libauth. Use that category in chipnet config. Never use the mainnet PUSD category on chipnet.

### PUSD category

Mainnet ParyonUSD (PUSD) category, explorer / wallet byte order:

```
2469acc5afa4b10cb5b5c04afb89c3a3ffd61c5da9c01e26d00951cae2a02544
```

**Verified** on 13 November 2026 (WAT) against:

- ParyonUSD canonical `mainnet-v1` deployment: [Contract Verification](https://paryonusd.com/docs/technical/contract-verification) (last updated 4 May 2026)
- ParyonUSD launch post: [ParyonUSD Launch Day](https://paryonusd.com/blog/launch) (30 April 2026)
- Also listed as PUSD on [Cauldron](https://app.cauldron.quest/swap/2469acc5afa4b10cb5b5c04afb89c3a3ffd61c5da9c01e26d00951cae2a02544) and in BCMR metadata on [blockexplorer.cash](https://blockexplorer.cash/mainnet/bcmr)

PUSD has **2 decimal places**. The smallest base unit is 0.01 PUSD (one cent). Contracts and the server must use integer cents: `100` means `1.00 PUSD`. The UI may format for display only.

Do not use `741dd9a36c0a1d8b6d396b5095880ac942dcf3f634d969a2caa1d2021687519f`. Selene's explorer has labeled a token at that category as ParyonUSD / "Wraps ParyonUSD". That is not the official `mainnet-v1` PUSD id published by ParyonUSD. Using the wrong category means the contract will reject real PUSD.

**Byte-order caveat (critical):** CashScript introspection (`tx.inputs[i].tokenCategory`, `tx.outputs[i].tokenCategory`) returns the category in the original unreversed VM order. Wallets, explorers, Cauldron, and the published PUSD id above use the reversed byte order. Before comparing or storing a category inside a contract, convert with Libauth's `swapEndianness`. A documented CashScript pattern is:

```ts
import { swapEndianness } from '@bitauth/libauth';
const categoryForContract = swapEndianness(publishedCategoryHex);
```

Lock this with a mocknet test: a UTXO that carries the published PUSD hex in the SDK's `token.category` field must satisfy `tx.inputs[i].tokenCategory == <constructor category>` only after the endianness conversion is correct. Treat SDK `TokenDetails.category` as explorer-order hex unless a test proves otherwise. If the 32-byte value is concatenated with `0x01` or `0x02`, that output also carries an NFT capability; Sellacalida offer and escrow UTXOs must be fungible-only (exactly 32 bytes, no capability suffix). Enforce `tokenCategory.length == 32` on those outputs and on the offer / escrow inputs.

---

## 3. Contract design

Two contracts, both P2SH32 (`LockingBytecodeP2SH32`, script hash is `hash256` of the redeem script). Do not use P2SH20.

A same-UTXO "mutable NFT for state + PUSD funds" design is not viable. CashTokens only allow an NFT on the same UTXO as fungible tokens if they share a category, and we cannot mint a PUSD NFT. So the offer and the escrow are different contracts (different constructor args, different addresses). The offer's `accept` function must itself enforce that output 0 is a correctly parameterized `SellacalidaEscrow`.

Shared contract constants (same values in both contracts and in TypeScript):

| Name | Suggested value | Role |
| --- | --- | --- |
| `MIN_OUTPUT_SATS` | `1000` | Minimum `value` on every contract-constrained output. Token-bearing dust is higher than 546 sats and depends on bytecode size. **Verify** against CashTokens dust for P2PKH and P2SH32 token outputs before mainnet, and raise the constant if needed. |
| `MAX_HEIGHT` | `500_000_000` | `expiryHeight` must be strictly below this so `tx.time` is treated as a block height, not a timestamp. |
| `MIN_VERIFIER_GRACE` | `18` | Minimum `verifierGraceBlocks` the agent may commit (about 3 hours at 10-minute blocks). |

`tx.time` may only appear as `require(tx.time >= <expression>)`. It cannot be used in a `<` comparison. The deadline bound below is written to fit that rule.

### 3.1 `SellacalidaOffer`

Holds the agent's bond until cancel or accept.

**Constructor**

| Param | Type | Meaning |
| --- | --- | --- |
| `agentPkh` | `bytes20` | hash160 of the agent's pubkey; payout and cancel authority |
| `verifierPk` | `pubkey` | verifier's compressed pubkey (33 bytes) |
| `bondAmount` | `int` | PUSD base units the agent locked |
| `feeAmount` | `int` | PUSD base units the challenger must add |
| `tokenCategory` | `bytes32` | unreversed 32-byte category, no capability suffix |
| `networkId` | `bytes` (1 byte) | `0x00` mainnet, `0x01` chipnet, `0x02` mocknet |
| `maxDeadlineDelta` | `int` | max blocks after accept locktime that `expiryHeight` may sit. Agent-authorized. Must be greater than `verifierGraceBlocks`. |
| `verifierGraceBlocks` | `int` | blocks between the answer deadline and `expiryHeight`. Must be `>= MIN_VERIFIER_GRACE`. Answer deadline is `expiryHeight - verifierGraceBlocks`. |
| `escrowBody` | `bytes` | compiled `SellacalidaEscrow` bytecode **without** constructor args, exactly as in the CashScript artifact |

`bondAmount` and `feeAmount` must be greater than 0. Prefer an explicit `require` of that in `cancel` and `accept`.

---

#### `cancel(pubkey agentPk, sig agentSig)`

Agent reclaims an unaccepted bond.

**Input table**

| Rule | Enforcement |
| --- | --- |
| `this.activeInputIndex == 0` | required |
| `tx.inputs.length` is 1 or 2 | required |
| Input 0 | this offer UTXO: `tokenCategory == tokenCategory` (length 32), `tokenAmount == bondAmount` |
| Input 1, if present | BCH fee only: `tokenCategory == 0x` |

**Output table**

`tx.outputs.length == 1`.

| Index | lockingBytecode | tokenCategory | tokenAmount | value |
| --- | --- | --- | --- | --- |
| 0 | `new LockingBytecodeP2PKH(agentPkh)` | `tokenCategory` (length 32) | `bondAmount` | `>= MIN_OUTPUT_SATS` |

No other outputs exist, so no unexpected token outputs are possible.

Other checks:

- `hash160(agentPk) == agentPkh`
- `checkSig(agentSig, agentPk)`

The agent signs this with their wallet. Use `placeholderSignature()` and `placeholderPublicKey()` plus a WizardConnect `inputPaths` entry if the wallet fills contract placeholders (Paytaca does; Selene must be confirmed during the wallet spike). Prefer the documented placeholder path when the wallet supports it.

---

#### `accept(bytes20 challengerPkh, bytes32 challengeId, bytes32 specHash, int expiryHeight, int escrowSatoshis, bytes escrowRedeemScript)`

The challenger accepts in a single transaction from their own wallet. There is no jointly signed funding.

**Deadline bound (on-chain, critical)**

- `require(expiryHeight < MAX_HEIGHT)` so timeout stays a block height.
- `require(verifierGraceBlocks >= MIN_VERIFIER_GRACE)` (constructor value, checked here too).
- `require(maxDeadlineDelta > verifierGraceBlocks)`.
- `require(expiryHeight > verifierGraceBlocks)` so `expiryHeight - verifierGraceBlocks` cannot underflow into a meaningless answer deadline.
- `require(tx.time >= expiryHeight - maxDeadlineDelta)`.

Why that last line is a real bound: `tx.time` is `nLocktime`. A transaction with a future `nLocktime` cannot be mined until that height. So mine height `>= nLocktime`, and the require gives `expiryHeight <= nLocktime + maxDeadlineDelta <= mine height + maxDeadlineDelta`. If a challenger sets `expiryHeight` far in the future and tries to use a current locktime, the require fails. If they raise locktime to satisfy the require, the accept itself will not confirm until that future height, and the agent can `cancel` in the meantime.

The app should still refuse silly windows, but the covenant is what stops a bypass of the website.

**Input table**

| Rule | Enforcement |
| --- | --- |
| `this.activeInputIndex == 0` | required |
| `tx.inputs.length` is 2 or 3 | required |
| Input 0 | this offer UTXO: `tokenCategory` length 32 and equal to constructor category, `tokenAmount == bondAmount` |
| Input 1 | challenger's PUSD UTXO: same `tokenCategory` (length 32), `tokenAmount >= feeAmount`, `lockingBytecode == new LockingBytecodeP2PKH(challengerPkh)` |
| Input 2, if present | BCH fee only: `tokenCategory == 0x` |

Because input 0 contributes only `bondAmount` tokens and only input 1 may add more of this category, the fee must come from the challenger. Set `allowImplicitFungibleTokenBurn: false` on the TransactionBuilder (the default).

Let `int changeAmount = tx.inputs[1].tokenAmount - feeAmount`. Require `tx.inputs[1].tokenAmount >= feeAmount` so this is non-negative. A zero-token output is not a valid CashTokens fungible output, so the two cases differ.

**Output table, exact-input path** (`changeAmount == 0`)

`tx.outputs.length == 2`.

| Index | lockingBytecode | tokenCategory | tokenAmount | value |
| --- | --- | --- | --- | --- |
| 0 | computed `SellacalidaEscrow` P2SH32 (see below) | `tokenCategory` (length 32) | `bondAmount + feeAmount` | `== escrowSatoshis` and `>= MIN_OUTPUT_SATS` |
| 1 | `new LockingBytecodeP2PKH(challengerPkh)` | `0x` (empty) | no tokens | `>= MIN_OUTPUT_SATS` (BCH change) |

**Output table, change path** (`changeAmount > 0`)

`tx.outputs.length == 2`.

| Index | lockingBytecode | tokenCategory | tokenAmount | value |
| --- | --- | --- | --- | --- |
| 0 | same computed escrow P2SH32 | `tokenCategory` (length 32) | `bondAmount + feeAmount` | `== escrowSatoshis` and `>= MIN_OUTPUT_SATS` |
| 1 | `new LockingBytecodeP2PKH(challengerPkh)` | `tokenCategory` (length 32) | `changeAmount` (`tx.inputs[1].tokenAmount - feeAmount`) | `>= MIN_OUTPUT_SATS` |

Output 1 is the fixed change index in both paths. In the change path, leftover BCH rides on that same output. There is no token change to any other address, and no third output.

**Escrow address check**

`escrowRedeemScript` must equal `encodeCashScriptConstructorArgs(escrowArgs) || escrowBody`, where `escrowArgs` are, in order:

`agentPkh, challengerPkh, verifierPk, bondAmount, feeAmount, tokenCategory, networkId, challengeId, specHash, expiryHeight, verifierGraceBlocks`

Then:

```cashscript
require(tx.outputs[0].lockingBytecode == new LockingBytecodeP2SH32(hash256(escrowRedeemScript)));
```

Because `expiryHeight` and `verifierGraceBlocks` are inside those args, a challenger cannot point output 0 at an escrow with a different deadline than the one just checked.

**`encodeCashScriptConstructorArgs` is a verify-and-lock item, not something to invent from memory.** CashScript 0.14 bakes constructor arguments into the redeem script using the SDK's encoding. Do not guess push opcodes or integer endianness. Milestone 1 starts by printing the redeem script of a `new Contract(escrowArtifact, args, { provider })` instance (verify the exact property name, likely on the Contract object) and writing a shared encoder that matches it byte-for-byte. The same encoder is reimplemented (or the fully encoded prefix is checked) inside `SellacalidaOffer.accept`. A mocknet test fails the build if:

```text
hash256(encode(args) || escrowBody)  !=  hash256(redeem script from the SDK Contract)
```

or if the offer contract accepts an output whose locking bytecode is not the escrow Contract's locking bytecode.

If in-contract encoding is too brittle or blows the script size, the allowed fallback is: pass the full `escrowRedeemScript` as now, and check (1) it ends with exactly `escrowBody`, (2) the constructor-arg prefix decodes to the expected values field by field. Still gate on a byte-for-byte match with the SDK.

### 3.2 `SellacalidaEscrow`

Holds `bondAmount + feeAmount` until a signed verdict or a block-height timeout.

**Constructor**

| Param | Type | Meaning |
| --- | --- | --- |
| `agentPkh` | `bytes20` | agent's payout |
| `challengerPkh` | `bytes20` | challenger's payout |
| `verifierPk` | `pubkey` | verifier pubkey |
| `bondAmount` | `int` | agent bond, base units |
| `feeAmount` | `int` | challenger fee, base units |
| `tokenCategory` | `bytes32` | unreversed category |
| `networkId` | `bytes` (1 byte) | same codes as the offer |
| `challengeId` | `bytes32` | unique id for this challenge |
| `specHash` | `bytes32` | SHA-256 of the canonical challenge spec |
| `expiryHeight` | `int` | absolute block height; `timeout()` becomes valid at this height |
| `verifierGraceBlocks` | `int` | answer deadline is `expiryHeight - verifierGraceBlocks`; `NORESPONSE` becomes valid then |

**Verdict bytes**

| Name | Byte | Payout |
| --- | --- | --- |
| `PASS` | `0x01` | `bondAmount + feeAmount` to the agent |
| `FAIL` | `0x02` | `bondAmount + feeAmount` to the challenger |
| `NORESPONSE` | `0x03` | `bondAmount + feeAmount` to the challenger, same as fail |

Any other byte, including `0x00`, fails. For `NORESPONSE`, `answerHash` in the attestation must be 32 zero bytes (no committed answer). For `PASS` and `FAIL`, `answerHash` is the committed answer hash.

---

#### `settle(datasig verifierSig, bytes message)`

The TypeScript verifier builds the 156-byte attestation, signs it, and passes the raw message into the contract. The contract does **not** rebuild the preimage by concatenation alone. It parses `message` with `.split` at the offsets in section 4, checks the prefix and every bound field, then `require(checkDataSig(verifierSig, message, verifierPk))`.

Parse sketch (CashScript 0.14 tuple destructuring):

```cashscript
require(message.length == 156);
bytes prefix, bytes rest = message.split(22);
require(prefix == bytes('SELLACALIDA-ATTEST-v1:'));
bytes networkIdB, rest = rest.split(1);
require(networkIdB == networkId);
bytes challengeIdB, rest = rest.split(32);
require(challengeIdB == challengeId);
bytes outpointTxidB, rest = rest.split(32);
require(outpointTxidB == tx.inputs[this.activeInputIndex].outpointTransactionHash);
bytes outpointIndexB, rest = rest.split(4);
require(outpointIndexB == encodeUint32LE(tx.inputs[this.activeInputIndex].outpointIndex));
bytes specHashB, rest = rest.split(32);
require(specHashB == specHash);
bytes verdictB, rest = rest.split(1);
bytes answerHashB, bytes none = rest.split(32);
require(none.length == 0);
```

`encodeUint32LE` is a **verify** item: 4-byte little-endian, locked by a test against the TypeScript serializer. Do not use `toPaddedBytes` until its endianness is verified against this layout.

Then:

- `verdictB` is `0x01`, `0x02`, or `0x03`
- if `verdictB == 0x03`: `require(answerHashB == 0x0000...0000)` (32 zero bytes) and `require(tx.time >= expiryHeight - verifierGraceBlocks)`
- if `verdictB == 0x01` or `0x02`: `answerHashB` is whatever was committed; no extra height lock
- winner is `agentPkh` if `PASS`, otherwise `challengerPkh`

**Input table**

| Rule | Enforcement |
| --- | --- |
| `this.activeInputIndex == 0` | required |
| `tx.inputs.length` is 1 or 2 | required |
| Input 0 | this escrow UTXO: `tokenCategory` length 32 and equal to constructor category, `tokenAmount == bondAmount + feeAmount` |
| Input 1, if present | settler's BCH fee only: `tokenCategory == 0x` |

**Output table**

`tx.outputs.length` is 1 or 2.

| Index | lockingBytecode | tokenCategory | tokenAmount | value |
| --- | --- | --- | --- | --- |
| 0 | `new LockingBytecodeP2PKH(winnerPkh)` | `tokenCategory` (length 32) | `bondAmount + feeAmount` | `>= MIN_OUTPUT_SATS` |
| 1, if present | settler / fee-wallet locking bytecode, passed as a `bytes feeLockingBytecode` argument so this cannot become a hidden token sink | `0x` | no tokens | `>= MIN_OUTPUT_SATS` if you want a floor, else allow dust-level BCH change. Be consistent and test it. |

If `feeLockingBytecode` is an argument, require output 1 (when present) to equal it and to have an empty `tokenCategory`. If `tx.outputs.length == 1`, all leftover BCH (minus miner fee) stays on output 0 with the winner. Both shapes must be tested.

`checkDataSig` already SHA-256s `message`. Pass the raw 156-byte preimage, not a hash of it.

---

#### `timeout()`

Refund both sides if no attestation has been published by `expiryHeight`. This is the verifier-unavailable path. It is not the agent-silent path. A silent agent, when the verifier is online, should already have been settled with `NORESPONSE` during the grace window.

Checks:

- `require(tx.time >= expiryHeight)`
- The TransactionBuilder **must** `setLocktime(expiryHeight)` (or a locktime `>= expiryHeight` and still `< MAX_HEIGHT`). The default input sequence in CashScript is `0xfffffffe` (non-final), which is what locktime needs. Do not set sequence to `0xffffffff`.

**Input table**

Same as `settle`: `this.activeInputIndex == 0`, `tx.inputs.length` is 1 or 2, input 0 carries `bondAmount + feeAmount` of the category (length 32), optional input 1 is BCH only.

**Output table**

`tx.outputs.length` is 2 or 3.

| Index | lockingBytecode | tokenCategory | tokenAmount | value |
| --- | --- | --- | --- | --- |
| 0 | `new LockingBytecodeP2PKH(agentPkh)` | `tokenCategory` (length 32) | `bondAmount` | `>= MIN_OUTPUT_SATS` |
| 1 | `new LockingBytecodeP2PKH(challengerPkh)` | `tokenCategory` (length 32) | `feeAmount` | `>= MIN_OUTPUT_SATS` |
| 2, if present | broadcaster BCH change (optional `bytes feeLockingBytecode` argument, same pattern as settle) | `0x` | no tokens | `>= MIN_OUTPUT_SATS` or the same consistent dust rule |

Anyone can broadcast a valid timeout once the height is reached (the server should do it). No signature is required. After `settle`, the UTXO is gone, so timeout cannot also run.

### 3.3 Native BCH feature

Mainnet eligibility must not depend only on PUSD transfers. Ship a useful native BCH transfer in the same app:

- **Tip an agent** (or fund an agent's listed BCH challenge-budget address) with a plain BCH send through WizardConnect: `placeholderP2PKHUnlocker`, one output to the agent's cash address, change back to the sender.
- Optionally also let the agent deposit a small BCH budget that the server uses only to pay escrow settlement fees. If you add this, keep it a simple send to a published address, not a second covenant, unless milestone 1 is already done.

The BCH tip is not a fallback bond. If the PUSD / CashToken wallet path fails the spike, the fallback is either an XO template for the token send, or a **BCH-denominated bond/fee variant** of the same two contracts (replace `tokenCategory` / `tokenAmount` checks with `value` checks). Decide on day 1 of the spike. Do not silently switch assets later.

### 3.4 CashScript / SDK notes (do not invent APIs)

Use only documented CashScript 0.14 APIs:

- `checkDataSig(datasig s, bytes msg, pubkey pk)` - the opcode SHA-256s `msg` itself. Pass the raw attestation preimage, not a hash of it. `datasig` is the 64-byte signature without a sighash flag.
- `checkSig(sig s, pubkey pk)` for the agent's cancel path.
- NULLFAIL: an invalid non-empty signature aborts the script. If a function ever has two alternative signatures, the unused one must be `0x`. v1 functions do not need alternative sigs.
- Introspection: `tx.outputs[i].lockingBytecode`, `tx.outputs[i].tokenCategory`, `tx.outputs[i].tokenAmount`, `tx.outputs[i].value`, `tx.outputs.length`, the same fields on `tx.inputs[i]`, `tx.inputs[i].outpointTransactionHash`, `tx.inputs[i].outpointIndex`, `this.activeInputIndex`, `tx.locktime`, `tx.time`.
- Bytes: `.length`, `.split(index)` (returns a tuple of the left and right slices; out-of-range indices fail the script), `.slice(start, end)` if needed.
- `this.age` is a relative lock (`nSequence`) and is not used in v1. Timeout and `NORESPONSE` use absolute `tx.time`.
- `new LockingBytecodeP2PKH(pkh)`, `new LockingBytecodeP2SH32(scriptHash)`, `new LockingBytecodeNullData(chunks)` if you need OP_RETURN (not used in the v1 output tables).
- `TransactionBuilder` with `provider`, default `allowImplicitFungibleTokenBurn: false`. `addInput(utxo, unlocker, options?)`, `addOutput({ to, amount, token? })`, `addOpReturnOutput`, `addTokenChangeOutputIfNeeded` (not used on accept in v1, because PUSD change is explicit at output 1), `addBchChangeOutputIfNeeded`, `setLocktime(locktime)`, `send()`, `build()`, `debug()`, `generateWcTransactionObject({ broadcast, userPrompt })`.
- CashScript 0.14 requires every UTXO to include `lockingBytecode`. Network providers set this on UTXOs they return. Mock UTXOs you add yourself must include it (`addUtxo` returns a spendable UTXO with it set).
- Token output shape in the SDK:

  ```ts
  token: { amount: 100n, category: categoryHex }
  ```

  `amount` is `bigint`. `category` hex order must be confirmed by the endianness test above.
- For WalletConnect / WizardConnect placeholders: `placeholderP2PKHUnlocker(address)`, `placeholderSignature()`, `placeholderPublicKey()` from `cashscript`. Then `generateWcTransactionObject()` and attach `inputPaths` yourself. See section 11.
- `Contract` address used when sending tokens must be the token-aware cashaddr (verify the property; in recent CashScript this is typically `contract.tokenAddress`). Locking bytecode comparison in the contract is independent of the address encoding.
- Integer literals in contracts can use `_` separators (`500_000_000`).

---

## 4. Attestation message layout

Domain-separated, fixed-width, identical bytes in the contract and in the TypeScript verifier. If the two encodings drift, valid verdicts will fail. Cover this with a unit test that builds the message in TypeScript, asserts lengths and offsets, and compares against the contract's `.split` parse.

`checkDataSig` already hashes the message with SHA-256. Do not pre-hash the preimage.

Prefix, counted in code on 13 November 2026 (WAT):

```
"SELLACALIDA-ATTEST-v1:"  ->  22 bytes ASCII
```

Do not drop the trailing colon. `SELLACALIDA-ATTEST-v1` without the colon is 21 bytes and would shift every later field.

| Offset | Length | Field | Encoding |
| --- | --- | --- | --- |
| 0 | 22 | prefix | ASCII `SELLACALIDA-ATTEST-v1:` |
| 22 | 1 | `networkId` | `0x00` mainnet, `0x01` chipnet, `0x02` mocknet |
| 23 | 32 | `challengeId` | raw 32 bytes |
| 55 | 32 | escrow outpoint txid | `tx.inputs[i].outpointTransactionHash` exactly as introspection returns it |
| 87 | 4 | escrow outpoint index | 4-byte **little-endian** unsigned (Bitcoin outpoint convention) |
| 91 | 32 | `specHash` | SHA-256 of the canonical challenge spec bytes |
| 123 | 1 | `verdict` | `0x01` PASS, `0x02` FAIL, `0x03` NORESPONSE |
| 124 | 32 | `answerHash` | SHA-256 of the canonical answer bytes, or 32 zero bytes for `NORESPONSE` |

**Total: 156 bytes.**

Shared TypeScript constants (names are suggestions) must be the single source of these numbers, imported by the serializer and by the tests:

```ts
export const ATTEST_PREFIX = 'SELLACALIDA-ATTEST-v1:'; // 22
export const ATTEST_LENGTH = 156;
export const ATTEST_OFFSETS = {
  prefix: 0,
  networkId: 22,
  challengeId: 23,
  outpointTxid: 55,
  outpointIndex: 87,
  specHash: 91,
  verdict: 123,
  answerHash: 124,
} as const;
```

Required tests:

- `ATTEST_PREFIX.length === 22` and `Buffer.byteLength(ATTEST_PREFIX, 'ascii') === 22`
- a built message has `length === 156`
- each field sits at the offset above (for example, bytes `[0, 22)` equal the prefix, byte 123 is the verdict)
- the contract rejects a message whose prefix is wrong, whose length is not 156, or whose field offsets are shifted
- a flipped-endian outpoint txid fails

Notes:

- Outpoint txid byte order is a **verify** item. Introspection may use VM (unreversed) order, while explorers reverse txids. The TypeScript signer must use the same bytes the contract reads from `outpointTransactionHash`, not an explorer string. Prove this on mocknet by settling with a signature and failing a flipped-endian one.
- The signature is bound to this escrow UTXO (`outpoint`), this `challengeId`, this `networkId`, this `specHash`, this `verdict`, and this `answerHash`. A pass signed for one escrow cannot be replayed against another.
- `specHash = sha256(canonicalSpec)`. `answerHash = sha256(utf8(canonicalAnswer))` for `PASS` and `FAIL`.

## 5. Challenge templates

Challengers try to stump the agent. They do not just pay and wait for a random platform question. Every live challenge is an instance of a template with challenger-supplied parameters and an exact checker.

v1 ships **three hero templates** (BCH transaction analysis) and **one secondary** (logic / arithmetic). No free-form questions, no subjective judging, no user-uploaded code, no price predictions, no internet-research quality scoring.

### Canonical spec

A spec is a UTF-8 JSON object with keys sorted lexicographically, no extra whitespace (or use a documented `canonicalize(spec)` that tests lock down). `specHash = sha256(utf8(canonicalJson))`.

Common fields:

```json
{
  "templateId": "bch.output_token_count",
  "version": 1,
  "network": "mainnet",
  "params": { }
}
```

`network` in the spec must match the escrow `networkId`. A chipnet spec cannot be settled against a mainnet escrow.

### Hero: BCH transaction analysis

The verifier fetches the referenced transaction from a public Fulcrum / Electrum server (`blockchain.transaction.get(txid, true)` or the equivalent method on CashScript's Electrum client - **verify** the exact helper; do not assume `ElectrumNetworkProvider` already wraps this). Use a chipnet server on chipnet (for example `chipnet.bch.ninja` - verify current hostname) and a mainnet server on mainnet. The verbose result must include CashToken fields; if it does not, switch to a raw tx hex plus Libauth decode. Parse once, then run the checker. Cache the raw tx hex in the evidence blob so a third party can reproduce the result without trusting the server.

1. `bch.output_token_count`

   - Prompt: how many outputs of transaction `txid` carry token category `category`?
   - Params: `{ "txid": "<explorer-order hex>", "category": "<explorer-order hex>" }`
   - Answer: a decimal integer as a string, no leading zeros (`"0"` allowed).
   - Checker: count outputs whose token category (in the same byte order you document in the checker) equals `category`. NFT-only and FT outputs both count as "carrying" that category. The evidence must show the per-output category list.

2. `bch.total_sats_to_address`

   - Prompt: how many sats does transaction `txid` send to `address`?
   - Params: `{ "txid": "...", "address": "<cashaddr>" }`
   - Answer: decimal integer string (total sats).
   - Checker: decode `address` to locking bytecode (Libauth; support both token-aware and non-token-aware encodings of the same payload). Sum `value` of outputs whose locking bytecode matches. Do not include input "debits". If the address is invalid, the challenge must be rejected at accept time, not at settle time.

3. `bch.nft_output_index`

   - Prompt: which output index in transaction `txid` holds the NFT with category `category` (and, if supplied, commitment `commitment`)?
   - Params: `{ "txid": "...", "category": "...", "commitment": "<hex or empty>" }`
   - Answer: decimal integer string (the output index).
   - Checker: find the unique matching output. If zero or more than one output matches, the correct agent behavior is to answer with a documented sentinel (use `"-1"`) rather than guessing. Lock this in the template description the agent sees.

All txids and categories in params are explorer-order hex, lowercase, no `0x` prefix. The checker converts as needed.

### Secondary: logic / arithmetic

4. `math.exact_result`

   - Prompt: a fully specified integer scenario, no hidden inputs.
   - Params: a small expression AST, not a free string to `eval`. Example shape (keys sorted in the canonical JSON):

     `{ "op": "add" | "sub" | "mul" | "div" | "mod", "left": <int or nested>, "right": <int or nested> }`

   - Integers are decimal strings in the JSON so they stay exact. Division is integer division; division or mod by zero is a rejected spec at accept time.
   - Answer: decimal integer string, allow a leading minus.
   - Checker: evaluate the AST in bigint arithmetic and compare.

Do not add a "valid arrangement under constraints" template until the four above are shipping. If there is spare time, a `logic.constraints` template can be a later stretch, still with a deterministic checker and no user-supplied code.

### Agent answers and evaluation integrity

The live agent runner must call a real LLM. It receives the template id, the human prompt, and the params. It must never import the checker, never receive the expected answer, and never sit in the same module as the verifier. Put checkers under a path the agent runner is forbidden to import (for example `lib/templates/check/` vs `lib/agent/`). If you use two processes, do not give the agent process filesystem access to the checker source or a function handle.

Sequence, required:

1. Accept confirms on-chain. The spec is public. The expected answer has not been computed yet (or, if a cache exists, the agent runner still cannot read it).
2. The agent runner calls the model, stores `modelId`, the raw response text, `rawResponseHash = sha256(utf8(rawResponse))`, and the parsed canonical answer string, in one atomic write.
3. That write **commits** `answerHash = sha256(utf8(canonicalAnswer))`. The store must refuse updates to the answer, raw response, or hashes after the first write.
4. Only after that commit does the verifier compute the expected answer, compare, and sign `PASS` or `FAIL`.
5. If the agent never commits an answer by the answer deadline, the verifier signs `NORESPONSE` with a 32-zero `answerHash`. It still must not need the agent runner for that path.

Scripted or test-fixture attempts are allowed for contract tests, CI, and a rehearsed demo backup. They must be stored with `source: "fixture"` (or equivalent) and the UI must label them **fixture**, never as an AI solve. Live arena rows that came from an LLM use `source: "ai"` plus the model ID. Do not display a checker-generated answer as if a model produced it.

The evidence page shows, when `source` is `ai`: model ID, raw response hash, canonical answer, answer hash, checker trace, and the attestation. When `source` is `fixture`, the same evidence is shown under a clear fixture badge.

## 6. Verifier design

The verifier is a trusted component. The contracts cannot decide whether arbitrary text is correct, and they cannot see whether an answer was committed off-chain. They can only check a `checkDataSig` from `verifierPk` over the bound attestation message, then enforce payouts. Disclose this on the home page and on every challenge page, in plain language:

> The BCH contract holds the money and enforces the payout. An independent verifier runs a fixed, published test and signs pass, fail, or no-response. You can re-run the test from the evidence, but you do have to trust this verifier's key to be the one that signed it, and to sign no-response only when the agent really did not commit an answer by the deadline. This is not a fully trustless judgment of the AI. If the verifier never signs, both sides are refunded at the expiry height.

What the verifier can and cannot do:

- It cannot send the funds to itself. The contract only pays the agent or the challenger.
- It can wrongly sign `FAIL` or `NORESPONSE` against an honest agent, or `PASS` against a wrong answer. That is the remaining trust boundary. Evidence is public so a bad verdict can be seen.
- It should not sign `NORESPONSE` if an answer hash was already committed, and should not sign `PASS`/`FAIL` without a committed answer. That rule lives in verifier software, not in the covenant (the chain does not store the commitment).
- If the verifier is offline through `expiryHeight`, `timeout()` refunds both sides. That is the safe recovery path, not a win for a silent agent.

Responsibilities, in the verifier module only (an API route or a module that the agent runner cannot import):

1. After accept confirms, load the spec and wait for a committed answer or the answer deadline.
2. If an answer is committed, fetch any referenced chain data, compute the expected answer, compare, and produce `PASS` or `FAIL`, plus an evidence blob (spec, raw tx hex, checker trace, model ID, raw response hash, timestamps as block height plus wall clock labeled WAT).
3. If no answer is committed by the answer deadline, produce `NORESPONSE` and evidence that the commitment slot was empty.
4. Build the 156-byte attestation message. Sign with the verifier private key as a CashScript `datasig` (64-byte Schnorr / the algorithm CashScript `checkDataSig` expects - **verify** against a mocknet settle test; Libauth has the signing helpers, do not invent a new scheme).
5. Build the `settle` transaction with CashScript, fund BCH fees from a small server fee wallet, broadcast, store the txid.
6. If the height reaches `expiryHeight` with no settle, build and broadcast `timeout()`.

Rules:

- The verifier key never leaves the server, never goes to the client bundle, and never appears in the repo or in screenshots.
- Evidence for every settled challenge is public: message hex, signature hex, verifier pubkey, raw inputs to the checker (except that the agent runner still must not be able to read expected answers before commit), and the payout txid.
- If the fetch or the checker throws on a `PASS`/`FAIL` path, do not sign a verdict. Retry, or if time runs out, sign nothing and let `timeout()` refund both. Do not convert a checker crash into `NORESPONSE`.
- Do not let a second model "judge" the answer.

## 7. Pages

A dark, fast, obvious UI. A judge should understand the product in one screen and complete a flow without a write-up.

Top-of-page banner on the **home page** (required for the mainnet track), with:

- Link to the Widget Factory deck
- Link to the public GitHub repo
- A CashTokens address for EMBER2026 votes

The banner can also appear on other pages, but it must be on `/`.

| Route | Purpose |
| --- | --- |
| `/` | Pitch line, two-sentence explanation, verifier trust disclosure, live counts, a short "how a challenge works" strip, featured agent, connect-wallet, and the required banner. |
| `/arena` | Open offers and live / recent challenges. Connect, accept an offer (pick a template, fill params, set fee already fixed by the offer, see expiry height and the agent's max deadline), or jump into a challenge. Poll for updates. Fixture rows are badged. |
| `/challenge/[id]` | The important page. Status, spec, agent, amounts, answer deadline, expiry height, accept / settle / timeout txids, the answer, `source` (`ai` or `fixture`), model ID when `source` is `ai`, the signed verdict, the evidence (reproducible), and payout. Links to a block explorer. Show pass, fail, and no-response with equal clarity. |
| `/agent/[id]` | Agent profile: public track record (pass / fail / no-response / timeout counts), bond policy including `maxDeadlineDelta`, open offers, WizardConnect tip-in-BCH button, optional "fund challenge budget" BCH send. |

No leaderboard in v1. If there is spare time after the demo is recorded, a simple `/arena` sort by recent results is enough.

Also ship unlinked or minimally styled utility routes if useful: a `/connect` test page for the wallet spike, later folded into the header.

Copy tone: short sentences, no jargon without a one-line gloss, amounts shown as `1.00 PUSD` with the integer units visible in a details line.

---

## 8. Day-by-day plan (14-22 November 2026, WAT)

Submission window for the hackathon runs through **22 November 2026, 15:00 WAT**. Treat that as a hard stop. Work in WAT.

**Milestone 1, due 16 November 2026 (WAT): wallet spike plus contracts that pass tests on mocknet and chipnet.** Do not start the product UI, the live verifier, or mainnet work until this is honestly green, including a written spike report. Contract tests for deadline bounds, no-response, output tables, exact-input, and change all belong in this milestone.

### 14 November - scaffold and spike start

- Create the repo, `.gitignore` (`.env*`, keys, `.db`), README, license.
- Scaffold Next.js (App Router, TS, Tailwind) and a `contracts/` plus `tests/` tree.
- Install `cashscript@^0.14.0`, `@bitauth/libauth`, `@wizardconnect/react`.
- Write first drafts of `SellacalidaOffer.cash` and `SellacalidaEscrow.cash`.
- Start the redeem-script encoder test and the 156-byte attestation offset test (the gates described in 3.1 and 4).
- Start the WizardConnect spike page: connect Paytaca or Selene, show address and token balance.
- Register / roll call if that is not already done.

### 15 November - mocknet contracts and chipnet token

- Finish encoder, endianness, and attestation offset tests.
- Full mocknet suites, including the list in section 9.
- Get chipnet tBCH from the faucet. Mint a fungible test token. Record the category id in `.env.local`.
- Deploy offer + escrow to chipnet with tiny amounts.

### 16 November - milestone 1 gate

- Complete the wallet spike (section 11 checklist) on chipnet with the test token and a P2SH32 contract.
- If Paytaca / Selene cannot send the test token into P2SH32, try the other wallet, then an XO template, then the BCH-only bond fallback. Write the decision in `SPIKE.md`.
- Chipnet: cancel, accept (exact and, if a wallet UTXO is not exact, change), settle pass, settle fail, and a `NORESPONSE` settle if the grace window is practical. Timeout on chipnet if you can use a short window; otherwise prove timeout thoroughly on mocknet and say so.
- Stop and report: tests, txids, spike results, chosen funding path.

### 17 November - verifier, templates, isolated agent runner

- Implement the four templates and checkers with unit tests, including odd cases (zero matches, token-aware addresses, div by zero rejected).
- Fulcrum / Electrum transaction fetch + Libauth decode.
- Attestation builder + signing, verified against a mocknet `settle` for `PASS`, `FAIL`, and `NORESPONSE`.
- Isolated agent runner module that calls a real LLM and cannot import checkers. Commitment-before-check sequence. Fixture source tagging.
- API: create offer record, accept, commit answer, run verifier, expose evidence.

### 18 November - accept flow in the app

- `/` banner shell, `/arena`, accept UI with template params.
- WizardConnect accept transaction (contract input fully unlocked by CashScript, user fee input via `placeholderP2PKHUnlocker` + `inputPaths`).
- Agent answer path (even if the "AI" is still a stub or a scripted fixture).

### 19 November - settlement, timeout, BCH tip

- Server-funded `settle` (`PASS` / `FAIL` / `NORESPONSE`) and `timeout` broadcasts.
- `/challenge/[id]` evidence view, including model ID, raw response hash, and fixture badges.
- Native BCH tip (and optional budget fund) on `/agent/[id]`.
- Pass, fail, and no-response tested on chipnet from the UI.

### 20 November - polish

- `/` and `/agent/[id]` track record, empty states, error messages, mobile layout.
- Trust-boundary copy. Amounts and tx links.
- Scripted demo fixtures only as backup, still labeled fixture. Prefer a real model attempt in the recorded demo.

### 21 November - deck, demo, mainnet dry run

- Widget Factory deck from the official template.
- Record the 90-second demo (section 10).
- Security checklist (section 9) executed and checked off.
- Mainnet dry run with **tiny** PUSD amounts (cents, not dollars) only if chipnet is fully green. Keep the agent hot wallet tiny.

### 22 November - submit, before 15:00 WAT

- Live site, public repo, banner links, mainnet tx of a useful feature, WizardConnect or XO integration, Widget Factory deck.
- A pass and a fail visible on the live site (real AI, or clearly labeled if a fixture had to be used), plus a BCH tip.
- Buffer in the morning for bugs. Submit early if you can.

Economics for the live demo: small bonds, framed as the agent paying to earn a public track record. Example: bond `100` base units (1.00 PUSD) and fee `20` (0.20 PUSD), or smaller if liquidity is tight. Never large public stakes.

---

## 9. Security test checklist

Run this before recording the demo and before mainnet. Every item is a written test or a manual chipnet txid, not a wish.

**Encoding and categories**

- [ ] PUSD / test-token category matches the intended network.
- [ ] Contract category is the unreversed VM bytes; SDK / wallet hex is explorer order. Both directions tested.
- [ ] Fungible-only outputs: `tokenCategory` is 32 bytes, never 33.
- [ ] Redeem script / escrow address computed in the offer matches `new Contract(escrowArtifact, args)`.
- [ ] Attestation prefix is 22 bytes, message is 156 bytes, and every offset matches section 4.
- [ ] Contract `.split` parse rejects a wrong prefix, a wrong length, and a shifted field.
- [ ] Outpoint txid endianness matches introspection.
- [ ] `answerHash` and `specHash` use the documented canonical bytes.
- [ ] `NORESPONSE` requires a 32-zero `answerHash`; a nonzero hash with verdict `0x03` fails.

**Offer**

- [ ] Only the agent can `cancel`. A random sig fails (NULLFAIL / checkSig).
- [ ] Cancel returns the full bond with `tx.outputs.length == 1` and does not leave a token on another output.
- [ ] Cancel fails if `tx.outputs.length != 1`, if output 0 is not the agent's P2PKH, or if output 0 value is under `MIN_OUTPUT_SATS`.
- [ ] `accept` without a sufficient fee on input 1 fails.
- [ ] `accept` to a wrong locking bytecode fails (wrong pkh, wrong expiry, wrong specHash, wrong body, wrong `verifierGraceBlocks`).
- [ ] `accept` with `expiryHeight` above `nLocktime + maxDeadlineDelta` fails, including a far-future expiry with a current locktime.
- [ ] `accept` with `expiryHeight >= MAX_HEIGHT` fails.
- [ ] `accept` with an NFT-capable category suffix on the escrow or change output fails.
- [ ] Exact-input path: `changeAmount == 0`, output 1 has no tokens and is the challenger's P2PKH.
- [ ] Change path: output 1 is the challenger's P2PKH, same category, `tokenAmount == input1 - fee`.
- [ ] Change path fails if output 1 is a third party's locking bytecode, or if the change amount is wrong.
- [ ] `accept` fails if `tx.outputs.length != 2`, if a third token input is added, or if input 1 is not the challenger's P2PKH.

**Escrow**

- [ ] `settle` PASS pays only the agent the full `bond + fee`.
- [ ] `settle` FAIL pays only the challenger the full `bond + fee`.
- [ ] `settle` NORESPONSE pays only the challenger the full `bond + fee`, and fails before the answer deadline.
- [ ] A verdict signed for challenge A / outpoint A cannot settle escrow B.
- [ ] Wrong `networkId`, wrong `specHash`, wrong prefix, or wrong `answerHash` fails `checkDataSig` / the parse.
- [ ] A `verdict` other than `0x01` / `0x02` / `0x03` fails.
- [ ] `settle` fails if an unexpected token output is present, or if `tx.outputs.length` is outside {1, 2}.
- [ ] `timeout` before `expiryHeight` fails, even if the builder sets a high locktime (CLTV must bite).
- [ ] `timeout` at or after `expiryHeight` refunds bond to agent and fee to challenger, with the output table in section 3.2.
- [ ] `timeout` fails if those outputs are reordered, if amounts are swapped, or if an extra token output is added.
- [ ] After `settle`, the UTXO is gone so `timeout` cannot also be applied.

**Wallet, keys, and evaluation**

- [ ] No private keys, WIFs, or mnemonic in the repo, client bundle, or commit history.
- [ ] Verifier key, fee-wallet key, and LLM API key only in `.env.local`.
- [ ] Agent demo wallet is a throwaway with a tiny cap.
- [ ] Integer math only; no `Number` for token amounts.
- [ ] Agent runner cannot import the checker or read an expected answer before commit. A test or a lint/boundary check should fail a forbidden import if you can arrange one; otherwise a documented module split plus a code review note in the report.
- [ ] Verifier will not run the checker until `answerHash` is committed.
- [ ] Fixture attempts are tagged `fixture` in the store and the UI.

**App-level**

- [ ] Invalid template params are rejected at accept, not at settle.
- [ ] Chipnet and mainnet configs cannot be mixed (category, networkId, Electrum server, addresses).
- [ ] Dust and fee sufficiency: transactions still relay.
- [ ] A failed checker does not produce a signature.

---

## 10. 90-second demo script

Target 90 seconds, hard cap 120. Record in a clean desktop browser. Have both wallets (agent and challenger) already funded with tiny chipnet or mainnet amounts so you do not wait on confirmations mid-take. If a confirmation is required, cut in a second clip after it lands.

Prefer a live `source: "ai"` attempt. If you must fall back to a rehearsed fixture, the UI badge must say fixture, and you should say so in the narration.

1. **0:00-0:10** - Home page. Read the pitch line. Point at the banner (deck, repo, EMBER2026 address) and the one-line verifier disclosure.
2. **0:10-0:20** - Open an agent's track record. Show an existing pass or two if you have them.
3. **0:20-0:35** - Arena: the open bonded offer (amount and max deadline visible). Connect WizardConnect (Paytaca or Selene). Choose `bch.output_token_count` (or `bch.nft_output_index`), paste a real txid and category meant to stump the agent.
4. **0:35-0:50** - Accept. Show the wallet prompt and the confirmed accept transaction: bond and fee now sit in the escrow on mainnet or chipnet (say which). If the wallet used token change, leave that in the take; it is a feature.
5. **0:50-1:05** - The agent answers live from the model. Prefer a **wrong** answer here. The verifier runs the published test only after the answer is committed, shows the trace, signs fail.
6. **1:05-1:20** - Payout tx lands. Challenger receives `bond + fee`. Open the evidence view: model ID, raw response hash, message, signature, raw tx, reproducible count. Cut or smash-cut a second, already-recorded **pass** where the agent is correct and the bond returns with the fee.

The memorable beat is the AI being confidently wrong, the test proving it, and the money moving.

---

## 11. WizardConnect, wallets, and the day-1 spike

Documented wallets that support WizardConnect today: **Paytaca** and **Selene** (Android, iPhone, and browser). That list comes from [Riften Labs wallet docs](https://docs.riftenlabs.com/cauldron/wallets/). Neither wallet is affiliated with this project.

React integration ([docs](https://docs.riftenlabs.com/wizardconnect/react/)):

```ts
import { useWizardConnect, WizardConnectQRDialog } from '@wizardconnect/react';

const wc = useWizardConnect({ dappName: 'Sellacalida' });
// wc.connect(), wc.disconnect()
// wc.state: "idle" | "connecting" | "connected" | "disconnected"
// wc.uri, wc.qrUri, wc.walletName, wc.manager
```

Show `WizardConnectQRDialog` only when `wc.uri && wc.qrUri` are set, so auto-reconnect does not open an empty QR modal. Session persistence uses localStorage under `wizardconnect-session` by default.

Once `state === "connected"`, use `wc.manager` (`DappConnectionManager` from `@wizardconnect/dapp`):

- Derive a receive pubkey with `wc.manager.getPubkey(0, 0n)` (child index `0` is receive, `1` is change, `7` is defi). Convert the pubkey to a cashaddr with Libauth. **Verify** the exact address-encoding helper you use, including token-aware encoding when holding CashTokens.
- Sign with the documented `signTransaction` shape. CashScript does not add a separate WizardConnect helper. You build a WalletConnect transaction object, then attach `inputPaths`.

```ts
const transaction = transactionBuilder.generateWcTransactionObject({
  broadcast: false, // or true; pick one and stay consistent. Verify wallet behavior.
  userPrompt: 'Accept Sellacalida challenge',
});

const inputPaths: [number, string, number][] = [
  [1, 'receive', addressIndex], // only inputs the wallet must sign
];

const response = await wc.manager.signTransaction({
  transaction,
  inputPaths,
});
```

The official WizardConnect dapp docs also show a slightly different inner `transaction` shape (`{ transaction: txHex, sourceOutputs, broadcast }`). **Verify against the installed `@wizardconnect/dapp` and `cashscript` versions** and follow whatever those packages actually type. Prefer `generateWcTransactionObject()` plus `inputPaths` as described in the [CashScript WalletConnect & WizardConnect guide](https://cashscript.org/docs/guides/walletconnect).

Rules from that guide:

- User P2PKH (or token-carrying P2PKH) inputs: `placeholderP2PKHUnlocker(userAddress)`.
- Contract inputs with complete unlocking bytecode (the offer `accept` path, server-built `settle` / `timeout`): **leave them out of `inputPaths`**.
- Contract inputs that need the wallet to fill a sig or pubkey: `placeholderSignature()` and `placeholderPublicKey()`, and include that input in `inputPaths`.
- Placeholder filling inside a contract input is wallet-dependent. It is implemented in Paytaca. **Confirm Selene during the spike.** If Selene cannot fill placeholders, still use it for simple sends (tips, funding the offer from a P2PKH), and use Paytaca for contract-placeholder flows, or have the agent cancel path use a server-side flow that does not need placeholders.
- WizardConnect signs transactions only. It does not sign arbitrary messages. That is fine: the verifier key is server-side, and user authorization is the transaction itself.
- `inputPaths` entries are `[inputIndex, pathName, addressIndex]` and must match the final input order.

### Wallet spike checklist (milestone 1)

Write results in `SPIKE.md` with wallet name, version if visible, network, and txids.

1. Connect Paytaca on chipnet (or mainnet wallet that can switch - prefer a dedicated chipnet wallet). Repeat with Selene if time.
2. Read address and test-token balance.
3. Send a small test-token amount, plus dust BCH, to a P2SH32 contract address (`contract.tokenAddress`). Confirm in an explorer.
4. Spend that contract back out: contract input fully unlocked by CashScript; if a user fee input is needed, the wallet signs only that input. Confirm.
5. If you need a contract-path signature (cancel with `checkSig`), test placeholders.
6. Test an accept-like spend where the user's token UTXO is larger than the fee, so output 1 must carry PUSD change back to that same wallet. This is the reason exact-only inputs are not enough.
7. Record failures precisely (rejected token-to-P2SH32, cannot sign multiple inputs, cannot sign token change, broadcast flag issues, path index issues).

Fallbacks, in order: the other WizardConnect wallet, an official XO template for the token transfer, then BCH-only bonds in the same app. The spike exists because this risk is higher than typo-level contract risk.

---

## 12. Widget Factory deck outline

Use the official BLAZE Widget Factory template: [Widget Factory Template](https://docs.google.com/presentation/d/1Yfuk9CJkf4U9M_WukcELhumWgj3Ak6345Ewy8hSp-Hk/edit?usp=sharing). Fit the content to that template. Do not invent a parallel deck structure if the template already fixes slide count or titles. If a slide is unused, leave it sparse rather than adding decoration.

Suggested content, mapped onto the template:

1. **Title** - Sellacalida. Pitch line. Your name / GitHub `0xileri`. Network: Bitcoin Cash.
2. **Problem** - Agents claim competence. Users cannot verify it, and there is no cost for being wrong.
3. **Product** - Bonded offer, one-tx accept, deterministic test, contract-enforced payout. One screenshot of `/challenge/[id]`.
4. **Demo** - Link the 90-second video. One still of the fail-and-payout moment.
5. **Why Bitcoin Cash** - CashScript escrow, CashTokens (PUSD), `checkDataSig` attestation, WizardConnect. A simple diagram: offer UTXO to escrow UTXO to payout.
6. **Trust boundary** - One sentence: the contract enforces money, the verifier signs a reproducible test (or no-response), the evidence is public, and a verifier outage refunds both sides.
7. **Business** - Verification infrastructure, evaluation fees, later enterprise testing. Small bonds as a public track record, not a casino.
8. **Links** - Live site, repo, Widget Factory (self), EMBER2026 vote address, two mainnet txids (accept or settle, and a BCH tip).

Keep typography and colors inside the template. No walls of text. Judges will not read a white paper on a slide.

---

## 13. Submission checklist

Mainnet track, due 22 November 2026, 15:00 WAT:

- [ ] Live, clickable website, no local setup required for a judge.
- [ ] At least one useful BCH mainnet transaction feature anyone can use (the BCH tip counts; a real PUSD accept / settle is better and should also be visible).
- [ ] WizardConnect integration (Paytaca or Selene), or XO Templates if that was the documented fallback.
- [ ] Public GitHub repo with source and a README that explains the trust boundary, how to run tests, and how to reproduce a checker result from evidence.
- [ ] Home-page banner: Widget Factory deck, repo, CashTokens address for EMBER2026 votes.
- [ ] Widget Factory presentation, using the official template.
- [ ] Attendance / Telegram / roll-call requirements the organizers posted (confirm on the DoraHacks page and in Telegram; do not assume this doc is complete on process).
- [ ] Both a pass and a fail path visible, with explorer links. Prefer `source: "ai"`. If a fixture is shown, it is labeled.
- [ ] `NORESPONSE` and `timeout` paths documented and tested (chipnet is enough if a mainnet wait would take too long, but the code paths must be live).
- [ ] Verifier disclosure visible without opening a markdown file.
- [ ] No keys in the repo.

Judging categories: innovation, design / usability, technical use of BCH, business / investment potential. The pitch should hit all four in the first minute of the video and the first two slides.

---

## 14. Cut list

Do not build these in the 9-day window:

- Supabase, Realtime, or any hosted database beyond SQLite / a JSON file
- A separate worker or queue process, other than an optional isolated agent-runner process
- A jointly signed funding transaction
- A leaderboard page
- Unrestricted custom agents or "bring your own model" marketplace UX
- Subjective human referees
- User-uploaded code execution
- Internet-research or price-prediction challenges
- Transferable achievement NFTs (a public receipt plus the settle txid is enough)
- Multichain support
- Elaborate tokenomics, points, or referral systems
- Large public-money stakes
- Unconstrained token change (change is allowed only as specified on output 1)
- A second "platform fee" output (keep v1 economics simple; you can say a fee comes later)
- WalletConnect-only flows, unless WizardConnect fails and you document the switch
- Mainnet before chipnet is green

Stretch only after the demo is recorded: a "survived" CashToken NFT, `logic.constraints`, nicer agent analytics, a short Media-track video cut from the same demo.

---

## 15. Recommended repo layout

```text
contracts/SellacalidaOffer.cash
contracts/SellacalidaEscrow.cash
lib/encodeRedeemScript.ts      // must match CashScript 0.14, locked by tests
lib/attestation.ts             // prefix, offsets, 156-byte serializer
lib/tokenCategory.ts           // endianness helpers
lib/templates/check/           // specs + checkers; agent runner must not import this
lib/agent/                     // LLM runner only; no checker imports
lib/bch/                       // electrum fetch, libauth decode, tx builders
app/                           // Next.js routes
app/api/
tests/                         // mocknet contract tests, template tests, attestation tests
SPIKE.md                       // wallet spike report
README.md
```

Environment (names are suggestions, all gitignored):

```text
NETWORK=chipnet
TOKEN_CATEGORY=<explorer-order hex>
VERIFIER_PRIVATE_KEY=<never commit>
FEE_WALLET_WIF=<never commit, tiny balance>
LLM_API_KEY=<never commit>
LLM_MODEL_ID=<recorded on each ai attempt>
ELECTRUM_HOSTNAME=<optional override>
```

---

## 16. Open verify items

These are not unknowns in the product design. They are implementation details to pin with a test or a docs check against the installed package versions before you depend on them:

- Exact CashScript 0.14 redeem-script encoding of constructor arguments.
- Exact Contract property names: redeem script, `address` vs `tokenAddress`.
- SDK `TokenDetails.category` byte order (treated as explorer order until proven).
- Introspection byte order of `outpointTransactionHash`.
- The precise Libauth function used to create a `datasig` that `checkDataSig` accepts, and to encode cashaddrs (including token-aware).
- 4-byte little-endian encoding of the outpoint index inside CashScript, matching TypeScript.
- Whether `ElectrumNetworkProvider` exposes transaction fetch, or you use `@electrum-cash/network` / Fulcrum `blockchain.transaction.get` directly. Protocol 1.5.0 is what CashScript 0.14's provider negotiates.
- `signTransaction` payload shape for the installed `@wizardconnect/dapp` versus `generateWcTransactionObject()`.
- Selene's support for placeholder sig / pubkey filling inside contract inputs, and for token change outputs.
- Dust amount: this spec starts at `MIN_OUTPUT_SATS = 1000`. Verify for token-bearing P2PKH and P2SH32 outputs and raise if needed.
- Current chipnet Electrum hostname and faucet availability on the day you start.
