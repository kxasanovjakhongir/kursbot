import { useNavigate, useParams } from "react-router-dom";
import { PlayCircle } from "lucide-react";
import { useSession } from "../context/SessionContext";
import { useToast } from "../context/ToastContext";
import { useAction } from "../hooks/useAction";
import { useBackButton } from "../hooks/useBackButton";
import { invalidate, useQuery } from "../hooks/useQuery";
import { errorText } from "../i18n";
import { api, ApiError } from "../lib/api";
import { fmtDate } from "../lib/format";
import type { Product } from "../lib/types";
import { Money } from "../components/Money";
import { PhoneCard } from "../components/PhoneCard";
import { Async, Badge, Button, Page, Row, Section, Skeleton } from "../components/ui";

interface ProductResponse {
  product: Product;
  openOrderId: string | null;
}

/** Darslik: tavsif, narx, video; asosiy amal — olish / to'lovni davom ettirish / darsliklarimga o'tish */
function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-secondary px-2 py-2.5">
      <dt className="text-[12px] text-hint">{label}</dt>
      <dd className="mt-0.5 truncate text-[15px] font-semibold">{value}</dd>
    </div>
  );
}

export default function ProductPage() {
  useBackButton("/");
  const { code = "" } = useParams();
  const { t, me, lang } = useSession();
  const toast = useToast();
  const navigate = useNavigate();
  const state = useQuery(`product:${code}`, () => api.get<ProductResponse>(`/products/${encodeURIComponent(code)}`));

  const [buy, buying] = useAction(async () => {
    try {
      const res = await api.post<{ id: string }>("/orders", { productCode: code });
      invalidate("orders");
      navigate(`/orders/${res.id}`);
    } catch (err) {
      toast.error(errorText(t, err));
      if (err instanceof ApiError && err.code === "already_owned") state.reload();
    }
  });

  const [sendVideo, sendingVideo] = useAction(async () => {
    try {
      await api.post(`/products/${encodeURIComponent(code)}/video`);
      toast.success(t("product_video_sent"));
    } catch (err) {
      toast.error(errorText(t, err));
    }
  });

  const skeleton = (
    <div className="rounded-2xl bg-section p-4">
      <Skeleton className="h-6 w-2/3" />
      <Skeleton className="mt-4 h-3 w-full" />
      <Skeleton className="mt-2 h-3 w-5/6" />
      <Skeleton className="mt-6 h-11 w-full rounded-xl" />
    </div>
  );

  return (
    <Page>
      <Async state={state} skeleton={skeleton}>
        {({ product, openOrderId }) => (
          <>
            <article className="mb-5 rounded-2xl bg-section p-4">
              <div className="flex items-start justify-between gap-3">
                <h1 className="text-[22px] font-bold leading-tight">{product.title}</h1>
                {product.type === "bundle" && <Badge tone="blue">{t("bundle")}</Badge>}
              </div>
              {product.price > 0 && (
                <p className="mt-2 flex items-baseline gap-2">
                  <Money amount={product.price} className="text-[22px] font-bold text-accent" />
                  {product.oldPrice && <Money amount={product.oldPrice} className="text-hint line-through" />}
                </p>
              )}
              {product.description && <p className="mt-3 whitespace-pre-line text-[15px] leading-relaxed">{product.description}</p>}
              {(product.duration || product.lessonsCount || product.startDate) && (
                <dl className="mt-4 grid grid-cols-3 gap-2 text-center">
                  {product.duration && <Fact label={t("course_duration")} value={product.duration} />}
                  {product.lessonsCount && <Fact label={t("course_lessons")} value={String(product.lessonsCount)} />}
                  {product.startDate && <Fact label={t("course_start")} value={fmtDate(product.startDate, lang)} />}
                </dl>
              )}
            </article>

            {/* Kurs bo'limlari: faqat to'ldirilganlari */}
            {(
              [
                ["course_audience", product.audience],
                ["course_benefits", product.benefits],
                ["course_program", product.program],
                ["course_teacher", product.teacher],
              ] as const
            ).map(([key, value]) =>
              value ? (
                <Section key={key} title={t(key)}>
                  <p className="whitespace-pre-line p-4 text-[15px] leading-relaxed">{value}</p>
                </Section>
              ) : null,
            )}

            {product.hasVideo && (
              <Section footer={t("product_video_hint")}>
                <Row icon={<PlayCircle className="h-6 w-6 text-accent" />} title={sendingVideo ? t("loading") : t("product_video")} onClick={sendVideo} />
              </Section>
            )}

            {product.ownership === "owned" ? (
              <>
                <p className="mb-3 text-center text-[15px]">{t("product_owned_text")}</p>
                <Button block onClick={() => navigate("/orders")}>
                  {t("product_owned_btn")}
                </Button>
              </>
            ) : openOrderId ? (
              <Button block onClick={() => navigate(`/orders/${openOrderId}`)}>
                {t("product_continue")}
              </Button>
            ) : !me().user.phone ? (
              <PhoneCard />
            ) : (
              <Button block loading={buying} onClick={buy}>
                {t("product_buy")}
              </Button>
            )}
            {/* Linkdan kelgan foydalanuvchi ham umumiy katalogga bir bosishda o'ta oladi */}
            <Button block variant="plain" className="mt-2" onClick={() => navigate("/")}>
              {t("all_products")}
            </Button>
          </>
        )}
      </Async>
    </Page>
  );
}
