import type { UserProfile } from "./types";

export type AppHomePath = "/admin" | "/dealer" | "/app";

export function isNetworkRole(user: Pick<UserProfile, "role"> | null | undefined): boolean {
  return user?.role === "dealer";
}

export function homePathForUser(user: UserProfile | null | undefined): AppHomePath {
  if (!user) return "/app";
  if (user.is_staff || user.is_superuser) return "/admin";
  if (isNetworkRole(user)) return "/app";
  return "/app";
}

export function roleLabel(user: UserProfile | null | undefined): string {
  if (!user) return "User";
  if (user.is_superuser) return "Super Admin";
  if (user.is_staff) return "Admin";
  if (user.role === "dealer") return "Dealer";
  return "User";
}
