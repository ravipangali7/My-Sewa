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
  listenForNativePushToken,
  setupPushNotifications,
  unregisterStoredDeviceToken,
} from "./push-notifications";

export type LoginOtpChallenge = {
  challenge_id: string;
  expires_in: number;
  channels: string[];
  email_hint?: string | null;
  phone_hint?: string | null;
  message: string;
  login_via?: "email" | "phone" | string | null;
  preferred_channel?: "email" | "sms" | string | null;
};

/** Result of password login — either OTP challenge or an established session. */
export type LoginResult =
  | { status: "otp_required"; challenge: LoginOtpChallenge }
  | { status: "authenticated"; user: UserProfile };

type AuthContextValue = {
  token: string | null;
  user: UserProfile | null;
  wallet: Wallet | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  isStaff: boolean;
  /** Step 1: verify credentials. May return OTP challenge or complete login when OTP is disabled. */
  beginLogin: (identifier: string, password: string) => Promise<LoginResult>;
  /** Step 2: verify OTP and establish session. */
  verifyLoginOtp: (challengeId: string, otp: string) => Promise<UserProfile>;
  resendLoginOtp: (challengeId: string) => Promise<LoginOtpChallenge>;
  register: (input: {
    phone: string;
    email: string;
    password: string;
    password2: string;
    transaction_pin: string;
    date_of_birth: string;
    first_name?: string;
    last_name?: string;
  }) => Promise<UserProfile>;
  logout: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  setSessionToken: (token: string) => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function toChallenge(res: {
  challenge_id: string;
  expires_in: number;
  channels: string[];
  email_hint?: string | null;
  phone_hint?: string | null;
  message: string;
  login_via?: string | null;
  preferred_channel?: string | null;
}): LoginOtpChallenge {
  const challenge: LoginOtpChallenge = {
    challenge_id: res.challenge_id,
    expires_in: res.expires_in,
    channels: res.channels || [],
    message: res.message,
  };
  if (res.email_hint != null) challenge.email_hint = res.email_hint;
  if (res.phone_hint != null) challenge.phone_hint = res.phone_hint;
  if (res.login_via != null) challenge.login_via = res.login_via;
  if (res.preferred_channel != null) challenge.preferred_channel = res.preferred_channel;
  return challenge;
}

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

  // Listen for the native FCM token on first paint (before login).
  useEffect(() => {
    listenForNativePushToken();
  }, []);

  // Register FCM device token as soon as an auth token exists — do not wait
  // for the profile query, or a slow/failed profile fetch would skip save.
  useEffect(() => {
    if (!token) return;
    void setupPushNotifications();
  }, [token]);

  const establishSession = useCallback(
    async (sessionToken: string) => {
      setToken(sessionToken);
      setTokenState(sessionToken);
      void setupPushNotifications();
      const profile = await apiClient.profile();
      queryClient.setQueryData(["auth", "profile"], profile);
      await queryClient.invalidateQueries({ queryKey: ["wallet", "balance"] });
      return profile;
    },
    [queryClient],
  );

  const beginLogin = useCallback(
    async (identifier: string, password: string): Promise<LoginResult> => {
      const res = await apiClient.login(identifier, password);
      if (!res.requires_otp && res.token) {
        const profile = await establishSession(res.token);
        return { status: "authenticated", user: profile };
      }
      if (!res.challenge_id) {
        throw new ApiError(
          "Login did not return a verification challenge. Please try again.",
          500,
        );
      }
      return {
        status: "otp_required",
        challenge: toChallenge({
          challenge_id: res.challenge_id,
          expires_in: res.expires_in ?? 300,
          channels: res.channels || [],
          email_hint: res.email_hint,
          phone_hint: res.phone_hint,
          message: res.message,
          login_via: res.login_via,
          preferred_channel: res.preferred_channel,
        }),
      };
    },
    [establishSession],
  );

  const verifyLoginOtp = useCallback(
    async (challengeId: string, otp: string) => {
      const res = await apiClient.verifyLoginOtp({
        challenge_id: challengeId,
        otp,
      });
      return establishSession(res.token);
    },
    [establishSession],
  );

  const resendLoginOtp = useCallback(async (challengeId: string) => {
    const res = await apiClient.resendLoginOtp(challengeId);
    return toChallenge(res);
  }, []);

  const register = useCallback(
    async (input: {
      phone: string;
      email: string;
      password: string;
      password2: string;
      transaction_pin: string;
      date_of_birth: string;
      first_name?: string;
      last_name?: string;
    }) => {
      const res = await apiClient.register(input);
      return establishSession(res.token);
    },
    [establishSession],
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
      beginLogin,
      verifyLoginOtp,
      resendLoginOtp,
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
      beginLogin,
      verifyLoginOtp,
      resendLoginOtp,
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
