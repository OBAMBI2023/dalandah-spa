import { createFileRoute } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Power, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { DataState, PageHeader, Panel } from "@/components/admin";
import { Img } from "@/components/app";
import { ProductFormDialog } from "@/components/product-form-dialog";
import { ProductPhotoDialog } from "@/components/product-photo-dialog";
import { getProduct, productCategories } from "@/data/products";
import { formatFCFA } from "@/lib/format";
import { SHOP_KEY } from "@/lib/shop";
import { isAvailable, isLowStock, productStats, setProductActive, type AdminProduct } from "@/lib/admin-products";
import { useAdminProducts, viewState } from "@/lib/admin-queries";

export const Route = createFileRoute("/admin/produits")({
  head: () => ({ meta: [{ title: "Produits | Administration Dalanda" }] }),
  component: Produits,
});

const norm = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border bg-card px-5 py-4 shadow-soft">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-1 text-3xl text-deep">{value}</p>
    </div>
  );
}

function StatusBadges({ p }: { p: AdminProduct }) {
  return (
    <div className="flex flex-wrap gap-1">
      {!p.active ? <Badge variant="outline">Inactif</Badge> : p.stock === 0 ? <Badge variant="destructive">Rupture</Badge> : <Badge variant="secondary">Disponible</Badge>}
      {p.active && p.stock > 0 && isLowStock(p) && <Badge variant="outline">Stock bas</Badge>}
    </div>
  );
}

function Produits() {
  const qc = useQueryClient();
  const query = useAdminProducts();
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("all");
  const [status, setStatus] = useState<"all" | "active" | "inactive">("all");
  const [form, setForm] = useState<{ product: AdminProduct | null } | null>(null);
  const [toggling, setToggling] = useState<AdminProduct | null>(null);
  const toggling_ = useRef(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const rows = query.data ?? [];
  const categories = [...new Set([...productCategories, ...rows.map((p) => p.category)])];
  const shown = rows.filter((p) =>
    (cat === "all" || p.category === cat)
    && (status === "all" || (status === "active") === p.active)
    && norm(`${p.name} ${p.sku}`).includes(norm(q.trim())));
  const stats = query.isSuccess ? productStats(rows) : null;
  const demo = rows.some((p) => p.isDemo);

  const toggle = useMutation({
    mutationFn: (p: AdminProduct) => setProductActive(p.id, !p.active),
    onSuccess: async (_d, p) => {
      await Promise.all([qc.invalidateQueries({ queryKey: ["admin", "products"] }), qc.invalidateQueries({ queryKey: SHOP_KEY })]);
      setNotice({ kind: "ok", text: p.active ? `« ${p.name} » est désactivé : il n'apparaît plus dans la boutique.` : `« ${p.name} » est réactivé.` });
    },
    onError: (e) => setNotice({ kind: "error", text: e instanceof Error ? e.message : "Modification impossible." }),
    onSettled: () => { toggling_.current = false; setToggling(null); },
  });

  const run = (p: AdminProduct) => {
    if (toggling_.current) return;
    toggling_.current = true;
    toggle.mutate(p);
  };

  const flip = (p: AdminProduct) => {
    if (toggling_.current) return;
    setNotice(null);
    // Désactiver demande une confirmation ; réactiver est immédiat.
    if (p.active) setToggling(p); else run(p);
  };

  return (
    <>
      <PageHeader
        title="Produits"
        text="Gérez votre catalogue, vos prix et vos stocks"
        actions={<button className="btn btn-primary" onClick={() => { setNotice(null); setForm({ product: null }); }}><Plus className="h-4 w-4" />Ajouter un produit</button>}
      />

      {stats && (
        <div className="grid gap-3 sm:grid-cols-3" aria-label="Statistiques du catalogue">
          <Stat label="Produits" value={stats.total} />
          <Stat label="Produits actifs" value={stats.active} />
          <Stat label="Produits indisponibles" value={stats.unavailable} />
        </div>
      )}

      {demo && <p className="rounded-xl bg-gold/10 px-4 py-2.5 text-sm text-deep">Certains produits sont des données de démonstration (prix, stocks et références provisoires) : à remplacer par les vrais produits.</p>}
      {notice && <p role={notice.kind === "error" ? "alert" : "status"} className={`rounded-xl border px-4 py-2.5 text-sm ${notice.kind === "error" ? "border-destructive/40 text-destructive" : "text-sage"}`}>{notice.text}</p>}

      <Panel>
        <div className="flex flex-wrap gap-3 border-b p-4">
          <div className="relative min-w-52 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher un produit…" aria-label="Rechercher un produit" className="pl-9" />
          </div>
          <select className="field w-auto" aria-label="Filtrer par catégorie" value={cat} onChange={(e) => setCat(e.target.value)}>
            <option value="all">Toutes les catégories</option>
            {categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <select className="field w-auto" aria-label="Filtrer par statut" value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
            <option value="all">Tous les statuts</option>
            <option value="active">Actifs</option>
            <option value="inactive">Inactifs</option>
          </select>
        </div>
        <DataState {...viewState(query, shown.length)} onRetry={() => void query.refetch()}
          {...(query.isSuccess && rows.length === 0 ? { title: "Aucun produit", text: "Ajoutez votre premier produit avec le bouton ci-dessus." } : query.isSuccess && shown.length === 0 ? { title: "Aucun résultat", text: "Aucun produit ne correspond à votre recherche ou à vos filtres." } : {})}>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Produit</TableHead>
                  <TableHead className="hidden md:table-cell">Catégorie</TableHead>
                  <TableHead className="text-right">Prix</TableHead>
                  <TableHead className="hidden text-right lg:table-cell">Coût d'achat</TableHead>
                  <TableHead className="text-right">Stock</TableHead>
                  <TableHead>Statut</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shown.map((p) => (
                  <TableRow key={p.id} data-available={isAvailable(p)}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <Img src={p.imageUrl || getProduct(p.id)?.images[0] || ""} sizes="96px" className="h-10 w-10 shrink-0 rounded-lg" />
                        <div><p className="font-medium text-deep">{p.name}</p><p className="text-xs text-muted-foreground">{p.sku}</p></div>
                      </div>
                    </TableCell>
                    <TableCell className="hidden md:table-cell"><Badge variant="secondary">{p.category}</Badge></TableCell>
                    <TableCell className="text-right">{formatFCFA(p.price)}</TableCell>
                    <TableCell className="hidden text-right lg:table-cell">{p.costPrice === null ? <span className="text-muted-foreground">Inconnu</span> : formatFCFA(p.costPrice)}</TableCell>
                    <TableCell className="text-right">{p.stock}</TableCell>
                    <TableCell><StatusBadges p={p} /></TableCell>
                    <TableCell>
                      <div className="flex flex-wrap justify-end gap-2">
                        <button className="btn btn-outline !px-3 text-sm" aria-label={`Modifier ${p.name}`} onClick={() => { setNotice(null); setForm({ product: p }); }}><Pencil className="h-4 w-4" />Modifier</button>
                        <ProductPhotoDialog product={p} fallbackImage={getProduct(p.id)?.images[0] ?? ""} />
                        <button className="btn btn-outline !px-3 text-sm" disabled={toggle.isPending} aria-label={`${p.active ? "Désactiver" : "Réactiver"} ${p.name}`} onClick={() => flip(p)}>
                          <Power className="h-4 w-4" />{p.active ? "Désactiver" : "Réactiver"}
                        </button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </DataState>
      </Panel>

      {form && (
        <ProductFormDialog key={form.product?.id ?? "new"} product={form.product} categories={productCategories}
          onClose={() => setForm(null)} onSaved={(text) => { setForm(null); setNotice({ kind: "ok", text }); }} />
      )}

      <AlertDialog open={!!toggling} onOpenChange={(o) => { if (!o && !toggle.isPending) setToggling(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Désactiver ce produit ?</AlertDialogTitle>
            <AlertDialogDescription>
              « {toggling?.name} » n'apparaîtra plus dans la boutique. Il n'est pas supprimé : ses données, son stock et sa photo sont conservés, et vous pourrez le réactiver à tout moment.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={toggle.isPending}>Annuler</AlertDialogCancel>
            <button className="btn btn-primary" disabled={toggle.isPending} onClick={() => toggling && run(toggling)}>
              {toggle.isPending ? "Désactivation…" : "Désactiver"}
            </button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
