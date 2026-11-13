import type { Metadata } from 'next';
import ArenaView from './ArenaView';

export const metadata: Metadata = { title: 'Arena | Sellacalida' };

export default function ArenaPage() {
  return <ArenaView />;
}
