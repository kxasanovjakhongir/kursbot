import type { AdminRole } from "@prisma/client";

/**
 * Rollar va ruxsatlar — yagona manba. Bot ham, admin panel API ham shu jadvaldan foydalanadi.
 * USER — oddiy mijoz (bazada alohida rol yo'q), ADMIN va SUPER_ADMIN — `AdminRole` (admins / panel_users).
 */
export type Role = "user" | AdminRole;

export const PERMISSIONS = [
  // Mijoz
  "catalog.view",
  "profile.view",
  "help.view",
  // Admin
  "orders.review",
  "stats.view",
  "users.view",
  "users.manage",
  "broadcast.send",
  "content.manage",
  // Super admin
  "products.manage",
  "cards.manage",
  "admins.manage",
  "settings.manage",
  "logs.view",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const USER: readonly Permission[] = ["catalog.view", "profile.view", "help.view"];
const ADMIN: readonly Permission[] = [
  ...USER,
  "orders.review",
  "stats.view",
  "users.view",
  "users.manage",
  "broadcast.send",
  "content.manage",
];
const SUPER_ADMIN: readonly Permission[] = PERMISSIONS;

const MATRIX: Record<Role, ReadonlySet<Permission>> = {
  user: new Set(USER),
  admin: new Set(ADMIN),
  superadmin: new Set(SUPER_ADMIN),
};

export function can(role: Role | null | undefined, permission: Permission): boolean {
  return MATRIX[role ?? "user"].has(permission);
}

/** Admin yozuvidan rol: admin bo'lmasa — oddiy foydalanuvchi */
export function roleOf(admin: { role: AdminRole } | null | undefined): Role {
  return admin?.role ?? "user";
}
