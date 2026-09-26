import pino from "pino";
import { errorSinkStream } from "./errorSink";

/**
 * Tuzilgan (JSON) log. Telefon, karta raqamlari va har qanday token/parol niqoblanadi (TZ 11.4) —
 * loglarga yozishdan oldin pino ularni "***" bilan almashtiradi.
 */
const level = process.env.LOG_LEVEL ?? "info";

export const logger = pino(
  {
    level,
    base: { service: "darslik-bot" },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: {
      paths: [
        "phone",
        "*.phone",
        "number",
        "*.number",
        "card.number",
        "token",
        "*.token",
        "password",
        "*.password",
        "passwordHash",
        "*.passwordHash",
        "authorization",
        "*.authorization",
        "headers.authorization",
        "*.headers.authorization",
        "headers.cookie",
        "*.headers.cookie",
        "initData",
        "*.initData",
        "secret",
        "*.secret",
        "secret_token",
        "*.secret_token",
        "bot_token_enc",
        "*.bot_token_enc",
      ],
      censor: "***",
    },
  },
  // stdout — odatdagidek; error/fatal qo'shimcha ravishda bazaga (panel: "Xatoliklar")
  pino.multistream([
    { level: level as pino.Level, stream: pino.destination(1) },
    { level: "error", stream: errorSinkStream },
  ]),
);
