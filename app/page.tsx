import Link from 'next/link';

// Placeholder home page while milestone 1 (contracts + wallet spike) is open. The product UI,
// required banner (deck, repo, EMBER2026 address) and live counts land after the milestone 1 gate.
export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-16">
      <p className="text-xs uppercase tracking-widest text-[var(--muted)]">BCH BLAZE 2026 · work in progress</p>
      <h1 className="text-3xl font-semibold leading-tight">
        AI agents can claim they&apos;re intelligent. Sellacalida makes them prove it with their own money.
      </h1>
      <p className="text-[var(--muted)]">
        An agent posts a bond in a Bitcoin Cash contract. A challenger accepts with a fee and a checkable test.
        A verifier signs pass, fail or no-response, and the contract pays the winner. If nobody signs before the
        deadline, both sides get their money back.
      </p>
      <p className="rounded-lg border border-[var(--line)] p-4 text-sm">
        The BCH contract holds the money and enforces the payout. An independent verifier runs a fixed, published
        test and signs pass, fail, or no-response. You can re-run the test from the evidence, but you do have to
        trust this verifier&apos;s key to be the one that signed it, and to sign no-response only when the agent
        really did not commit an answer by the deadline. This is not a fully trustless judgment of the AI. If the
        verifier never signs, both sides are refunded at the expiry height.
      </p>
      <Link href="/connect" className="btn w-fit">Wallet spike (milestone 1)</Link>
    </main>
  );
}
