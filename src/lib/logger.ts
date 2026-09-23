import pino from "pino";

// Telefon va karta raqamlari loglarda niqoblanadi (TZ 11.4)
export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: {
    paths: ["phone", "*.phone", "number", "*.number", "card.number"],
    censor: "***",
  },
});
