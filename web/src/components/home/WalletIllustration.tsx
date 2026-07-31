/** 3D-style wallet graphic as shown on the home wallet card. */
export function WalletIllustration({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 120 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      {/* Soft glow dots */}
      <circle cx="92" cy="80" r="2.2" fill="#7DD3FC" opacity="0.55" />
      <circle cx="104" cy="70" r="1.6" fill="#A5F3FC" opacity="0.5" />
      <circle cx="80" cy="90" r="1.3" fill="#67E8F9" opacity="0.45" />
      <circle cx="110" cy="86" r="1.1" fill="#BAE6FD" opacity="0.4" />
      <circle cx="74" cy="76" r="1.5" fill="#7DD3FC" opacity="0.4" />
      <circle cx="98" cy="92" r="1" fill="#99F6E4" opacity="0.35" />

      {/* Soft shadow */}
      <ellipse cx="56" cy="88" rx="38" ry="7" fill="#021830" opacity="0.28" />

      {/* Wallet body */}
      <rect x="14" y="26" width="76" height="52" rx="12" fill="url(#wlt-body)" />
      <rect x="14" y="26" width="76" height="52" rx="12" fill="url(#wlt-sheen)" />

      {/* Top card slot */}
      <path
        d="M24 36h48c2.2 0 4 1.8 4 4v10H20V40c0-2.2 1.8-4 4-4Z"
        fill="#124A8A"
        opacity="0.7"
      />
      <rect x="28" y="40" width="36" height="4" rx="2" fill="#5BA3E0" opacity="0.45" />

      {/* Side clasp */}
      <rect x="78" y="42" width="22" height="24" rx="7" fill="url(#wlt-clasp)" />
      <circle cx="92" cy="54" r="4.2" fill="#E8FFF4" opacity="0.95" />
      <circle cx="92" cy="54" r="2" fill="#0A7A4B" opacity="0.55" />

      {/* Logo badge on wallet */}
      <circle cx="46" cy="64" r="12" fill="#04275C" />
      <circle cx="46" cy="64" r="12" stroke="#6CFFAE" strokeOpacity="0.35" />
      {/* Simplified S mark */}
      <path
        d="M40.5 60.2c2.6-2.6 6.8-2.8 8.8-.6.9 1 .9 2.3.2 3.4-1 1.6-3.2 2.2-5.2 2.6l5.2 4.6h-4.6l-4.8-4.2c-.7.1-1.4.1-2.1-.1-2.4-.6-3.8-2.4-3.2-4.1.5-1.4 2-2.4 5.7-1.6Z"
        fill="#80FFB0"
      />
      <path
        d="M51.2 59.4c-1.8-1.6-4.6-1.4-6.6.8-.3.4-.6.8-.7 1.2 1.9-.1 3.8-.2 5 .8.7.6.9 1.3.6 2 1.5-.3 2.6-1.6 1.7-4.8Z"
        fill="white"
      />

      <defs>
        <linearGradient id="wlt-body" x1="14" y1="26" x2="96" y2="78" gradientUnits="userSpaceOnUse">
          <stop stopColor="#2B7BC4" />
          <stop offset="0.45" stopColor="#0E4F96" />
          <stop offset="1" stopColor="#083A72" />
        </linearGradient>
        <linearGradient id="wlt-sheen" x1="28" y1="26" x2="72" y2="72" gradientUnits="userSpaceOnUse">
          <stop stopColor="white" stopOpacity="0.28" />
          <stop offset="0.45" stopColor="white" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="wlt-clasp" x1="78" y1="42" x2="100" y2="66" gradientUnits="userSpaceOnUse">
          <stop stopColor="#3B8FD4" />
          <stop offset="1" stopColor="#0E4F96" />
        </linearGradient>
      </defs>
    </svg>
  );
}
