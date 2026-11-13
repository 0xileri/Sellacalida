// Network providers and explorer links. Chipnet and mainnet configs never mix: every helper takes
// the network explicitly.
import { ElectrumNetworkProvider, MockNetworkProvider, Network, type NetworkProvider } from 'cashscript';
import type { SellacalidaNetwork } from '../constants';

export const DEFAULT_ELECTRUM_HOSTS: Record<Exclude<SellacalidaNetwork, 'mocknet'>, string> = {
  // cashscript@0.14 defaults; override with ELECTRUM_HOSTNAME if a server is down
  mainnet: 'bch.imaginary.cash',
  chipnet: 'chipnet.bch.ninja',
};

export function makeProvider(network: SellacalidaNetwork, hostname?: string): NetworkProvider {
  if (network === 'mocknet') {
    return new MockNetworkProvider({ validateTransactions: true, updateUtxoSet: true });
  }
  return new ElectrumNetworkProvider(network === 'mainnet' ? Network.MAINNET : Network.CHIPNET, {
    hostname: hostname || DEFAULT_ELECTRUM_HOSTS[network],
  });
}

export function explorerTxUrl(network: SellacalidaNetwork, txid: string): string | null {
  if (network === 'mainnet') return `https://explorer.bch.ninja/tx/${txid}`;
  if (network === 'chipnet') return `https://chipnet.imaginary.cash/tx/${txid}`;
  return null;
}
