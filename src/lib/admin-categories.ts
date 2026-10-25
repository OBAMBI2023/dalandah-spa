import { productCategories } from "@/data/products";
import { AdminError, classify } from "@/lib/admin-api";
import { assertOk, CatalogueNotInstalledError, rpc as adminRpc } from "@/lib/admin-products";
import { adminSupabase } from "@/lib/supabase";

// Catégories de produits proposées à l'administrateur (table public.product_categories, migration 20261027000000).
// Lecture : table protégée par la RLS (administrateurs). Création : admin_create_category(), qui vérifie le rôle admin et rend
// { ok: true, name } ou { ok: false, code, error }. products.category reste un texte libre : une catégorie n'est jamais liée à un produit par clé.

/** La table ou la fonction n'existent pas encore : la migration n'est pas appliquée à ce projet. */
export class CategoriesNotInstalledError extends AdminError {
  constructor() {
    super("server", "Les catégories ne sont pas encore installées dans la base : la migration 20261027000000_product_categories.sql n'a pas été appliquée à ce projet.");
  }
}

/** Mêmes bornes que products.category et que la table. */
export const CATEGORY_LIMITS = { min: 2, max: 60 } as const;

/**
 * Nom tel qu'il doit être enregistré : Unicode NFC, caractères invisibles ou de sens d'écriture retirés (\p{Cf}), espaces de toute sorte
 * (insécable, cadratin…) ramenés à une espace ordinaire, espaces répétés fusionnés, espaces de début et de fin retirés.
 */
export const normalizeCategoryName = (s: string) => s.normalize("NFC").replace(/\p{Cf}/gu, "").replace(/\s+/g, " ").trim();

/** Clé de comparaison : forme normalisée, sans casse, sans accents (décomposition de compatibilité puis retrait des marques combinantes). */
export const categoryKey = (s: string) => normalizeCategoryName(s).normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();

/** Message d'erreur du nom saisi, ou null s'il est acceptable. `existing` : catégories déjà proposées. */
export function validateCategoryName(raw: string, existing: readonly string[]): string | null {
  const name = normalizeCategoryName(raw);
  if (name === "") return "Indiquez le nom de la catégorie.";
  if (name.length < CATEGORY_LIMITS.min || name.length > CATEGORY_LIMITS.max) return "Le nom de la catégorie doit contenir de 2 à 60 caractères.";
  if (/\p{Cc}/u.test(name)) return "Le nom de la catégorie contient un caractère non autorisé.";
  const same = existing.find((e) => categoryKey(e) === categoryKey(name));
  if (same) return `Une catégorie « ${same} » existe déjà.`;
  return null;
}

/** Catégories sans doublon exact : celles du code d'abord (dans leur ordre habituel), puis les autres par ordre alphabétique. */
export function mergeCategories(...lists: (readonly string[])[]): string[] {
  const all = new Set(lists.flat());
  const known = productCategories.filter((c) => all.has(c));
  const others = [...all].filter((c) => !(productCategories as readonly string[]).includes(c)).sort((a, b) => a.localeCompare(b, "fr"));
  return [...known, ...others];
}

type Failure = { code?: string; message?: string; status?: number } | null;

/** Catégories enregistrées (administrateur). Lève CategoriesNotInstalledError tant que la migration n'est pas appliquée. */
export async function listAdminCategories(): Promise<string[]> {
  if (!adminSupabase) throw new AdminError("server", "Base de données non configurée.");
  let res: { data: { name: string }[] | null; error: Failure };
  try {
    res = (await adminSupabase.from("product_categories").select("name").order("name")) as typeof res;
  } catch (e) {
    throw classify({ message: e instanceof Error ? e.message : "network" }, "Lecture des catégories");
  }
  if (res.error) {
    const { code, message = "", status } = res.error;
    if (code === "42P01" || code === "PGRST205" || (status === 404 && /schema cache|does not exist|product_categories/i.test(message))) throw new CategoriesNotInstalledError();
    throw classify(res.error, "Lecture des catégories");
  }
  return (res.data ?? []).map((r) => r.name);
}

/**
 * Crée une catégorie et rend son nom tel qu'enregistré. Un refus (doublon, nom invalide) est levé en ProductActionError avec le message de
 * la base ; une catégorie n'est JAMAIS donnée pour créée si l'enregistrement n'a pas réellement abouti.
 */
export async function createAdminCategory(name: string): Promise<string> {
  let data: unknown;
  try {
    data = await adminRpc("admin_create_category", { p_name: name }, "Création de la catégorie");
  } catch (e) {
    throw e instanceof CatalogueNotInstalledError ? new CategoriesNotInstalledError() : e;
  }
  assertOk(data, "Création de la catégorie");
  const saved = (data as { name?: unknown }).name;
  if (typeof saved !== "string" || saved === "") throw new AdminError("server", "Création de la catégorie : réponse inattendue du serveur.");
  return saved;
}
