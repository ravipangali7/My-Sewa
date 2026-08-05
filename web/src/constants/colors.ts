/**
 * MySewa — single source of truth for colors.
 * Every token here is mirrored into CSS variables in src/styles.css.
 * Components should use the semantic Tailwind classes (bg-brand, text-danger, ...).
 */

export const COLORS = {
  brand: "#0A7A4B",
  brandDark: "#065F3A",
  brandSoft: "#E8F6EF",
  brandAccent: "#20C36A",

  /** Deep blue used in the wallet hero gradient (from the MySewa app art) */
  ocean: "#0B3B7A",
  oceanDeep: "#062A5C",

  bg: "#F2F2F7",
  surface: "#FFFFFF",
  label: "#1C1C1E",
  secondary: "#8E8E93",
  separator: "#C6C6C8",

  danger: "#FF3B30",
  warning: "#FF9500",
  success: "#34C759",
  info: "#0A84FF",
} as const;

export const GRADIENTS = {
  /** Wallet balance card + app header */
  hero: `linear-gradient(120deg, ${COLORS.oceanDeep} 0%, ${COLORS.ocean} 45%, ${COLORS.brand} 100%)`,
  brand: `linear-gradient(135deg, ${COLORS.brand} 0%, ${COLORS.brandAccent} 100%)`,
} as const;

export const RADII = {
  lg: "16px",
  md: "12px",
  pill: "999px",
} as const;

/** Status → semantic token name, shared by both portals */
export const STATUS_TONE = {
  pending: "warning",
  approved: "success",
  success: "success",
  rejected: "danger",
  failed: "danger",
  not_submitted: "warning",
} as const;

export type StatusKey = keyof typeof STATUS_TONE;
