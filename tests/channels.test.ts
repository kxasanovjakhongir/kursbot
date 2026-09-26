import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Api } from "grammy";

const store = vi.hoisted(() => ({ known: [] as { id: string; title: string }[] }));
vi.mock("../src/services/settings", () => ({
  getSettings: async () => ({ known_channels: store.known }),
  setSetting: async (_k: string, v: { id: string; title: string }[]) => void (store.known = v),
}));

import { ChannelInputError, resolveChannelId } from "../src/services/channels";

const api = {
  getChat: vi.fn(async (id: number | string) => {
    if (id === "@darslik") return { id: -1009876543210, type: "channel" };
    if (id === -1001111111111) return { id, type: "channel", invite_link: "https://t.me/+AbCdEf123" };
    throw new Error("chat not found");
  }),
} as unknown as Api;

describe("resolveChannelId", () => {
  beforeEach(() => void (store.known = []));

  it("ID, post havolasi va @username", async () => {
    expect(await resolveChannelId(api, " -1001234567890 ")).toBe("-1001234567890");
    expect(await resolveChannelId(api, "1234567890")).toBe("-1001234567890");
    expect(await resolveChannelId(api, "https://t.me/c/1234567890/15")).toBe("-1001234567890");
    expect(await resolveChannelId(api, "@darslik")).toBe("-1009876543210");
    expect(await resolveChannelId(api, "https://t.me/darslik")).toBe("-1009876543210");
  });

  it("yopiq kanal havolasi bot admin bo'lgan kanallar ichidan topiladi", async () => {
    store.known = [{ id: "-1001111111111", title: "Yopiq" }];
    expect(await resolveChannelId(api, "https://t.me/+AbCdEf123")).toBe("-1001111111111");
    expect(await resolveChannelId(api, "t.me/joinchat/AbCdEf123")).toBe("-1001111111111");
    await expect(resolveChannelId(api, "https://t.me/+Boshqa999")).rejects.toBeInstanceOf(ChannelInputError);
  });

  it("noto'g'ri qiymat — tushunarli xato", async () => {
    await expect(resolveChannelId(api, "salom dunyo")).rejects.toBeInstanceOf(ChannelInputError);
    await expect(resolveChannelId(api, "https://t.me/+AbCdEf123")).rejects.toThrow(/admin qilib qo'shing/);
  });
});
