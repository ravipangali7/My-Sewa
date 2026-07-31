/** Subtle mountain silhouette matching the MySewa home header art. */
export function MountainBackdrop({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 390 210"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
      preserveAspectRatio="xMidYMax slice"
    >
      {/* Distant peaks */}
      <path
        d="M0 210V142L34 108L62 136L98 72L134 120L176 42L222 116L262 68L302 118L342 86L390 112V210H0Z"
        fill="#B8F0FF"
        opacity="0.34"
      />
      {/* Mid range with snow tips hint */}
      <path
        d="M0 210V158L40 124L76 150L118 98L160 142L204 90L248 138L290 112L332 146L370 128L390 140V210H0Z"
        fill="#8FDCF5"
        opacity="0.38"
      />
      {/* Near hills — soft mint into green side */}
      <path
        d="M0 210V176L52 154L104 172L156 148L210 168L264 152L316 170L360 158L390 168V210H0Z"
        fill="#A7F3D0"
        opacity="0.26"
      />
      {/* Soft snow highlights on peaks */}
      <path d="M176 42L186 58L166 56Z" fill="white" opacity="0.35" />
      <path d="M98 72L106 84L90 82Z" fill="white" opacity="0.28" />
      <path d="M262 68L270 80L254 78Z" fill="white" opacity="0.28" />
    </svg>
  );
}
