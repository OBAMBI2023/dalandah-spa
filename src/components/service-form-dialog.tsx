import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Camera, ImagePlus, Plus, Trash2, Undo2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Img } from "@/components/app";
import { CategoryCreateDialog } from "@/components/category-create-dialog";
import { serviceCategories, type ServiceCategoryInfo } from "@/data/services";
import { createAdminServiceCategory } from "@/lib/admin-service-categories";
import { listAdminServices, type AdminService } from "@/lib/admin-api";
import { IMAGE_TYPES, removeServiceImage, uploadServiceImage, validateImageFile } from "@/lib/admin-images";
import {
  createAdminService, emptyServiceForm, findCreatedService, formatDuration, formToServiceInput, serviceFormSchema, serviceToForm,
  updateAdminService, type ServiceFormValues,
} from "@/lib/admin-services";
import { squeeze } from "@/lib/admin-products";

const err = (m?: string) => (m ? <p role="alert" className="ap-error">{m}</p> : null);

/** La fiche est enregistrée, mais pas la photo : le message d'origine est conservé. */
class PhotoStepError extends Error {
  constructor(message: string, readonly created: boolean) { super(message); }
}

/**
 * Création (service absent) ou modification d'une prestation, photo comprise. Un seul bouton enregistre tout :
 * 1. la fiche (insertion ou mise à jour de public.services, sous la RLS administrateur) ;
 * 2. puis la photo (Storage + services.image_url) si elle a été choisie ou retirée. Sans action sur la photo, elle n'est jamais touchée.
 * Création : si la réponse d'un essai s'est perdue, le catalogue est relu avant toute nouvelle tentative (jamais de doublon).
 */
export function ServiceFormDialog({ service, fallbackImage = "", existingIds, categories = serviceCategories, canCreateCategory = false, categoriesProblem = null, onRetryCategories, onClose, onSaved }: {
  service: AdminService | null; fallbackImage?: string; existingIds: readonly string[];
  /** Catégories proposées (origine + créées). `canCreateCategory` : la migration est appliquée, l'action « Créer une catégorie » est proposée. */
  categories?: readonly ServiceCategoryInfo[]; canCreateCategory?: boolean;
  categoriesProblem?: string | null; onRetryCategories?: () => void;
  onClose: () => void; onSaved: (text: string, kind?: "ok" | "error") => void;
}) {
  const qc = useQueryClient();
  const editing = service !== null;
  const [formError, setFormError] = useState("");
  // Verrou synchrone : isPending ne change qu'au rendu suivant, un second clic immédiat passerait sinon.
  const sending = useRef(false);
  const attempted = useRef<{ id: string } | null>(null);
  const created = useRef<{ id: string } | null>(null);

  const { register, handleSubmit, setError, setValue, watch, formState: { errors } } = useForm<ServiceFormValues>({
    resolver: zodResolver(serviceFormSchema),
    defaultValues: service ? serviceToForm(service) : emptyServiceForm,
  });
  const name = watch("name");

  // Catégories proposées : celles de la page, celles créées pendant cette saisie et, en modification, celle de la prestation (même hors liste).
  const [createdCategories, setCreatedCategories] = useState<ServiceCategoryInfo[]>([]);
  const [pendingCategory, setPendingCategory] = useState<string | null>(null);
  const [categoryDialog, setCategoryDialog] = useState(false);
  const options: { id: string; label: string }[] = [...categories];
  for (const c of createdCategories) if (!options.some((o) => o.id === c.id)) options.push(c);
  if (service && !options.some((o) => o.id === service.category)) options.push({ id: service.category, label: service.category });
  const optionsKey = options.map((o) => o.id).join("|");
  // La catégorie qui vient d'être créée est sélectionnée dès que la liste l'affiche (le reste du brouillon n'est pas touché).
  useEffect(() => {
    if (pendingCategory && options.some((o) => o.id === pendingCategory)) {
      setValue("category", pendingCategory, { shouldValidate: true, shouldDirty: true });
      setPendingCategory(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingCategory, optionsKey]);
  const minutesRaw = watch("durationMin");
  const label = watch("durationLabel");

  // Libellé de durée : suit la durée tant qu'il n'a pas été personnalisé (ex. « 2 h et + » est conservé).
  const minutes = /^\d+$/.test(squeeze(minutesRaw ?? "")) ? Number(squeeze(minutesRaw)) : 0;
  const lastAuto = useRef(service ? formatDuration(service.durationMin) : "");
  useEffect(() => {
    const auto = formatDuration(minutes);
    if (label === "" || label === lastAuto.current) setValue("durationLabel", auto);
    lastAuto.current = auto;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [minutes]);

  // Photo : choisie (en attente d'enregistrement), ou retirée (idem). Rien n'est envoyé avant « Enregistrer ».
  const fileInput = useRef<HTMLInputElement>(null);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [removePhoto, setRemovePhoto] = useState(false);
  const [photoPreview, setPhotoPreview] = useState("");
  const [photoProblem, setPhotoProblem] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const currentUrl = service?.imageUrl ?? null;
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
  const shownPhoto = photoPreview || (removePhoto ? "" : currentUrl ?? "") || fallbackImage;
  const hasPhoto = currentUrl !== null && !removePhoto;
  const photoStatus = photoFile ? "Nouvelle photo : elle sera enregistrée avec la prestation."
    : removePhoto ? "La photo sera retirée à l'enregistrement."
    : currentUrl ? "Photo actuelle de la prestation."
    : "Aucune photo : l'image par défaut est affichée.";

  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ["admin", "services"] }), qc.invalidateQueries({ queryKey: ["catalogue"] })]);

  const save = useMutation({
    mutationFn: async (v: ServiceFormValues) => {
      const input = formToServiceInput(v);
      let id: string;
      if (service) {
        await updateAdminService(service.id, input, { confirmTariff: service.isDemo && v.confirmTariff });
        id = service.id;
      } else {
        if (!created.current) {
          let known = existingIds;
          if (attempted.current) {
            // Un essai précédent a pu aboutir sans que la réponse nous parvienne : on relit le catalogue AVANT de recréer quoi que ce soit.
            // Si cette relecture échoue, rien n'est créé (l'erreur est affichée) : mieux vaut un échec qu'un doublon.
            const fresh = await listAdminServices();
            const hit = findCreatedService(fresh, attempted.current, v.name);
            if (hit) { created.current = { id: hit.id }; attempted.current = null; }
            else known = fresh.map((s) => s.id);
          }
          if (!created.current) {
            created.current = await createAdminService(input, known, { onAttempt: (a) => { attempted.current = a; } });
            attempted.current = null;
          }
        }
        id = created.current.id;
      }
      try {
        if (photoFile) await uploadServiceImage(id, photoFile, currentUrl);
        else if (removePhoto && currentUrl) await removeServiceImage(id, currentUrl);
      } catch (e) {
        throw new PhotoStepError(e instanceof Error ? e.message : "Photo non enregistrée.", !service);
      }
      return { id };
    },
    onSuccess: async (_d, v) => {
      await refresh();
      onSaved(editing ? `« ${v.name.trim()} » a été modifiée.` : `« ${v.name.trim()} » a été ajoutée au catalogue.`);
    },
    onError: async (e, v) => {
      if (e instanceof PhotoStepError) {
        // La fiche est déjà enregistrée : on actualise les listes, puis on explique ce qui reste à faire.
        await refresh();
        if (e.created) onSaved(`« ${v.name.trim()} » a été ajoutée, mais sa photo n'a pas pu être enregistrée : ${e.message} Ouvrez « Modifier » pour la réessayer.`, "error");
        else setFormError(`Les informations sont enregistrées, mais la photo ne l'est pas : ${e.message}`);
        return;
      }
      // Le message de la base est conservé tel quel ; une erreur sur le nom est rattachée à son champ.
      const message = e instanceof Error ? e.message : "Enregistrement impossible.";
      if (/\bnom\b/i.test(message) && /2 lettres/.test(message)) setError("name", { message });
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
          <DialogTitle className="ap-dialog-title">{editing ? "Modifier la prestation" : "Nouvelle prestation"}</DialogTitle>
          <DialogDescription className="ap-dialog-desc">{editing ? service.name : "Renseignez les informations essentielles de la prestation."}</DialogDescription>
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
                <label className="ap-label" htmlFor="s-name">Nom de la prestation *</label>
                <input id="s-name" className="ap-input" autoComplete="off" {...register("name")} />
                {err(errors.name?.message)}
                {editing && <p className="ap-hint">Identifiant : {service.id} (non modifiable : les réservations s'y rattachent)</p>}
              </div>
              <div>
                <label className="ap-label" htmlFor="s-category">Catégorie *</label>
                <select id="s-category" className="ap-select" {...register("category")}>
                  <option value="">Choisir…</option>
                  {options.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
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
              <div>
                <label className="ap-label" htmlFor="s-description">Description <span className="ap-muted-text" style={{ fontWeight: 400 }}>(facultative)</span></label>
                <textarea id="s-description" className="ap-textarea" rows={3} {...register("description")} />
                {err(errors.description?.message)}
              </div>
            </section>

            <section className="ap-section">
              <h3 className="ap-section-title">Durée et tarif</h3>
              <div className="ap-grid-2">
                <div>
                  <label className="ap-label" htmlFor="s-duration">Durée (minutes) *</label>
                  <input id="s-duration" inputMode="numeric" className="ap-input" {...register("durationMin")} />
                  {err(errors.durationMin?.message)}
                  <p className="ap-hint">Temps réservé dans le planning (5 à 720 minutes).</p>
                </div>
                <div>
                  <label className="ap-label" htmlFor="s-label">Durée affichée aux clientes</label>
                  <input id="s-label" className="ap-input" placeholder="90 min" {...register("durationLabel")} />
                  {err(errors.durationLabel?.message)}
                  <p className="ap-hint">Générée à partir de la durée ; modifiable (ex. « 2 h et + »).</p>
                </div>
                <div>
                  <label className="ap-label" htmlFor="s-price">Prix de vente (FCFA) *</label>
                  <input id="s-price" inputMode="numeric" className="ap-input" {...register("price")} />
                  {err(errors.price?.message)}
                  <p className="ap-hint">Appliqué aux nouvelles réservations ; les réservations existantes gardent leur tarif.</p>
                </div>
              </div>
              {editing && service.isDemo && (
                <label className="ap-switch-row mt-3">
                  <input type="checkbox" className="h-4 w-4" {...register("confirmTariff")} />
                  <div>
                    <strong>Tarif et durée confirmés</strong>
                    <span>Ce tarif est encore marqué « à confirmer » (donnée de démonstration). Cochez pour le valider officiellement.</span>
                  </div>
                </label>
              )}
            </section>

            <section className="ap-section">
              <h3 className="ap-section-title">Visibilité</h3>
              <label className="ap-switch-row">
                <input type="checkbox" role="switch" className="ap-switch" {...register("active")} />
                <div>
                  <strong>Prestation active</strong>
                  <span>Réservable par les clientes et visible dans le catalogue.</span>
                </div>
              </label>
            </section>

            {formError && <p role="alert" className="ap-notice ap-notice-error mb-4">{formError}</p>}
          </div>

          <div className="ap-dialog-foot">
            <button type="button" disabled={save.isPending} onClick={onClose} className="ap-btn">Annuler</button>
            <button type="submit" disabled={save.isPending} className="ap-btn ap-btn-primary">
              {save.isPending ? (editing ? "Enregistrement…" : "Création…") : editing ? "Enregistrer les modifications" : "Créer la prestation"}
            </button>
          </div>
        </form>

        {canCreateCategory && (
          <CategoryCreateDialog
            open={categoryDialog} onOpenChange={setCategoryDialog} existing={options.map((o) => o.label)}
            queryKey={["admin", "service-categories"]} description="Elle sera disponible pour toutes vos prestations."
            create={async (n) => {
              const c = await createAdminServiceCategory(n);
              setCreatedCategories((prev) => (prev.some((p) => p.id === c.id) ? prev : [...prev, { id: c.id, label: c.label, title: c.label, description: "", image: "" }]));
              return c.id;
            }}
            onCreated={(id) => setPendingCategory(id)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
