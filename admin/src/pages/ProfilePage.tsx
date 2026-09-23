import { useState, type FormEvent } from "react";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { api, errorMessage } from "../lib/api";
import { fmtDateTime } from "../lib/format";
import type { PanelUser } from "../lib/types";
import { Badge, Button, Card, CardHeader, Field, Input, PageHeader } from "../components/ui";

export default function ProfilePage() {
  const { user, setUser } = useAuth();
  const toast = useToast();
  const [name, setName] = useState(user?.name ?? "");
  const [savingName, setSavingName] = useState(false);
  const [pw, setPw] = useState({ currentPassword: "", newPassword: "", confirm: "" });
  const [savingPw, setSavingPw] = useState(false);

  if (!user) return null;

  const saveName = async (e: FormEvent) => {
    e.preventDefault();
    setSavingName(true);
    try {
      const r = await api.put<{ user: PanelUser }>("/auth/profile", { name });
      setUser(r.data.user);
      toast.success("Profil yangilandi");
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSavingName(false);
    }
  };

  const savePw = async (e: FormEvent) => {
    e.preventDefault();
    if (pw.newPassword !== pw.confirm) return toast.error("Yangi parollar mos emas");
    setSavingPw(true);
    try {
      await api.put("/auth/password", { currentPassword: pw.currentPassword, newPassword: pw.newPassword });
      setPw({ currentPassword: "", newPassword: "", confirm: "" });
      toast.success("Parol o'zgartirildi");
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSavingPw(false);
    }
  };

  return (
    <>
      <PageHeader title="Profil" />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Ma'lumotlar" />
          <form onSubmit={saveName} className="space-y-4 p-5">
            <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
              <span className="text-gray-500">
                Email: <b className="text-gray-900">{user.email}</b>
              </span>
              <Badge tone={user.role === "superadmin" ? "blue" : "gray"}>{user.role === "superadmin" ? "Super Admin" : "Admin"}</Badge>
            </div>
            <p className="text-sm text-gray-500">Oxirgi kirish: {fmtDateTime(user.lastLoginAt)}</p>
            <Field label="Ism">
              <Input value={name} onChange={(e) => setName(e.target.value)} minLength={2} maxLength={100} required />
            </Field>
            <Button type="submit" loading={savingName}>
              Saqlash
            </Button>
          </form>
        </Card>
        <Card>
          <CardHeader title="Parolni o'zgartirish" />
          <form onSubmit={savePw} className="space-y-4 p-5">
            <Field label="Joriy parol">
              <Input type="password" autoComplete="current-password" required value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} />
            </Field>
            <Field label="Yangi parol" hint="Kamida 8 belgi">
              <Input type="password" autoComplete="new-password" minLength={8} required value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} />
            </Field>
            <Field label="Yangi parolni takrorlang">
              <Input type="password" autoComplete="new-password" minLength={8} required value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} />
            </Field>
            <Button type="submit" loading={savingPw}>
              Parolni o'zgartirish
            </Button>
          </form>
        </Card>
      </div>
    </>
  );
}
