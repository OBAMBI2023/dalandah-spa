import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Camera, ImagePlus, Trash2, Undo2 } from "lucide-react";
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Img } from "@/components/app";
import { IMAGE_TYPES, removePromotionImage, uploadPromotionImage, validateImageFile } from "@/lib/admin-images";
import {
  createAdminPromotion, emptyPromotionForm, formToPromotionInput, newPromotionId, promotionFormSchema, promotionToForm, updateAdminPromotion,
  type PromotionFormValues,
} from "@/lib/admin-promotions";
import { squeeze } from "@/lib/admin-products";
import { formatFCFA } from "@/lib/format";
import { discountPercent, KIND_DESCRIPTIONS, KIND_LABELS, PROMO_NOTICE, PROMOTIONS_KEY, type Promotion, type PromotionKind } from "@/lib/promotions";

const err = (m?: string) => (m ? <p role="alert" className="ap-error">{m}</p> : null);

/** La fiche est enregistrée, mais pas le visuel : le message d'origine est conservé. */
class PhotoStepError extends Error {
  constructor(message: string, readonly created: boolean) { super(message); }
}

/** Prestation ou produit proposé comme cible. `price` : tarif actuel du catalogue, utilisé UNIQUEMENT pour proposer une valeur de départ (jamais enregistré comme lien). */
type Option = { id: string; name: string; price?: number | undefined };

/** Champs de prix que chaque type conserve ; les autres sont vidés à l'enregistrement. */
const KEPT: Record<PromotionKind, (keyof PromotionFormValues)[]> = { price: ["originalPrice", "promoPrice"], percent: ["percentOff", "originalPrice"], announcement: [] };
const PRICE_FIELDS = ["originalPrice", "promoPrice", "percentOff"] as const;
const FIELD_LABELS: Record<(typeof PRICE_FIELDS)[number], string> = { originalPrice: "le prix initial / de référence annoncé", promoPrice: "le prix promotionnel annoncé", percentOff: "le pourcentage de réduction" };

/**
 * Création (promotion absente) ou modification d'une promotion, visuel compris. Un seul bouton enregistre tout :
 * 1. la fiche (insertion ou mise à jour de public.promotions, sous la RLS administrateur) ;
 * 2. puis le visuel (Storage + promotions.image_url) s'il a été choisi ou retiré. Sans action sur le visuel, il n'est jamais touché.
 * L'identifiant d'une nouvelle promotion est choisi à l'ouverture : un second essai après une réponse perdue ne peut pas créer de doublon.
 * Les promotions sont informatives : rien n'est jamais écrit dans les prestations, les produits ni les réservations.
 */
export function PromotionFormDialog({ promotion, services, products, linksProblem = null, onClose, onSaved }: {
  promotion: Promotion | null; services: readonly Option[]; products: readonly Option[]; linksProblem?: string | null;
  onClose: () => void; onSaved: (text: string, kind?: "ok" | "error") => void;
}) {
  const qc = useQueryClient();
  const editing = promotion !== null;
  const [formError, setFormError] = useState("");
  // Verrou synchrone : isPending ne change qu'au rendu suivant, un second clic immédiat passerait sinon.
  const sending = useRef(false);
  const newId = useRef(newPromotionId());
  const created = useRef(false);

  const { register, handleSubmit, setValue, getValues, watch, formState: { errors } } = useForm<PromotionFormValues>({
    resolver: zodResolver(promotionFormSchema),
    defaultValues: promotion ? promotionToForm(promotion) : emptyPromotionForm,
  });
  const v = watch();
  const kind = v.kind as PromotionKind;
  const id = promotion?.id ?? newId.current;

  // Changer de type quand des valeurs saisies seraient perdues demande confirmation (rien n'est effacé tant que l'on n'a pas confirmé).
  const kindField = register("kind");
  const [pendingKind, setPendingKind] = useState<{ kind: PromotionKind; lost: (typeof PRICE_FIELDS)[number][] } | null>(null);
  const changeKind = (e: React.ChangeEvent<HTMLInputElement>) => {
    const next = e.target.value as PromotionKind;
    const current = getValues("kind") as PromotionKind | "";
    const lost = current === "" ? [] : PRICE_FIELDS.filter((k) => getValues(k).trim() !== "" && !KEPT[next].includes(k));
    if (lost.length === 0) { void kindField.onChange(e); return; }
    setValue("kind", current as PromotionKind); // remet le choix précédent à l'écran en attendant la confirmation
    setPendingKind({ kind: next, lost });
  };
  const confirmKind = () => {
    if (!pendingKind) return;
    for (const k of pendingKind.lost) setValue(k, "");
    setValue("kind", pendingKind.kind, { shouldValidate: true, shouldDirty: true });
    setPendingKind(null);
  };

  // Changer de type de lien vide l'élément choisi (il appartenait à l'autre liste).
  const lastLink = useRef(v.linkType);
  useEffect(() => {
    if (lastLink.current !== v.linkType) { lastLink.current = v.linkType; setValue("linkId", ""); }
  }, [v.linkType, setValue]);

  // Visuel : choisi (en attente d'enregistrement), ou retiré (idem). Rien n'est envoyé avant « Enregistrer ».
  const fileInput = useRef<HTMLInputElement>(null);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [removePhoto, setRemovePhoto] = useState(false);
  const [photoPreview, setPhotoPreview] = useState("");
  const [photoProblem, setPhotoProblem] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const currentUrl = promotion?.imageUrl ?? null;
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
  const shownPhoto = photoPreview || (removePhoto ? "" : currentUrl ?? "");
  const hasPhoto = currentUrl !== null && !removePhoto;
  const photoStatus = photoFile ? "Nouveau visuel : il sera enregistré avec la promotion."
    : removePhoto ? "Le visuel sera retiré à l'enregistrement."
    : currentUrl ? "Visuel actuel de la promotion."
    : "Aucun visuel : une image par défaut est affichée.";

  // Réduction calculée à partir des DEUX prix saisis (jamais depuis les tarifs en base).
  const o = squeeze(v.originalPrice), p = squeeze(v.promoPrice);
  const computed = kind === "price" && /^\d+$/.test(o) && /^\d+$/.test(p)
    ? discountPercent({ kind: "price", originalPrice: Number(o), promoPrice: Number(p), percentOff: null }) : null;

  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ["admin", "promotions"] }), qc.invalidateQueries({ queryKey: PROMOTIONS_KEY })]);

  const save = useMutation({
    mutationFn: async (values: PromotionFormValues) => {
      const input = formToPromotionInput(values, promotion ?? undefined);
      if (promotion) await updateAdminPromotion(promotion.id, input);
      else if (!created.current) { await createAdminPromotion(id, input); created.current = true; }
      else await updateAdminPromotion(id, input); // création déjà faite lors d'un essai précédent (visuel en échec) : on met à jour la même promotion
      try {
        if (photoFile) await uploadPromotionImage(id, photoFile, currentUrl);
        else if (removePhoto && currentUrl) await removePromotionImage(id, currentUrl);
      } catch (e) {
        throw new PhotoStepError(e instanceof Error ? e.message : "Visuel non enregistré.", !promotion);
      }
      return { id };
    },
    onSuccess: async (_d, values) => {
      await refresh();
      onSaved(editing ? `« ${values.title.trim()} » a été modifiée.` : `« ${values.title.trim()} » a été créée.`);
    },
    onError: async (e, values) => {
      if (e instanceof PhotoStepError) {
        await refresh();
        if (e.created) onSaved(`« ${values.title.trim()} » a été créée, mais son visuel n'a pas pu être enregistré : ${e.message} Ouvrez « Modifier » pour le réessayer.`, "error");
        else setFormError(`Les informations sont enregistrées, mais le visuel ne l'est pas : ${e.message}`);
        return;
      }
      setFormError(e instanceof Error ? e.message : "Enregistrement impossible.");
    },
    onSettled: () => { sending.current = false; },
  });

  const submit = handleSubmit((values) => {
    if (sending.current) return;
    sending.current = true;
    setFormError("");
    save.mutate(values);
  });

  // Tarif actuel de la cible choisie : proposé comme valeur de DÉPART seulement (bouton explicite), jamais relié à la promotion.
  const targetPrice = (v.linkType === "service" ? services : v.linkType === "product" ? products : []).find((x) => x.id === v.linkId)?.price;
  const canCopyTariff = (kind === "price" || kind === "percent") && typeof targetPrice === "number" && targetPrice > 0;
  const copyTariff = () => { if (typeof targetPrice === "number") setValue("originalPrice", String(targetPrice), { shouldValidate: true, shouldDirty: true }); };

  const linkOptions = v.linkType === "service" ? services : v.linkType === "product" ? products : [];
  // La cible actuelle reste sélectionnable même si elle n'est plus dans la liste (prestation ou produit introuvable).
  const options = v.linkId && !linkOptions.some((x) => x.id === v.linkId) ? [...linkOptions, { id: v.linkId, name: v.linkId }] : linkOptions;

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !save.isPending) onClose(); }}>
      <DialogContent className="ap-dialog max-w-2xl">
        <DialogHeader className="ap-dialog-head space-y-0 text-left">
          <DialogTitle className="ap-dialog-title">{editing ? "Modifier la promotion" : "Nouvelle promotion"}</DialogTitle>
          <DialogDescription className="ap-dialog-desc">{editing ? promotion.title : "Annoncez une promotion à vos clientes. Elle est informative : aucun tarif n'est modifié."}</DialogDescription>
        </DialogHeader>

        <form onSubmit={(e) => void submit(e)} noValidate>
          <div className="ap-dialog-body">
            <section className="ap-section">
              <h3 className="ap-section-title">Visuel</h3>
              <div
                className="ap-dropzone" data-over={dragOver}
                onDragOver={(e) => { e.preventDefault(); if (!save.isPending) setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => { e.preventDefault(); setDragOver(false); if (!save.isPending) choosePhoto(e.dataTransfer.files?.[0]); }}
              >
                <div className="ap-preview" style={{ width: "7.5rem", flex: "none" }}>
                  <Img src={shownPhoto || undefined} alt={`Aperçu du visuel${v.title.trim() ? ` : ${v.title.trim()}` : ""}`} sizes="120px" className="h-full w-full" />
                </div>
                <div className="min-w-0 flex-1 space-y-2">
                  <p className="text-sm" style={{ color: "var(--ap-ink-soft)" }}>{photoStatus}</p>
                  <input ref={fileInput} type="file" accept={IMAGE_TYPES.join(",")} className="sr-only" aria-label="Choisir un visuel" disabled={save.isPending}
                    onChange={(e) => choosePhoto(e.target.files?.[0])} />
                  <div className="flex flex-wrap gap-2">
                    <button type="button" className="ap-btn" disabled={save.isPending} onClick={() => fileInput.current?.click()}>
                      {hasPhoto || photoFile ? <Camera className="h-4 w-4" aria-hidden="true" /> : <ImagePlus className="h-4 w-4" aria-hidden="true" />}
                      {hasPhoto || photoFile ? "Remplacer le visuel" : "Ajouter un visuel"}
                    </button>
                    {photoFile && <button type="button" className="ap-btn" disabled={save.isPending} onClick={clearChoice}><Undo2 className="h-4 w-4" aria-hidden="true" />Annuler le changement</button>}
                    {!photoFile && hasPhoto && <button type="button" className="ap-btn ap-btn-danger" disabled={save.isPending} onClick={() => setRemovePhoto(true)}><Trash2 className="h-4 w-4" aria-hidden="true" />Retirer le visuel</button>}
                    {!photoFile && removePhoto && <button type="button" className="ap-btn" disabled={save.isPending} onClick={() => setRemovePhoto(false)}><Undo2 className="h-4 w-4" aria-hidden="true" />Annuler le retrait</button>}
                  </div>
                  {photoProblem && <p role="alert" className="ap-error">{photoProblem}</p>}
                  <p className="ap-hint">JPEG, PNG ou WebP, glissés ici ou choisis. Réduit automatiquement (5 Mo maximum une fois enregistré).</p>
                </div>
              </div>
            </section>

            <section className="ap-section ap-stack">
              <h3 className="ap-section-title">Informations</h3>
              <div>
                <label className="ap-label" htmlFor="pr-title">Titre de la promotion *</label>
                <input id="pr-title" className="ap-input" autoComplete="off" {...register("title")} />
                {err(errors.title?.message)}
              </div>
              <div>
                <label className="ap-label" htmlFor="pr-description">Description <span className="ap-muted-text" style={{ fontWeight: 400 }}>(facultative)</span></label>
                <textarea id="pr-description" className="ap-textarea" rows={3} {...register("description")} />
                {err(errors.description?.message)}
              </div>
              <fieldset aria-describedby={errors.kind ? "pr-kind-error" : undefined}>
                <legend className="ap-label">Type de promotion *</legend>
                <div className="grid gap-2">
                  {(Object.keys(KIND_LABELS) as PromotionKind[]).map((k) => (
                    <label key={k} className="ap-switch-row" style={{ alignItems: "flex-start" }}>
                      <input type="radio" value={k} className="mt-1 h-4 w-4" {...kindField} onChange={changeKind} />
                      <div><strong>{KIND_LABELS[k]}</strong><span>{KIND_DESCRIPTIONS[k]}</span></div>
                    </label>
                  ))}
                </div>
                {errors.kind && <p id="pr-kind-error" role="alert" className="ap-error">{errors.kind.message}</p>}
              </fieldset>
              {kind === "price" && (
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className="ap-label" htmlFor="pr-original">Prix initial annoncé (FCFA) *</label>
                    <input id="pr-original" inputMode="numeric" className="ap-input" {...register("originalPrice")} />
                    {err(errors.originalPrice?.message)}
                  </div>
                  <div>
                    <label className="ap-label" htmlFor="pr-promo">Prix promotionnel annoncé (FCFA) *</label>
                    <input id="pr-promo" inputMode="numeric" className="ap-input" {...register("promoPrice")} />
                    {err(errors.promoPrice?.message)}
                  </div>
                  <p className="ap-hint sm:col-span-2" aria-live="polite">
                    {computed !== null ? `Réduction calculée : -${computed}%.` : "La réduction est calculée automatiquement à partir des deux prix."}
                  </p>
                </div>
              )}
              {kind === "percent" && (
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className="ap-label" htmlFor="pr-percent">Pourcentage de réduction annoncé *</label>
                    <input id="pr-percent" inputMode="numeric" className="ap-input" placeholder="20" {...register("percentOff")} />
                    {err(errors.percentOff?.message)}
                  </div>
                  <div>
                    <label className="ap-label" htmlFor="pr-reference">Prix de référence annoncé (FCFA) <span className="ap-muted-text" style={{ fontWeight: 400 }}>(facultatif)</span></label>
                    <input id="pr-reference" inputMode="numeric" className="ap-input" {...register("originalPrice")} />
                    {err(errors.originalPrice?.message)}
                  </div>
                  <p className="ap-hint sm:col-span-2">Aucun prix promotionnel n'est calculé : seul le pourcentage est annoncé. Le prix de référence, s'il est renseigné, est affiché comme « prix de référence annoncé ».</p>
                </div>
              )}
              {canCopyTariff && (
                <div>
                  <button type="button" className="ap-btn" disabled={save.isPending} onClick={copyTariff}>Reprendre le tarif du catalogue</button>
                  <p className="ap-hint">Copie le tarif actuel ({formatFCFA(targetPrice!)}) dans le champ « {kind === "price" ? "Prix initial annoncé" : "Prix de référence annoncé"} ». C'est seulement une valeur de départ, modifiable : elle ne suit pas le tarif réel.</p>
                </div>
              )}
              {kind !== "announcement" && <p className="ap-notice ap-notice-info">{PROMO_NOTICE}</p>}
            </section>

            <section className="ap-section ap-stack">
              <h3 className="ap-section-title">Lien (facultatif)</h3>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="ap-label" htmlFor="pr-link-type">Concerne</label>
                  <select id="pr-link-type" className="ap-select" {...register("linkType")}>
                    <option value="none">Aucun lien (simple annonce)</option>
                    <option value="service">Une prestation</option>
                    <option value="product">Un produit</option>
                  </select>
                </div>
                {v.linkType !== "none" && (
                  <div>
                    <label className="ap-label" htmlFor="pr-link-id">{v.linkType === "service" ? "Prestation" : "Produit"} *</label>
                    <select id="pr-link-id" className="ap-select" {...register("linkId")}>
                      <option value="">Choisir…</option>
                      {options.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                    </select>
                    {err(errors.linkId?.message)}
                  </div>
                )}
              </div>
              {linksProblem && v.linkType !== "none" && <p role="alert" className="ap-notice ap-notice-error">La liste n'a pas pu être chargée : {linksProblem}</p>}
              <p className="ap-hint">Le bouton de la promotion mène à cet élément. Son prix reste inchangé : aucune remise n'est appliquée.</p>
            </section>

            <section className="ap-section ap-stack">
              <h3 className="ap-section-title">Période</h3>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="ap-label" htmlFor="pr-start">Date de début <span className="ap-muted-text" style={{ fontWeight: 400 }}>(facultative)</span></label>
                  <input id="pr-start" type="date" className="ap-input" {...register("startsOn")} />
                  {err(errors.startsOn?.message)}
                </div>
                <div>
                  <label className="ap-label" htmlFor="pr-end">Date de fin <span className="ap-muted-text" style={{ fontWeight: 400 }}>(facultative)</span></label>
                  <input id="pr-end" type="date" className="ap-input" {...register("endsOn")} />
                  {err(errors.endsOn?.message)}
                </div>
              </div>
              <p className="ap-hint">Sans date de début, la promotion commence dès sa publication ; sans date de fin, elle dure jusqu'à sa désactivation. La date de fin est incluse.</p>
            </section>

            <section className="ap-section">
              <h3 className="ap-section-title">Publication</h3>
              <label className="ap-label" htmlFor="pr-publication">Statut *</label>
              <select id="pr-publication" className="ap-select" {...register("publication")}>
                <option value="draft">{promotion?.publication === "disabled" ? "Désactivée (non publiée)" : "Brouillon (non visible)"}</option>
                <option value="published">Publiée</option>
              </select>
              {err(errors.publication?.message)}
              <p className="ap-hint">Une promotion publiée n'apparaît sur le site que pendant sa période (programmée avant, expirée après).</p>
            </section>

            {formError && <p role="alert" className="ap-notice ap-notice-error mb-4">{formError}</p>}
          </div>

          <div className="ap-dialog-foot">
            <button type="button" disabled={save.isPending} onClick={onClose} className="ap-btn">Annuler</button>
            <button type="submit" disabled={save.isPending} className="ap-btn ap-btn-primary">
              {save.isPending ? (editing ? "Enregistrement…" : "Création…") : editing ? "Enregistrer les modifications" : "Créer la promotion"}
            </button>
          </div>
        </form>

        <AlertDialog open={!!pendingKind} onOpenChange={(o) => { if (!o) setPendingKind(null); }}>
          <AlertDialogContent className="ap-dialog max-w-md">
            <AlertDialogHeader className="ap-dialog-head text-left">
              <AlertDialogTitle className="ap-dialog-title">Changer le type de promotion ?</AlertDialogTitle>
              <AlertDialogDescription className="ap-dialog-desc">
                Le type « {pendingKind ? KIND_LABELS[pendingKind.kind] : ""} » ne conserve pas {pendingKind?.lost.map((k) => FIELD_LABELS[k]).join(", ")} : {pendingKind && pendingKind.lost.length > 1 ? "ces valeurs seront effacées" : "cette valeur sera effacée"} du formulaire.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter className="ap-dialog-foot !flex-row !space-x-0">
              <AlertDialogCancel className="ap-btn !mt-0">Garder le type actuel</AlertDialogCancel>
              <button type="button" className="ap-btn ap-btn-primary" onClick={confirmKind}>Changer le type</button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  );
}
