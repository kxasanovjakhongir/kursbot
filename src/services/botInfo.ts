import type { Api } from "grammy";

let cached: { token: string; username: string | null } | null = null;

/**
 * Bot username (t.me/<username> havolalari uchun). Bir marta so'raladi va keshlanadi;
 * token paneldan almashtirilsa kesh o'zi yangilanadi.
 */
export async function botUsername(api: Api): Promise<string | null> {
  if (cached?.token === api.token && cached.username) return cached.username;
  const username = (await api.getMe().catch(() => null))?.username ?? null;
  cached = { token: api.token, username };
  return username;
}
