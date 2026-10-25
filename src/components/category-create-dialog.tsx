import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { createAdminCategory, normalizeCategoryName, validateCategoryName } from "@/lib/admin-categories";

/**
 * Petite fenêtre « Créer une catégorie », ouverte depuis le formulaire produit ou le formulaire prestation. Elle est indépendante du
 * formulaire : fermer ou échouer ne touche jamais au brouillon. Rien n'est considéré comme créé tant que la base n'a pas confirmé.
 * `existing` : catégories déjà proposées (pour refuser un doublon avant même d'appeler la base).
 * Par défaut : catégories de PRODUITS. Pour d'autres catégories : `create` (rend la valeur transmise à `onCreated`), `queryKey` (liste à
 * relire avant de rendre la main) et `description`.
 */
export function CategoryCreateDialog({ open, onOpenChange, existing, onCreated, create: createCategory = createAdminCategory, queryKey = ["admin", "categories"], description = "Elle sera disponible pour tous vos produits." }: {
  open: boolean; onOpenChange: (open: boolean) => void; existing: readonly string[]; onCreated: (created: string) => void;
  create?: (name: string) => Promise<string>; queryKey?: readonly unknown[]; description?: string;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  // Verrou synchrone : isPending ne change qu'au rendu suivant, un second clic immédiat passerait sinon.
  const sending = useRef(false);

  const create = useMutation({
    mutationFn: (n: string) => createCategory(n),
    onSuccess: async (saved) => {
      await qc.invalidateQueries({ queryKey: [...queryKey] });
      setName("");
      setError("");
      onCreated(saved);
      onOpenChange(false);
    },
    // Le message de la base (doublon, nom invalide, droits, réseau) est affiché tel quel ; le nom saisi est conservé.
    onError: (e) => setError(e instanceof Error ? e.message : "Création impossible."),
    onSettled: () => { sending.current = false; },
  });

  const close = () => { if (create.isPending) return; setName(""); setError(""); onOpenChange(false); };

  const submit = (e: React.FormEvent) => {
    // La fenêtre est rendue DANS le formulaire produit côté React : sans ceci, la validation enverrait aussi le formulaire produit.
    e.preventDefault();
    e.stopPropagation();
    if (sending.current) return;
    const problem = validateCategoryName(name, existing);
    if (problem) { setError(problem); return; }
    sending.current = true;
    setError("");
    create.mutate(normalizeCategoryName(name));
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) close(); }}>
      <DialogContent className="ap-dialog max-w-sm">
        <DialogHeader className="ap-dialog-head space-y-0 text-left">
          <DialogTitle className="ap-dialog-title">Créer une catégorie</DialogTitle>
          <DialogDescription className="ap-dialog-desc">{description}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} noValidate>
          <div className="ap-dialog-body !pb-4 !pt-4">
            <label className="ap-label" htmlFor="c-name">Nom de la catégorie *</label>
            <input
              id="c-name" className="ap-input" autoComplete="off" autoFocus maxLength={80} value={name} disabled={create.isPending}
              aria-invalid={error !== ""} aria-describedby={error ? "c-error" : undefined}
              onChange={(e) => { setName(e.target.value); if (error) setError(""); }}
            />
            {error && <p id="c-error" role="alert" className="ap-error">{error}</p>}
          </div>
          <div className="ap-dialog-foot flex-col-reverse sm:flex-row">
            <button type="button" className="ap-btn" disabled={create.isPending} onClick={close}>Annuler</button>
            <button type="submit" className="ap-btn ap-btn-primary" disabled={create.isPending}>{create.isPending ? "Création…" : "Créer la catégorie"}</button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
