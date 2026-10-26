import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { CalendarCheck, CalendarClock, CalendarX, Check, Copy, Eye, Inbox, ListChecks, RefreshCw, Search, SearchX } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState, ListSkeleton } from "@/components/admin-ui";
import { useIsMobile } from "@/hooks/use-mobile";
import { BOOKINGS_LIMIT, upcomingBookings, type AdminBooking } from "@/lib/admin-api";
import { useAdminBookings, viewState } from "@/lib/admin-queries";
import { formatFCFA } from "@/lib/format";

export const Route = createFileRoute("/admin/reservations")({
  head: () => ({ meta: [{ title: "Réservations | Administration Dalanda" }] }),
  component: Reservations,
});

// Seuls deux statuts existent dans la base : confirmée et annulée (type booking_status). Aucun autre statut n'est inventé ici.
const STATUS: Record<AdminBooking["status"], { label: string; pill: string }> = {
  confirmed: { label: "Confirmée", pill: "ap-pill-ok" },
  cancelled: { label: "Annulée", pill: "ap-pill-muted" },
};

// Dates : la base donne une date « AAAA-MM-JJ » et une heure « HH:MM » du salon (Abidjan, UTC+0). Le formatage se fait en UTC pour qu'aucun fuseau
// de l'appareil ne décale la date affichée.
const SHORT = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const LONG = new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const STAMP = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
const at = (iso: string) => new Date(`${iso}T00:00:00Z`);
const shortDate = (iso: string) => SHORT.format(at(iso));
const longDate = (iso: string) => LONG.format(at(iso));
const digits = (s: string) => s.replace(/\D/g, "");

type StatusFilter = "all" | AdminBooking["status"];

/** Recherche locale sur les données déjà chargées : référence, client, téléphone (chiffres seuls acceptés) et prestation. */
function matchesSearch(b: AdminBooking, raw: string): boolean {
  const needle = raw.trim().toLowerCase();
  if (needle === "") return true;
  if (`${b.ref} ${b.name} ${b.phone} ${b.serviceName}`.toLowerCase().includes(needle)) return true;
  const d = digits(needle);
  return d.length >= 3 && digits(`${b.phone} ${b.phoneKey}`).includes(d);
}

function CopyRef({ value }: { value: string }) {
  const [done, setDone] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(value); setDone(true); setTimeout(() => setDone(false), 1500); } catch { /* presse-papiers indisponible : rien à faire */ }
  };
  return (
    <button type="button" className="ap-icon-btn ap-copy" onClick={() => void copy()} aria-label={done ? `Référence ${value} copiée` : `Copier la référence ${value}`} title="Copier la référence">
      {done ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : <Copy className="h-3.5 w-3.5" aria-hidden="true" />}
    </button>
  );
}

function StatusPill({ status }: { status: AdminBooking["status"] }) {
  return <span className={`ap-pill ${STATUS[status].pill}`}>{STATUS[status].label}</span>;
}

function When({ b }: { b: AdminBooking }) {
  return (
    <span className="ap-when" title={`${longDate(b.date)} à ${b.slot}`}>
      <span>{shortDate(b.date)}</span>
      <span className="ap-when-time">{b.slot}</span>
    </span>
  );
}

function Detail({ b, onClose }: { b: AdminBooking | null; onClose: () => void }) {
  return (
    <Dialog open={!!b} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="ap-dialog max-w-md">
        {b && (
          <>
            <DialogHeader className="ap-dialog-head space-y-0 text-left">
              <DialogTitle className="ap-dialog-title">Détails de la réservation</DialogTitle>
              <DialogDescription className="ap-dialog-desc"><span className="ap-mono">{b.ref}</span></DialogDescription>
            </DialogHeader>
            <dl className="ap-dialog-body ap-detail">
              <div><dt>Statut</dt><dd><StatusPill status={b.status} /></dd></div>
              <div><dt>Client</dt><dd>{b.name}</dd></div>
              <div><dt>Téléphone</dt><dd>{b.phone}</dd></div>
              <div><dt>Prestation</dt><dd>{b.serviceName}</dd></div>
              <div><dt>Rendez-vous</dt><dd>{longDate(b.date)} à {b.slot}</dd></div>
              <div><dt>Prix</dt><dd>{formatFCFA(b.price)} <span className="ap-muted-text">(prix enregistré à la réservation)</span></dd></div>
              <div><dt>Réservée le</dt><dd>{STAMP.format(new Date(b.createdAt))}</dd></div>
            </dl>
            <div className="ap-dialog-foot"><button className="ap-btn" onClick={onClose}>Fermer</button></div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Reservations() {
  const isMobile = useIsMobile();
  const query = useAdminBookings();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [date, setDate] = useState("");
  const [viewing, setViewing] = useState<AdminBooking | null>(null);

  const rows = query.data ?? [];
  const shown = rows.filter((b) => (status === "all" || b.status === status) && (date === "" || b.date === date) && matchesSearch(b, q));
  const active = q.trim() !== "" || status !== "all" || date !== "";
  const reset = () => { setQ(""); setStatus("all"); setDate(""); };
  const view = viewState(query, shown.length);

  // Indicateurs : calculés sur toutes les réservations chargées (jamais sur le filtre en cours), à partir des seuls statuts existants.
  const kpis = [
    { label: "Total des réservations", Icon: ListChecks, value: rows.length, hint: "Toutes les réservations chargées" },
    { label: "Confirmées", Icon: CalendarCheck, value: rows.filter((b) => b.status === "confirmed").length, hint: "Statut « Confirmée »" },
    { label: "Annulées", Icon: CalendarX, value: rows.filter((b) => b.status === "cancelled").length, hint: "Statut « Annulée »" },
    { label: "À venir", Icon: CalendarClock, value: upcomingBookings(rows).length, hint: "Confirmées, pas encore passées" },
  ];

  return (
    <div className="ap-page space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="ap-title">Réservations</h1>
          <p className="ap-subtitle">Gérez les rendez-vous, consultez les détails et suivez leur statut.</p>
        </div>
        <button className="ap-btn" disabled={query.isFetching} onClick={() => void query.refetch()} aria-label="Actualiser les réservations">
          <RefreshCw className={`h-4 w-4 ${query.isFetching ? "animate-spin" : ""}`} aria-hidden="true" />Actualiser
        </button>
      </header>

      <div className="ap-kpis ap-kpis-compact">
        {kpis.map(({ label, Icon, value, hint }) => (
          <div key={label} className="ap-card ap-kpi">
            <span className="ap-kpi-icon" aria-hidden="true"><Icon className="h-[1.05rem] w-[1.05rem]" strokeWidth={1.6} /></span>
            <div className="ap-kpi-text">
              <p className="ap-kpi-label">{label}</p>
              <p className="ap-kpi-value">{query.isSuccess ? value : "—"}</p>
              <p className="ap-kpi-hint">{query.isPending ? "Chargement…" : query.isError ? "Chargement impossible" : hint}</p>
            </div>
          </div>
        ))}
      </div>

      <section className="ap-card overflow-hidden" aria-label="Liste des réservations">
        <div className="flex flex-wrap items-center gap-3 border-b p-3 sm:p-4" style={{ borderColor: "var(--ap-line)" }}>
          <div className="ap-search">
            <Search aria-hidden="true" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Référence, client ou téléphone" aria-label="Rechercher une réservation" className="ap-input" />
          </div>
          <select className="ap-select !w-auto" aria-label="Filtrer par statut" value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)}>
            <option value="all">Tous les statuts</option>
            <option value="confirmed">Confirmées</option>
            <option value="cancelled">Annulées</option>
          </select>
          <input type="date" className="ap-input !w-auto" aria-label="Filtrer par date du rendez-vous" value={date} onChange={(e) => setDate(e.target.value)} />
          {active && <button className="ap-link-btn" onClick={reset}>Réinitialiser les filtres</button>}
        </div>
        {query.isSuccess && rows.length > 0 && (
          <p className="border-b px-4 py-2 text-sm" style={{ borderColor: "var(--ap-line)", color: "var(--ap-ink-soft)" }} aria-live="polite">
            {active ? `${shown.length} sur ${rows.length} réservation${rows.length > 1 ? "s" : ""}` : `${rows.length} réservation${rows.length > 1 ? "s" : ""}`}
          </p>
        )}

        {view.status === "loading" ? <ListSkeleton />
          : view.status === "error" ? (
            <EmptyState icon={RefreshCw} tone="danger" title={view.title ?? "Chargement impossible"} text={view.text ?? "Les données n'ont pas pu être récupérées. Réessayez dans un instant."}
              action={<button className="ap-btn" onClick={() => void query.refetch()}><RefreshCw className="h-4 w-4" aria-hidden="true" />Réessayer</button>} />
          )
          : rows.length === 0 ? <EmptyState icon={Inbox} title="Aucune réservation enregistrée" text="Les réservations faites par vos clientes apparaîtront ici." />
          : shown.length === 0 ? (
            <EmptyState icon={SearchX} title="Aucun résultat" text="Aucune réservation ne correspond à vos critères."
              action={<button className="ap-btn" onClick={reset}>Réinitialiser les filtres</button>} />
          )
          : isMobile ? (
            <ul className="ap-cards" aria-label="Réservations">
              {shown.map((b) => (
                <li key={b.ref} className="ap-card-row" data-active={b.status === "confirmed"}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="ap-product-name">{b.name}</p>
                      <p className="ap-phone">{b.phone}</p>
                    </div>
                    <StatusPill status={b.status} />
                  </div>
                  <p className="ap-res-service">{b.serviceName}</p>
                  <div className="ap-card-meta">
                    <When b={b} />
                    <span className="ml-auto font-semibold">{formatFCFA(b.price)}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1"><span className="ap-mono">{b.ref}</span><CopyRef value={b.ref} /></span>
                    <button className="ap-btn !min-h-[2rem] !px-3 !text-[0.8rem]" onClick={() => setViewing(b)} aria-label={`Détails de la réservation ${b.ref}`}><Eye className="h-3.5 w-3.5" aria-hidden="true" />Détails</button>
                  </div>
                </li>
              ))}
            </ul>
          )
          : (
            <div className="overflow-x-auto">
              <table className="ap-table ap-res-table">
                <thead>
                  <tr>
                    <th className="ap-col-ref">Référence</th><th>Client</th><th>Prestation</th><th className="ap-col-when">Date et heure</th>
                    <th className="ap-col-status">Statut</th><th className="ap-col-price">Prix</th><th className="ap-col-actions"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((b) => (
                    <tr key={b.ref} data-active={b.status === "confirmed"}>
                      <td className="ap-col-ref"><span className="flex items-center gap-1"><span className="ap-mono">{b.ref}</span><CopyRef value={b.ref} /></span></td>
                      <td><p className="ap-product-name">{b.name}</p><p className="ap-phone">{b.phone}</p></td>
                      <td className="ap-res-service">{b.serviceName}</td>
                      <td className="ap-col-when"><When b={b} /></td>
                      <td className="ap-col-status"><StatusPill status={b.status} /></td>
                      <td className="ap-col-price">{formatFCFA(b.price)}</td>
                      <td className="ap-col-actions">
                        <button className="ap-icon-btn" title="Voir les détails" aria-label={`Détails de la réservation ${b.ref}`} onClick={() => setViewing(b)}><Eye className="h-4 w-4" aria-hidden="true" /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        {rows.length >= BOOKINGS_LIMIT && <p className="border-t px-5 py-3 text-xs" style={{ borderColor: "var(--ap-line)", color: "var(--ap-muted)" }}>Seules les {BOOKINGS_LIMIT} réservations les plus récentes sont chargées.</p>}
      </section>

      <Detail b={viewing} onClose={() => setViewing(null)} />
    </div>
  );
}
