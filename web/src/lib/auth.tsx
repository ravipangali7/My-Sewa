import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiClient, getToken, setToken, ApiError } from "./api";
import { LIVE_REFETCH_MS } from "./refresh";
import type { UserProfile, Wallet } from "./types";
import {
  setupPushNotifications,
  unregisterStoredDeviceToken,
} from "./push-notifications";

type AuthContextValue = {
  token: string | null;
  user: UserProfile | null;
  wallet: Wallet | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  isStaff: boolean;
  login: (phone: string, password: string) => Promise<UserProfile>;
  register: (input: {
    phone: string;
    email: string;
    password: string;
    password2: string;
    transaction_pin: string;
    first_name?: string;
    last_name?: string;
  }) => Promise<UserProfile>;
  logout: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  setSessionToken: (token: string) => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [token, setTokenState] = useState<string | null>(() => getToken());

  const profileQuery = useQuery({
    queryKey: ["auth", "profile"],
    queryFn: () => apiClient.profile(),
    enabled: !!token,
    retry: false,
    // Poll so Pending → Active (and other profile fields) update without a manual refresh.
    refetchInterval: token ? LIVE_REFETCH_MS : false,
    refetchIntervalInBackground: false,
  });

  const walletQuery = useQuery({
    queryKey: ["wallet", "balance"],
    queryFn: () => apiClient.walletBalance(),
    enabled: !!token,
    retry: false,
    refetchInterval: token ? LIVE_REFETCH_MS : false,
    refetchIntervalInBackground: false,
  });

  const prevAccountStatus = useRef<string | null>(null);

  useEffect(() => {
    if (profileQuery.error instanceof ApiError && profileQuery.error.status === 401) {
      setToken(null);
      setTokenState(null);
      queryClient.clear();
    }
  }, [profileQuery.error, queryClient]);

  // Notify the user when Super Admin activates their account (Pending → Active).
  useEffect(() => {
    const status = profileQuery.data?.account_status ?? null;
    if (!status) return;
    const prev = prevAccountStatus.current;
    prevAccountStatus.current = status;
    if (prev === "pending" && status === "approved") {
      toast.success("Your account is now active. You can use all wallet features.");
    }
  }, [profileQuery.data?.account_status]);

  // Register FCM / web device token once authenticated.
  useEffect(() => {
    if (!token || !profileQuery.data) return;
    void setupPushNotifications();
  }, [token, profileQuery.data?.id]);

  const login = useCallback(
    async (phone: string, password: string) => {
      const res = await apiClient.login(phone, password);
      setToken(res.token);
      setTokenState(res.token);
      const profile = await apiClient.profile();
      queryClient.setQueryData(["auth", "profile"], profile);
      await queryClient.invalidateQueries({ queryKey: ["wallet", "balance"] });
      return profile;
    },
    [queryClient],
  );

  const register = useCallback(
    async (input: {
      phone: string;
      email: string;
      password: string;
      password2: string;
      transaction_pin: string;
      first_name?: string;
      last_name?: string;
    }) => {
      const res = await apiClient.register(input);
      setToken(res.token);
      setTokenState(res.token);
      const profile = await apiClient.profile();
      queryClient.setQueryData(["auth", "profile"], profile);
      await queryClient.invalidateQueries({ queryKey: ["wallet", "balance"] });
      return profile;
    },
    [queryClient],
  );

  const logout = useCallback(async () => {
    try {
      await unregisterStoredDeviceToken();
      if (getToken()) await apiClient.logout();
    } catch {
      // ignore logout errors
    } finally {
      setToken(null);
      setTokenState(null);
      queryClient.clear();
    }
  }, [queryClient]);

  const refreshProfile = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["auth", "profile"] }),
      queryClient.invalidateQueries({ queryKey: ["wallet", "balance"] }),
    ]);
  }, [queryClient]);

  const setSessionToken = useCallback((next: string) => {
    setToken(next);
    setTokenState(next);
  }, []);

  const user = profileQuery.data ?? null;
  const value = useMemo<AuthContextValue>(
    () => ({
      token,
      user,
      wallet: walletQuery.data ?? null,
      isLoading: !!token && (profileQuery.isLoading || walletQuery.isLoading),
      isAuthenticated: !!token && !!user,
      isStaff: !!(user?.is_staff || user?.is_superuser),
      login,
      register,
      logout,
      refreshProfile,
      setSessionToken,
    }),
    [
      token,
      user,
      walletQuery.data,
      profileQuery.isLoading,
      walletQuery.isLoading,
      login,
      register,
      logout,
      refreshProfile,
      setSessionToken,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
