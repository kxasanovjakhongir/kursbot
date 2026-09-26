import type { Api } from "grammy";
import { getSettings, setSetting } from "./settings";

export type KnownChannel = { id: string; title: string; username?: string };

export class ChannelInputError extends Error {}

/** Bot admin qilingan kanallar (my_chat_member orqali eslab qolinadi) — yopiq havolani ID ga moslash uchun */
export async function listKnownChannels(): Promise<KnownChannel[]> {
  return (await getSettings()).known_channels ?? [];
}

export async function rememberChannel(ch: KnownChannel): Promise<void> {
  const list = (await listKnownChannels()).filter((c) => c.id !== ch.id);
  await setSetting("known_channels", [...list, ch]);
}

export async function forgetChannel(id: string): Promise<void> {
  const list = await listKnownChannels();
  if (list.some((c) => c.id === id)) await setSetting("known_channels", list.filter((c) => c.id !== id));
}

/**
 * Admin kiritgan qiymatdan kanal ID sini aniqlaydi:
 *  -1001234567890 | 1234567890 | @kanal | t.me/kanal | t.me/c/1234567890/5 (post havolasi)
 *  | t.me/+XXXX yoki t.me/joinchat/XXXX (yopiq kanal — bot admin bo'lgan kanallar ichidan qidiriladi)
 */
export async function resolveChannelId(api: Api, raw: string): Promise<string> {
  const input = raw.trim().replace(/^(https?:\/\/)?(www\.)?(t\.me|telegram\.me|telegram\.dog)\//i, "t.me/");

  if (/^-100\d{5,}$/.test(input)) return input;
  if (/^\d{8,}$/.test(input)) return `-100${input}`;

  const post = input.match(/^t\.me\/c\/(\d+)/i);
  if (post) return `-100${post[1]}`;

  const invite = input.match(/^t\.me\/(?:\+|joinchat\/)([\w-]+)/i);
  if (invite) return resolveInviteLink(api, invite[1]);

  const username = input.match(/^(?:@|t\.me\/)([a-z]\w{3,31})\/?(?:\d+)?$/i);
  if (username) {
    const chat = await api.getChat(`@${username[1]}`).catch(() => null);
    if (!chat) throw new ChannelInputError(`@${username[1]} kanali topilmadi`);
    return String(chat.id);
  }

  throw new ChannelInputError("Kanal havolasi yoki ID noto'g'ri. Masalan: https://t.me/+AbCd..., @kanal yoki -1001234567890");
}

async function resolveInviteLink(api: Api, hash: string): Promise<string> {
  const known = await listKnownChannels();
  for (const ch of known) {
    const chat = await api.getChat(Number(ch.id)).catch(() => null);
    const link = chat && "invite_link" in chat ? chat.invite_link : undefined;
    if (link && link.endsWith(hash)) return ch.id;
  }
  throw new ChannelInputError(
    known.length
      ? "Bu havola bo'yicha kanal topilmadi. Ro'yxatdan kanalni tanlang yoki kanaldagi istalgan post havolasini (t.me/c/...) kiriting"
      : "Yopiq kanal havolasidan ID ni aniqlab bo'lmadi. Avval botni kanalga admin qilib qo'shing, so'ng havolani qayta kiriting",
  );
}
