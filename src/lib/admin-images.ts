import { adminSupabase } from "@/lib/supabase";
import { compressImage } from "@/lib/images";
import { AdminError, classify } from "@/lib/admin-api";

// Photos du catalogue dans Supabase Storage (bucket public `catalog-images`, écriture réservée aux administrateurs
// par les politiques de supabase/migrations/20261025000000_catalog_images_storage.sql).
// La référence enregistrée dans `services.image_url` est l'URL publique de l'objet (stable, non signée).

export const IMAGE_BUCKET = "catalog-images";
/** Formats acceptés. */
export const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
/** Poids maximal du fichier choisi (avant compression) : au-delà, la photo est refusée. */
export const MAX_INPUT_BYTES = 20 * 1024 * 1024;
/** Poids maximal enregistré dans le stockage (après compression). Le bucket applique la même limite côté serveur. */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** Message d'erreur à afficher, ou null si le fichier choisi est acceptable. */
export function validateImageFile(file: { type: string; size: number }): string | null {
  if (!(IMAGE_TYPES as readonly string[]).includes(file.type)) return "Format non pris en charge. Choisissez une image JPEG, PNG ou WebP.";
  if (file.size === 0) return "Ce fichier est vide.";
  if (file.size > MAX_INPUT_BYTES) return `Image trop lourde (${Math.round(MAX_INPUT_BYTES / 1024 / 1024)} Mo maximum).`;
  return null;
}

/** Chemin d'objet unique (jamais deux fois le même nom : l'ancienne photo reste en place jusqu'au succès du remplacement). */
export function newImagePath(serviceId: string, now = Date.now(), rand = Math.random().toString(36).slice(2, 8)) {
  return `services/${serviceId}/${now}-${rand}.webp`;
}

const MARKER = `/object/public/${IMAGE_BUCKET}/`;

/** Chemin d'objet d'une URL publique de notre bucket ; null pour toute autre URL (image locale, autre bucket…). */
export function pathFromPublicUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const i = url.indexOf(MARKER);
  return i === -1 ? null : decodeURIComponent(url.slice(i + MARKER.length).split("?")[0]!);
}

function client() {
  if (!adminSupabase) throw new AdminError("server", "Base de données non configurée.");
  return adminSupabase;
}

type StorageFailure = { message?: string; statusCode?: string | number; status?: number } | null;

/**
 * Erreur Storage -> message exploitable. Le message et le code d'origine sont journalisés dans la console du navigateur
 * (jamais de jeton ni de clé) pour ne plus être masqués derrière un « Téléversement impossible » générique.
 */
export function storageError(e: StorageFailure, what: string): AdminError {
  const message = e?.message ?? "";
  const code = Number(e?.statusCode ?? e?.status);
  console.error(`[photos] ${what} : Storage a répondu ${Number.isNaN(code) ? "?" : code} « ${message} »`);
  if (/bucket not found|NoSuchBucket/i.test(message) || code === 404) {
    return new AdminError("server", `Le stockage des photos n'est pas configuré (bucket « ${IMAGE_BUCKET} » introuvable). Appliquez la migration Storage au projet Supabase.`);
  }
  if (/row-level security|unauthorized|not allowed|forbidden/i.test(message) || code === 401 || code === 403) {
    return new AdminError("forbidden", "Accès refusé : ce compte n'est pas autorisé à modifier les photos. Reconnectez-vous avec un compte administrateur.");
  }
  if (/mime type|not supported|invalid.*type/i.test(message)) return new AdminError("server", "Format refusé par le serveur. Utilisez une image JPEG, PNG ou WebP.");
  if (/exceeded|too large|payload|maximum allowed size/i.test(message) || code === 413) return new AdminError("server", "Image trop lourde pour le serveur (5 Mo maximum).");
  return classify({ message, ...(Number.isNaN(code) ? {} : { status: code }) }, what);
}

/** Supprime l'objet de l'ancienne photo, sauf si une autre prestation l'utilise encore. Sans effet sur les erreurs : la nouvelle photo est déjà en place. */
async function deleteIfUnused(serviceId: string, oldUrl: string | null | undefined) {
  const path = pathFromPublicUrl(oldUrl);
  if (!path) return;
  const c = client();
  const { count, error } = await c.from("services").select("id", { count: "exact", head: true }).eq("image_url", oldUrl!).neq("id", serviceId);
  if (error || (count ?? 0) > 0) return;
  await c.storage.from(IMAGE_BUCKET).remove([path]);
}

/**
 * Téléverse une photo (réduite en WebP), puis l'enregistre sur la prestation. Retourne la nouvelle URL publique.
 * Ordre : 1. envoi du nouvel objet · 2. mise à jour de la base · 3. suppression de l'ancien objet.
 * Si l'étape 2 échoue, le nouvel objet est retiré : aucune référence invalide, aucun fichier orphelin.
 */
export async function uploadServiceImage(serviceId: string, file: File, currentUrl: string | null): Promise<string> {
  const invalid = validateImageFile(file);
  if (invalid) throw new AdminError("server", invalid);
  const c = client();

  let blob: Blob;
  try {
    blob = await compressImage(file);
  } catch {
    throw new AdminError("server", "Cette image n'a pas pu être lue. Essayez un autre fichier.");
  }
  if (blob.size > MAX_IMAGE_BYTES) throw new AdminError("server", `Image trop lourde (${Math.round(MAX_IMAGE_BYTES / 1024 / 1024)} Mo maximum après compression).`);

  const path = newImagePath(serviceId);
  let up: { error: { message?: string; statusCode?: string | number } | null };
  try {
    const r = await c.storage.from(IMAGE_BUCKET).upload(path, blob, { contentType: "image/webp", cacheControl: "31536000", upsert: false });
    up = { error: r.error as { message?: string; statusCode?: string | number } | null };
  } catch (e) {
    throw storageError({ message: e instanceof Error ? e.message : "network" }, "Téléversement");
  }
  if (up.error) throw storageError(up.error, "Téléversement");

  const url = c.storage.from(IMAGE_BUCKET).getPublicUrl(path).data.publicUrl;
  const { data, error } = await c.from("services").update({ image_url: url }).eq("id", serviceId).select("id");
  if (error || !data?.length) {
    // Aucune ligne modifiée = la RLS a refusé (compte non autorisé) ou la prestation n'existe plus.
    await c.storage.from(IMAGE_BUCKET).remove([path]);
    throw error ? classify(error, "Enregistrement de la photo") : new AdminError("forbidden", "Accès refusé.");
  }
  await deleteIfUnused(serviceId, currentUrl);
  return url;
}

/** Retire la photo d'une prestation : référence effacée d'abord, puis objet supprimé s'il n'est plus utilisé ailleurs. */
export async function removeServiceImage(serviceId: string, currentUrl: string | null): Promise<void> {
  const c = client();
  const { data, error } = await c.from("services").update({ image_url: null }).eq("id", serviceId).select("id");
  if (error) throw classify(error, "Suppression de la photo");
  if (!data?.length) throw new AdminError("forbidden", "Accès refusé.");
  await deleteIfUnused(serviceId, currentUrl);
}
