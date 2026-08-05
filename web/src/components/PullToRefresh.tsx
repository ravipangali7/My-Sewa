import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type TouchEvent as ReactTouchEvent,
} from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

const THRESHOLD = 70;
const MAX_PULL = 112;
/** Ignore tiny downward jitter so normal scroll isn't interrupted. */
const ARM_DELTA = 14;

function getScrollableAncestor(node: HTMLElement | null): HTMLElement | null {
  let current = node?.parentElement ?? null;
  while (current) {
    const style = window.getComputedStyle(current);
    const overflowY = style.overflowY;
    const scrollableY =
      (overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay") &&
      current.scrollHeight > current.clientHeight + 1;
    if (scrollableY) return current;
    current = current.parentElement;
  }
  return null;
}

function isAtTop(node: HTMLElement | null): boolean {
  if (typeof window === "undefined") return true;
  const scroller = getScrollableAncestor(node);
  if (scroller) return scroller.scrollTop <= 2;
  return (window.scrollY || document.documentElement.scrollTop || 0) <= 2;
}

type Props = {
  onRefresh: () => Promise<void>;
  children: ReactNode;
  disabled?: boolean;
  className?: string;
};

/**
 * Swipe-down-to-refresh for document-scrolling pages (mobile / WebView).
 * Activates only when the page is already scrolled to the top, and only
 * after a clear downward pull — never blocks normal pan scrolling.
 */
export function PullToRefresh({
  onRefresh,
  children,
  disabled = false,
  className,
}: Props) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const startY = useRef<number | null>(null);
  const startX = useRef<number | null>(null);
  const armed = useRef(false);
  const tracking = useRef(false);
  const pullRef = useRef(0);

  const reset = useCallback(() => {
    startY.current = null;
    startX.current = null;
    armed.current = false;
    tracking.current = false;
    pullRef.current = 0;
    setPull(0);
  }, []);

  // Non-passive listener so we can cancel rubber-band bounce while armed.
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const onMove = (e: TouchEvent) => {
      if (!armed.current || !e.cancelable) return;
      e.preventDefault();
    };
    el.addEventListener("touchmove", onMove, { passive: false });
    return () => el.removeEventListener("touchmove", onMove);
  }, []);

  const onTouchStart = (e: ReactTouchEvent) => {
    if (disabled || refreshing) return;
    if (!isAtTop(e.currentTarget as HTMLElement)) {
      reset();
      return;
    }
    startY.current = e.touches[0]?.clientY ?? null;
    startX.current = e.touches[0]?.clientX ?? null;
    armed.current = false;
    tracking.current = true;
  };

  const onTouchMove = (e: ReactTouchEvent) => {
    if (!tracking.current || startY.current == null || disabled || refreshing) return;
    if (!isAtTop(e.currentTarget as HTMLElement)) {
      reset();
      return;
    }

    const y = e.touches[0]?.clientY ?? startY.current;
    const x = e.touches[0]?.clientX ?? startX.current ?? 0;
    const dy = y - startY.current;
    const dx = Math.abs(x - (startX.current ?? x));

    // Horizontal or upward pans: never hijack.
    if (dy <= ARM_DELTA || dx > dy) {
      if (armed.current) {
        pullRef.current = 0;
        setPull(0);
        armed.current = false;
      }
      return;
    }

    armed.current = true;
    const dampened = Math.min(MAX_PULL, (dy - ARM_DELTA) * 0.42);
    pullRef.current = dampened;
    setPull(dampened);
  };

  const onTouchEnd = async () => {
    if (!armed.current) {
      reset();
      return;
    }
    const shouldRefresh = pullRef.current >= THRESHOLD;
    armed.current = false;
    tracking.current = false;
    startY.current = null;
    startX.current = null;

    if (!shouldRefresh) {
      pullRef.current = 0;
      setPull(0);
      return;
    }

    setRefreshing(true);
    setPull(THRESHOLD * 0.55);
    try {
      await onRefresh();
    } finally {
      setRefreshing(false);
      pullRef.current = 0;
      setPull(0);
    }
  };

  const showIndicator = pull > 10 || refreshing;
  const pastThreshold = pull >= THRESHOLD || refreshing;

  return (
    <div
      ref={rootRef}
      className={cn("relative min-w-0 w-full max-w-full overscroll-y-none", className)}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onTouchCancel={reset}
    >
      <div
        aria-hidden={!showIndicator}
        className={cn(
          "pointer-events-none absolute inset-x-0 z-50 flex justify-center transition-opacity duration-150",
          showIndicator ? "opacity-100" : "opacity-0",
        )}
        style={{
          top: "max(10px, calc(var(--safe-area-top, env(safe-area-inset-top, 0px)) + 6px))",
        }}
      >
        <div className="flex size-9 items-center justify-center rounded-full border border-border/80 bg-surface shadow-[0_4px_14px_-4px_rgba(16,24,40,0.28)]">
          <Loader2
            className={cn("size-5 text-brand", pastThreshold && "animate-spin")}
            style={
              !pastThreshold
                ? { transform: `rotate(${Math.round(pull * 2.8)}deg)` }
                : undefined
            }
          />
        </div>
      </div>

      <div
        className="min-w-0 w-full max-w-full"
        style={{
          transform: pull > 0 ? `translateY(${pull}px)` : undefined,
          transition: armed.current ? undefined : "transform 180ms ease-out",
        }}
      >
        {children}
      </div>
    </div>
  );
}
