import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
  useRouterState,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { Toaster } from "@/components/ui/sonner";
import { AuthProvider } from "@/lib/auth";
import { I18nProvider } from "@/lib/i18n";
import { useSiteBranding } from "@/hooks/use-site-branding";
import { useLiveRefresh } from "@/hooks/use-live-refresh";
import { ensureNativeDocumentScroll, isMySewaNativeApp } from "@/lib/native-app";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover" },
      { title: "MySewa — Nepal Digital Wallet, Remittance & Top-Up" },
      { name: "description", content: "MySewa is a Nepal digital wallet: load remittance into your wallet, send bank transfers and recharge NTC or NCELL in seconds." },
      { name: "author", content: "Lovable" },
      { property: "og:title", content: "MySewa — Nepal Digital Wallet, Remittance & Top-Up" },
      { property: "og:description", content: "MySewa is a Nepal digital wallet: load remittance into your wallet, send bank transfers and recharge NTC or NCELL in seconds." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:site", content: "@Lovable" },
      { name: "twitter:title", content: "MySewa — Nepal Digital Wallet, Remittance & Top-Up" },
      { name: "twitter:description", content: "MySewa is a Nepal digital wallet: load remittance into your wallet, send bank transfers and recharge NTC or NCELL in seconds." },
      { property: "og:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/62f6bb4d-a201-4e33-b99d-b08e070dfcc2/id-preview-555aee0a--7258fa6e-b4f0-4b82-a4f9-113d67c52724.lovable.app-1785493584021.png" },
      { name: "twitter:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/62f6bb4d-a201-4e33-b99d-b08e070dfcc2/id-preview-555aee0a--7258fa6e-b4f0-4b82-a4f9-113d67c52724.lovable.app-1785493584021.png" },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
      { rel: "icon", href: "/favicon.png", type: "image/png" },
      { rel: "shortcut icon", href: "/favicon.ico" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  return (
    <QueryClientProvider client={queryClient}>
      <I18nProvider>
        <AuthProvider>
          <SiteBrandingSync />
          <LiveRefreshSync />
          <NativeScrollSync />
          {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
          <Outlet />
          <Toaster position="top-center" />
        </AuthProvider>
      </I18nProvider>
    </QueryClientProvider>
  );
}

/** Keeps the document favicon in sync with the uploaded site logo. */
function SiteBrandingSync() {
  useSiteBranding();
  return null;
}

/** Refetch when the WebView/tab becomes visible again. */
function LiveRefreshSync() {
  useLiveRefresh();
  return null;
}

/** Flutter WebView: keep document scrolling unlocked across SPA navigations. */
function NativeScrollSync() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  useEffect(() => {
    if (!isMySewaNativeApp()) return;
    ensureNativeDocumentScroll();
    const t1 = window.setTimeout(ensureNativeDocumentScroll, 50);
    const t2 = window.setTimeout(ensureNativeDocumentScroll, 300);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [pathname]);

  return null;
}
