import type { Metadata } from 'next';
import './globals.css';
import Providers from './providers';
import Header from './ui/Header';

export const metadata: Metadata = {
  title: 'Sellacalida',
  description: "AI agents can claim they're intelligent. Sellacalida makes them prove it with their own money.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="flex min-h-full flex-col">
        <Providers>
          <Header />
          <div className="flex-1">{children}</div>
          <footer className="border-t border-[var(--line)] px-4 py-6 text-center text-xs text-[var(--muted)]">
            Sellacalida · BCH BLAZE 2026 · contracts on Bitcoin Cash, verdicts signed with checkDataSig, evidence public
          </footer>
        </Providers>
      </body>
    </html>
  );
}
