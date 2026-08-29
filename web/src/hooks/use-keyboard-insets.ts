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

function isFillHeightPage(): boolean {
  return Boolean(document.querySelector(".mysewa-fill-height"));
}

/** Keep the focused field in the visual viewport on document-scrolling forms. */
function scrollFieldIntoView(el: HTMLElement) {
  const vv = window.visualViewport;
  const visibleTop = vv?.offsetTop ?? 0;
  const visibleBottom = visibleTop + (vv?.height ?? window.innerHeight);
  const rect = el.getBoundingClientRect();
  const headerReserve = 72;
  const footerReserve = 24;
  if (rect.top >= visibleTop + headerReserve && rect.bottom <= visibleBottom - footerReserve) {
    return;
  }
  el.scrollIntoView({ block: "center", inline: "nearest" });
}

/**
 * Tracks the visual viewport so mobile keyboards do not lift the bottom nav
 * under search/chat fields. Sets --vv-height, --keyboard-inset, and the
 * `keyboard-open` class on <html>.
 *
 * Document scroll is locked only on fill-height composer screens (chat).
 * Form pages (Fund Transfer, remittance, top-up, …) stay scrollable so
 * fields and submit buttons below the fold remain reachable.
 */
export function useKeyboardInsets() {
  useEffect(() => {
    const root = document.documentElement;
    const mq = window.matchMedia("(max-width: 1023px)");
    let blurTimer = 0;
    let revealTimer = 0;

    const sync = () => {
      const vv = window.visualViewport;
      const height = Math.round(vv?.height ?? window.innerHeight);
      const offsetTop = vv?.offsetTop ?? 0;
      const inset = Math.max(0, Math.round(window.innerHeight - height - offsetTop));
      root.style.setProperty("--vv-height", `${height}px`);
      root.style.setProperty("--keyboard-inset", `${inset}px`);

      const focused = isTextEntry(document.activeElement);
      const fillHeight = isFillHeightPage();
      const keyboardOpen = mq.matches && (focused || inset > 80);
      root.classList.toggle("keyboard-open", keyboardOpen);
      root.classList.toggle("keyboard-lock", keyboardOpen && fillHeight);

      if (keyboardOpen && fillHeight) {
        // Stop the browser from panning the chat composer above the tab bar.
        window.scrollTo(0, 0);
      }
    };

    const revealFocusedField = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement) || isFillHeightPage()) return;
      window.clearTimeout(revealTimer);
      revealTimer = window.setTimeout(() => {
        if (document.activeElement !== target) return;
        scrollFieldIntoView(target);
      }, 280);
    };

    const onFocusIn = (event: FocusEvent) => {
      if (!isTextEntry(event.target)) return;
      window.clearTimeout(blurTimer);
      sync();
      revealFocusedField(event.target);
    };

    const onFocusOut = () => {
      window.clearTimeout(blurTimer);
      blurTimer = window.setTimeout(sync, 180);
    };

    const onViewportChange = () => {
      sync();
      const active = document.activeElement;
      if (isTextEntry(active) && !isFillHeightPage() && active instanceof HTMLElement) {
        revealFocusedField(active);
      }
    };

    sync();
    window.addEventListener("focusin", onFocusIn);
    window.addEventListener("focusout", onFocusOut);
    window.addEventListener("resize", onViewportChange);
    mq.addEventListener("change", sync);
    window.visualViewport?.addEventListener("resize", onViewportChange);
    window.visualViewport?.addEventListener("scroll", onViewportChange);

    return () => {
      window.clearTimeout(blurTimer);
      window.clearTimeout(revealTimer);
      window.removeEventListener("focusin", onFocusIn);
      window.removeEventListener("focusout", onFocusOut);
      window.removeEventListener("resize", onViewportChange);
      mq.removeEventListener("change", sync);
      window.visualViewport?.removeEventListener("resize", onViewportChange);
      window.visualViewport?.removeEventListener("scroll", onViewportChange);
      root.classList.remove("keyboard-open");
      root.classList.remove("keyboard-lock");
      root.style.removeProperty("--vv-height");
      root.style.removeProperty("--keyboard-inset");
    };
  }, []);
}
