import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { BookMarked, ExternalLink, Receipt } from "lucide-react";
import { useSession } from "../context/SessionContext";
import { useToast } from "../context/ToastContext";
import { useAction } from "../hooks/useAction";
import { useQuery } from "../hooks/useQuery";
import { usePaged } from "../hooks/usePaged";
import { errorText } from "../i18n";
import { api } from "../lib/api";
import { fmtDate } from "../lib/format";
import { openTelegramLink } from "../lib/telegram";
import type { OrderSummary, Purchase } from "../lib/types";
import { Money } from "../components/Money";
import { OrderStatusBadge } from "../components/OrderStatus";
import { Async, Badge, Button, EmptyState, Page, Row, Section, Segmented } from "../components/ui";

type Tab = "books" | "history";

function Books() {
  const { t, lang } = useSession();
  const toast = useToast();
  const navigate = useNavigate();
  const state = useQuery("purchases", () => api.get<{ items: Purchase[] }>("/purchases").then((r) => r.items));
  const [openingId, setOpeningId] = useState<string | null>(null);

  // Link shaxsiy va bir martalik — har safar serverdan olinadi (eskirgan bo'lsa yangisi yaratiladi)
  const [join] = useAction(async (p: Purchase) => {
    setOpeningId(p.id);
    try {
      const { url } = await api.post<{ url: string }>(`/purchases/${p.id}/link`);
      openTelegramLink(url);
    } catch (err) {
      toast.error(errorText(t, err));
    } finally {
      setOpeningId(null);
    }
  });

  return (
    <Async state={state}>
      {(items) =>
        items.length === 0 ? (
          <EmptyState
            icon={<BookMarked className="h-10 w-10" />}
            title={t("books_empty")}
            hint={t("books_empty_hint")}
            action={<Button onClick={() => navigate("/")}>{t("to_catalog")}</Button>}
          />
        ) : (
          <Section>
            {items.map((p) => (
              <Row
                key={p.id}
                icon={<BookMarked className="h-5 w-5 text-accent" />}
                title={p.product.title}
                subtitle={
                  <>
                    {p.joined ? <Badge tone="green">{t("joined")}</Badge> : <Badge tone="yellow">{t("not_joined")}</Badge>}
                    {p.expiresAt && <span className="ml-2 text-[13px]">{t("access_until", { date: fmtDate(p.expiresAt, lang) })}</span>}
                  </>
                }
                after={
                  <span className="flex items-center gap-1 text-[14px] text-accent">
                    {openingId === p.id ? t("loading") : t("join_channel")} <ExternalLink className="h-4 w-4" />
                  </span>
                }
                chevron={false}
                onClick={() => join(p)}
              />
            ))}
          </Section>
        )
      }
    </Async>
  );
}

function History() {
  const { t, lang } = useSession();
  const navigate = useNavigate();
  const list = usePaged<OrderSummary>("orders:history", "/orders");

  return (
    <Async state={list}>
      {(items) =>
        items.length === 0 ? (
          <EmptyState icon={<Receipt className="h-10 w-10" />} title={t("history_empty")} />
        ) : (
          <>
            <Section>
              {items.map((o) => (
                <Row
                  key={o.id}
                  title={o.product.title}
                  subtitle={
                    <>
                      #{o.id} · {fmtDate(o.createdAt, lang)} · <Money amount={o.amount} />
                    </>
                  }
                  after={<OrderStatusBadge status={o.status} />}
                  onClick={() => navigate(`/orders/${o.id}`)}
                />
              ))}
            </Section>
            {list.hasMore && (
              <Button variant="secondary" block loading={list.loadingMore} onClick={list.loadMore}>
                {t("load_more")}
              </Button>
            )}
          </>
        )
      }
    </Async>
  );
}

/** Xaridlar: olingan darsliklar (kanalga kirish) va buyurtmalar tarixi */
export default function OrdersPage() {
  const { t } = useSession();
  const [tab, setTab] = useState<Tab>("books");
  return (
    <Page title={t("orders_title")}>
      <Segmented
        value={tab}
        onChange={setTab}
        options={[
          { value: "books", label: t("tab_my_books") },
          { value: "history", label: t("tab_history") },
        ]}
      />
      {tab === "books" ? <Books /> : <History />}
    </Page>
  );
}
