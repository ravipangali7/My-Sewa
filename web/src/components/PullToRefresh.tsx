import {
  useCallback,
  useRef,
  useState,
  type ReactNode,
  type TouchEvent as ReactTouchEvent,
} from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

const THRESHOLD = 70;
const MAX_PULL = 112;

function getScrollableAncestor(node: HTMLElement | null): HTMLElement | null {
  let current = node?.parentElement ?? null;
  while (current) {
    const style = window.getComputedStyle(current);
    const overflowY = style.overflowY;
    const scrollableY =
      (overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay") &&
      current.scrollHeight > current.clientHeight;
    if (scrollableY) return current;
    current = current.parentElement;
  }
  return null;
}

function isAtTop(node: HTMLElement | null): boolean {
  if (typeof window === "undefined") return true;
  const scroller = getScrollableAncestor(node);
  if (scroller) return scroller.scrollTop <= 2;
  return window.scrollY <= 2;
}

type Props = {
  onRefresh: () => Promise<void>;
  children: ReactNode;
  disabled?: boolean;
  className?: string;
};

/**
 * Swipe-down-to-refresh for document-scrolling pages (mobile / WebView).
 * Activates only when the page is already scrolled to the top.
 */
export function PullToRefresh({
  onRefresh,
  children,
  disabled = false,
  className,
}: Props) {
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const startY = useRef<number | null>(null);
  const armed = useRef(false);
  const pullRef = useRef(0);

  const reset = useCallback(() => {
    startY.current = null;
    armed.current = false;
    pullRef.current = 0;
    setPull(0);
  }, []);

  const onTouchStart = (e: ReactTouchEvent) => {
    if (disabled || refreshing) return;
    if (!isAtTop(e.currentTarget)) {
      startY.current = null;
      return;
    }
    startY.current = e.touches[0]?.clientY ?? null;
    armed.current = false;
  };

  const onTouchMove = (e: ReactTouchEvent) => {
    if (startY.current == null || disabled || refreshing) return;
    if (!isAtTop(e.currentTarget)) {
      reset();
      return;
    }
    const y = e.touches[0]?.clientY ?? startY.current;
    const dy = y - startY.current;
    if (dy <= 0) {
      pullRef.current = 0;
      setPull(0);
      armed.current = false;
      return;
    }
    armed.current = true;
    const dampened = Math.min(MAX_PULL, dy * 0.42);
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
    startY.current = null;

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
      className={cn("relative min-w-0 w-full max-w-full", className)}
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
