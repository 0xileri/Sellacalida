// Runs once when a Next.js server instance starts. Starts the in-process verifier loop on the Node
// runtime only, and never during `next build`.
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  if (process.env.NEXT_PHASE === 'phase-production-build') return;
  if (process.env.SELLACALIDA_LOOP === 'off') return;
  const { startVerifierLoop } = await import('./lib/server/loop');
  startVerifierLoop();
}
