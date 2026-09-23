import type { Api } from "grammy";

/** API ga kerak bo'ladigan bot holati (Express va bot bitta jarayonda ishlaydi) */
export interface BotRuntime {
  api: Api;
  mode: "polling" | "webhook";
  tokenSource: "env" | "database";
  isRunning: () => boolean;
}
