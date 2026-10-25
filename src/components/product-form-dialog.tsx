import { useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  createAdminProduct, emptyProductForm, formToInput, ProductActionError, productFormSchema, productToForm, slugify, squeeze, updateAdminProduct,
  type AdminProduct, type ProductFormValues,
} from "@/lib/admin-products";
import { SHOP_KEY } from "@/lib/shop";

const err = (m?: string) => (m ? <p role="alert" className="mt-1 text-xs text-destructive">{m}</p> : null);

/**
 * Création (product absent) ou modification d'un produit. La modification n'envoie ni photo ni stock : admin_update_product n'en a pas,
 * donc rien ne peut les effacer. Le stock actuel est montré en lecture seule.
 */
export function ProductFormDialog({ product, categories, onClose, onSaved }: {
  product: AdminProduct | null; categories: readonly string[]; onClose: () => void; onSaved: (text: string) => void;
}) {
  const qc = useQueryClient();
  const editing = product !== null;
  const [formError, setFormError] = useState("");
  // Verrou synchrone : isPending ne change qu'au rendu suivant, un second clic immédiat passerait sinon.
  const sending = useRef(false);
  const { register, handleSubmit, setError, watch, formState: { errors } } = useForm<ProductFormValues>({
    resolver: zodResolver(productFormSchema),
    defaultValues: product ? productToForm(product) : emptyProductForm,
  });
  // Catégorie inconnue de la liste proposée (produit importé) : on la garde sélectionnable pour ne pas la perdre.
  const options = product && !categories.includes(product.category) ? [...categories, product.category] : categories;
  const name = watch("name");

  const save = useMutation({
    mutationFn: async (v: ProductFormValues) => {
      const input = formToInput(v);
      if (product) { await updateAdminProduct(product.id, input); return; }
      const id = slugify(v.name);
      if (id.length < 2) throw new ProductActionError("invalid_input", "Le nom doit contenir au moins 2 lettres ou chiffres.");
      await createAdminProduct({ ...input, id, initialQty: Number(v.initialQty.replace(/[\s\u00a0\u202f]/g, "")) });
    },
    onSuccess: async (_d, v) => {
      await Promise.all([qc.invalidateQueries({ queryKey: ["admin", "products"] }), qc.invalidateQueries({ queryKey: SHOP_KEY })]);
      onSaved(editing ? `« ${v.name.trim()} » a été modifié.` : `« ${v.name.trim()} » a été ajouté au catalogue. Vous pouvez maintenant lui associer une photo.`);
    },
    onError: (e) => {
      // Le message de la base est conservé tel quel ; on le rattache au champ concerné quand c'est possible.
      const message = e instanceof Error ? e.message : "Enregistrement impossible.";
      if (e instanceof ProductActionError && e.reason === "sku_taken") setError("sku", { message });
      else if (e instanceof ProductActionError && e.reason === "id_taken") setError("name", { message });
      else setFormError(message);
    },
    onSettled: () => { sending.current = false; },
  });

  const submit = handleSubmit((v) => {
    if (sending.current) return;
    sending.current = true;
    setFormError("");
    save.mutate(v);
  });

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !save.isPending) onClose(); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl">{editing ? "Modifier le produit" : "Ajouter un produit"}</DialogTitle>
          <DialogDescription>{editing ? product.name : "Les champs marqués d'une étoile sont obligatoires."}</DialogDescription>
        </DialogHeader>

        <form onSubmit={(e) => void submit(e)} noValidate className="space-y-4">
          <div>
            <Label htmlFor="p-name">Nom *</Label>
            <Input id="p-name" className="mt-1" {...register("name")} />
            {err(errors.name?.message)}
            {!editing && name.trim() && <p className="mt-1 text-xs text-muted-foreground">Adresse du produit : /boutique/{slugify(name) || "…"}</p>}
            {editing && <p className="mt-1 text-xs text-muted-foreground">Adresse du produit : /boutique/{product.id} (non modifiable)</p>}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="p-sku">Référence *</Label>
              <Input id="p-sku" className="mt-1 uppercase" placeholder="DAL-SAV-MEL" {...register("sku")} />
              {err(errors.sku?.message)}
            </div>
            <div>
              <Label htmlFor="p-category">Catégorie *</Label>
              <select id="p-category" className="field mt-1" {...register("category")}>
                <option value="">Choisir…</option>
                {options.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              {err(errors.category?.message)}
            </div>
          </div>
          <div>
            <Label htmlFor="p-short">Résumé</Label>
            <Input id="p-short" className="mt-1" {...register("shortDescription")} />
            {err(errors.shortDescription?.message)}
          </div>
          <div>
            <Label htmlFor="p-description">Description</Label>
            <Textarea id="p-description" className="mt-1" rows={3} {...register("description")} />
            {err(errors.description?.message)}
          </div>
          <div>
            <Label htmlFor="p-features">Caractéristiques (une par ligne)</Label>
            <Textarea id="p-features" className="mt-1" rows={3} {...register("features")} />
            {err(errors.features?.message)}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="p-volume">Contenance</Label>
              <Input id="p-volume" className="mt-1" placeholder="200 ml" {...register("volume")} />
              {err(errors.volume?.message)}
            </div>
            <div>
              <Label htmlFor="p-usage">Conseils d'utilisation</Label>
              <Input id="p-usage" className="mt-1" {...register("usageTips")} />
              {err(errors.usageTips?.message)}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="p-price">Prix de vente (FCFA) *</Label>
              <Input id="p-price" inputMode="numeric" className="mt-1" {...register("price")} />
              {err(errors.price?.message)}
            </div>
            <div>
              <Label htmlFor="p-cost">Coût d'achat (FCFA)</Label>
              <Input id="p-cost" inputMode="numeric" className="mt-1" {...register("costPrice")} />
              {err(errors.costPrice?.message)}
              <p className="mt-1 text-xs text-muted-foreground">Visible des administrateurs seulement. Vide = coût inconnu.</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              {editing ? (
                <>
                  <Label htmlFor="p-stock">Stock actuel</Label>
                  <Input id="p-stock" className="mt-1" value={product.stock} readOnly aria-readonly="true" />
                  <p className="mt-1 text-xs text-muted-foreground">Le stock n'est pas modifiable ici : les entrées, sorties et ajustements arrivent à l'étape suivante.</p>
                </>
              ) : (
                <>
                  <Label htmlFor="p-initial">Stock initial *</Label>
                  <Input id="p-initial" inputMode="numeric" className="mt-1" {...register("initialQty")} />
                  {err(errors.initialQty?.message)}
                </>
              )}
            </div>
            <div>
              <Label htmlFor="p-threshold">Seuil d'alerte</Label>
              <Input id="p-threshold" inputMode="numeric" className="mt-1" {...register("lowStockThreshold")} />
              {err(errors.lowStockThreshold?.message)}
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="h-4 w-4" {...register("active")} />
            Produit actif (visible dans la boutique dès qu'il est en stock)
          </label>

          {formError && <p role="alert" className="rounded-lg border border-destructive/40 p-3 text-sm text-destructive">{formError}</p>}

          <div className="grid grid-cols-2 gap-2">
            <button type="submit" disabled={save.isPending} className="btn btn-primary">{save.isPending ? "Enregistrement…" : editing ? "Enregistrer" : "Ajouter le produit"}</button>
            <button type="button" disabled={save.isPending} onClick={onClose} className="btn btn-outline">Annuler</button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
