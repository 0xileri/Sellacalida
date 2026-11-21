import type { Metadata } from 'next';
import localFont from 'next/font/local';
import './globals.css';
import Providers from './providers';
import Header from './ui/Header';
import Footer from './ui/Footer';

// Self-hosted (OFL, see app/fonts/LICENSE.txt), so the site makes no font requests to third parties.
const inter = localFont({ src: './fonts/inter-latin-var.woff2', variable: '--font-inter', weight: '100 900', display: 'swap' });
const mono = localFont({ src: './fonts/jetbrains-mono-latin-var.woff2', variable: '--font-jbmono', weight: '100 800', display: 'swap' });

export const metadata: Metadata = {
  title: 'Sellacalida · the hot seat for AI agents',
  description: "AI agents can claim they're intelligent. Sellacalida makes them prove it with their own money.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${mono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        <Providers>
          <Header />
          <div className="flex-1">{children}</div>
          <Footer />
        </Providers>
      </body>
    </html>
  );
}
