# Widget Factory deck: slide text

Paste into the official BLAZE Widget Factory template:
https://docs.google.com/presentation/d/1Yfuk9CJkf4U9M_WukcELhumWgj3Ak6345Ewy8hSp-Hk/edit?usp=sharing
(File > Make a copy, then share the copy as "Anyone with the link can view".)

Fit this to the template. If it has fewer slides, merge 5 and 6. Keep the template's fonts and colors. Short lines, no paragraphs on slides. "Say" lines are for the video or a live pitch, not for the slide.

---

## 1. Title

**On the slide**

- Sellacalida
- AI agents can claim they're intelligent. Sellacalida makes them prove it with their own money.
- Live on Bitcoin Cash mainnet · real PUSD bonds · contract-enforced payouts
- ileri · github.com/0xileri

**Say:** An AI agent puts its own money on every answer. Anyone can challenge it with a test that has one checkable answer. A Bitcoin Cash contract pays whoever is right.

---

## 2. Problem

**On the slide**

- Agents claim competence. Nobody can check it.
- Benchmarks are self-reported. Being wrong costs nothing.
- So "trust me, I'm smart" is the whole sales pitch.

**Say:** Today an agent's track record is whatever its maker says it is. There is no price on a wrong answer, so there is no signal.

---

## 3. Product

**On the slide**

1. The agent bonds PUSD in an offer contract
2. A challenger accepts in one transaction: adds a fee and a test
3. The agent answers; a verifier runs the published test and signs the verdict
4. The escrow pays the winner. No verdict by the deadline: both sides refunded

Four tests, all checkable with no human judge: exact integer arithmetic, count token outputs, sats sent to an address, find the NFT output.

**Image:** the challenge page of a settled challenge (`shots/deck-challenge.png`).

**Say:** The agent commits its answer before the verifier looks at anything, and every verdict comes with evidence anyone can re-run with one command.

---

## 4. Demo

**On the slide**

- 90-second video: <link>
- Live: sellacalida.up.railway.app
- Try it without a wallet: web-production-20dba597.up.railway.app

**Image:** a still from the video at the payout moment (or the arena screenshot, `shots/deck-arena.png`).

**Say:** Everything in the video is mainnet, signed in Paytaca over WizardConnect.

---

## 5. Why Bitcoin Cash

**On the slide**

- CashScript covenants: the offer can only become a correctly built escrow; the escrow can only pay the agent, the challenger, or refund both
- CashTokens: bonds and fees in PUSD
- checkDataSig: the verifier's signed verdict is checked inside the contract
- Block-height deadlines: a silent verifier can't freeze funds
- WizardConnect: Paytaca signs only its own inputs; the contract unlocks itself

**Image:** the flow diagram (`shots/deck-flow.png`): offer UTXO → accept → escrow UTXO → settle (signed verdict) → winner, or timeout → refunds.

**Say:** All of the money logic is on chain. The server can't redirect a payout; the most a bad verifier can do is sign a wrong verdict, in public.

---

## 6. Trust boundary

**On the slide**

The contract enforces the money. The verifier signs a reproducible test, or no-response. The evidence is public. A verifier outage refunds both sides.

**Say:** This is not trustless AI judging, and it doesn't pretend to be. It is a narrow, inspectable trust: one key, signing results anyone can reproduce.

---

## 7. Business

**On the slide**

- Verification infrastructure for AI agents
- Now: evaluation fees. Challengers pay to test; agents earn by being right
- Next: enterprise testing. Teams bond their agents against a test suite before shipping; buyers read the public record
- Small bonds as a public track record, not a casino

**Say:** The bond is a credibility signal you can't fake. The product is the record it builds.

---

## 8. Links

**On the slide**

- Live (mainnet): https://sellacalida.up.railway.app
- Play money: https://web-production-20dba597.up.railway.app
- Repo: https://github.com/0xileri/Sellacalida
- Widget Factory deck: <this deck's link>
- EMBER2026 votes: <your CashTokens address>
- Mainnet accept: https://explorer.bch.ninja/tx/e246074142c8a0410c9ebdae596a8a49d053dc825eda6b83245e816b0d3a71b6
- Mainnet settle (PASS): https://explorer.bch.ninja/tx/ddfa5384d090cd2bb0ba904e730fbe47681152346ac9a812dbb3b0ef54633c6d
- BCH tip: <txid after you tip the agent>

---

## Numbers you can quote (as of 21 Nov)

- Live mainnet challenges answered by Claude Sonnet 5.5 through the site: 2 PASS so far, including a 48-digit product reduced modulo a prime. A third (an exact 89-digit product) is being decided.
- Every contract path ran on mainnet with real PUSD on 17 and 19 Nov: cancel, PASS, FAIL, no-response, timeout refund. 17 transactions, all funds returned. Mainnet FAIL settle: https://explorer.bch.ninja/tx/d0a9dd0d9e0be40d42a2f9c9494b4c301e722d5ca9b6876d9e053c67cce7587a
- Paytaca over WizardConnect passed every wallet check on mainnet, including signing inside a covenant.
- 437 automated tests; all 43 items of the security checklist proven by tests.
