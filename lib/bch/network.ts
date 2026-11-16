// Network providers and explorer links. Chipnet and mainnet configs never mix: every helper takes
// the network explicitly.
import { ElectrumNetworkProvider, MockNetworkProvider, Network, type NetworkProvider } from 'cashscript';
import { MAINNET_MIN_HEIGHT, type SellacalidaNetwork } from '../constants';

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

/**
 * Refuse an Electrum server on the wrong network (for example ELECTRUM_HOSTNAME pointing a chipnet
 * config at a mainnet server). Mocknet is skipped. Returns the height it saw.
 */
export async function assertChainMatchesNetwork(provider: NetworkProvider, network: SellacalidaNetwork): Promise<number | null> {
  if (network === 'mocknet') return null;
  const h = await provider.getBlockHeight();
  const looksMainnet = h >= MAINNET_MIN_HEIGHT;
  if (looksMainnet !== (network === 'mainnet')) {
    throw new Error(
      `the Electrum server reports height ${h}, which is ${looksMainnet ? 'mainnet' : 'not mainnet'}, ` +
        `but NETWORK is ${network}: check ELECTRUM_HOSTNAME`,
    );
  }
  return h;
}

export function explorerTxUrl(network: SellacalidaNetwork, txid: string): string | null {
  if (network === 'mainnet') return `https://explorer.bch.ninja/tx/${txid}`;
  if (network === 'chipnet') return `https://chipnet.imaginary.cash/tx/${txid}`;
  return null;
}
