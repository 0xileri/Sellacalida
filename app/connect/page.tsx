import type { Metadata } from 'next';
import ConnectSpikeLoader from './ConnectSpikeLoader';

export const metadata: Metadata = {
  title: 'Wallet spike | Sellacalida',
  robots: { index: false },
};

export default function ConnectPage() {
  return <ConnectSpikeLoader />;
}
