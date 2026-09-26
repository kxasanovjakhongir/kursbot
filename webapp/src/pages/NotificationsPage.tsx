import { Bell, CheckCircle2, MessageCircle, Package, TriangleAlert } from "lucide-react";
import { useSession } from "../context/SessionContext";
import { usePaged } from "../hooks/usePaged";
import { fmtDateTime } from "../lib/format";
import type { AppNotification, NotificationKind } from "../lib/types";
import { Async, Button, EmptyState, Page } from "../components/ui";

const ICONS: Record<NotificationKind, { icon: typeof Bell; cls: string }> = {
  info: { icon: Bell, cls: "text-accent" },
  success: { icon: CheckCircle2, cls: "text-emerald-600 dark:text-emerald-400" },
  warning: { icon: TriangleAlert, cls: "text-amber-500" },
  order: { icon: Package, cls: "text-accent" },
  message: { icon: MessageCircle, cls: "text-accent" },
};

/** Bildirishnomalar tarixi: chek tasdiqlandi/rad etildi, kanalga qo'shildi, admin xabarlari */
export default function NotificationsPage() {
  const { t, lang } = useSession();
  const list = usePaged<AppNotification>("notifications", "/notifications");

  return (
    <Page title={t("notifications_title")}>
      <Async state={list}>
        {(items) =>
          items.length === 0 ? (
            <EmptyState icon={<Bell className="h-10 w-10" />} title={t("notifications_empty")} />
          ) : (
            <>
              <ul className="space-y-2.5">
                {items.map((n) => {
                  const { icon: Icon, cls } = ICONS[n.kind];
                  return (
                    <li key={n.id} className="flex gap-3 rounded-2xl bg-section p-3.5">
                      <Icon className={`mt-0.5 h-5 w-5 shrink-0 ${cls}`} />
                      <div className="min-w-0">
                        <p className="whitespace-pre-line text-[15px] leading-snug">{n.text}</p>
                        <p className="mt-1 text-[12px] text-hint">{fmtDateTime(n.createdAt, lang)}</p>
                      </div>
                    </li>
                  );
                })}
              </ul>
              {list.hasMore && (
                <Button variant="secondary" block className="mt-3" loading={list.loadingMore} onClick={list.loadMore}>
                  {t("load_more")}
                </Button>
              )}
            </>
          )
        }
      </Async>
    </Page>
  );
}
