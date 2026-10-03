import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Api } from "grammy";
import type { Express } from "express";
import { createApp } from "../src/api/app";
import { prisma } from "../src/db";
import { createPanelUser } from "../src/services/panelUsers";
import { can, type Permission } from "../src/services/permissions";

/**
 * Avtorizatsiya matritsasi: admin panel API ning BARCHA marshrutlari manba koddan yig'iladi
 * (yangi marshrut qo'shilsa ham avtomatik tekshiriladi):
 * - tokensiz — 401 (faqat /auth/login ochiq);
 * - ADMIN roli super admin ruxsatini talab qiladigan marshrutga — 403 (handler ishlamaydi).
 */
const root = path.resolve(__dirname, "..");
const read = (f: string) => readFileSync(path.join(root, f), "utf8");

interface Route {
  method: "get" | "post" | "put" | "patch" | "delete";
  url: string;
  permission: Permission | null;
}

function collectRoutes(): Route[] {
  const app = read("src/api/app.ts");
  const files = new Map([...app.matchAll(/import \{ (\w+Router) \} from "\.\/routes\/(\w+)"/g)].map((m) => [m[1], m[2]]));
  const routes: Route[] = [];
  for (const m of app.matchAll(/api\.use\("([^"]+)",\s*(?:requirePermission\("([\w.]+)"\),\s*)?(\w+Router)/g)) {
    const [, prefix, mountPermission, routerName] = m;
    const src = read(`src/api/routes/${files.get(routerName)}.ts`);
    for (const r of src.matchAll(/\b\w+\.(get|post|put|patch|delete)\(\s*"([^"]+)"([^\n]*)/g)) {
      const own = /requirePermission\("([\w.]+)"\)/.exec(r[3])?.[1];
      routes.push({
        method: r[1] as Route["method"],
        url: `/api${prefix}${r[2] === "/" ? "" : r[2]}`.replace(/:(\w+)/g, "1"),
        permission: (own ?? mountPermission ?? null) as Permission | null,
      });
    }
  }
  return routes;
}

const routes = collectRoutes();
const fakeApi = { getMe: async () => ({ id: 1, is_bot: true, first_name: "T", username: "t_bot" }) } as unknown as Api;

describe("admin API avtorizatsiyasi (barcha marshrutlar)", () => {
  const app: Express = createApp({ runtime: { api: fakeApi, mode: "polling", tokenSource: "env", isRunning: () => true } });

  it("marshrutlar to'liq yig'ildi", () => {
    expect(routes.length).toBeGreaterThan(70);
    expect(routes.some((r) => r.url === "/api/bot/texts" && r.method === "put" && r.permission === "settings.manage")).toBe(true);
  });

  it("tokensiz yoki soxta token bilan — 401 (login va parol tiklashdan tashqari)", async () => {
    const failures: string[] = [];
    for (const r of routes) {
      // Ochiq: kirish va "Parolni unutdim" (kod so'rash/tekshirish)
      if (["/api/auth/login", "/api/auth/forgot-password", "/api/auth/verify-otp"].includes(r.url)) continue;
      for (const auth of [undefined, "Bearer soxta.token.qiymat"]) {
        const req = request(app)[r.method](r.url);
        const res = await (auth ? req.set("Authorization", auth) : req).send({});
        if (res.status !== 401) failures.push(`${r.method.toUpperCase()} ${r.url} → ${res.status}`);
      }
    }
    expect(failures).toEqual([]);
  });
});

const enabled = !!process.env.TEST_DATABASE_URL;

describe.skipIf(!enabled)("admin roli super admin bo'limlariga kira olmaydi", () => {
  let app: Express;
  let adminToken = "";

  beforeAll(async () => {
    await prisma.panelUser.deleteMany({ where: { email: "authz-admin@test.uz" } });
    await createPanelUser({ email: "authz-admin@test.uz", name: "Authz", password: "adminpass1", role: "admin" });
    app = createApp({ runtime: { api: fakeApi, mode: "polling", tokenSource: "env", isRunning: () => true } });
    adminToken = (await request(app).post("/api/auth/login").send({ email: "authz-admin@test.uz", password: "adminpass1" })).body.token;
  });
  afterAll(async () => {
    await prisma.panelUser.deleteMany({ where: { email: "authz-admin@test.uz" } });
    await prisma.$disconnect();
  });

  it("super admin ruxsatini talab qiladigan har bir marshrut — 403", async () => {
    const superOnly = routes.filter((r) => r.permission && !can("admin", r.permission));
    expect(superOnly.length).toBeGreaterThan(20);
    const failures: string[] = [];
    for (const r of superOnly) {
      const res = await request(app)[r.method](r.url).set("Authorization", `Bearer ${adminToken}`).send({});
      if (res.status !== 403) failures.push(`${r.method.toUpperCase()} ${r.url} (${r.permission}) → ${res.status}`);
    }
    expect(failures).toEqual([]);
  });
});
