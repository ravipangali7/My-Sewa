import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { apiClient } from "@/lib/api";

const DEFAULT_LOGO = "/logo.png";
const DEFAULT_FAVICON = "/favicon.png";

/** Public settings branding: logo URL for UI + document favicon. */
export function useSiteBranding() {
  const settingsQuery = useQuery({
    queryKey: ["settings"],
    queryFn: () => apiClient.settings(),
    staleTime: 60_000,
  });

  const logoUrl = settingsQuery.data?.logo_url || DEFAULT_LOGO;
  const faviconUrl = settingsQuery.data?.logo_url || DEFAULT_FAVICON;

  useEffect(() => {
    const ensureLink = (rel: string, href: string, type?: string) => {
      let link = document.querySelector<HTMLLinkElement>(`link[rel='${rel}']`);
      if (!link) {
        link = document.createElement("link");
        link.rel = rel;
        document.head.appendChild(link);
      }
      link.href = href;
      if (type) link.type = type;
    };

    ensureLink("icon", faviconUrl, faviconUrl.endsWith(".ico") ? "image/x-icon" : "image/png");
    ensureLink("shortcut icon", faviconUrl);
  }, [faviconUrl]);

  return {
    logoUrl,
    faviconUrl,
    isLoading: settingsQuery.isLoading,
  };
}
