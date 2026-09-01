import { useId } from "react";
import { cn } from "@/lib/utils";

/** Messenger-style chat mark: gradient bubble + white lightning. */
export function MessengerChatIcon({ className }: { className?: string }) {
  const uid = useId().replace(/:/g, "");
  const gradientId = `msgr-g-${uid}`;

  return (
    <svg
      viewBox="0 0 800 807"
      className={cn("block overflow-visible", className)}
      aria-hidden
    >
      <defs>
        <radialGradient id={gradientId} cx="22%" cy="18%" r="92%">
          <stop offset="0%" stopColor="#4DEBFF" />
          <stop offset="28%" stopColor="#00B2FF" />
          <stop offset="52%" stopColor="#006AFF" />
          <stop offset="78%" stopColor="#A033FF" />
          <stop offset="100%" stopColor="#FF5280" />
        </radialGradient>
      </defs>
      <path
        fill={`url(#${gradientId})`}
        d="M400 0C174.7 0 0 165.1 0 388c0 116.6 47.8 217.4 125.6 287 6.5 5.8 10.5 14 10.7 22.8l2.2 71.2c.7 22.7 24.1 37.5 44.9 28.3l79.4-35c6.7-3 14.3-3.5 21.4-1.6 36.5 10 75.3 15.4 115.8 15.4 225.3 0 400-165.1 400-388S625.3 0 400 0z"
      />
      <path
        fill="#fff"
        d="M159.8 501.5l117.5-186.4c18.7-29.7 58.7-37 86.8-16l93.5 70.1c8.6 6.4 20.4 6.4 28.9-.1l126.2-95.8c16.8-12.8 38.8 7.4 27.6 25.3L522.7 484.9c-18.7 29.7-58.7 37-86.8 16l-93.5-70.1c-8.6-6.4-20.4-6.4-28.9.1l-126.2 95.8c-16.8 12.8-38.8-7.3-27.5-25.2z"
      />
    </svg>
  );
}
