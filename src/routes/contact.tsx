import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Facebook, MapPin, Phone, MessageCircle } from "lucide-react";
import { settings } from "@/data/settings";
import { waLink } from "@/lib/format";
import { PageTitle } from "@/components/layout";

export const Route = createFileRoute("/contact")({
  head: () => ({
    meta: [
      { title: "Contact | Dalanda Beauty-Spa, Abidjan Riviera" },
      { name: "description", content: "Contactez Dalanda Beauty-Spa : Rond-point Riviera, Ancien Camp Akouédo, Abidjan. WhatsApp et téléphone." },
      { property: "og:title", content: "Contacter Dalanda Beauty" },
      { property: "og:description", content: "WhatsApp, téléphone et réseaux sociaux de Dalanda Beauty." },
    ],
  }),
  component: Contact,
});

function Contact() {
  const [f, setF] = useState({ name: "", reach: "", subject: "", message: "" });
  const [tried, setTried] = useState(false);
  const valid = f.name.trim().length > 1 && f.reach.trim().length > 4 && f.message.trim().length > 4;
  const msg = `Bonjour Dalanda Beauty,\nNom : ${f.name}\nContact : ${f.reach}\nObjet : ${f.subject || "—"}\n\n${f.message}`;
  const href = valid ? waLink(msg) : null;
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });

  return (
    <>
      <PageTitle eyebrow="Contact" title="Parlons de vous" text="Votre message est préparé ici puis envoyé depuis votre WhatsApp." />
      <section className="mx-auto grid max-w-6xl gap-10 px-5 py-12 pb-28 md:grid-cols-[1fr_340px]">
        <div className="space-y-4">
          <label className="block text-sm font-medium">Nom<input className="field mt-1" value={f.name} onChange={set("name")} /></label>
          <label className="block text-sm font-medium">Téléphone ou e-mail<input className="field mt-1" value={f.reach} onChange={set("reach")} /></label>
          <label className="block text-sm font-medium">Objet<input className="field mt-1" value={f.subject} onChange={set("subject")} /></label>
          <label className="block text-sm font-medium">Message<textarea className="field mt-1 min-h-36" value={f.message} onChange={set("message")} maxLength={1000} /></label>
          {tried && !valid && <p className="text-sm text-destructive">Merci de remplir votre nom, un moyen de contact et votre message.</p>}
          {href
            ? <a href={href} target="_blank" rel="noreferrer" className="btn btn-primary">Contacter Dalanda Beauty</a>
            : <button onClick={() => setTried(true)} className="btn btn-primary">Contacter Dalanda Beauty</button>}
        </div>
        <aside className="space-y-4 rounded-2xl bg-secondary p-6 text-sm">
          <p className="flex gap-2"><MapPin className="h-4 w-4 shrink-0 text-primary" />{settings.address}</p>
          {settings.phones.map((p) => <a key={p} href={`tel:${p.replace(/\s/g, "")}`} className="flex gap-2"><Phone className="h-4 w-4 text-primary" />{p}</a>)}
          {waLink("Bonjour Dalanda Beauty") && <a href={waLink("Bonjour Dalanda Beauty")!} target="_blank" rel="noreferrer" className="flex gap-2"><MessageCircle className="h-4 w-4 text-primary" />WhatsApp</a>}
          <a href={settings.facebookBeauty} target="_blank" rel="noreferrer" className="flex gap-2"><Facebook className="h-4 w-4 text-primary" />Dalanda Beauty</a>
          <a href={settings.facebookCosmetique} target="_blank" rel="noreferrer" className="flex gap-2"><Facebook className="h-4 w-4 text-primary" />Dalanda Cosmétique</a>
        </aside>
      </section>
    </>
  );
}
