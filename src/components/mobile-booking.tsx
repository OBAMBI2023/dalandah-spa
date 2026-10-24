import { Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { fr } from "date-fns/locale";
import { format } from "date-fns";
import { Check, CalendarPlus, User, Calendar as CalIcon, Clock, Timer, Wallet } from "lucide-react";
import { Calendar } from "@/components/ui/calendar";
import { services } from "@/data/services";
import { settings } from "@/data/settings";
import { formatFCFA, isValidPhone } from "@/lib/format";
import { bookedSlots, createBooking, endTime, longDate, useBookings, useProfile, type Booking } from "@/lib/bookings";
import { AppBar, Screen, Stepper, Img } from "@/components/app";

const iso = (d: Date) => format(d, "yyyy-MM-dd");

function calendarFile(b: Booking) {
  const stamp = (date: string, t: string) => `${date.replaceAll("-", "")}T${t.replace(":", "")}00`;
  const ics = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Dalanda Beauty Spa//FR", "BEGIN:VEVENT",
    `UID:${b.ref}@dalanda`, `DTSTAMP:${stamp(iso(new Date()), "00:00")}`,
    `DTSTART:${stamp(b.date, b.slot)}`, `DTEND:${stamp(b.date, endTime(b.slot, b.duration))}`,
    `SUMMARY:${b.serviceName} - Dalanda Beauty Spa`, `LOCATION:${settings.address}`, `DESCRIPTION:Référence ${b.ref}`,
    "END:VEVENT", "END:VCALENDAR",
  ].join("\r\n");
  return URL.createObjectURL(new Blob([ics], { type: "text/calendar" }));
}

export function MobileBooking({ initialService }: { initialService?: string | undefined }) {
  const bookings = useBookings();
  const profile = useProfile();
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [serviceId, setServiceId] = useState(services.some((s) => s.id === initialService) ? initialService! : "");
  const [date, setDate] = useState<Date | undefined>();
  const [slot, setSlot] = useState("");
  const [name, setName] = useState(profile.name);
  const [phone, setPhone] = useState(profile.phone);
  const [comment, setComment] = useState("");
  const [tried, setTried] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<Booking | null>(null);

  const service = services.find((s) => s.id === serviceId);
  const dateIso = date ? iso(date) : "";
  const taken = useMemo(() => (dateIso ? bookedSlots(bookings, dateIso) : []), [bookings, dateIso]);
  const nameOk = name.trim().length >= 2, phoneOk = isValidPhone(phone);
  const today = new Date(new Date().setHours(0, 0, 0, 0));

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
            <h2 className="mt-3 text-center text-2xl text-deep">Votre rendez-vous est enregistré !</h2>
            <p className="mt-1 text-center text-xs text-muted-foreground">Référence <b className="text-deep">{done.ref}</b> · à confirmer par l'établissement</p>
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
    if (step === 1 && !service) return;
    if (step === 2 && !date) return;
    if (step === 3 && (!slot || !nameOk || !phoneOk)) return;
    setTried(false);
    setStep((step + 1) as 2 | 3 | 4);
  };

  const confirm = () => {
    if (!service || !date || !slot) return;
    const r = createBooking({ serviceId: service.id, serviceName: service.name, duration: service.duration, price: service.price, date: dateIso, slot, name: name.trim(), phone: phone.trim(), comment: comment.trim() });
    if (!r.ok) { setError(r.error); setSlot(""); setStep(3); return; }
    setDone(r.booking);
  };

  const err = (cond: boolean, msg: string) => tried && cond ? <p role="alert" className="mt-1 text-xs text-destructive">{msg}</p> : null;

  return (
    <Screen>
      <AppBar title="Réservation" back={step === 1} />
      <Stepper step={step} />
      <div className="px-4 pt-5">
        {step > 1 && <button onClick={() => { setTried(false); setStep((step - 1) as 1 | 2 | 3); }} className="mb-3 text-xs text-gold-deep underline">← Étape précédente</button>}

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
          </>
        )}

        {step === 2 && (
          <>
            <h2 className="text-lg text-deep">Choisissez la date</h2>
            <div className="mt-3 flex justify-center rounded-2xl border bg-card p-2 shadow-soft">
              <Calendar mode="single" locale={fr} weekStartsOn={1} selected={date} onSelect={setDate} disabled={{ before: today }} defaultMonth={date ?? today} className="[--cell-size:2.4rem]" />
            </div>
            {err(!date, "Choisissez une date pour continuer.")}
          </>
        )}

        {step === 3 && (
          <>
            <h2 className="text-lg text-deep">Choisissez l'heure</h2>
            {error && <p role="alert" className="mt-2 rounded-lg bg-destructive/10 p-2 text-xs text-destructive">{error}</p>}
            <div className="mt-3 grid grid-cols-3 gap-2">
              {settings.timeSlots.map((t) => {
                const off = taken.includes(t);
                return (
                  <button key={t} disabled={off} aria-pressed={slot === t} onClick={() => { setSlot(t); setError(""); }}
                    className={`rounded-full border py-2.5 text-sm ${slot === t ? "border-deep bg-deep text-deep-foreground" : "bg-card"} ${off ? "cursor-not-allowed text-muted-foreground line-through opacity-50" : ""}`}>{t}</button>
                );
              })}
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
            <dl className="mt-3 divide-y rounded-2xl border bg-card px-4 text-sm shadow-soft">
              {[["Soin", service.name], ["Date", longDate(dateIso)], ["Heure", slot], ["Durée", service.duration], ["Prix", formatFCFA(service.price)], ["Nom", name], ["Téléphone", phone]].map(([k, v]) => (
                <div key={k} className="flex justify-between gap-4 py-2.5"><dt className="text-muted-foreground">{k}</dt><dd className="text-right">{v}</dd></div>
              ))}
            </dl>
            <p className="mt-3 text-[11px] text-muted-foreground">Tarif et durée indicatifs. Votre rendez-vous sera confirmé par l'établissement.</p>
          </>
        )}

        <button onClick={step === 4 ? confirm : next} className="btn btn-app mt-6 w-full">{step === 4 ? "Confirmer la réservation" : "Continuer"}</button>
      </div>
    </Screen>
  );
}
