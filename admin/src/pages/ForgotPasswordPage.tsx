import { useEffect, useRef, useState, type ClipboardEvent, type FormEvent, type KeyboardEvent } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { AxiosError } from "axios";
import { ArrowLeft, KeyRound, Mail } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { api, errorMessage } from "../lib/api";
import { Button, Field, Input } from "../components/ui";

const CODE_LENGTH = 6;
const RESEND_SECONDS = 60;

/** Serverdan qolgan urinishlar soni (400 OTP_INVALID → details.remainingAttempts) */
function remainingAttempts(err: unknown): number | null {
  if (!(err instanceof AxiosError)) return null;
  const details: unknown = (err.response?.data as { details?: unknown } | undefined)?.details;
  if (typeof details === "object" && details !== null && "remainingAttempts" in details && typeof details.remainingAttempts === "number") {
    return details.remainingAttempts;
  }
  return null;
}

/** 6 xonali kod: har bir raqam alohida katakda, nusxa qo'yish (paste) va Backspace bilan qulay */
function CodeInput({ value, onChange, disabled }: { value: string; onChange: (v: string) => void; disabled: boolean }) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const digits = Array.from({ length: CODE_LENGTH }, (_, i) => value[i] ?? "");

  const setAt = (i: number, d: string) => {
    const next = digits.slice();
    next[i] = d;
    onChange(next.join("").slice(0, CODE_LENGTH));
  };

  const onKeyDown = (i: number, e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace" && !digits[i] && i > 0) {
      e.preventDefault();
      setAt(i - 1, "");
      refs.current[i - 1]?.focus();
    } else if (e.key === "ArrowLeft" && i > 0) refs.current[i - 1]?.focus();
    else if (e.key === "ArrowRight" && i < CODE_LENGTH - 1) refs.current[i + 1]?.focus();
  };

  const onPaste = (e: ClipboardEvent<HTMLInputElement>) => {
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, CODE_LENGTH);
    if (!pasted) return;
    e.preventDefault();
    onChange(pasted);
    refs.current[Math.min(pasted.length, CODE_LENGTH - 1)]?.focus();
  };

  return (
    <div className="flex justify-between gap-2" onPaste={onPaste}>
      {digits.map((d, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          value={d}
          disabled={disabled}
          inputMode="numeric"
          autoComplete={i === 0 ? "one-time-code" : "off"}
          maxLength={1}
          aria-label={`Kodning ${i + 1}-raqami`}
          autoFocus={i === 0}
          onKeyDown={(e) => onKeyDown(i, e)}
          onChange={(e) => {
            const v = e.target.value.replace(/\D/g, "");
            if (v.length > 1) {
              // Telefon klaviaturasi butun kodni bitta katakka qo'yishi mumkin
              onChange(v.slice(0, CODE_LENGTH));
              refs.current[Math.min(v.length, CODE_LENGTH - 1)]?.focus();
              return;
            }
            setAt(i, v);
            if (v && i < CODE_LENGTH - 1) refs.current[i + 1]?.focus();
          }}
          className="h-12 w-11 rounded-lg border border-gray-300 text-center text-xl font-semibold text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30 disabled:bg-gray-100"
        />
      ))}
    </div>
  );
}

/** "Parolni unutdim": 1) email → kod yuboriladi, 2) 6 xonali kod → kirish, keyin yangi parol o'rnatish */
export default function ForgotPasswordPage() {
  const { user, loginWithOtp } = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [info, setInfo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attemptsLeft, setAttemptsLeft] = useState<number | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  if (user) return <Navigate to={user.mustChangePassword ? "/profile" : "/"} replace />;

  const requestCode = async () => {
    setError(null);
    setLoading(true);
    try {
      const r = await api.post<{ message: string; resendAfterSeconds: number }>("/auth/forgot-password", { email });
      setInfo(r.data.message);
      setStep("code");
      setCode("");
      setAttemptsLeft(null);
      setCooldown(r.data.resendAfterSeconds ?? RESEND_SECONDS);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const verify = async (e: FormEvent) => {
    e.preventDefault();
    if (code.length !== CODE_LENGTH) return setError("Kodning 6 ta raqamini kiriting");
    setError(null);
    setLoading(true);
    try {
      await loginWithOtp(email, code);
      navigate("/profile", { replace: true });
    } catch (err) {
      setError(errorMessage(err));
      setAttemptsLeft(remainingAttempts(err));
      setCode("");
    } finally {
      setLoading(false);
    }
  };

  const blocked = attemptsLeft === 0;

  return (
    <div className="flex min-h-full items-center justify-center bg-sidebar px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-600">
            <KeyRound className="h-7 w-7 text-white" />
          </div>
          <h1 className="text-xl font-semibold text-white">Parolni tiklash</h1>
          <p className="text-sm text-blue-100/70">
            {step === "email" ? "Emailingizga 6 xonali tasdiqlash kodi yuboramiz" : "Emailga kelgan 6 xonali kodni kiriting"}
          </p>
        </div>

        {step === "email" ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void requestCode();
            }}
            className="space-y-4 rounded-2xl bg-white p-6 shadow-xl"
          >
            <Field label="Email">
              <Input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
            </Field>
            {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
            <Button type="submit" className="w-full" loading={loading}>
              <Mail className="h-4 w-4" /> Kod yuborish
            </Button>
            <Link to="/login" className="flex items-center justify-center gap-1 text-sm text-gray-500 hover:text-gray-800">
              <ArrowLeft className="h-4 w-4" /> Kirish sahifasiga qaytish
            </Link>
          </form>
        ) : (
          <form onSubmit={verify} className="space-y-4 rounded-2xl bg-white p-6 shadow-xl">
            {info && (
              <p className="rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-800">
                {info}. Kod <b>10 daqiqa</b> amal qiladi.
              </p>
            )}
            <p className="text-sm text-gray-500">
              Email: <b className="text-gray-900">{email}</b>
            </p>
            <CodeInput value={code} onChange={setCode} disabled={loading || blocked} />
            {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
            {attemptsLeft !== null && attemptsLeft > 0 && <p className="text-sm text-amber-700">Qolgan urinishlar: {attemptsLeft}</p>}
            <Button type="submit" className="w-full" loading={loading} disabled={blocked || code.length !== CODE_LENGTH}>
              Tasdiqlash va kirish
            </Button>
            <div className="flex items-center justify-between text-sm">
              <button
                type="button"
                onClick={() => {
                  setStep("email");
                  setError(null);
                }}
                className="text-gray-500 hover:text-gray-800"
              >
                Emailni o'zgartirish
              </button>
              <button type="button" disabled={cooldown > 0 || loading} onClick={() => void requestCode()} className="font-medium text-blue-600 hover:text-blue-800 disabled:text-gray-400">
                {cooldown > 0 ? `Qayta yuborish (${cooldown} s)` : "Kodni qayta yuborish"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
