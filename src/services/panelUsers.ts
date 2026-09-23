import bcrypt from "bcryptjs";
import type { AdminRole, PanelUser } from "@prisma/client";
import { prisma } from "../db";

export type SafePanelUser = Omit<PanelUser, "passwordHash">;

/** Parol hech qachon javobga chiqmaydi */
export function toSafe(u: PanelUser): SafePanelUser {
  const { passwordHash: _omit, ...safe } = u;
  return safe;
}

export const hashPassword = (password: string) => bcrypt.hash(password, 12);

// Foydalanuvchi topilmaganda ham bcrypt ishlaydi — javob vaqti orqali email aniqlanmasligi uchun
const DUMMY_HASH = bcrypt.hashSync("dummy-password-for-timing", 12);

export async function verifyCredentials(email: string, password: string): Promise<PanelUser | null> {
  const user = await prisma.panelUser.findUnique({ where: { email: email.toLowerCase() } });
  const ok = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
  return user && user.isActive && ok ? user : null;
}

export async function createPanelUser(input: { email: string; name: string; password: string; role: AdminRole }) {
  return prisma.panelUser.create({
    data: {
      email: input.email.toLowerCase(),
      name: input.name,
      role: input.role,
      passwordHash: await hashPassword(input.password),
    },
  });
}

export async function countActiveSuperAdmins(excludeId?: number): Promise<number> {
  return prisma.panelUser.count({
    where: { role: "superadmin", isActive: true, ...(excludeId ? { id: { not: excludeId } } : {}) },
  });
}
