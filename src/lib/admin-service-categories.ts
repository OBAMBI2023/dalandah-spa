import { AdminError, classify } from "@/lib/admin-api";
import { normalizeCategoryName } from "@/lib/admin-categories";
import { assertOk, CatalogueNotInstalledError, rpc as adminRpc } from "@/lib/admin-products";
import { buildCategories, CATEGORY_COLUMNS, type CategoryRow } from "@/lib/service-categories";
import { adminSupabase } from "@/lib/supabase";
import type { ServiceCategoryInfo } from "@/data/services";

// Catégories de PRESTATIONS (table public.service_categories, migration 20261028000000).
// Lecture : table publique en lecture. Création : admin_create_service_category(), qui vérifie le rôle admin et rend
// { ok: true, id, label } ou { ok: false, code, error }. Les règles de nom sont celles des catégories de produits (admin-categories.ts).

/** La table ou la fonction n'existent pas encore : la migration n'est pas appliquée à ce projet. */
export class ServiceCategoriesNotInstalledError extends AdminError {
  constructor() {
    super("server", "Les catégories de prestations ne sont pas encore installées dans la base : la migration 20261028000000_service_categories.sql n'a pas été appliquée à ce projet.");
  }
}

type Failure = { code?: string; message?: string; status?: number } | null;

/** Catégories (origine + créées), dans l'ordre d'affichage. Lève ServiceCategoriesNotInstalledError tant que la migration n'est pas appliquée. */
export async function listAdminServiceCategories(): Promise<ServiceCategoryInfo[]> {
  if (!adminSupabase) throw new AdminError("server", "Base de données non configurée.");
  let res: { data: CategoryRow[] | null; error: Failure };
  try {
    res = (await adminSupabase.from("service_categories").select(CATEGORY_COLUMNS).order("sort_order")) as typeof res;
  } catch (e) {
    throw classify({ message: e instanceof Error ? e.message : "network" }, "Lecture des catégories de prestations");
  }
  if (res.error) {
    const { code, message = "", status } = res.error;
    if (code === "42P01" || code === "PGRST205" || (status === 404 && /schema cache|does not exist|service_categories/i.test(message))) throw new ServiceCategoriesNotInstalledError();
    throw classify(res.error, "Lecture des catégories de prestations");
  }
  return buildCategories(res.data ?? []);
}

/**
 * Crée une catégorie de prestations et rend son identifiant et son libellé tels qu'enregistrés. Un refus (doublon, nom invalide) est levé avec
 * le message de la base ; une catégorie n'est JAMAIS donnée pour créée si l'enregistrement n'a pas réellement abouti.
 */
export async function createAdminServiceCategory(name: string): Promise<{ id: string; label: string }> {
  let data: unknown;
  try {
    data = await adminRpc("admin_create_service_category", { p_name: normalizeCategoryName(name) }, "Création de la catégorie");
  } catch (e) {
    throw e instanceof CatalogueNotInstalledError ? new ServiceCategoriesNotInstalledError() : e;
  }
  assertOk(data, "Création de la catégorie");
  const { id, label } = data as { id?: unknown; label?: unknown };
  if (typeof id !== "string" || id === "" || typeof label !== "string" || label === "") throw new AdminError("server", "Création de la catégorie : réponse inattendue du serveur.");
  return { id, label };
}
