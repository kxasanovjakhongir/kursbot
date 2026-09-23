import { FileText, Film } from "lucide-react";
import type { BroadcastType } from "../lib/types";

/** Xabar Telegram'da qanday ko'rinishini taqlid qiladi */
export function TelegramPreview({ type, text, fileUrl, fileName, botName }: { type: BroadcastType; text: string; fileUrl: string | null; fileName: string | null; botName: string }) {
  const time = new Date().toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  return (
    <div className="rounded-xl bg-[#8fb6d6] bg-[radial-gradient(circle_at_20%_20%,#a8c8e0_0,transparent_40%),radial-gradient(circle_at_80%_70%,#9cc3a8_0,transparent_45%)] p-4">
      <div className="max-w-[340px] overflow-hidden rounded-2xl rounded-bl-md bg-white shadow">
        {type === "photo" && fileUrl && <img src={fileUrl} alt="" className="max-h-72 w-full object-cover" />}
        {type === "video" && (
          <div className="relative flex h-44 items-center justify-center bg-gray-800">
            {fileUrl ? <video src={fileUrl} className="h-full w-full object-cover" muted /> : null}
            <Film className="absolute h-10 w-10 text-white/80" />
          </div>
        )}
        {type === "document" && (
          <div className="flex items-center gap-3 px-3 pt-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-[#3a9ee4]">
              <FileText className="h-5 w-5 text-white" />
            </div>
            <span className="truncate text-sm font-medium text-gray-900">{fileName ?? "fayl"}</span>
          </div>
        )}
        <div className="px-3 pb-1.5 pt-2">
          {type === "text" && <p className="mb-0.5 text-sm font-medium text-[#3a9ee4]">{botName}</p>}
          <p className="whitespace-pre-wrap break-words text-[15px] leading-snug text-gray-900">{text || (type === "text" ? "Xabar matni…" : "")}</p>
          <p className="mt-0.5 text-right text-[11px] text-gray-400">{time}</p>
        </div>
      </div>
    </div>
  );
}
