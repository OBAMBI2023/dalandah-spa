import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { User } from "lucide-react";
import { toast } from "sonner";
import { isValidPhone } from "@/lib/format";
import { saveProfile, useProfile } from "@/lib/bookings";
import { AppBar, Screen } from "@/components/app";

export const Route = createFileRoute("/profil")({
  head: () => ({ meta: [{ title: "Mon profil | Dalanda Beauty Spa" }] }),
  component: Profil,
});

function Profil() {
  const profile = useProfile();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [tried, setTried] = useState(false);
  useEffect(() => { setName(profile.name); setPhone(profile.phone); setEmail(profile.email); }, [profile]);

  const errors = {
    name: name.trim().length < 2 && "Indiquez votre nom.",
    phone: phone.trim() !== "" && !isValidPhone(phone) && "Numéro de téléphone invalide.",
    email: email.trim() !== "" && !/^\S+@\S+\.\S+$/.test(email) && "Adresse e-mail invalide.",
  };
  const submit = () => {
    setTried(true);
    if (Object.values(errors).some(Boolean)) return;
    saveProfile({ name: name.trim(), phone: phone.trim(), email: email.trim() });
    toast.success("Profil enregistré");
  };
  const Err = ({ k }: { k: keyof typeof errors }) => tried && errors[k] ? <p role="alert" className="mt-1 text-xs text-destructive">{errors[k]}</p> : null;

  return (
    <Screen>
      <AppBar title="Mon profil" back={false} />
      <div className="px-4">
        <div className="flex items-center gap-4 rounded-2xl border bg-card p-4 shadow-soft">
          <div className="grid h-16 w-16 place-items-center rounded-full bg-gold/25 text-gold-deep"><User className="h-8 w-8" /></div>
          <div className="min-w-0">
            <p className="truncate font-semibold text-deep">{profile.name || "Cliente"}</p>
            <p className="truncate text-xs text-muted-foreground">{profile.phone || "Téléphone non renseigné"}</p>
            <p className="truncate text-xs text-muted-foreground">{profile.email || "E-mail non renseigné"}</p>
          </div>
        </div>
        <h2 className="mt-6 text-lg text-deep">Mes informations</h2>
        <div className="mt-3 space-y-3">
          <label className="block text-sm font-medium">Nom<input className="field mt-1" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" /><Err k="name" /></label>
          <label className="block text-sm font-medium">Téléphone<input className="field mt-1" type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" /><Err k="phone" /></label>
          <label className="block text-sm font-medium">E-mail<input className="field mt-1" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" /><Err k="email" /></label>
        </div>
        <button onClick={submit} className="btn btn-app mt-5 w-full">Enregistrer</button>
        <p className="mt-3 text-[11px] text-muted-foreground">Ces informations sont conservées sur cet appareil et préremplissent vos réservations.</p>
      </div>
    </Screen>
  );
}
