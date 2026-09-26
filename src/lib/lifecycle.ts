import { config } from "../config";
import { logger } from "./logger";

type State = "starting" | "ready" | "stopping";
type ShutdownHandler = () => Promise<void>;

/**
 * Jarayon holati va graceful shutdown.
 * - /ready faqat "ready" holatida 200 qaytaradi (load balancer to'xtayotgan instansga trafik yubormaydi)
 * - SIGTERM/SIGINT: handlerlar ketma-ket bajariladi, SHUTDOWN_TIMEOUT_MS dan oshsa majburan chiqiladi
 */
class Lifecycle {
  private state: State = "starting";
  private handlers: ShutdownHandler[] = [];
  private shuttingDown: Promise<void> | null = null;

  get isReady(): boolean {
    return this.state === "ready";
  }

  get isStopping(): boolean {
    return this.state === "stopping";
  }

  markReady(): void {
    if (this.state === "starting") this.state = "ready";
  }

  onShutdown(handler: ShutdownHandler): void {
    this.handlers.push(handler);
  }

  shutdown(reason: string, exitCode = 0): Promise<void> {
    this.shuttingDown ??= this.run(reason, exitCode);
    return this.shuttingDown;
  }

  private async run(reason: string, exitCode: number): Promise<void> {
    this.state = "stopping";
    logger.info({ reason }, "to'xtatilmoqda (graceful shutdown)");
    const force = setTimeout(() => {
      logger.error({ timeoutMs: config.SHUTDOWN_TIMEOUT_MS }, "to'xtatish vaqti tugadi — majburan chiqilmoqda");
      process.exit(exitCode || 1);
    }, config.SHUTDOWN_TIMEOUT_MS);
    force.unref();

    for (const handler of this.handlers) {
      try {
        await handler();
      } catch (err) {
        logger.error({ err }, "to'xtatishda xato");
      }
    }
    logger.info("to'xtatildi");
    process.exit(exitCode);
  }

  installProcessHandlers(): void {
    process.once("SIGTERM", () => void this.shutdown("SIGTERM"));
    process.once("SIGINT", () => void this.shutdown("SIGINT"));
    // Kutilmagan xato: holat noma'lum — log, toza to'xtatish, orkestrator (Docker/PM2) qayta ishga tushiradi
    process.on("uncaughtException", (err) => {
      logger.fatal({ err }, "uncaughtException");
      void this.shutdown("uncaughtException", 1);
    });
    // Ushlanmagan promise: loglanadi, jarayon ishlashda davom etadi (bitta xato butun botni to'xtatmaydi)
    process.on("unhandledRejection", (reason) => {
      logger.error({ err: reason }, "unhandledRejection");
    });
  }
}

export const lifecycle = new Lifecycle();
