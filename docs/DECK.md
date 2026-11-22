# Widget Factory deck: slide text

For the official BLAZE Widget Factory template:
https://docs.google.com/presentation/d/1Yfuk9CJkf4U9M_WukcELhumWgj3Ak6345Ewy8hSp-Hk/edit?usp=sharing
(File > Make a copy, then share the copy as "Anyone with the link can view".)

The filled-in deck: https://docs.google.com/presentation/d/186g5bkbARjl3cj4nzBm9cQ-T3JOxRlBDw3KacAY50u8/edit?usp=sharing

The template's slides, in order: title, "[Project]!", "The Story of…", "Benefits of…", "BCH …", "The Vision for…". Replace the Widget Factory text on each with the blocks below and keep the template's fonts, colors and layout. Images are in `public/brand/` and the screenshots I sent. "Say" lines are for the video, not the slide.

---

## 1. Title

- Title: **Sellacalida**
- Subtitle: **Solo build: ileri (0xileri)**
- Square image (replace the Widget Factory robot): `public/brand/logo-square-cream.png`
- Link row: `sellacalida.up.railway.app` · `github.com/0xileri/Sellacalida` (drop the Telegram and X icons, or put your handles there)

**Say:** Sellacalida means "hot seat". It puts AI agents in the hot seat with their own money.

---

## 2. "Sellacalida!"

- Headline: **Sellacalida!**
- Line: **AI agents can claim they're intelligent. Sellacalida makes them prove it with their own money.**
- Link: **https://sellacalida.up.railway.app**

---

## 3. The Story of Sellacalida

> Agents claim competence, but nobody can check it, and being wrong costs nothing.
>
> So Sellacalida puts the agent in the hot seat. It bonds real PUSD on every answer. Anyone can challenge it with a test that has one checkable answer, and a Bitcoin Cash contract pays whoever is right.
>
> Live on mainnet today: 2 PASS, 1 FAIL. It lost its 0.50 PUSD on an 89-digit product.

Image: the FAIL page (`deck-fail.png`), "FAIL · challenger paid".

**Say:** The money only moves when a published test says so, and the test result is public.

---

## 4. Benefits of Sellacalida

- **Proof, not claims:** every answer is backed by the agent's own bond
- **One transaction to challenge,** from your own wallet (Paytaca over WizardConnect)
- **Checkable tests, no human judge:** exact arithmetic, token outputs, sats to an address, NFT outputs
- **Money moves by contract:** the server can't redirect a payout
- **Public evidence:** every verdict re-runs with one command
- **Verifier down?** Both sides are refunded at the deadline

---

## 5. BCH Integration (keep the template's title wording)

- **CashScript covenants:** the offer can only become a correctly built escrow; the escrow can only pay the agent, the challenger, or refund both
- **CashTokens:** bonds and fees in PUSD
- **checkDataSig:** the verifier's signed verdict is checked inside the contract
- **Block-height deadlines:** a silent verifier can't freeze funds
- **WizardConnect:** Paytaca signs only its own inputs; the covenant unlocks itself

Image (where the template has its code screenshot): the flow diagram, `deck-flow.png`.

**Say:** All of the money logic is on chain. The most a bad verifier can do is sign a wrong verdict, in public.

---

## 6. The Vision for Sellacalida

- **Verification infrastructure for AI agents**
- **Now: evaluation fees.** Challengers pay to test; agents earn by being right
- **Next: enterprise testing.** Teams bond their agents against a test suite before shipping; buyers read the public record
- **Small bonds as a public track record,** not a casino

**Say:** The bond is a credibility signal you can't fake. The product is the record it builds.

---

## 7. Proof and links (add a slide if the template has room; otherwise put these in the slide notes)

- Live (mainnet): https://sellacalida.up.railway.app
- Play money, no wallet needed: https://web-production-20dba597.up.railway.app
- Repo: https://github.com/0xileri/Sellacalida
- 90-second video: <link>
- EMBER2026 votes: bitcoincash:zqufwwepurkeq8m22jv9afxndl7s4ml6ss25yu0lj4
- Mainnet accept: https://explorer.bch.ninja/tx/e246074142c8a0410c9ebdae596a8a49d053dc825eda6b83245e816b0d3a71b6
- Mainnet settle (PASS): https://explorer.bch.ninja/tx/ddfa5384d090cd2bb0ba904e730fbe47681152346ac9a812dbb3b0ef54633c6d
- Mainnet settle (FAIL, challenger paid): https://explorer.bch.ninja/tx/7d247f9646d6e18e21c2eb1b32fb8c5fc4131e186937579a57d256836b6d08a7
- BCH tip: https://explorer.bch.ninja/tx/8b165cd3022fa8fa839641f7bce636e46fcb4bc33a0e9573cdbae61f86a728b6

---

## Numbers you can quote (as of 21 Nov)

- Live mainnet challenges through the site, answered by Claude Sonnet 5.5 with 0.50 PUSD at stake each time: 2 PASS, 1 FAIL.
  - PASS: (123456789 × −987654321) mod 993 = −717
  - PASS: a 48-digit product reduced modulo 1,000,000,007 = 514934865
  - FAIL: an exact 89-digit product of three 30-digit numbers. The model spent its whole answer budget working and committed nothing parseable; the verifier signed FAIL and the challenger took bond + fee (0.60 PUSD).
- Every contract path ran on mainnet with real PUSD on 17 and 19 Nov: cancel, PASS, FAIL, no-response, timeout refund. 17 transactions, all funds returned.
- Paytaca over WizardConnect passed every wallet check on mainnet, including signing inside a covenant.
- 448 automated tests; all 43 items of the security checklist proven by tests.
