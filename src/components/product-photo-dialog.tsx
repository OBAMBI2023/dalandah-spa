import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Camera } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { Img } from "@/components/app";
import { IMAGE_TYPES, removeProductImage, uploadProductImage, validateImageFile } from "@/lib/admin-images";
import type { AdminProduct } from "@/lib/admin-products";

type Message = { kind: "ok" | "error"; text: string } | null;

/** Photo d'un produit : choix, aperçu avant enregistrement, remplacement, suppression (avec confirmation). La photo actuelle n'est jamais retirée avant le succès du remplacement. */
export function ProductPhotoDialog({ product, fallbackImage }: { product: AdminProduct; fallbackImage: string }) {
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [busy, setBusy] = useState<"upload" | "remove" | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState<Message>(null);

  useEffect(() => {
    if (!file) { setPreview(""); return; }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const reset = () => { setFile(null); setConfirming(false); setMessage(null); if (input.current) input.current.value = ""; };
  const refresh = () => qc.invalidateQueries({ queryKey: ["admin", "products"] });

  const choose = (f: File | undefined) => {
    setMessage(null);
    setConfirming(false);
    if (!f) return;
    const problem = validateImageFile(f);
    if (problem) { setFile(null); setMessage({ kind: "error", text: problem }); if (input.current) input.current.value = ""; return; }
    setFile(f);
  };

  const save = async () => {
    if (!file || busy) return;
    setBusy("upload");
    setMessage(null);
    try {
      await uploadProductImage(product.id, file, product.imageUrl);
      await refresh();
      setFile(null);
      if (input.current) input.current.value = "";
      setMessage({ kind: "ok", text: "Photo enregistrée." });
    } catch (e) {
      setMessage({ kind: "error", text: e instanceof Error ? e.message : "Téléversement impossible." });
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    if (busy) return;
    setBusy("remove");
    setMessage(null);
    try {
      await removeProductImage(product.id, product.imageUrl);
      await refresh();
      setConfirming(false);
      setMessage({ kind: "ok", text: "Photo supprimée. L'image par défaut sera affichée." });
    } catch (e) {
      setMessage({ kind: "error", text: e instanceof Error ? e.message : "Suppression impossible." });
    } finally {
      setBusy(null);
    }
  };

  const shown = preview || product.imageUrl || fallbackImage;
  return (
    <Dialog open={open} onOpenChange={(o) => { if (busy) return; setOpen(o); if (!o) reset(); }}>
      <DialogTrigger asChild>
        <button className="btn btn-outline !px-3 text-sm" aria-label={`Photo de ${product.name}`}><Camera className="h-4 w-4" />Photo</button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl">Photo du produit</DialogTitle>
          <DialogDescription>{product.name}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <Img src={shown} alt={`Aperçu : ${product.name}`} sizes="448px" className="aspect-square w-full rounded-xl" />
          <p className="text-xs text-muted-foreground">
            {preview ? "Aperçu : cette photo n'est pas encore enregistrée." : product.imageUrl ? "Photo actuelle du produit." : "Aucune photo téléversée : l'image par défaut est affichée."}
          </p>

          <input ref={input} type="file" accept={IMAGE_TYPES.join(",")} className="sr-only" aria-label="Choisir une photo" disabled={!!busy}
            onChange={(e) => choose(e.target.files?.[0])} />

          {busy === "upload" && (
            <div role="status" aria-live="polite" className="space-y-1">
              <Progress aria-label="Téléversement en cours" className="h-2 animate-pulse" value={66} />
              <p className="text-xs text-muted-foreground">Réduction et téléversement de la photo…</p>
            </div>
          )}
          {message && <p role={message.kind === "error" ? "alert" : "status"} className={`text-sm ${message.kind === "error" ? "text-destructive" : "text-sage"}`}>{message.text}</p>}

          {file ? (
            <div className="grid grid-cols-2 gap-2">
              <button className="btn btn-primary" disabled={!!busy} onClick={() => void save()}>{busy === "upload" ? "Envoi…" : "Enregistrer la photo"}</button>
              <button className="btn btn-outline" disabled={!!busy} onClick={reset}>Annuler</button>
            </div>
          ) : (
            <div className="space-y-2">
              <button className="btn btn-primary w-full" disabled={!!busy} onClick={() => input.current?.click()}>
                {product.imageUrl ? "Remplacer la photo" : "Importer une photo"}
              </button>
              {product.imageUrl && (confirming ? (
                <div role="alertdialog" aria-label="Confirmer la suppression" className="rounded-xl border border-destructive/40 p-3 text-sm">
                  <p>Supprimer cette photo ? Le site affichera l'image par défaut.</p>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <button className="btn btn-outline !border-destructive !text-destructive" disabled={!!busy} onClick={() => void remove()}>{busy === "remove" ? "Suppression…" : "Oui, supprimer"}</button>
                    <button className="btn btn-outline" disabled={!!busy} onClick={() => setConfirming(false)}>Non, garder</button>
                  </div>
                </div>
              ) : (
                <button className="btn btn-outline w-full" disabled={!!busy} onClick={() => setConfirming(true)}>Supprimer la photo</button>
              ))}
            </div>
          )}
          <p className="text-[11px] text-muted-foreground">JPEG, PNG ou WebP. La photo est réduite automatiquement (5 Mo maximum une fois enregistrée).</p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
