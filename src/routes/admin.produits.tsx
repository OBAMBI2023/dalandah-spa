import { createFileRoute } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Info, Package, Pencil, Plus, Power, RefreshCw, Search, SearchX } from "lucide-react";
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Img } from "@/components/app";
import { ProductFormDialog } from "@/components/product-form-dialog";
import { getProduct, productCategories } from "@/data/products";
import { formatFCFA } from "@/lib/format";
import { SHOP_KEY } from "@/lib/shop";
import { isAvailable, isLowStock, productStats, setProductActive, type AdminProduct } from "@/lib/admin-products";
import { useAdminCategories, useAdminProducts, viewState } from "@/lib/admin-queries";
import { CategoriesNotInstalledError, mergeCategories } from "@/lib/admin-categories";

export const Route = createFileRoute("/admin/produits")({
  head: () => ({ meta: [{ title: "Produits | Administration Dalanda" }] }),
  component: Produits,
});

const norm = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

type StatusFilter = "all" | "active" | "inactive";
type Notice = { kind: "ok" | "error"; text: string } | null;

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="ap-stat">
      <p className="ap-stat-label">{label}</p>
      <p className="ap-stat-value">{value}</p>
    </div>
  );
}

function StatusBadges({ p }: { p: AdminProduct }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {!p.active ? <span className="ap-pill ap-pill-muted">Inactif</span>
        : p.stock === 0 ? <span className="ap-pill ap-pill-danger">Rupture</span>
        : <span className="ap-pill ap-pill-ok">Disponible</span>}
      {p.active && p.stock > 0 && isLowStock(p) && <span className="ap-pill ap-pill-warn">Stock bas</span>}
    </div>
  );
}

function Message({ kind, children }: { kind: "info" | "ok" | "error"; children: string }) {
  const Icon = kind === "ok" ? CheckCircle2 : kind === "error" ? AlertTriangle : Info;
  return (
    <div role={kind === "error" ? "alert" : "status"} className={`ap-notice ap-notice-${kind}`}>
      <Icon aria-hidden="true" /><p>{children}</p>
    </div>
  );
}

function Skeleton() {
  return (
    <div aria-busy="true" aria-label="Chargement" className="space-y-1 p-4">
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="flex items-center gap-4 py-2.5">
          <div className="ap-skeleton h-11 w-11 shrink-0" />
          <div className="flex-1 space-y-2"><div className="ap-skeleton h-3.5 w-1/3" /><div className="ap-skeleton h-3 w-1/5" /></div>
          <div className="ap-skeleton hidden h-3.5 w-20 sm:block" /><div className="ap-skeleton h-3.5 w-16" />
        </div>
      ))}
    </div>
  );
}

function Empty({ icon: Icon, title, text, action }: { icon: typeof Package; title: string; text: string; action?: React.ReactNode }) {
  return (
    <div role="status" className="ap-empty">
      <div className="ap-empty-icon"><Icon className="h-6 w-6" strokeWidth={1.5} aria-hidden="true" /></div>
      <h3>{title}</h3>
      <p>{text}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

function Produits() {
  const qc = useQueryClient();
  const query = useAdminProducts();
  const categoriesQuery = useAdminCategories();
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("all");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [form, setForm] = useState<{ product: AdminProduct | null } | null>(null);
  const [toggling, setToggling] = useState<AdminProduct | null>(null);
  const togglingNow = useRef(false);
  const [notice, setNotice] = useState<Notice>(null);

  const rows = query.data ?? [];
  // Liste des catégories : celles du code, celles enregistrées en base (si la migration est appliquée) et celles des produits.
  const categories = mergeCategories(productCategories, categoriesQuery.data ?? [], rows.map((p) => p.category));
  const shown = rows.filter((p) =>
    (cat === "all" || p.category === cat)
    && (status === "all" || (status === "active") === p.active)
    && norm(`${p.name} ${p.sku}`).includes(norm(q.trim())));
  const stats = query.isSuccess ? productStats(rows) : null;
  const demo = rows.some((p) => p.isDemo);
  const filtered = q.trim() !== "" || cat !== "all" || status !== "all";
  const resetFilters = () => { setQ(""); setCat("all"); setStatus("all"); };
  // Catégories : « migration non appliquée » n'est pas une panne (le formulaire garde la liste du code, sans action de création) ;
  // toute AUTRE erreur (réseau, droits, serveur) est signalée dans le formulaire, avec un bouton pour réessayer.
  const categoriesError = categoriesQuery.isError ? categoriesQuery.error : null;
  const categoriesProblem = categoriesError && !(categoriesError instanceof CategoriesNotInstalledError)
    ? (categoriesError instanceof Error && categoriesError.message ? categoriesError.message : "Erreur inconnue.")
    : null;
  const openForm = (product: AdminProduct | null) => {
    setNotice(null);
    if (categoriesQuery.isError) void categoriesQuery.refetch(); // la migration a peut-être été appliquée depuis : l'action de création apparaît sans recharger la page
    setForm({ product });
  };

  const toggle = useMutation({
    mutationFn: (p: AdminProduct) => setProductActive(p.id, !p.active),
    onSuccess: async (_d, p) => {
      await Promise.all([qc.invalidateQueries({ queryKey: ["admin", "products"] }), qc.invalidateQueries({ queryKey: SHOP_KEY })]);
      setNotice({ kind: "ok", text: p.active ? `« ${p.name} » est désactivé : il n'apparaît plus dans la boutique.` : `« ${p.name} » est réactivé.` });
    },
    onError: (e) => setNotice({ kind: "error", text: e instanceof Error ? e.message : "Modification impossible." }),
    onSettled: () => { togglingNow.current = false; setToggling(null); },
  });

  const run = (p: AdminProduct) => {
    if (togglingNow.current) return;
    togglingNow.current = true;
    toggle.mutate(p);
  };

  const flip = (p: AdminProduct) => {
    if (togglingNow.current) return;
    setNotice(null);
    // Désactiver demande une confirmation ; réactiver est immédiat.
    if (p.active) setToggling(p); else run(p);
  };

  const view = viewState(query, shown.length);
  const tabs: { id: StatusFilter; label: string; count: number }[] = [
    { id: "all", label: "Tous", count: rows.length },
    { id: "active", label: "Actifs", count: rows.filter((p) => p.active).length },
    { id: "inactive", label: "Inactifs", count: rows.filter((p) => !p.active).length },
  ];

  return (
    <div className="ap-page space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="ap-title">Produits</h1>
          <p className="ap-subtitle">Gérez votre catalogue, vos prix et vos stocks</p>
        </div>
        <button className="ap-btn ap-btn-primary" onClick={() => openForm(null)}><Plus className="h-4 w-4" aria-hidden="true" />Ajouter un produit</button>
      </header>

      {stats && (
        <div className="ap-card ap-stats" aria-label="Statistiques du catalogue">
          <Stat label="Produits" value={stats.total} />
          <Stat label="Produits actifs" value={stats.active} />
          <Stat label="Produits indisponibles" value={stats.unavailable} />
        </div>
      )}

      {demo && <Message kind="info">Certains produits sont des données de démonstration (prix, stocks et références provisoires) : à remplacer par les vrais produits.</Message>}
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
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher par nom ou référence" aria-label="Rechercher un produit" className="ap-input" />
          </div>
          <select className="ap-select !w-auto" aria-label="Filtrer par catégorie" value={cat} onChange={(e) => setCat(e.target.value)}>
            <option value="all">Toutes les catégories</option>
            {categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>

        {view.status === "loading" ? <Skeleton />
          : view.status === "error" ? (
            <div role="alert" className="ap-empty">
              <div className="ap-empty-icon" style={{ background: "var(--ap-danger-soft)", color: "var(--ap-danger)" }}><AlertTriangle className="h-6 w-6" strokeWidth={1.5} aria-hidden="true" /></div>
              <h3>{view.title ?? "Chargement impossible"}</h3>
              <p>{view.text ?? "Les données n'ont pas pu être récupérées. Réessayez dans un instant."}</p>
              <button onClick={() => void query.refetch()} className="ap-btn mt-5"><RefreshCw className="h-4 w-4" aria-hidden="true" />Réessayer</button>
            </div>
          )
          : rows.length === 0 ? (
            <Empty icon={Package} title="Aucun produit" text="Ajoutez votre premier produit avec le bouton ci-dessous."
              action={<button className="ap-btn ap-btn-primary" onClick={() => openForm(null)}><Plus className="h-4 w-4" aria-hidden="true" />Ajouter un produit</button>} />
          )
          : shown.length === 0 ? (
            <Empty icon={SearchX} title="Aucun résultat" text="Aucun produit ne correspond à votre recherche ou à vos filtres."
              action={filtered ? <button className="ap-btn" onClick={resetFilters}>Réinitialiser les filtres</button> : undefined} />
          )
          : (
            <div className="overflow-x-auto">
              <table className="ap-table">
                <thead>
                  <tr>
                    <th>Produit</th>
                    <th className="hidden md:table-cell">Catégorie</th>
                    <th className="ap-num">Prix</th>
                    <th className="ap-num hidden lg:table-cell">Coût d'achat</th>
                    <th className="ap-num">Stock</th>
                    <th>Statut</th>
                    <th className="ap-num">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((p) => (
                    <tr key={p.id} data-available={isAvailable(p)}>
                      <td>
                        <div className="flex items-center gap-3">
                          <div className="ap-thumb"><Img src={p.imageUrl || getProduct(p.id)?.images[0] || ""} sizes="96px" className="h-full w-full" /></div>
                          <div className="min-w-0"><p className="ap-product-name">{p.name}</p><p className="ap-product-ref">{p.sku}</p></div>
                        </div>
                      </td>
                      <td className="hidden md:table-cell"><span className="ap-chip">{p.category}</span></td>
                      <td className="ap-num whitespace-nowrap">{formatFCFA(p.price)}</td>
                      <td className="ap-num hidden whitespace-nowrap lg:table-cell">{p.costPrice === null ? <span className="ap-muted-text">Inconnu</span> : formatFCFA(p.costPrice)}</td>
                      <td className={`ap-num ${p.stock === 0 ? "ap-stock-out" : p.active && isLowStock(p) ? "ap-stock-low" : ""}`}>{p.stock}</td>
                      <td><StatusBadges p={p} /></td>
                      <td>
                        <div className="flex items-center justify-end gap-1">
                          <button className="ap-btn !min-h-[2rem] !px-3 !text-[0.8rem]" aria-label={`Modifier ${p.name}`} onClick={() => openForm(p)}><Pencil className="h-3.5 w-3.5" aria-hidden="true" />Modifier</button>
                          <button className="ap-icon-btn" disabled={toggle.isPending} title={p.active ? "Désactiver" : "Réactiver"} aria-label={`${p.active ? "Désactiver" : "Réactiver"} ${p.name}`} onClick={() => flip(p)}>
                            <Power className="h-4 w-4" aria-hidden="true" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
      </section>

      {form && (
        <ProductFormDialog key={form.product?.id ?? "new"} product={form.product} categories={categories} canCreateCategory={categoriesQuery.isSuccess}
          categoriesProblem={categoriesProblem} onRetryCategories={() => void categoriesQuery.refetch()}
          existing={{ ids: rows.map((p) => p.id), skus: rows.map((p) => p.sku) }}
          onClose={() => setForm(null)} onSaved={(text, kind) => { setForm(null); setNotice({ kind: kind ?? "ok", text }); }} />
      )}

      <AlertDialog open={!!toggling} onOpenChange={(o) => { if (!o && !toggle.isPending) setToggling(null); }}>
        <AlertDialogContent className="ap-dialog max-w-md">
          <AlertDialogHeader className="ap-dialog-head text-left">
            <AlertDialogTitle className="ap-dialog-title">Désactiver ce produit ?</AlertDialogTitle>
            <AlertDialogDescription className="ap-dialog-desc">
              « {toggling?.name} » n'apparaîtra plus dans la boutique. Il n'est pas supprimé : ses données, son stock et sa photo sont conservés, et vous pourrez le réactiver à tout moment.
            </AlertDialogDescription>
          </AlertDialogHeader>
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
