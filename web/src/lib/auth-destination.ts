import type { UserProfile } from "./types";

export type AppHomePath = "/admin" | "/dealer" | "/app";

export function isNetworkRole(user: Pick<UserProfile, "role"> | null | undefined): boolean {
  const role = user?.role;
  return role === "dealer" || role === "agent" || role === "sub_agent";
}

export function homePathForUser(user: UserProfile | null | undefined): AppHomePath {
  if (!user) return "/app";
  if (user.is_staff || user.is_superuser) return "/admin";
  if (isNetworkRole(user)) return "/dealer";
  return "/app";
}

export function roleLabel(user: UserProfile | null | undefined): string {
  if (!user) return "User";
  if (user.is_superuser) return "Super Admin";
  if (user.is_staff) return "Admin";
  if (user.role === "dealer") return "Dealer";
  if (user.role === "agent") return "Agent";
  if (user.role === "sub_agent") return "Sub-Agent";
  return "Customer";
}
