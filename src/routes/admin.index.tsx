import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Area, AreaChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import {
  ArrowDownRight, ArrowRight, ArrowUpRight, BarChart3, CalendarCheck, CalendarClock, CalendarDays, ChevronRight, Clock, Coins, Flower2, Minus,
  Package, RefreshCw, ShieldCheck, Settings, Sparkles, Tag, UserPlus, Users, Wallet, Zap,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import hero from "@/assets/hero.jpg";
import { AdminAccount } from "@/components/admin-account";
import { DataState } from "@/components/admin";
import { useAdminEmail, useAdminSignOut } from "@/components/admin-gate";
import { services as localServices } from "@/data/services";
import { BOOKINGS_LIMIT, bookingsToday, clientsFromBookings, upcomingBookings, type AdminBooking } from "@/lib/admin-api";
import {
  addDays, categoryBreakdown, granularity, monthToDate, newClientsThisMonth, PERIODS, periodRanges, revenue, revenueSeries, topBooked, trend,
  type Granularity, type PeriodId, type Trend,
} from "@/lib/admin-dashboard";
import { abidjanToday, longDate } from "@/lib/bookings";
import { useAdminBookings, useAdminServiceCategories, useAdminServices, viewState } from "@/lib/admin-queries";
import { formatFCFA } from "@/lib/format";
import { buildCategories } from "@/lib/service-categories";

export const Route = createFileRoute("/admin/")({
  head: () => ({ meta: [{ title: "Vue d'ensemble | Administration Dalanda" }] }),
  component: Overview,
});

const SHORT = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const DAYMONTH = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", timeZone: "UTC" });
const MONTH = new Intl.DateTimeFormat("fr-FR", { month: "short", timeZone: "UTC" });
const NUM = new Intl.NumberFormat("fr-FR");
const at = (iso: string) => new Date(`${iso}T00:00:00Z`);
const shortDate = (iso: string) => SHORT.format(at(iso));
const initials = (name: string) => (name.trim().split(/\s+/).slice(0, 2).map((w) => w.charAt(0)).join("") || "?").toUpperCase();
const pct = (n: number) => `${String(Math.abs(n)).replace(".", ",")} %`;
const PALETTE = ["#0b1f3a", "#c5a15a", "#2f6fb5", "#8fb0d6", "#8a7fc7", "#aab4c3"];

const VS: Record<PeriodId, string> = {
  "7d": "aux 7 jours précédents", "30d": "aux 30 jours précédents", month: "au mois précédent (même période)",
  quarter: "au trimestre précédent (même période)", year: "à l'année précédente (même période)",
};

function TrendBadge({ t, vs }: { t: Trend; vs: string }) {
  if (t.direction === "none") return <span className="dash-trend dash-trend-flat"><Minus className="h-3 w-3" aria-hidden="true" />Pas de comparaison</span>;
  if (t.direction === "new") return <span className="dash-trend dash-trend-up"><ArrowUpRight className="h-3 w-3" aria-hidden="true" />Nouveau {vs}</span>;
  const Icon = t.direction === "up" ? ArrowUpRight : t.direction === "down" ? ArrowDownRight : Minus;
  const sign = t.direction === "up" ? "+" : t.direction === "down" ? "−" : "";
  return <span className={`dash-trend dash-trend-${t.direction}`}><Icon className="h-3 w-3" aria-hidden="true" />{sign}{pct(t.percent ?? 0)} {vs}</span>;
}

type CardProps = {
  label: string; Icon: typeof Users; value: ReactNode; pending: boolean; failed: boolean; footer?: ReactNode; cta?: string;
  /** Destination réelle ; absente = carte non cliquable. */
  to?: "/admin/reservations" | "/admin/clients" | "/admin/prestations";
};

function Card({ label, Icon, value, pending, failed, footer, cta, to }: CardProps) {
  const body = (
    <>
      <span className="dash-icon" aria-hidden="true"><Icon className="h-[1.1rem] w-[1.1rem]" strokeWidth={1.7} /></span>
      <div className="dash-card-text">
        <p className="dash-card-label">{label}</p>
        <p className="dash-card-value">{value}</p>
        {pending && <p className="dash-card-foot">Chargement…</p>}
        {failed && <p role="alert" className="dash-card-foot dash-card-error">Chargement impossible</p>}
        {!pending && !failed && footer && <div className="dash-card-foot">{footer}</div>}
        {!pending && !failed && cta && <span className="dash-card-cta">{cta}<ArrowRight className="h-3 w-3" aria-hidden="true" /></span>}
      </div>
    </>
  );
  return to
    ? <Link to={to} className="dash-card dash-card-link" aria-label={`${label} : ouvrir la liste`}>{body}</Link>
    : <div className="dash-card">{body}</div>;
}

const STATUS = { confirmed: { label: "Confirmée", cls: "dash-badge-ok" }, cancelled: { label: "Annulée", cls: "dash-badge-muted" } } as const;

type Tip = { active?: boolean; payload?: { payload: { from: string; to: string; revenue: number; bookings: number } }[] };
function RevenueTip({ active, payload }: Tip) {
  const p = active ? payload?.[0]?.payload : undefined;
  if (!p) return null;
  return (
    <div className="dash-tip" role="status">
      <p className="dash-tip-date">{p.from === p.to ? shortDate(p.from) : `${shortDate(p.from)} → ${shortDate(p.to)}`}</p>
      <p className="dash-tip-value">{formatFCFA(p.revenue)}</p>
      <p className="dash-tip-sub">{p.bookings} réservation{p.bookings > 1 ? "s" : ""} confirmée{p.bookings > 1 ? "s" : ""}</p>
    </div>
  );
}

const tick = (g: Granularity) => (v: string) => (g === "month" ? MONTH.format(at(v)) : DAYMONTH.format(at(v)));

function Thumb({ src, alt }: { src: string; alt: string }) {
  return src ? <img src={src} alt={alt} loading="lazy" className="dash-thumb" /> : <span className="dash-thumb dash-thumb-empty" aria-hidden="true"><Sparkles className="h-4 w-4" /></span>;
}

function Overview() {
  const email = useAdminEmail();
  const signOut = useAdminSignOut();
  const bookings = useAdminBookings();
  const services = useAdminServices();
  const categoriesQuery = useAdminServiceCategories();
  const rows = bookings.data;
  const today = abidjanToday();
  const refreshing = bookings.isFetching || services.isFetching;
  const [period, setPeriod] = useState<PeriodId>("7d");

  // Cartes du haut
  const day = rows ? revenue(rows, today, today) : null;
  const yesterday = rows ? revenue(rows, addDays(today, -1), addDays(today, -1)) : 0;
  const month = rows ? monthToDate(rows, today) : null;
  const todayConfirmed = rows ? bookingsToday(rows).length : null;
  const todayCancelled = rows ? rows.filter((b) => b.date === today && b.status === "cancelled").length : 0;
  const upcoming = rows ? upcomingBookings(rows).length : null;
  const clients = rows ? clientsFromBookings(rows).length : null;
  const newClients = rows ? newClientsThisMonth(rows, today) : null;
  const activeServices = services.data ? services.data.filter((s) => s.active).length : null;
  const q = { pending: bookings.isPending, failed: bookings.isError };
  const fcfa = (n: number | null) => (n === null ? "—" : formatFCFA(n));

  // Période choisie : graphique, répartition, prestations les plus réservées
  const ranges = periodRanges(period, today);
  const g = granularity(period);
  const series = rows ? revenueSeries(rows, ranges.current, g) : [];
  const total = series.reduce((s, p) => s + p.revenue, 0);
  const previousTotal = rows ? revenue(rows, ranges.previous.from, ranges.previous.to) : 0;
  const tr = trend(total, previousTotal);

  const serviceCategory = new Map((services.data ?? []).map((s) => [s.id, s.category]));
  const categories = buildCategories(categoriesQuery.data, [...serviceCategory.values()]);
  const shares = rows ? categoryBreakdown(rows, ranges.current, (sid) => {
    const cid = sid ? serviceCategory.get(sid) : undefined;
    const c = cid ? categories.find((x) => x.id === cid) : undefined;
    return c ? { id: c.id, label: c.label } : { id: "autres", label: "Autres prestations" };
  }) : [];
  const sharesTotal = shares.reduce((s, c) => s + c.revenue, 0);
  const sold = rows ? topBooked(rows, ranges.current, 5) : [];
  const imageOf = (s: { serviceId: string | undefined; name: string }) => {
    const svc = (services.data ?? []).find((x) => (s.serviceId ? x.id === s.serviceId : x.name === s.name));
    return svc?.imageUrl || localServices.find((l) => l.id === (svc?.id ?? s.serviceId))?.image || "";
  };

  const recent = rows ? [...rows].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 5) : [];
  const latest = viewState(bookings, recent.length);
  const periodLabel = PERIODS.find((p) => p.id === period)!;

  return (
    <div className="dash-page space-y-5">
      <div className="dash-topbar">
        <span className="dash-date" aria-label="Date du jour"><CalendarDays className="h-4 w-4" aria-hidden="true" />{longDate(today)}</span>
        <div className="dash-tools">
          {email && <span className="dash-session" role="status" aria-label="État de la connexion"><span className="dash-live" aria-hidden="true" />Session active</span>}
          <button className="dash-btn" disabled={refreshing} onClick={() => void Promise.all([bookings.refetch(), services.refetch()])} aria-label="Actualiser les données">
            <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} aria-hidden="true" />Actualiser
          </button>
          {email && signOut && <AdminAccount email={email} onSignOut={signOut} />}
        </div>
      </div>

      <section className="dash-banner" aria-labelledby="dash-title">
        <img src={hero} alt="" className="dash-banner-img" />
        <div className="dash-banner-shade" aria-hidden="true" />
        <div className="dash-banner-text">
          <p className="dash-banner-eyebrow"><ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />Administration</p>
          <h1 id="dash-title" className="dash-banner-title">Vue d'ensemble</h1>
          <p className="dash-banner-sub">Le résumé de l'activité de votre spa en un coup d'œil.</p>
        </div>
      </section>

      <div className="dash-cards">
        <Card label="Chiffre d'affaires du jour" Icon={Coins} value={fcfa(day)} {...q}
          footer={<><TrendBadge t={trend(day ?? 0, yesterday)} vs="vs hier" /><span className="dash-muted">Montant estimé · hier : {formatFCFA(yesterday)}</span></>} />
        <Card label="Chiffre d'affaires mensuel" Icon={Wallet} value={fcfa(month ? month.current : null)} {...q}
          footer={month && <><TrendBadge t={trend(month.current, month.previous)} vs="vs mois précédent" /><span className="dash-muted">Montant estimé · même période : {formatFCFA(month.previous)}</span></>} />
        <Card label="Réservations du jour" Icon={CalendarCheck} value={todayConfirmed ?? "—"} to="/admin/reservations" cta="Voir les réservations" {...q}
          footer={<span className="dash-muted">{todayConfirmed === 1 ? "1 confirmée" : `${todayConfirmed ?? 0} confirmées`}{todayCancelled > 0 && ` · ${todayCancelled} annulée${todayCancelled > 1 ? "s" : ""}`}</span>} />
        <Card label="Rendez-vous à venir" Icon={CalendarClock} value={upcoming ?? "—"} to="/admin/reservations" cta="Voir les rendez-vous" {...q}
          footer={<span className="dash-muted">Rendez-vous programmés</span>} />
        <Card label="Clients" Icon={Users} value={clients ?? "—"} to="/admin/clients" cta="Voir les clients" {...q}
          footer={<span className="dash-muted"><UserPlus className="inline h-3 w-3" aria-hidden="true" /> {newClients ?? 0} nouveau{(newClients ?? 0) > 1 ? "x" : ""} client{(newClients ?? 0) > 1 ? "s" : ""} ce mois</span>} />
        <Card label="Prestations au catalogue" Icon={Sparkles} value={activeServices ?? "—"} to="/admin/prestations" cta="Gérer les prestations" pending={services.isPending} failed={services.isError}
          footer={<span className="dash-muted">Prestations actives</span>} />
      </div>
      <p className="dash-note">
        Les montants sont des estimations : somme des prix des réservations confirmées, à la date du rendez-vous. Aucun paiement n'est enregistré dans l'application, ces chiffres ne sont donc pas des sommes encaissées.
        {rows && rows.length >= BOOKINGS_LIMIT && ` Calculé sur les ${BOOKINGS_LIMIT} réservations les plus récentes.`}
      </p>

      <div className="dash-layout">
        <section className="dash-panel dash-a-revenue" aria-labelledby="dash-revenue">
          <div className="dash-panel-head">
            <div className="dash-head-main">
              <span className="dash-icon dash-icon-sm" aria-hidden="true"><BarChart3 className="h-4 w-4" strokeWidth={1.7} /></span>
              <div>
                <h2 id="dash-revenue" className="dash-panel-title">Chiffre d'affaires</h2>
                <p className="dash-panel-sub">Montant estimé des réservations confirmées, {periodLabel.sub}</p>
              </div>
            </div>
            <select className="dash-select" aria-label="Période du graphique" value={period} onChange={(e) => setPeriod(e.target.value as PeriodId)}>
              {PERIODS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
          </div>
          <div className="dash-panel-body">
            <div className="dash-total">
              <p className="dash-total-value" aria-live="polite">{rows ? formatFCFA(total) : "—"}</p>
              {rows && <TrendBadge t={tr} vs={VS[period]} />}
            </div>
            {rows && <p className="dash-muted">Période précédente : {formatFCFA(previousTotal)}</p>}
            {bookings.isPending ? <div className="dash-skeleton" aria-busy="true" aria-label="Chargement" />
              : bookings.isError ? <p role="alert" className="dash-empty">Chargement impossible</p>
              : total === 0 ? <p className="dash-empty">Aucune réservation confirmée sur cette période.</p>
              : (
                <div className="dash-chart" role="img" aria-label={`Évolution du chiffre d'affaires estimé, ${periodLabel.sub} : ${formatFCFA(total)}`}>
                  <ResponsiveContainer width="100%" height={250}>
                    <AreaChart data={series} margin={{ top: 10, right: 12, bottom: 0, left: 0 }}>
                      <defs>
                        <linearGradient id="dash-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#164e86" stopOpacity={0.22} /><stop offset="100%" stopColor="#164e86" stopOpacity={0.02} /></linearGradient>
                      </defs>
                      <CartesianGrid stroke="#e3e8ef" strokeDasharray="3 4" vertical={false} />
                      <XAxis dataKey="from" tickFormatter={tick(g)} tickLine={false} axisLine={{ stroke: "#e3e8ef" }} tick={{ fill: "#7a8aa0", fontSize: 11 }} minTickGap={18} />
                      <YAxis tickFormatter={(v: number) => NUM.format(v)} tickLine={false} axisLine={false} width={68} tick={{ fill: "#7a8aa0", fontSize: 11 }} />
                      <Tooltip content={<RevenueTip />} cursor={{ stroke: "#c9d3e0" }} />
                      <Area type="monotone" dataKey="revenue" stroke="#164e86" strokeWidth={2.25} fill="url(#dash-fill)" dot={{ r: 3.5, fill: "#164e86", stroke: "#fff", strokeWidth: 1.5 }} activeDot={{ r: 5.5 }} isAnimationActive={false} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              )}
            <ul className="sr-only" aria-label="Détail du graphique">
              {series.map((p) => <li key={p.key}>{p.from === p.to ? shortDate(p.from) : `${shortDate(p.from)} au ${shortDate(p.to)}`} : {formatFCFA(p.revenue)}</li>)}
            </ul>
          </div>
        </section>

        <section className="dash-panel dash-a-split" aria-labelledby="dash-split">
          <div className="dash-panel-head"><div><h2 id="dash-split" className="dash-panel-title">Répartition des revenus</h2><p className="dash-panel-sub">Par catégorie de prestation, montants estimés</p></div></div>
          <div className="dash-panel-body">
            {bookings.isPending ? <div className="dash-skeleton" aria-busy="true" aria-label="Chargement" />
              : bookings.isError ? <p role="alert" className="dash-empty">Chargement impossible</p>
              : shares.length === 0 ? <p className="dash-empty">Pas assez de données : aucune réservation confirmée sur cette période.</p>
              : (
                <>
                  <div className="dash-donut" role="img" aria-label={`Répartition des revenus estimés : ${formatFCFA(sharesTotal)}`}>
                    <ResponsiveContainer width="100%" height={190}>
                      <PieChart>
                        <Pie data={shares} dataKey="revenue" nameKey="label" innerRadius={58} outerRadius={84} paddingAngle={2} stroke="#fff" strokeWidth={2} isAnimationActive={false}>
                          {shares.map((s, i) => <Cell key={s.id} fill={PALETTE[i % PALETTE.length]!} />)}
                        </Pie>
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="dash-donut-center"><strong>{NUM.format(sharesTotal)}</strong><span>FCFA</span></div>
                  </div>
                  <ul className="dash-legend">
                    {shares.map((s, i) => (
                      <li key={s.id}><span className="dash-dot" style={{ background: PALETTE[i % PALETTE.length] }} aria-hidden="true" /><span className="dash-legend-name">{s.label}</span><span className="dash-legend-pct">{pct(s.percent)}</span><span className="dash-legend-amount">{formatFCFA(s.revenue)}</span></li>
                    ))}
                  </ul>
                </>
              )}
          </div>
        </section>

        <section className="dash-panel dash-a-quick" aria-labelledby="dash-quick">
          <div className="dash-panel-head"><div className="dash-head-main"><span className="dash-icon dash-icon-sm dash-icon-gold" aria-hidden="true"><Zap className="h-4 w-4" strokeWidth={1.7} /></span><h2 id="dash-quick" className="dash-panel-title">Accès rapides</h2></div></div>
          <nav className="dash-quick" aria-label="Accès rapides">
            <Link to="/admin/reservations"><CalendarDays className="h-[1.1rem] w-[1.1rem]" aria-hidden="true" />Gérer les réservations<ChevronRight className="dash-quick-go" aria-hidden="true" /></Link>
            <Link to="/admin/prestations"><Sparkles className="h-[1.1rem] w-[1.1rem]" aria-hidden="true" />Consulter les prestations<ChevronRight className="dash-quick-go" aria-hidden="true" /></Link>
            <Link to="/admin/produits"><Package className="h-[1.1rem] w-[1.1rem]" aria-hidden="true" />Gérer les produits<ChevronRight className="dash-quick-go" aria-hidden="true" /></Link>
            <Link to="/admin/promotions"><Tag className="h-[1.1rem] w-[1.1rem]" aria-hidden="true" />Gérer les promotions<ChevronRight className="dash-quick-go" aria-hidden="true" /></Link>
            <Link to="/admin/parametres"><Settings className="h-[1.1rem] w-[1.1rem]" aria-hidden="true" />Accéder aux paramètres<ChevronRight className="dash-quick-go" aria-hidden="true" /></Link>
          </nav>
        </section>

        <section className="dash-panel dash-a-top" aria-labelledby="dash-top">
          <div className="dash-panel-head"><div><h2 id="dash-top" className="dash-panel-title">Prestations les plus vendues</h2><p className="dash-panel-sub">Réservations confirmées, {periodLabel.sub}</p></div></div>
          <div className="dash-panel-body">
            {bookings.isPending ? <div className="dash-skeleton" aria-busy="true" aria-label="Chargement" />
              : bookings.isError ? <p role="alert" className="dash-empty">Chargement impossible</p>
              : sold.length === 0 ? <p className="dash-empty">Aucune réservation confirmée sur cette période.</p>
              : (
                <ol className="dash-sold">
                  {sold.map((s) => (
                    <li key={s.key}>
                      <Thumb src={imageOf(s)} alt="" />
                      <div className="dash-sold-main">
                        <p className="dash-sold-name">{s.name}</p>
                        <p className="dash-sold-count">{s.bookings} réservation{s.bookings > 1 ? "s" : ""}</p>
                        <div className="dash-top-track" aria-hidden="true"><span style={{ width: `${Math.max(4, s.percent)}%` }} /></div>
                      </div>
                      <span className="dash-sold-pct">{pct(s.percent)}</span>
                    </li>
                  ))}
                </ol>
              )}
          </div>
        </section>

        <section className="dash-panel dash-a-activity" aria-labelledby="dash-latest">
          <div className="dash-panel-head">
            <div className="dash-head-main">
              <span className="dash-icon dash-icon-sm dash-icon-gold" aria-hidden="true"><Clock className="h-4 w-4" strokeWidth={1.7} /></span>
              <div><h2 id="dash-latest" className="dash-panel-title">Activité récente</h2><p className="dash-panel-sub">Les derniers rendez-vous enregistrés dans votre spa.</p></div>
            </div>
            <Link to="/admin/reservations" className="dash-link">Voir toutes les réservations <ArrowRight className="inline h-3 w-3" aria-hidden="true" /></Link>
          </div>
          <DataState {...latest} {...(latest.status === "empty" ? { title: "Aucune réservation", text: "Les réservations enregistrées apparaîtront ici." } : {})} onRetry={() => void bookings.refetch()}>
            <div className="dash-table-wrap">
            <table className="dash-table">
              <thead><tr><th>Client</th><th>Prestation</th><th>Référence</th><th>Date et heure</th><th>Statut</th></tr></thead>
              <tbody>
                {recent.map((b: AdminBooking) => {
                  const st = STATUS[b.status];
                  return (
                    <tr key={b.ref}>
                      <td data-label="Client"><span className="dash-client"><span className="dash-avatar" aria-hidden="true">{initials(b.name)}</span><span className="dash-client-name">{b.name}</span></span></td>
                      <td data-label="Prestation">{b.serviceName}</td>
                      <td data-label="Référence"><span className="dash-ref">{b.ref}</span></td>
                      <td data-label="Date et heure" className="dash-when">{shortDate(b.date)} · {b.slot}</td>
                      <td data-label="Statut"><span className={`dash-badge ${st.cls}`}>{st.label}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            </div>
          </DataState>
        </section>

        <section className="dash-end dash-a-end" aria-label="Message de bienvenue">
          <Flower2 className="dash-end-icon" strokeWidth={1.3} aria-hidden="true" />
          <div className="dash-end-text">
            <p className="dash-end-title">Prenez soin de vous, chaque jour</p>
            <p className="dash-end-sub">Une expérience beauté et détente, sur mesure.</p>
          </div>
          <Link to="/admin/prestations" className="dash-end-btn">Voir nos prestations<ArrowRight className="h-4 w-4" aria-hidden="true" /></Link>
        </section>
      </div>
    </div>
  );
}
