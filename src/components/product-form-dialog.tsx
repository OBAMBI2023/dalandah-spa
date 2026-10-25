import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Camera, ImagePlus, Plus, Trash2, Undo2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Img } from "@/components/app";
import { CategoryCreateDialog } from "@/components/category-create-dialog";
import { getProduct } from "@/data/products";
import { mergeCategories } from "@/lib/admin-categories";
import { IMAGE_TYPES, removeProductImage, uploadProductImage, validateImageFile } from "@/lib/admin-images";
import {
  createProductAuto, emptyProductForm, findCreated, formToInput, listAdminProducts, nextSku, ProductActionError, productFormSchema, productToForm, productToInput, skuBase, squeeze,
  updateAdminProduct, type AdminProduct, type ProductFormValues,
} from "@/lib/admin-products";
import { SHOP_KEY } from "@/lib/shop";

const err = (m?: string) => (m ? <p role="alert" className="ap-error">{m}</p> : null);

/** La fiche est enregistrée, mais pas la photo : le message d'origine est conservé. */
class PhotoStepError extends Error {
  constructor(message: string, readonly created: boolean) { super(message); }
}

/**
 * Création (product absent) ou modification d'un produit, photo comprise. Un seul bouton enregistre tout :
 * 1. la fiche (admin_create_product / admin_update_product, qui n'ont aucun paramètre de photo ni de stock) ;
 * 2. puis la photo (admin_set_product_image) si elle a été choisie ou retirée. Sans action sur la photo, elle n'est jamais touchée.
 * La référence n'est jamais saisie : générée à partir du nom à la création, permanente ensuite. Le résumé, les caractéristiques, la contenance
 * et les conseils ne sont plus proposés, mais ceux d'un produit existant sont renvoyés tels quels à la modification (rien n'est effacé).
 */
export function ProductFormDialog({ product, categories, canCreateCategory = false, categoriesProblem = null, onRetryCategories, existing, onClose, onSaved }: {
  product: AdminProduct | null; categories: readonly string[]; canCreateCategory?: boolean;
  /** Message d'une erreur INATTENDUE de chargement des catégories enregistrées (pas « migration non appliquée »). */
  categoriesProblem?: string | null; onRetryCategories?: () => void; existing: { ids: readonly string[]; skus: readonly string[] };
  onClose: () => void; onSaved: (text: string, kind?: "ok" | "error") => void;
}) {
  const qc = useQueryClient();
  const editing = product !== null;
  const [formError, setFormError] = useState("");
  // Verrou synchrone : isPending ne change qu'au rendu suivant, un second clic immédiat passerait sinon.
  const sending = useRef(false);
  // Création : dernier essai dont on ignore l'issue (réponse perdue ?), et création confirmée (jamais refaite dans ce formulaire).
  const attempted = useRef<{ id: string; sku: string } | null>(null);
  const created = useRef<{ id: string; sku: string } | null>(null);
  const { register, handleSubmit, setError, setValue, watch, formState: { errors } } = useForm<ProductFormValues>({
    resolver: zodResolver(productFormSchema),
    defaultValues: product ? productToForm(product) : emptyProductForm,
  });
  // Catégories proposées : celles de la page, celles créées pendant cette saisie et, en modification, celle du produit (même hors liste) pour ne pas la perdre.
  const [createdCategories, setCreatedCategories] = useState<string[]>([]);
  const [pendingCategory, setPendingCategory] = useState<string | null>(null);
  const [categoryDialog, setCategoryDialog] = useState(false);
  const options = mergeCategories(categories, createdCategories, product ? [product.category] : []);
  const optionsKey = options.join("\u0001");
  // La catégorie qui vient d'être créée est sélectionnée dès que la liste l'affiche (le reste du brouillon n'est pas touché).
  useEffect(() => {
    if (pendingCategory && options.includes(pendingCategory)) {
      setValue("category", pendingCategory, { shouldValidate: true, shouldDirty: true });
      setPendingCategory(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingCategory, optionsKey]);
  const name = watch("name");

  // Référence : celle du produit en modification ; sinon la première variante libre pour le nom saisi (mise à jour à chaque frappe).
  const reference = product ? product.sku : nextSku(name, existing.skus);
  const variant = !editing && reference !== "" && reference !== skuBase(name);

  // Photo : choisie (en attente d'enregistrement), ou retirée (idem). Rien n'est envoyé avant « Enregistrer ».
  const fileInput = useRef<HTMLInputElement>(null);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [removePhoto, setRemovePhoto] = useState(false);
  const [photoPreview, setPhotoPreview] = useState("");
  const [photoProblem, setPhotoProblem] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const currentUrl = product?.imageUrl ?? null;
  useEffect(() => {
    if (!photoFile) { setPhotoPreview(""); return; }
    const url = URL.createObjectURL(photoFile);
    setPhotoPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [photoFile]);
  const choosePhoto = (f: File | undefined) => {
    setPhotoProblem("");
    if (!f) return;
    const problem = validateImageFile(f);
    if (problem) { setPhotoFile(null); setPhotoProblem(problem); if (fileInput.current) fileInput.current.value = ""; return; }
    setRemovePhoto(false);
    setPhotoFile(f);
  };
  const clearChoice = () => { setPhotoFile(null); setPhotoProblem(""); if (fileInput.current) fileInput.current.value = ""; };
  const fallback = product ? getProduct(product.id)?.images[0] ?? "" : "";
  const shownPhoto = photoPreview || (removePhoto ? "" : currentUrl ?? "") || fallback;
  const hasPhoto = currentUrl !== null && !removePhoto;
  const photoStatus = photoFile ? "Nouvelle photo : elle sera enregistrée avec le produit."
    : removePhoto ? "La photo sera retirée à l'enregistrement."
    : currentUrl ? "Photo actuelle du produit."
    : "Aucune photo : l'image par défaut est affichée.";

  const save = useMutation({
    mutationFn: async (v: ProductFormValues) => {
      let id: string;
      let sku: string;
      if (product) {
        await updateAdminProduct(product.id, formToInput(v, productToInput(product)));
        id = product.id; sku = product.sku;
      } else {
        if (!created.current) {
          let known = existing;
          if (attempted.current) {
            // Un essai précédent a pu aboutir sans que la réponse nous parvienne : on relit le catalogue AVANT de recréer quoi que ce soit.
            // Si cette relecture échoue, rien n'est créé (l'erreur est affichée) : mieux vaut un échec qu'un doublon.
            const fresh = await listAdminProducts();
            const hit = findCreated(fresh, attempted.current, v.name);
            if (hit) { created.current = { id: hit.id, sku: hit.sku }; attempted.current = null; }
            else known = { ids: fresh.map((x) => x.id), skus: fresh.map((x) => x.sku) };
          }
          if (!created.current) {
            created.current = await createProductAuto(
              { ...formToInput(v), initialQty: Number(squeeze(v.initialQty)) }, known, { onAttempt: (a) => { attempted.current = a; } },
            );
            attempted.current = null;
          }
        }
        ({ id, sku } = created.current);
      }
      try {
        if (photoFile) await uploadProductImage(id, photoFile, currentUrl);
        else if (removePhoto && currentUrl) await removeProductImage(id, currentUrl);
      } catch (e) {
        throw new PhotoStepError(e instanceof Error ? e.message : "Photo non enregistrée.", !product);
      }
      return { id, sku };
    },
    onSuccess: async (d, v) => {
      await Promise.all([qc.invalidateQueries({ queryKey: ["admin", "products"] }), qc.invalidateQueries({ queryKey: SHOP_KEY })]);
      onSaved(editing ? `« ${v.name.trim()} » a été modifié.` : `« ${v.name.trim()} » a été ajouté au catalogue (référence ${d.sku}).`);
    },
    onError: async (e, v) => {
      if (e instanceof PhotoStepError) {
        // La fiche est déjà enregistrée : on actualise les listes, puis on explique ce qui reste à faire.
        await Promise.all([qc.invalidateQueries({ queryKey: ["admin", "products"] }), qc.invalidateQueries({ queryKey: SHOP_KEY })]);
        if (e.created) onSaved(`« ${v.name.trim()} » a été ajouté, mais sa photo n'a pas pu être enregistrée : ${e.message} Ouvrez « Modifier » pour la réessayer.`, "error");
        else setFormError(`Les informations sont enregistrées, mais la photo ne l'est pas : ${e.message}`);
        return;
      }
      // Le message de la base est conservé tel quel ; une erreur sur le nom est rattachée à son champ.
      const message = e instanceof Error ? e.message : "Enregistrement impossible.";
      if (e instanceof ProductActionError && e.reason === "invalid_input" && /\bnom\b/i.test(message)) setError("name", { message });
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
      <DialogContent className="ap-dialog max-w-2xl">
        <DialogHeader className="ap-dialog-head space-y-0 text-left">
          <DialogTitle className="ap-dialog-title">{editing ? "Modifier le produit" : "Ajouter un produit"}</DialogTitle>
          <DialogDescription className="ap-dialog-desc">{editing ? product.name : "Renseignez les informations essentielles de votre produit."}</DialogDescription>
        </DialogHeader>

        <form onSubmit={(e) => void submit(e)} noValidate>
          <div className="ap-dialog-body">
            <section className="ap-section">
              <h3 className="ap-section-title">Photo</h3>
              <div
                className="ap-dropzone" data-over={dragOver}
                onDragOver={(e) => { e.preventDefault(); if (!save.isPending) setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => { e.preventDefault(); setDragOver(false); if (!save.isPending) choosePhoto(e.dataTransfer.files?.[0]); }}
              >
                <div className="ap-preview" style={{ width: "7.5rem", flex: "none" }}>
                  <Img src={shownPhoto} alt={`Aperçu de la photo${name.trim() ? ` : ${name.trim()}` : ""}`} sizes="120px" className="h-full w-full" />
                </div>
                <div className="min-w-0 flex-1 space-y-2">
                  <p className="text-sm" style={{ color: "var(--ap-ink-soft)" }}>{photoStatus}</p>
                  <input ref={fileInput} type="file" accept={IMAGE_TYPES.join(",")} className="sr-only" aria-label="Choisir une photo" disabled={save.isPending}
                    onChange={(e) => choosePhoto(e.target.files?.[0])} />
                  <div className="flex flex-wrap gap-2">
                    <button type="button" className="ap-btn" disabled={save.isPending} onClick={() => fileInput.current?.click()}>
                      {hasPhoto || photoFile ? <Camera className="h-4 w-4" aria-hidden="true" /> : <ImagePlus className="h-4 w-4" aria-hidden="true" />}
                      {hasPhoto || photoFile ? "Remplacer la photo" : "Ajouter une photo"}
                    </button>
                    {photoFile && <button type="button" className="ap-btn" disabled={save.isPending} onClick={clearChoice}><Undo2 className="h-4 w-4" aria-hidden="true" />Annuler le changement</button>}
                    {!photoFile && hasPhoto && <button type="button" className="ap-btn ap-btn-danger" disabled={save.isPending} onClick={() => setRemovePhoto(true)}><Trash2 className="h-4 w-4" aria-hidden="true" />Retirer la photo</button>}
                    {!photoFile && removePhoto && <button type="button" className="ap-btn" disabled={save.isPending} onClick={() => setRemovePhoto(false)}><Undo2 className="h-4 w-4" aria-hidden="true" />Annuler le retrait</button>}
                  </div>
                  {photoProblem && <p role="alert" className="ap-error">{photoProblem}</p>}
                  <p className="ap-hint">JPEG, PNG ou WebP, glissés ici ou choisis. Réduite automatiquement (5 Mo maximum une fois enregistrée).</p>
                </div>
              </div>
            </section>

            <section className="ap-section ap-stack">
              <h3 className="ap-section-title">Informations</h3>
              <div>
                <label className="ap-label" htmlFor="p-name">Nom du produit *</label>
                <input id="p-name" className="ap-input" autoComplete="off" {...register("name")} />
                {err(errors.name?.message)}
                {editing && <p className="ap-hint">Adresse du produit : /boutique/{product.id} (non modifiable)</p>}
              </div>
              <div className="ap-grid-2">
                <div>
                  <label className="ap-label" htmlFor="p-sku">Référence produit</label>
                  <input id="p-sku" className="ap-input ap-ref" value={reference} placeholder="Générée après saisie du nom" readOnly aria-readonly="true" />
                  <p className="ap-hint">
                    {editing ? "Permanente : elle ne change plus après la création."
                      : variant ? `Variante attribuée : « ${skuBase(name)} » existe déjà.`
                      : "Générée automatiquement à partir du nom du produit."}
                  </p>
                </div>
                <div>
                  <label className="ap-label" htmlFor="p-category">Catégorie *</label>
                  <select id="p-category" className="ap-select" {...register("category")}>
                    <option value="">Choisir…</option>
                    {options.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                  {err(errors.category?.message)}
                  {categoriesProblem && (
                    <div role="alert" className="ap-notice ap-notice-error mt-1.5 !items-center !gap-2 !px-2.5 !py-1.5 text-xs">
                      <p className="flex-1">Les catégories enregistrées n'ont pas pu être chargées : {categoriesProblem} La liste affichée peut être incomplète.</p>
                      {onRetryCategories && <button type="button" className="ap-link-btn !px-1.5 !py-0.5 shrink-0" onClick={onRetryCategories}>Réessayer</button>}
                    </div>
                  )}
                  {canCreateCategory && (
                    <button type="button" className="ap-link-btn !px-0 mt-1.5 inline-flex items-center gap-1" disabled={save.isPending} onClick={() => setCategoryDialog(true)}>
                      <Plus className="h-3.5 w-3.5" aria-hidden="true" />Créer une catégorie
                    </button>
                  )}
                </div>
              </div>
              <div>
                <label className="ap-label" htmlFor="p-description">Description <span className="ap-muted-text" style={{ fontWeight: 400 }}>(facultative)</span></label>
                <textarea id="p-description" className="ap-textarea" rows={3} {...register("description")} />
                {err(errors.description?.message)}
              </div>
            </section>

            <section className="ap-section">
              <h3 className="ap-section-title">Prix et stock</h3>
              <div className="ap-grid-2">
                <div>
                  <label className="ap-label" htmlFor="p-price">Prix de vente (FCFA) *</label>
                  <input id="p-price" inputMode="numeric" className="ap-input" {...register("price")} />
                  {err(errors.price?.message)}
                </div>
                <div>
                  <label className="ap-label" htmlFor="p-cost">Coût d'achat (FCFA)</label>
                  <input id="p-cost" inputMode="numeric" className="ap-input" {...register("costPrice")} />
                  {err(errors.costPrice?.message)}
                  <p className="ap-hint">Visible des administrateurs seulement. Vide = coût inconnu.</p>
                </div>
                <div>
                  {editing ? (
                    <>
                      <label className="ap-label" htmlFor="p-stock">Stock actuel</label>
                      <input id="p-stock" className="ap-input" value={product.stock} readOnly aria-readonly="true" />
                      <p className="ap-hint">Le stock n'est pas modifiable ici : les entrées, sorties et ajustements arrivent à l'étape suivante.</p>
                    </>
                  ) : (
                    <>
                      <label className="ap-label" htmlFor="p-initial">Stock initial *</label>
                      <input id="p-initial" inputMode="numeric" className="ap-input" {...register("initialQty")} />
                      {err(errors.initialQty?.message)}
                    </>
                  )}
                </div>
                <div>
                  <label className="ap-label" htmlFor="p-threshold">Seuil d'alerte</label>
                  <input id="p-threshold" inputMode="numeric" className="ap-input" {...register("lowStockThreshold")} />
                  {err(errors.lowStockThreshold?.message)}
                  <p className="ap-hint">« Stock bas » s'affiche en dessous de ce seuil. Vide ou 0 : pas d'alerte.</p>
                </div>
              </div>
            </section>

            <section className="ap-section">
              <h3 className="ap-section-title">Visibilité</h3>
              <label className="ap-switch-row">
                <input type="checkbox" role="switch" className="ap-switch" {...register("active")} />
                <div>
                  <strong>Produit actif</strong>
                  <span>Visible dans la boutique lorsqu'il est disponible en stock.</span>
                </div>
              </label>
            </section>

            {formError && <p role="alert" className="ap-notice ap-notice-error mb-4">{formError}</p>}
          </div>

          <div className="ap-dialog-foot">
            <button type="button" disabled={save.isPending} onClick={onClose} className="ap-btn">Annuler</button>
            <button type="submit" disabled={save.isPending} className="ap-btn ap-btn-primary">
              {save.isPending ? (editing ? "Enregistrement…" : "Création…") : editing ? "Enregistrer" : "Créer le produit"}
            </button>
          </div>
        </form>

        {canCreateCategory && (
          <CategoryCreateDialog
            open={categoryDialog} onOpenChange={setCategoryDialog} existing={options}
            onCreated={(name) => { setCreatedCategories((prev) => (prev.includes(name) ? prev : [...prev, name])); setPendingCategory(name); }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
