import { createFileRoute } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Clock, Pencil, Plus, Power, RefreshCw, Search, SearchX, Sparkles } from "lucide-react";
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Img } from "@/components/app";
import { EmptyState, ListSkeleton, Message } from "@/components/admin-ui";
import { ServiceFormDialog } from "@/components/service-form-dialog";
import { services as localServices } from "@/data/services";
import { useIsMobile } from "@/hooks/use-mobile";
import type { AdminService } from "@/lib/admin-api";
import { ServiceCategoriesNotInstalledError } from "@/lib/admin-service-categories";
import { serviceCategoryLabel, setServiceActive, upcomingBookingsByService } from "@/lib/admin-services";
import { buildCategories } from "@/lib/service-categories";
import { formatFCFA } from "@/lib/format";
import { useAdminServiceCategories, useAdminServices, viewState } from "@/lib/admin-queries";

export const Route = createFileRoute("/admin/prestations")({
  head: () => ({ meta: [{ title: "Prestations | Administration Dalanda" }] }),
  component: Prestations,
});

const norm = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
const imageOf = (id: string) => localServices.find((l) => l.id === id)?.image ?? "";

type StatusFilter = "all" | "active" | "inactive";
type Notice = { kind: "ok" | "error"; text: string } | null;

function StatusPills({ s }: { s: AdminService }) {
  return <span className={`ap-pill ${s.active ? "ap-pill-ok" : "ap-pill-muted"}`}>{s.active ? "Active" : "Inactive"}</span>;
}

function Prestations() {
  const qc = useQueryClient();
  const isMobile = useIsMobile();
  const query = useAdminServices();
  const categoriesQuery = useAdminServiceCategories();
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("all");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [form, setForm] = useState<{ service: AdminService | null } | null>(null);
  const [toggling, setToggling] = useState<AdminService | null>(null);
  const togglingNow = useRef(false);
  const [notice, setNotice] = useState<Notice>(null);

  const rows = query.data ?? [];
  // Catégories : celles de la base si la migration est appliquée, sinon celles du code ; une catégorie utilisée par une prestation y figure toujours.
  const categories = buildCategories(categoriesQuery.data, rows.map((s) => s.category));
  // « Migration non appliquée » n'est pas une panne (liste du code, sans action de création) ; toute AUTRE erreur est signalée dans le formulaire.
  const categoriesError = categoriesQuery.isError ? categoriesQuery.error : null;
  const categoriesProblem = categoriesError && !(categoriesError instanceof ServiceCategoriesNotInstalledError)
    ? (categoriesError instanceof Error && categoriesError.message ? categoriesError.message : "Erreur inconnue.")
    : null;
  const shown = rows.filter((s) =>
    (cat === "all" || s.category === cat)
    && (status === "all" || (status === "active") === s.active)
    && norm(`${s.name} ${s.description}`).includes(norm(q.trim())));
  const filtered = q.trim() !== "" || cat !== "all" || status !== "all";
  const resetFilters = () => { setQ(""); setCat("all"); setStatus("all"); };
  const openForm = (service: AdminService | null) => {
    setNotice(null);
    if (categoriesQuery.isError) void categoriesQuery.refetch(); // la migration a peut-être été appliquée depuis : l'action de création apparaît sans recharger la page
    setForm({ service });
  };
  const view = viewState(query, shown.length);
  const tabs: { id: StatusFilter; label: string; count: number }[] = [
    { id: "all", label: "Toutes", count: rows.length },
    { id: "active", label: "Actives", count: rows.filter((s) => s.active).length },
    { id: "inactive", label: "Inactives", count: rows.filter((s) => !s.active).length },
  ];

  // Réservations à venir de la prestation, relues seulement quand on propose de la désactiver.
  const upcoming = useQuery({ queryKey: ["admin", "services", "upcoming"], queryFn: () => upcomingBookingsByService(), enabled: !!toggling, staleTime: 0, retry: false });
  const upcomingCount = toggling && upcoming.isSuccess ? upcoming.data[toggling.id] ?? 0 : null;

  const toggle = useMutation({
    mutationFn: (s: AdminService) => setServiceActive(s.id, !s.active),
    onSuccess: async (_d, s) => {
      await Promise.all([qc.invalidateQueries({ queryKey: ["admin", "services"] }), qc.invalidateQueries({ queryKey: ["catalogue"] })]);
      setNotice({ kind: "ok", text: s.active ? `« ${s.name} » est désactivée : elle n'est plus proposée aux clientes.` : `« ${s.name} » est réactivée.` });
    },
    onError: (e) => setNotice({ kind: "error", text: e instanceof Error ? e.message : "Modification impossible." }),
    onSettled: () => { togglingNow.current = false; setToggling(null); },
  });

  const run = (s: AdminService) => {
    if (togglingNow.current) return;
    togglingNow.current = true;
    toggle.mutate(s);
  };
  const flip = (s: AdminService) => {
    if (togglingNow.current) return;
    setNotice(null);
    // Désactiver demande une confirmation (avec les réservations à venir) ; réactiver est immédiat.
    if (s.active) setToggling(s); else run(s);
  };

  const actions = (s: AdminService) => (
    <div className="flex items-center justify-end gap-1">
      <button className="ap-btn !min-h-[2rem] !px-3 !text-[0.8rem]" aria-label={`Modifier ${s.name}`} onClick={() => openForm(s)}><Pencil className="h-3.5 w-3.5" aria-hidden="true" />Modifier</button>
      <button className="ap-icon-btn" disabled={toggle.isPending} title={s.active ? "Désactiver" : "Réactiver"} aria-label={`${s.active ? "Désactiver" : "Réactiver"} ${s.name}`} onClick={() => flip(s)}>
        <Power className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );

  return (
    <div className="ap-page space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="ap-title">Prestations</h1>
          <p className="ap-subtitle">Catalogue des soins, services et tarifs proposés aux clientes.</p>
        </div>
        <button className="ap-btn ap-btn-primary" onClick={() => openForm(null)}><Plus className="h-4 w-4" aria-hidden="true" />Nouvelle prestation</button>
      </header>

      {notice && <Message kind={notice.kind}>{notice.text}</Message>}

      <section className="ap-card overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 border-b p-3 sm:p-4" style={{ borderColor: "var(--ap-line)" }}>
          <div role="tablist" aria-label="Statut" className="ap-tabs">
            {tabs.map((t) => (
              <button key={t.id} role="tab" aria-selected={status === t.id} className="ap-tab" onClick={() => setStatus(t.id)}>
                {t.label}{query.isSuccess && <span className="ap-tab-count">{t.count}</span>}
              </button>
            ))}
          </div>
          <div className="ap-search">
            <Search aria-hidden="true" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher par nom ou description" aria-label="Rechercher une prestation" className="ap-input" />
          </div>
          <select className="ap-select !w-auto" aria-label="Filtrer par catégorie" value={cat} onChange={(e) => setCat(e.target.value)}>
            <option value="all">Toutes les catégories</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </div>
        {query.isSuccess && rows.length > 0 && (
          <div className="flex items-center justify-between gap-3 border-b px-4 py-2 text-sm" style={{ borderColor: "var(--ap-line)", color: "var(--ap-ink-soft)" }}>
            <p aria-live="polite">{filtered ? `${shown.length} sur ${rows.length} prestation${rows.length > 1 ? "s" : ""}` : `${rows.length} prestation${rows.length > 1 ? "s" : ""}`}</p>
            {filtered && <button className="ap-link-btn" onClick={resetFilters}>Réinitialiser les filtres</button>}
          </div>
        )}

        {view.status === "loading" ? <ListSkeleton />
          : view.status === "error" ? (
            <EmptyState icon={RefreshCw} tone="danger" title={view.title ?? "Chargement impossible"} text={view.text ?? "Les données n'ont pas pu être récupérées. Réessayez dans un instant."}
              action={<button onClick={() => void query.refetch()} className="ap-btn"><RefreshCw className="h-4 w-4" aria-hidden="true" />Réessayer</button>} />
          )
          : rows.length === 0 ? (
            <EmptyState icon={Sparkles} title="Aucune prestation" text="Ajoutez votre première prestation avec le bouton ci-dessous."
              action={<button className="ap-btn ap-btn-primary" onClick={() => openForm(null)}><Plus className="h-4 w-4" aria-hidden="true" />Nouvelle prestation</button>} />
          )
          : shown.length === 0 ? (
            <EmptyState icon={SearchX} title="Aucun résultat" text="Aucune prestation ne correspond à votre recherche ou à vos filtres."
              action={filtered ? <button className="ap-btn" onClick={resetFilters}>Réinitialiser les filtres</button> : undefined} />
          )
          : isMobile ? (
            <ul className="ap-cards" aria-label="Prestations">
              {shown.map((s) => (
                <li key={s.id} className="ap-card-row" data-active={s.active}>
                  <div className="flex items-start gap-3">
                    <div className="ap-thumb"><Img src={s.imageUrl || imageOf(s.id)} sizes="96px" className="h-full w-full" /></div>
                    <div className="min-w-0 flex-1">
                      <p className="ap-product-name">{s.name}</p>
                      {s.description && <p className="ap-clamp">{s.description}</p>}
                    </div>
                    <StatusPills s={s} />
                  </div>
                  <div className="ap-card-meta">
                    <span className="ap-chip">{serviceCategoryLabel(s.category, categories)}</span>
                    <span className="inline-flex items-center gap-1"><Clock className="h-3.5 w-3.5" aria-hidden="true" />{s.durationLabel}</span>
                    <span className="ml-auto font-semibold">{formatFCFA(s.price)}</span>
                  </div>
                  {s.isDemo && <p className="ap-demo-note">Tarif à confirmer</p>}
                  {actions(s)}
                </li>
              ))}
            </ul>
          )
          : (
            <div className="overflow-x-auto">
              <table className="ap-table">
                <thead>
                  <tr>
                    <th className="w-0"><span className="sr-only">Photo</span></th>
                    <th>Prestation</th>
                    <th>Catégorie</th>
                    <th>Durée</th>
                    <th className="ap-num">Prix</th>
                    <th>Statut</th>
                    <th className="ap-num">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((s) => (
                    <tr key={s.id} data-active={s.active}>
                      <td><div className="ap-thumb"><Img src={s.imageUrl || imageOf(s.id)} sizes="96px" className="h-full w-full" /></div></td>
                      <td>
                        <p className="ap-product-name">{s.name}</p>
                        {s.description && <p className="ap-clamp">{s.description}</p>}
                      </td>
                      <td><span className="ap-chip">{serviceCategoryLabel(s.category, categories)}</span></td>
                      <td className="whitespace-nowrap">{s.durationLabel}</td>
                      <td className="ap-num whitespace-nowrap">
                        {formatFCFA(s.price)}
                        {s.isDemo && <p className="ap-demo-note">Tarif à confirmer</p>}
                      </td>
                      <td><StatusPills s={s} /></td>
                      <td>{actions(s)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
      </section>

      {form && (
        <ServiceFormDialog key={form.service?.id ?? "new"} service={form.service} fallbackImage={form.service ? imageOf(form.service.id) : ""}
          existingIds={rows.map((s) => s.id)}
          categories={categories} canCreateCategory={categoriesQuery.isSuccess} categoriesProblem={categoriesProblem} onRetryCategories={() => void categoriesQuery.refetch()} onClose={() => setForm(null)} onSaved={(text, kind) => { setForm(null); setNotice({ kind: kind ?? "ok", text }); }} />
      )}

      <AlertDialog open={!!toggling} onOpenChange={(o) => { if (!o && !toggle.isPending) setToggling(null); }}>
        <AlertDialogContent className="ap-dialog max-w-md">
          <AlertDialogHeader className="ap-dialog-head text-left">
            <AlertDialogTitle className="ap-dialog-title">Désactiver cette prestation ?</AlertDialogTitle>
            <AlertDialogDescription className="ap-dialog-desc">
              « {toggling?.name} » ne sera plus proposée dans le catalogue et ne pourra plus être réservée. Elle n'est pas supprimée : vous pourrez la réactiver à tout moment.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="ap-dialog-body !pb-4 !pt-3 text-sm" aria-live="polite">
            {upcoming.isPending && <p className="ap-hint">Vérification des réservations à venir…</p>}
            {upcoming.isError && <p className="ap-error">Les réservations à venir n'ont pas pu être vérifiées.</p>}
            {upcomingCount !== null && upcomingCount > 0 && (
              <p className="ap-notice ap-notice-info">
                {upcomingCount === 1 ? "1 réservation à venir utilise" : `${upcomingCount} réservations à venir utilisent`} cette prestation : {upcomingCount === 1 ? "elle est conservée" : "elles sont conservées"} avec son nom, sa durée et son prix.
              </p>
            )}
            {upcomingCount === 0 && <p className="ap-hint">Aucune réservation à venir ne concerne cette prestation.</p>}
          </div>
          <AlertDialogFooter className="ap-dialog-foot !flex-row !space-x-0">
            <AlertDialogCancel disabled={toggle.isPending} className="ap-btn !mt-0">Annuler</AlertDialogCancel>
            <button className="ap-btn ap-btn-primary" disabled={toggle.isPending} onClick={() => toggling && run(toggling)}>
              {toggle.isPending ? "Désactivation…" : "Désactiver"}
            </button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
