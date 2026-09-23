import { useEffect, useState } from "react";
import { FileText } from "lucide-react";
import { api, errorMessage } from "../lib/api";
import { Spinner } from "./ui";

/** Chek fayli JWT bilan yuklanadi (img src sarlavha yubora olmaydi) */
export function ReceiptFile({ orderId, receiptId, type, className = "max-h-[480px]" }: { orderId: string; receiptId: string; type: string; className?: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    api
      .get<Blob>(`/orders/${orderId}/receipts/${receiptId}/file`, { responseType: "blob" })
      .then((r) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(r.data);
        setUrl(objectUrl);
      })
      .catch((e: unknown) => !cancelled && setError(errorMessage(e)));
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [orderId, receiptId]);

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!url) return <Spinner label="Chek yuklanmoqda…" />;
  if (type === "pdf")
    return (
      <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 text-sm text-blue-600 hover:underline">
        <FileText className="h-4 w-4" /> PDF chekni ochish
      </a>
    );
  return (
    <a href={url} target="_blank" rel="noreferrer" title="To'liq o'lchamda ochish">
      <img src={url} alt="To'lov cheki" className={`w-full rounded-lg border border-gray-200 bg-gray-50 object-contain ${className}`} />
    </a>
  );
}
