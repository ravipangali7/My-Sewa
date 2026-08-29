import { useEffect } from "react";

function isTextEntry(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  if (tag === "TEXTAREA") return true;
  if (tag !== "INPUT") return false;
  const type = ((el as HTMLInputElement).type || "text").toLowerCase();
  return ![
    "button",
    "checkbox",
    "color",
    "file",
    "hidden",
    "image",
    "radio",
    "range",
    "reset",
    "submit",
  ].includes(type);
}

/**
 * Tracks the visual viewport so mobile keyboards do not lift the bottom nav
 * under search/chat fields. Sets --vv-height, --keyboard-inset, and the
 * `keyboard-open` class on <html>.
 */
export function useKeyboardInsets() {
  useEffect(() => {
    const root = document.documentElement;
    const mq = window.matchMedia("(max-width: 1023px)");
    let blurTimer = 0;

    const sync = () => {
      const vv = window.visualViewport;
      const height = Math.round(vv?.height ?? window.innerHeight);
      const offsetTop = vv?.offsetTop ?? 0;
      const inset = Math.max(0, Math.round(window.innerHeight - height - offsetTop));
      root.style.setProperty("--vv-height", `${height}px`);
      root.style.setProperty("--keyboard-inset", `${inset}px`);

      const focused = isTextEntry(document.activeElement);
      const keyboardOpen = mq.matches && (focused || inset > 80);
      root.classList.toggle("keyboard-open", keyboardOpen);

      if (keyboardOpen) {
        // Stop the browser from panning the focused field above the tab bar.
        window.scrollTo(0, 0);
      }
    };

    const onFocusIn = (event: FocusEvent) => {
      if (!isTextEntry(event.target)) return;
      window.clearTimeout(blurTimer);
      sync();
    };

    const onFocusOut = () => {
      window.clearTimeout(blurTimer);
      blurTimer = window.setTimeout(sync, 180);
    };

    sync();
    window.addEventListener("focusin", onFocusIn);
    window.addEventListener("focusout", onFocusOut);
    window.addEventListener("resize", sync);
    mq.addEventListener("change", sync);
    window.visualViewport?.addEventListener("resize", sync);
    window.visualViewport?.addEventListener("scroll", sync);

    return () => {
      window.clearTimeout(blurTimer);
      window.removeEventListener("focusin", onFocusIn);
      window.removeEventListener("focusout", onFocusOut);
      window.removeEventListener("resize", sync);
      mq.removeEventListener("change", sync);
      window.visualViewport?.removeEventListener("resize", sync);
      window.visualViewport?.removeEventListener("scroll", sync);
      root.classList.remove("keyboard-open");
      root.style.removeProperty("--vv-height");
      root.style.removeProperty("--keyboard-inset");
    };
  }, []);
}
