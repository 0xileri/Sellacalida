// A few stroke icons, inline so the site needs no icon font or library.
import type { ReactNode } from 'react';

function Icon({ size = 16, className = '', children }: { size?: number; className?: string; children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={`shrink-0 ${className}`}
    >
      {children}
    </svg>
  );
}

type P = { size?: number; className?: string };

export const ArrowRight = (p: P) => <Icon {...p}><path d="M5 12h14M13 6l6 6-6 6" /></Icon>;
export const ArrowUpRight = (p: P) => <Icon {...p}><path d="M7 17 17 7M8 7h9v9" /></Icon>;
export const ArrowLeft = (p: P) => <Icon {...p}><path d="M19 12H5M11 18l-6-6 6-6" /></Icon>;
export const ChevronRight = (p: P) => <Icon {...p}><path d="m9 6 6 6-6 6" /></Icon>;
export const Copy = (p: P) => <Icon {...p}><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V6a2 2 0 0 1 2-2h8" /></Icon>;
export const Check = (p: P) => <Icon {...p}><path d="m5 12 4.5 4.5L19 7" /></Icon>;
export const Shield = (p: P) => <Icon {...p}><path d="M12 3 5 6v5c0 4.5 3 8.2 7 10 4-1.8 7-5.5 7-10V6l-7-3Z" /><path d="m9 12 2 2 4-4" /></Icon>;
export const Lock = (p: P) => <Icon {...p}><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></Icon>;
export const Wallet = (p: P) => <Icon {...p}><path d="M4 7a2 2 0 0 1 2-2h11v4" /><rect x="4" y="7" width="16" height="12" rx="2" /><path d="M16 13h.01" /></Icon>;
export const Beaker = (p: P) => <Icon {...p}><path d="M9 3h6M10 3v6L4.5 18.5A1.7 1.7 0 0 0 6 21h12a1.7 1.7 0 0 0 1.5-2.5L14 9V3" /><path d="M7 15h10" /></Icon>;
export const Coins = (p: P) => <Icon {...p}><ellipse cx="9" cy="7" rx="5" ry="2.5" /><path d="M4 7v4c0 1.4 2.2 2.5 5 2.5s5-1.1 5-2.5V7" /><path d="M10 15.5c.9 1.2 2.9 2 5 2 2.8 0 5-1.1 5-2.5v-4c0-1.3-1.9-2.3-4.5-2.5" /></Icon>;
export const Clock = (p: P) => <Icon {...p}><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></Icon>;
export const Slides = (p: P) => <Icon {...p}><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M12 16v4M8 20h8" /></Icon>;
export const Ballot = (p: P) => <Icon {...p}><path d="M4 13h16v7H4z" /><path d="M8 13V5h8v8" /><path d="m10 9 1.5 1.5L14 8" /></Icon>;
export const Github = ({ size = 16, className = '' }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={`shrink-0 ${className}`}>
    <path d="M12 2C6.5 2 2 6.6 2 12.2c0 4.5 2.9 8.3 6.8 9.7.5.1.7-.2.7-.5v-1.7c-2.8.6-3.4-1.4-3.4-1.4-.5-1.2-1.1-1.5-1.1-1.5-.9-.6.1-.6.1-.6 1 .1 1.5 1 1.5 1 .9 1.6 2.4 1.1 2.9.8.1-.7.4-1.1.6-1.4-2.2-.3-4.6-1.1-4.6-5 0-1.1.4-2 1-2.7-.1-.3-.4-1.3.1-2.7 0 0 .8-.3 2.8 1a9.4 9.4 0 0 1 5 0c1.9-1.3 2.8-1 2.8-1 .5 1.4.2 2.4.1 2.7.6.7 1 1.6 1 2.7 0 3.9-2.3 4.7-4.6 5 .4.3.7.9.7 1.9v2.8c0 .3.2.6.7.5A10.1 10.1 0 0 0 22 12.2C22 6.6 17.5 2 12 2Z" />
  </svg>
);
