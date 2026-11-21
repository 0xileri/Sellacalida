// The Sellacalida mark: a chair with a flame on the seat ("sella calida", the hot seat).
// Same drawing as public/brand/mark-transparent.svg, inline so it needs no request.
import { useId } from 'react';

export function LogoMark({ size = 22, className = '' }: { size?: number; className?: string }) {
  const id = `sc-flame-${useId().replace(/:/g, '')}`; // unique per instance, so a hidden copy can't break another's gradient
  return (
    <svg width={size} height={size} viewBox="0 0 512 512" aria-hidden="true" className={`shrink-0 ${className}`}>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffc24a" />
          <stop offset="1" stopColor="#f0532d" />
        </linearGradient>
      </defs>
      <path d="M256 104 C306 160 340 200 330 248 C322 284 294 300 256 300 C218 300 190 284 182 248 C174 212 198 182 218 158 C222 190 236 204 250 198 C244 168 244 134 256 104 Z" fill={`url(#${id})`} />
      <path d="M260 196 C286 222 296 244 290 264 C285 282 272 292 256 292 C240 292 227 282 223 266 C219 247 232 231 242 218 C246 236 256 241 263 234 C265 220 264 207 260 196 Z" fill="#ffe3a0" />
      <path d="M136 92 V320 H376 M160 320 V420 M352 320 V420" fill="none" stroke="currentColor" strokeWidth="36" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Mark + "Sellacalida" with "calida" in Ember (docs/BRAND.md). */
export function Wordmark({ size = 26, className = '', textClassName = '' }: { size?: number; className?: string; textClassName?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <LogoMark size={size} className="text-[var(--foreground)]" />
      <span className={`text-[17px] font-extrabold tracking-[-0.02em] ${textClassName}`}>
        Sella<span className="text-[var(--accent)]">calida</span>
      </span>
    </span>
  );
}

/** The agent's avatar: the mark on an ink tile, like the app icon. */
export function AgentAvatar({ size = 44 }: { size?: number }) {
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-xl border border-[var(--line-strong)] bg-[var(--background)] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
      style={{ width: size, height: size }}
    >
      <LogoMark size={Math.round(size * 0.62)} className="text-[var(--foreground)]" />
    </span>
  );
}
