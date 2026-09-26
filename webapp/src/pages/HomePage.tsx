import { useNavigate } from "react-router-dom";
import { ArrowRight, BookOpen, CircleAlert, Sparkles } from "lucide-react";
import { useSession } from "../context/SessionContext";
import { useQuery } from "../hooks/useQuery";
import { api } from "../lib/api";
import { fmtDate } from "../lib/format";
import { Avatar } from "../components/Avatar";
import type { OrderSummary, Paged, Product } from "../lib/types";
import { Money } from "../components/Money";
import { OrderStatusBadge } from "../components/OrderStatus";
import { PhoneCard } from "../components/PhoneCard";
import { Async, Badge, EmptyState, Page, Row, Section, Skeleton } from "../components/ui";

function ProductSkeleton() {
  return (
    <div className="space-y-3">
      {[0, 1, 2].map((i) => (
        <div key={i} className="rounded-2xl bg-section p-4">
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="mt-3 h-3 w-full" />
          <Skeleton className="mt-2 h-3 w-4/5" />
          <Skeleton className="mt-4 h-5 w-1/3" />
        </div>
      ))}
    </div>
  );
}

function ProductCard({ product }: { product: Product }) {
  const { t } = useSession();
  const navigate = useNavigate();
  return (
    <button
      type="button"
      onClick={() => navigate(`/product/${product.code}`)}
      className="block w-full rounded-2xl bg-section p-4 text-left transition-opacity active:opacity-70"
    >
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-[17px] font-semibold leading-snug">{product.title}</h3>
        {product.ownership === "owned" && <Badge tone="green">{t("badge_owned")}</Badge>}
        {product.ownership === "partial" && <Badge tone="yellow">{t("badge_partial")}</Badge>}
        {product.ownership === "none" && product.type === "bundle" && <Badge tone="blue">{t("bundle")}</Badge>}
      </div>
      {product.description && <p className="mt-1.5 line-clamp-2 text-[14px] leading-snug text-hint">{product.description}</p>}
      {product.price > 0 && (
        <p className="mt-3 flex items-baseline gap-2">
          <Money amount={product.price} className="text-[17px] font-bold text-accent" />
          {product.oldPrice && <Money amount={product.oldPrice} className="text-[14px] text-hint line-through" />}
        </p>
      )}
    </button>
  );
}

/** "Siz uchun": reklama linki orqali kelgan darslik — katta, rangli karta */
function FeaturedCard({ code, title, product }: { code: string; title: string; product: Product | undefined }) {
  const { t, lang } = useSession();
  const navigate = useNavigate();
  const facts = [product?.duration, product?.lessonsCount ? `${product.lessonsCount} ${t("course_lessons").toLowerCase()}` : null, product?.startDate ? fmtDate(product.startDate, lang) : null].filter(
    (f): f is string => !!f,
  );
  return (
    <section className="mb-6 overflow-hidden rounded-3xl bg-button p-5 text-button-text shadow-lg">
      <p className="flex items-center gap-1.5 text-[13px] font-semibold uppercase tracking-wide opacity-90">
        <Sparkles className="h-4 w-4" /> {t("featured_title")}
      </p>
      <h2 className="mt-2 text-[26px] font-extrabold leading-tight">{title}</h2>
      {product?.description && <p className="mt-2 line-clamp-3 text-[15px] leading-snug opacity-90">{product.description}</p>}
      {facts.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {facts.map((f) => (
            <span key={f} className="rounded-full bg-white/20 px-2.5 py-1 text-[13px] font-medium">
              {f}
            </span>
          ))}
        </div>
      )}
      {product && product.price > 0 && (
        <p className="mt-4 flex items-baseline gap-2">
          <Money amount={product.price} className="text-[24px] font-extrabold" />
          {product.oldPrice && <Money amount={product.oldPrice} className="text-[15px] line-through opacity-70" />}
        </p>
      )}
      <button
        type="button"
        onClick={() => navigate(`/product/${encodeURIComponent(code)}`)}
        className="mt-4 flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-white text-[16px] font-bold text-[#1c1c1e] transition-opacity active:opacity-80"
      >
        {t("featured_cta")} <ArrowRight className="h-5 w-5" />
      </button>
    </section>
  );
}

/** Asosiy: salomlashuv, telefon (kerak bo'lsa), faol buyurtmalar va darsliklar katalogi */
export default function HomePage() {
  const { t, me } = useSession();
  const navigate = useNavigate();
  const products = useQuery("products", () => api.get<{ items: Product[] }>("/products").then((r) => r.items));
  const orders = useQuery("orders:active", () => api.get<Paged<OrderSummary>>("/orders?pageSize=10").then((r) => r.items));
  const active = (orders.data ?? []).filter((o) => o.canPay || o.status === "receipt_sent");
  const user = me().user;
  const featured = me().featured;

  return (
    <Page>
      <header className="mb-5 flex items-center gap-3 px-1">
        <Avatar name={user.firstName} size="md" />
        <div className="min-w-0">
          <h1 className="truncate text-[20px] font-bold">{t("hello", { name: user.firstName ?? "" })}</h1>
          <p className="text-[14px] text-hint">{t("home_subtitle")}</p>
        </div>
      </header>

      {/* Reklama linki orqali kelgan darslik — ekranning eng yuqorisida, katta va aniq */}
      {featured && <FeaturedCard code={featured.code} title={featured.title} product={(products.data ?? []).find((p) => p.code === featured.code)} />}

      {!user.phone && <PhoneCard />}

      {active.length > 0 && (
        <Section title={t("active_orders")}>
          {active.map((o) => (
            <Row
              key={o.id}
              icon={<CircleAlert className="h-5 w-5 text-accent" />}
              title={o.product.title}
              subtitle={<Money amount={o.amount} />}
              after={<OrderStatusBadge status={o.status} />}
              onClick={() => navigate(`/orders/${o.id}`)}
            />
          ))}
        </Section>
      )}

      {/* Reklama linki orqali kelgan (bot yoki ilova) — o'sha darslik birinchi */}

      <h2 className="mb-2 px-1 text-[13px] font-medium uppercase tracking-wide text-subtitle">{t("catalog_title")}</h2>
      <Async state={products} skeleton={<ProductSkeleton />}>
        {(items) =>
          items.length === 0 ? (
            <EmptyState icon={<BookOpen className="h-10 w-10" />} title={t("catalog_empty")} />
          ) : (
            <div className="space-y-3">
              {/* "Siz uchun" dagi darslik katalogda takrorlanmaydi */}
              {items
                .filter((p) => p.code !== featured?.code)
                .map((p) => (
                  <ProductCard key={p.code} product={p} />
                ))}
            </div>
          )
        }
      </Async>
    </Page>
  );
}
