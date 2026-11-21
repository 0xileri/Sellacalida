// The Sellacalida mark: a chair with a flame on the seat ("sella calida", the hot seat).
// Same drawing as public/brand/mark-transparent.svg, inline so it needs no request.
export function LogoMark({ size = 22, className = '' }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 512 512" aria-hidden="true" className={className}>
      <defs>
        <linearGradient id="sc-flame" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffc24a" />
          <stop offset="1" stopColor="#f0532d" />
        </linearGradient>
      </defs>
      <path d="M256 104 C306 160 340 200 330 248 C322 284 294 300 256 300 C218 300 190 284 182 248 C174 212 198 182 218 158 C222 190 236 204 250 198 C244 168 244 134 256 104 Z" fill="url(#sc-flame)" />
      <path d="M260 196 C286 222 296 244 290 264 C285 282 272 292 256 292 C240 292 227 282 223 266 C219 247 232 231 242 218 C246 236 256 241 263 234 C265 220 264 207 260 196 Z" fill="#ffe3a0" />
      <path d="M136 92 V320 H376 M160 320 V420 M352 320 V420" fill="none" stroke="currentColor" strokeWidth="36" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
