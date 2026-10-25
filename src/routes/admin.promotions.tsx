import { createFileRoute } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Eye, Pencil, Plus, Power, RefreshCw, Search, SearchX, Tag, Trash2 } from "lucide-react";
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Img } from "@/components/app";
import { EmptyState, ListSkeleton, Message } from "@/components/admin-ui";
import { PromotionCard } from "@/components/promotion-card";
import { PromotionFormDialog } from "@/components/promotion-form-dialog";
import { useIsMobile } from "@/hooks/use-mobile";
import { deleteAdminPromotion, setPromotionPublication } from "@/lib/admin-promotions";
import { useAdminProducts, useAdminPromotions, useAdminServices, viewState } from "@/lib/admin-queries";
import { formatFCFA } from "@/lib/format";
import {
  discountPercent, KIND_LABELS, periodLabel, PROMOTIONS_KEY, promotionStatus, STATUS_LABELS, type Promotion, type PromotionStatus,
} from "@/lib/promotions";
import { abidjanToday } from "@/lib/bookings";

export const Route = createFileRoute("/admin/promotions")({
  head: () => ({ meta: [{ title: "Promotions | Administration Dalanda" }] }),
  component: Promotions,
});

const norm = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

type StatusFilter = "all" | PromotionStatus;
type PeriodFilter = "all" | "current" | "upcoming" | "past" | "none";
type Notice = { kind: "ok" | "error"; text: string } | null;

const PILL: Record<PromotionStatus, string> = { active: "ap-pill-ok", scheduled: "ap-pill-warn", expired: "ap-pill-danger", draft: "ap-pill-muted", disabled: "ap-pill-muted" };
const PERIOD_LABELS: Record<PeriodFilter, string> = {
  all: "Toutes les périodes", current: "En cours (aujourd'hui)", upcoming: "À venir", past: "Terminées", none: "Sans date",
};

/** Période de validité d'après les seules dates (indépendante de la publication). */
function inPeriod(p: Promotion, f: PeriodFilter, today: string): boolean {
  if (f === "all") return true;
  if (f === "none") return !p.startsOn && !p.endsOn;
  if (!p.startsOn && !p.endsOn) return false;
  if (f === "upcoming") return !!p.startsOn && p.startsOn > today;
  if (f === "past") return !!p.endsOn && p.endsOn < today;
  return (!p.startsOn || p.startsOn <= today) && (!p.endsOn || p.endsOn >= today);
}

function StatusPill({ status }: { status: PromotionStatus }) {
  return <span className={`ap-pill ${PILL[status]}`}>{STATUS_LABELS[status]}</span>;
}

function Promotions() {
  const qc = useQueryClient();
  const isMobile = useIsMobile();
  const query = useAdminPromotions();
  const servicesQuery = useAdminServices();
  const productsQuery = useAdminProducts();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [period, setPeriod] = useState<PeriodFilter>("all");
  const [form, setForm] = useState<{ promotion: Promotion | null } | null>(null);
  const [viewing, setViewing] = useState<Promotion | null>(null);
  const [deleting, setDeleting] = useState<Promotion | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const busy = useRef(false);

  const today = abidjanToday();
  const rows = query.data ?? [];
  const services = (servicesQuery.data ?? []).map((s) => ({ id: s.id, name: s.name }));
  const products = (productsQuery.data ?? []).map((p) => ({ id: p.id, name: p.name }));
  const linksProblem = servicesQuery.isError || productsQuery.isError ? "certaines listes (prestations ou produits) sont indisponibles." : null;
  const targetName = (p: Promotion) =>
    p.serviceId ? `Prestation : ${services.find((s) => s.id === p.serviceId)?.name ?? p.serviceId}`
      : p.productId ? `Produit : ${products.find((x) => x.id === p.productId)?.name ?? p.productId}` : null;

  const withStatus = rows.map((p) => ({ p, s: promotionStatus(p, today) }));
  const shown = withStatus.filter(({ p, s }) =>
    (status === "all" || s === status) && inPeriod(p, period, today) && norm(`${p.title} ${p.description}`).includes(norm(q.trim())));
  const filtered = q.trim() !== "" || status !== "all" || period !== "all";
  const resetFilters = () => { setQ(""); setStatus("all"); setPeriod("all"); };
  const view = viewState(query, shown.length);
  const count = (s: PromotionStatus) => withStatus.filter((x) => x.s === s).length;

  const openForm = (promotion: Promotion | null) => { setNotice(null); setForm({ promotion }); };
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ["admin", "promotions"] }), qc.invalidateQueries({ queryKey: PROMOTIONS_KEY })]);

  const toggle = useMutation({
    mutationFn: (p: Promotion) => setPromotionPublication(p.id, p.publication === "published" ? "disabled" : "published"),
    onSuccess: async (_d, p) => {
      await refresh();
      if (p.publication === "published") { setNotice({ kind: "ok", text: `« ${p.title} » est désactivée : elle n'apparaît plus sur le site.` }); return; }
      const next = promotionStatus({ publication: "published", startsOn: p.startsOn, endsOn: p.endsOn }, today);
      setNotice({
        kind: "ok",
        text: next === "active" ? `« ${p.title} » est activée : elle apparaît sur le site.`
          : next === "scheduled" ? `« ${p.title} » est publiée mais programmée : elle apparaîtra sur le site à partir du ${p.startsOn?.split("-").reverse().join("/")}.`
          : `« ${p.title} » est publiée mais sa période est terminée : elle n'apparaît pas sur le site. Modifiez ses dates pour la remettre en ligne.`,
      });
    },
    onError: (e) => setNotice({ kind: "error", text: e instanceof Error ? e.message : "Modification impossible." }),
    onSettled: () => { busy.current = false; },
  });
  const flip = (p: Promotion) => {
    if (busy.current) return;
    busy.current = true;
    setNotice(null);
    toggle.mutate(p);
  };

  const remove = useMutation({
    mutationFn: (p: Promotion) => deleteAdminPromotion(p.id),
    onSuccess: async (_d, p) => { await refresh(); setNotice({ kind: "ok", text: `« ${p.title} » est supprimée : elle n'apparaît plus dans la liste ni sur le site.` }); },
    onError: (e) => setNotice({ kind: "error", text: e instanceof Error ? e.message : "Suppression impossible." }),
    onSettled: () => { busy.current = false; setDeleting(null); },
  });
  const confirmDelete = (p: Promotion) => {
    if (busy.current) return;
    busy.current = true;
    remove.mutate(p);
  };

  const prices = (p: Promotion) => p.kind === "price" && p.originalPrice !== null && p.promoPrice !== null
    ? <><s className="ap-muted-text">{formatFCFA(p.originalPrice)}</s> <b>{formatFCFA(p.promoPrice)}</b></>
    : p.kind === "percent" ? <span className="ap-muted-text">Annoncé en %</span> : <span className="ap-muted-text">—</span>;
  const reduction = (p: Promotion) => { const d = discountPercent(p); return d === null ? "—" : `-${d}%`; };

  const actions = (p: Promotion) => (
    <div className="flex items-center justify-end gap-1">
      <button className="ap-icon-btn" title="Consulter" aria-label={`Consulter ${p.title}`} onClick={() => setViewing(p)}><Eye className="h-4 w-4" aria-hidden="true" /></button>
      <button className="ap-btn !min-h-[2rem] !px-3 !text-[0.8rem]" aria-label={`Modifier ${p.title}`} onClick={() => openForm(p)}><Pencil className="h-3.5 w-3.5" aria-hidden="true" />Modifier</button>
      <button className="ap-icon-btn" disabled={toggle.isPending} title={p.publication === "published" ? "Désactiver" : "Activer"} aria-label={`${p.publication === "published" ? "Désactiver" : "Activer"} ${p.title}`} onClick={() => flip(p)}>
        <Power className="h-4 w-4" aria-hidden="true" />
      </button>
      <button className="ap-icon-btn" disabled={remove.isPending} title="Supprimer" aria-label={`Supprimer ${p.title}`} onClick={() => { setNotice(null); setDeleting(p); }}>
        <Trash2 className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );

  return (
    <div className="ap-page space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="ap-title">Promotions</h1>
          <p className="ap-subtitle">Annonces promotionnelles affichées aux clientes. Elles sont informatives : aucun tarif n'est modifié.</p>
        </div>
        <button className="ap-btn ap-btn-primary" onClick={() => openForm(null)}><Plus className="h-4 w-4" aria-hidden="true" />Nouvelle promotion</button>
      </header>

      {notice && <Message kind={notice.kind}>{notice.text}</Message>}

      <section className="ap-card overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 border-b p-3 sm:p-4" style={{ borderColor: "var(--ap-line)" }}>
          <div className="ap-search">
            <Search aria-hidden="true" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher par titre ou description" aria-label="Rechercher une promotion" className="ap-input" />
          </div>
          <select className="ap-select !w-auto" aria-label="Filtrer par statut" value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)}>
            <option value="all">Tous les statuts</option>
            {(Object.keys(STATUS_LABELS) as PromotionStatus[]).map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}{query.isSuccess ? ` (${count(s)})` : ""}</option>)}
          </select>
          <select className="ap-select !w-auto" aria-label="Filtrer par période" value={period} onChange={(e) => setPeriod(e.target.value as PeriodFilter)}>
            {(Object.keys(PERIOD_LABELS) as PeriodFilter[]).map((k) => <option key={k} value={k}>{PERIOD_LABELS[k]}</option>)}
          </select>
        </div>
        {query.isSuccess && rows.length > 0 && (
          <div className="flex items-center justify-between gap-3 border-b px-4 py-2 text-sm" style={{ borderColor: "var(--ap-line)", color: "var(--ap-ink-soft)" }}>
            <p aria-live="polite">{filtered ? `${shown.length} sur ${rows.length} promotion${rows.length > 1 ? "s" : ""}` : `${rows.length} promotion${rows.length > 1 ? "s" : ""}`}</p>
            {filtered && <button className="ap-link-btn" onClick={resetFilters}>Réinitialiser les filtres</button>}
          </div>
        )}

        {view.status === "loading" ? <ListSkeleton />
          : view.status === "error" ? (
            <EmptyState icon={RefreshCw} tone="danger" title={view.title ?? "Chargement impossible"} text={view.text ?? "Les données n'ont pas pu être récupérées. Réessayez dans un instant."}
              action={<button onClick={() => void query.refetch()} className="ap-btn"><RefreshCw className="h-4 w-4" aria-hidden="true" />Réessayer</button>} />
          )
          : rows.length === 0 ? (
            <EmptyState icon={Tag} title="Aucune promotion" text="Créez votre première promotion avec le bouton ci-dessous."
              action={<button className="ap-btn ap-btn-primary" onClick={() => openForm(null)}><Plus className="h-4 w-4" aria-hidden="true" />Nouvelle promotion</button>} />
          )
          : shown.length === 0 ? (
            <EmptyState icon={SearchX} title="Aucun résultat" text="Aucune promotion ne correspond à votre recherche ou à vos filtres."
              action={filtered ? <button className="ap-btn" onClick={resetFilters}>Réinitialiser les filtres</button> : undefined} />
          )
          : isMobile ? (
            <ul className="ap-cards" aria-label="Promotions">
              {shown.map(({ p, s }) => (
                <li key={p.id} className="ap-card-row" data-active={s === "active"}>
                  <div className="flex items-start gap-3">
                    <div className="ap-thumb"><Img src={p.imageUrl ?? undefined} sizes="96px" className="h-full w-full" /></div>
                    <div className="min-w-0 flex-1">
                      <p className="ap-product-name">{p.title}</p>
                      <p className="ap-clamp">{KIND_LABELS[p.kind]}</p>
                    </div>
                    <StatusPill status={s} />
                  </div>
                  <div className="ap-card-meta">
                    <span>{prices(p)}</span>
                    {discountPercent(p) !== null && <span className="ap-chip">{reduction(p)}</span>}
                    <span className="ml-auto">{periodLabel(p) ?? "Sans limite de dates"}</span>
                  </div>
                  {actions(p)}
                </li>
              ))}
            </ul>
          )
          : (
            <div className="overflow-x-auto">
              <table className="ap-table">
                <thead>
                  <tr>
                    <th className="w-0"><span className="sr-only">Visuel</span></th>
                    <th>Promotion</th>
                    <th>Prix annoncés</th>
                    <th className="ap-num">Réduction</th>
                    <th>Période</th>
                    <th>Statut</th>
                    <th className="ap-num">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map(({ p, s }) => (
                    <tr key={p.id} data-active={s === "active"}>
                      <td><div className="ap-thumb"><Img src={p.imageUrl ?? undefined} sizes="96px" className="h-full w-full" /></div></td>
                      <td>
                        <p className="ap-product-name">{p.title}</p>
                        <p className="ap-clamp">{KIND_LABELS[p.kind]}{targetName(p) ? ` · ${targetName(p)}` : ""}</p>
                      </td>
                      <td className="whitespace-nowrap">{prices(p)}</td>
                      <td className="ap-num whitespace-nowrap">{reduction(p)}</td>
                      <td className="text-sm">{periodLabel(p) ?? <span className="ap-muted-text">Sans limite de dates</span>}</td>
                      <td><StatusPill status={s} /></td>
                      <td>{actions(p)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
      </section>

      {form && (
        <PromotionFormDialog key={form.promotion?.id ?? "new"} promotion={form.promotion} services={services} products={products} linksProblem={linksProblem}
          onClose={() => setForm(null)} onSaved={(text, kind) => { setForm(null); setNotice({ kind: kind ?? "ok", text }); }} />
      )}

      <Dialog open={!!viewing} onOpenChange={(o) => { if (!o) setViewing(null); }}>
        <DialogContent className="ap-dialog max-w-md">
          <DialogHeader className="ap-dialog-head space-y-0 text-left">
            <DialogTitle className="ap-dialog-title">{viewing?.title}</DialogTitle>
            <DialogDescription className="ap-dialog-desc">
              {viewing && <>Aperçu tel que vu sur le site · <StatusPill status={promotionStatus(viewing, today)} />{targetName(viewing) ? ` · ${targetName(viewing)}` : ""}</>}
            </DialogDescription>
          </DialogHeader>
          <div className="ap-dialog-body">{viewing && <PromotionCard promotion={viewing} actions={false} />}</div>
          <div className="ap-dialog-foot">
            <button className="ap-btn" onClick={() => setViewing(null)}>Fermer</button>
            {viewing && <button className="ap-btn ap-btn-primary" onClick={() => { const p = viewing; setViewing(null); openForm(p); }}><Pencil className="h-4 w-4" aria-hidden="true" />Modifier</button>}
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleting} onOpenChange={(o) => { if (!o && !remove.isPending) setDeleting(null); }}>
        <AlertDialogContent className="ap-dialog max-w-md">
          <AlertDialogHeader className="ap-dialog-head text-left">
            <AlertDialogTitle className="ap-dialog-title">Supprimer cette promotion ?</AlertDialogTitle>
            <AlertDialogDescription className="ap-dialog-desc">
              « {deleting?.title} » disparaîtra de la liste et du site. Les prestations et produits concernés ne sont pas modifiés.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="ap-dialog-foot !flex-row !space-x-0">
            <AlertDialogCancel disabled={remove.isPending} className="ap-btn !mt-0">Annuler</AlertDialogCancel>
            <button className="ap-btn ap-btn-danger" disabled={remove.isPending} onClick={() => deleting && confirmDelete(deleting)}>
              {remove.isPending ? "Suppression…" : "Supprimer"}
            </button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
