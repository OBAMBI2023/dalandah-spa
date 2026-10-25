import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { fr } from "date-fns/locale";
import { addDays, format, parseISO } from "date-fns";
import { Check, CalendarPlus, User, Calendar as CalIcon, Clock, Timer, Wallet } from "lucide-react";
import { Calendar } from "@/components/ui/calendar";
import { settings } from "@/data/settings";
import { formatFCFA, isValidPhone } from "@/lib/format";
import { abidjanToday, endTime, longDate, useProfile, type Booking } from "@/lib/bookings";
import { api } from "@/lib/api";
import { useCatalogue } from "@/lib/catalogue";
import { trackPromotion } from "@/lib/promotion-tracking";
import { AppBar, Screen, Stepper, Img } from "@/components/app";

const iso = (d: Date) => format(d, "yyyy-MM-dd");

function calendarFile(b: Booking) {
  const stamp = (date: string, t: string) => `${date.replaceAll("-", "")}T${t.replace(":", "")}00`;
  const ics = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Dalanda Beauty Spa//FR", "BEGIN:VEVENT",
    `UID:${b.ref}@dalanda`, `DTSTAMP:${stamp(abidjanToday(), "00:00")}`,
    `DTSTART:${stamp(b.date, b.slot)}`, `DTEND:${stamp(b.date, b.ends ?? endTime(b.slot, b.duration))}`,
    `SUMMARY:${b.serviceName} - Dalanda Beauty Spa`, `LOCATION:${settings.address}`, `DESCRIPTION:Référence ${b.ref}`,
    "END:VEVENT", "END:VCALENDAR",
  ].join("\r\n");
  return URL.createObjectURL(new Blob([ics], { type: "text/calendar" }));
}

/**
 * `promotionId` : promotion d'où vient le visiteur (?promo=). Elle reste valable pendant toutes les étapes (l'état du parcours est interne) et sert
 * uniquement au suivi : « réservation démarrée » à l'arrivée, puis rattachement de la réservation une fois créée. Aucun effet sur le prix.
 */
export function MobileBooking({ initialService, promotionId }: { initialService?: string | undefined; promotionId?: string | undefined }) {
  const profile = useProfile();
  useEffect(() => { if (promotionId) void trackPromotion("booking_started", promotionId); }, [promotionId]);
  const catalogue = useCatalogue();
  const { services, rules } = catalogue;
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [serviceId, setServiceId] = useState(initialService ?? "");
  const [date, setDate] = useState<Date | undefined>();
  const [slot, setSlot] = useState("");
  const [name, setName] = useState(profile.name);
  const [phone, setPhone] = useState(profile.phone);
  const [comment, setComment] = useState("");
  const [tried, setTried] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<Booking | null>(null);
  const busy = useRef(false);  // verrou synchrone : deux clics avant le re-rendu ne doivent envoyer qu'une demande

  const service = services.find((s) => s.id === serviceId);
  const dateIso = date ? iso(date) : "";
  const nameOk = name.trim().length >= 2, phoneOk = isValidPhone(phone);
  // « Aujourd'hui » est la date d'Abidjan, pas celle de l'appareil.
  const today = parseISO(abidjanToday());
  const lastDay = addDays(today, rules.maxDaysAhead);

  const availability = useQuery({
    queryKey: ["availability", dateIso, service?.id],
    queryFn: () => api.getAvailability(dateIso, service!),
    enabled: step === 3 && !!service && !!dateIso,
    staleTime: 0,
    gcTime: 0,
    retry: 1,
  });
  const slots = availability.data ?? [];
  const anyFree = slots.some((s) => s.available);

  if (done) {
    const rows: [typeof User, string, string][] = [
      [User, "Soin", done.serviceName], [CalIcon, "Date", longDate(done.date)], [Clock, "Heure", done.slot],
      [Timer, "Durée", done.duration], [Wallet, "Prix", formatFCFA(done.price)],
    ];
    return (
      <Screen>
        <AppBar title="Confirmation" back={false} />
        <div className="px-4">
          <div className="rounded-2xl border bg-card p-5 shadow-soft">
            <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-deep text-deep-foreground"><Check className="h-7 w-7" /></div>
            <h2 className="mt-3 text-center text-2xl text-deep">Votre réservation est confirmée !</h2>
            {!api.remote && <p role="status" className="mt-2 rounded-lg bg-secondary p-2 text-center text-xs">Mode local : cette réservation n'est enregistrée que sur cet appareil.</p>}
            <p className="mt-2 text-center text-xs text-muted-foreground">Référence <b className="text-deep">{done.ref}</b> · conservez-la pour consulter ou annuler</p>
            <dl className="mt-4 divide-y text-sm">
              {rows.map(([Icon, k, v]) => (
                <div key={k} className="flex items-center gap-3 py-2.5"><Icon className="h-4 w-4 text-gold-deep" /><dt className="w-14 text-muted-foreground">{k}</dt><dd className="ml-auto text-right">{v}</dd></div>
              ))}
            </dl>
          </div>
          <a href={calendarFile(done)} download={`rdv-${done.ref}.ics`} className="btn btn-app mt-5 w-full"><CalendarPlus className="h-4 w-4" />Ajouter à mon calendrier</a>
          <Link to="/rendez-vous" className="btn btn-app-outline mt-3 w-full">Voir mes rendez-vous</Link>
        </div>
      </Screen>
    );
  }

  const next = () => {
    setTried(true);
    if (step === 1 && (!service || !catalogue.loaded)) return;
    if (step === 2 && !date) return;
    if (step === 3 && (!slot || !nameOk || !phoneOk)) return;
    setTried(false);
    setError("");
    setStep((step + 1) as 2 | 3 | 4);
  };

  const confirm = async () => {
    if (!service || !date || !slot || busy.current) return;  // empêche la double soumission
    busy.current = true;
    setSubmitting(true);
    setError("");
    const r = await api.createBooking({ service, date: dateIso, slot, name, phone, comment, promotionId });
    setSubmitting(false);
    if (r.ok) { setDone(r.booking); return; }  // le verrou reste posé : la réservation ne repart pas
    busy.current = false;
    setError(r.error);
    if (["slot_unavailable", "too_early", "too_far", "invalid_input"].includes(r.code)) {
      setSlot("");
      setStep(3);
      void availability.refetch();
    }
  };

  const err = (cond: boolean, msg: string) => tried && cond ? <p role="alert" className="mt-1 text-xs text-destructive">{msg}</p> : null;

  return (
    <Screen>
      <AppBar title="Réservation" back={step === 1} />
      <Stepper step={step} />
      <div className="px-4 pt-5">
        {step > 1 && <button onClick={() => { setTried(false); setError(""); setStep((step - 1) as 1 | 2 | 3); }} className="mb-3 text-xs text-gold-deep underline">← Étape précédente</button>}

        {catalogue.isError && (
          <div role="alert" className="mb-4 rounded-lg bg-destructive/10 p-3 text-xs text-destructive">
            Impossible de charger les tarifs en ligne. <button className="underline" onClick={catalogue.refetch}>Réessayer</button>
          </div>
        )}

        {step === 1 && (
          <>
            <h2 className="text-lg text-deep">Choisissez un soin</h2>
            <ul className="mt-3 space-y-3" role="radiogroup" aria-label="Soin">
              {services.map((s) => (
                <li key={s.id}>
                  <button role="radio" aria-checked={serviceId === s.id} onClick={() => setServiceId(s.id)}
                    className={`flex w-full items-center gap-3 rounded-2xl border bg-card p-2.5 text-left shadow-soft ${serviceId === s.id ? "border-gold-deep ring-1 ring-gold-deep" : ""}`}>
                    <Img src={s.image} alt="" sizes="96px" className="h-14 w-14 rounded-xl object-cover" />
                    <span className="flex-1"><span className="block text-sm font-semibold text-deep">{s.name}</span><span className="text-xs text-muted-foreground">{s.duration} · {formatFCFA(s.price)}</span></span>
                    {serviceId === s.id && <Check className="mr-1 h-5 w-5 text-gold-deep" />}
                  </button>
                </li>
              ))}
            </ul>
            {err(!service, "Choisissez un soin pour continuer.")}
            {tried && service && !catalogue.loaded && !catalogue.isError && <p role="status" className="mt-1 text-xs text-muted-foreground">Chargement des tarifs…</p>}
          </>
        )}

        {step === 2 && (
          <>
            <h2 className="text-lg text-deep">Choisissez la date</h2>
            <div className="mt-3 flex justify-center rounded-2xl border bg-card p-2 shadow-soft">
              <Calendar mode="single" locale={fr} weekStartsOn={1} selected={date} onSelect={setDate}
                disabled={{ before: today, after: lastDay }} defaultMonth={date ?? today} className="[--cell-size:2.4rem]" />
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">Réservation possible au moins {rules.minNoticeHours} h à l'avance, jusqu'à {rules.maxDaysAhead} jours.</p>
            {err(!date, "Choisissez une date pour continuer.")}
          </>
        )}

        {step === 3 && (
          <>
            <h2 className="text-lg text-deep">Choisissez l'heure</h2>
            {error && <p role="alert" className="mt-2 rounded-lg bg-destructive/10 p-2 text-xs text-destructive">{error}</p>}
            {availability.isLoading && <p role="status" className="mt-3 text-sm text-muted-foreground">Chargement des créneaux…</p>}
            {availability.isError && (
              <p role="alert" className="mt-3 text-sm text-destructive">Créneaux indisponibles pour le moment. <button className="underline" onClick={() => void availability.refetch()}>Réessayer</button></p>
            )}
            {availability.isSuccess && !anyFree && <p role="status" className="mt-3 text-sm text-muted-foreground">Aucun créneau disponible ce jour-là. Choisissez une autre date.</p>}
            <div className="mt-3 grid grid-cols-3 gap-2">
              {slots.map(({ slot: t, available }) => (
                <button key={t} disabled={!available} aria-pressed={slot === t} onClick={() => { setSlot(t); setError(""); }}
                  className={`rounded-full border py-2.5 text-sm ${slot === t ? "border-deep bg-deep text-deep-foreground" : "bg-card"} ${!available ? "cursor-not-allowed text-muted-foreground line-through opacity-50" : ""}`}>{t}</button>
              ))}
            </div>
            {err(!slot, "Choisissez un créneau.")}
            <div className="mt-5 space-y-3">
              <label className="block text-sm font-medium">Votre nom<input className="field mt-1" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />{err(!nameOk, "Indiquez votre nom.")}</label>
              <label className="block text-sm font-medium">Téléphone<input className="field mt-1" type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" placeholder="07 00 00 00 00" />{err(!phoneOk, "Numéro de téléphone invalide.")}</label>
              <label className="block text-sm font-medium">Commentaire (facultatif)<textarea className="field mt-1 min-h-20" maxLength={500} value={comment} onChange={(e) => setComment(e.target.value)} /></label>
            </div>
          </>
        )}

        {step === 4 && service && date && (
          <>
            <h2 className="text-lg text-deep">Vérifiez votre réservation</h2>
            {error && <p role="alert" className="mt-2 rounded-lg bg-destructive/10 p-2 text-xs text-destructive">{error}</p>}
            <dl className="mt-3 divide-y rounded-2xl border bg-card px-4 text-sm shadow-soft">
              {[["Soin", service.name], ["Date", longDate(dateIso)], ["Heure", slot], ["Durée", service.duration], ["Prix", formatFCFA(service.price)], ["Nom", name], ["Téléphone", phone]].map(([k, v]) => (
                <div key={k} className="flex justify-between gap-4 py-2.5"><dt className="text-muted-foreground">{k}</dt><dd className="text-right">{v}</dd></div>
              ))}
            </dl>
            <p className="mt-3 text-[11px] text-muted-foreground">Tarif et durée indicatifs, à confirmer par l'établissement.</p>
          </>
        )}

        <button onClick={step === 4 ? confirm : next} disabled={submitting || (step === 4 && !catalogue.loaded)} className="btn btn-app mt-6 w-full">
          {submitting ? "Enregistrement…" : step === 4 ? "Confirmer la réservation" : "Continuer"}
        </button>
      </div>
    </Screen>
  );
}
