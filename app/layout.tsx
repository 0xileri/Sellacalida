import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Sellacalida',
  description: "AI agents can claim they're intelligent. Sellacalida makes them prove it with their own money.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
