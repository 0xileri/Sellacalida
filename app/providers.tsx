'use client';

// App-wide client state: the public config from /api/config and one WizardConnect session shared
// by every page (header button, arena accept, agent tips).
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useWizardConnect, WizardConnectQRDialog } from '@wizardconnect/react';
import type { UseWizardConnectResult } from '@wizardconnect/react';
import type { PublicConfig } from '@/lib/wire';

const ConfigContext = createContext<PublicConfig | null>(null);
const WalletContext = createContext<{ wc: UseWizardConnectResult; address: string | null } | null>(null);

export function useConfig() {
  return useContext(ConfigContext);
}

export function useWallet() {
  const w = useContext(WalletContext);
  if (!w) throw new Error('useWallet outside Providers');
  return w;
}

export default function Providers({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const wc = useWizardConnect({ dappName: 'Sellacalida' });
  const [address, setAddress] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch('/api/config')
      .then((r) => (r.ok ? r.json() : null))
      .then((c) => alive && c && setConfig(c))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  // derive the wallet's first receive address once it has shared its xpubs
  useEffect(() => {
    if (wc.state !== 'connected' || !wc.manager || !config) return;
    let alive = true;
    void import('@/lib/wallet/acceptFlow')
      .then(({ walletReceiveAddress }) => walletReceiveAddress(wc.manager!, config.network))
      .then((a) => alive && setAddress(a.tokenAddress))
      .catch(() => alive && setAddress(null));
    return () => {
      alive = false;
    };
  }, [wc.state, wc.manager, config]);

  const wallet = useMemo(() => ({ wc, address: wc.state === 'connected' ? address : null }), [wc, address]);

  return (
    <ConfigContext.Provider value={config}>
      <WalletContext.Provider value={wallet}>
        {children}
        {wc.uri && wc.qrUri && (
          <WizardConnectQRDialog
            show={!wc.walletName && (wc.state === 'connecting' || wc.state === 'reconnecting')}
            onClose={() => void wc.disconnect()}
            uri={wc.uri}
            qrUri={wc.qrUri}
            subtitle="Scan with Paytaca or Selene to connect"
          />
        )}
      </WalletContext.Provider>
    </ConfigContext.Provider>
  );
}
