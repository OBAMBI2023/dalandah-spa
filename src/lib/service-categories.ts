import { defaultCategoryImage, serviceCategories, type ServiceCategoryInfo } from "@/data/services";

// Catégories de prestations : les 6 d'origine (code) + celles créées depuis l'administration (table public.service_categories).
// Fonctions pures, partagées par le site public et l'administration.

/** Ligne de public.service_categories telle que lue par le site. */
export type CategoryRow = { id: string; label: string; title?: string | null; description?: string | null; image_url?: string | null; sort_order?: number | null };

/** Colonnes demandées à la base. */
export const CATEGORY_COLUMNS = "id,label,title,description,image_url,sort_order";

const ID = /^[a-z0-9-]{2,60}$/;

const isRow = (r: unknown): r is CategoryRow =>
  !!r && typeof r === "object" && typeof (r as CategoryRow).id === "string" && ID.test((r as CategoryRow).id) && typeof (r as CategoryRow).label === "string" && (r as CategoryRow).label !== "";

/** Libellé lisible d'un identifiant inconnu (« soins-du-dos » -> « Soins du dos »). */
const readable = (id: string) => { const s = id.replace(/-/g, " "); return s.charAt(0).toUpperCase() + s.slice(1); };

/**
 * Liste complète des catégories, dans l'ordre d'affichage.
 *  - Les 6 catégories d'origine gardent TOUJOURS leur libellé, titre, description, image et ordre du code, même si la base en dit autre chose.
 *  - Les catégories créées ensuite suivent, par ordre d'affichage (sort_order) puis par identifiant ; sans photo elles reçoivent l'image par défaut.
 *  - `rows` absent ou illisible (table pas encore créée, réseau) : seules les catégories d'origine sont rendues.
 *  - `usedIds` : catégories référencées par des prestations ; une catégorie inconnue de la liste est ajoutée plutôt que de masquer ses prestations.
 */
export function buildCategories(rows?: unknown, usedIds: readonly string[] = []): ServiceCategoryInfo[] {
  const known = new Set<string>(serviceCategories.map((c) => c.id));
  const extra: (ServiceCategoryInfo & { order: number })[] = [];
  if (Array.isArray(rows)) {
    for (const r of rows) {
      if (!isRow(r) || known.has(r.id)) continue;
      known.add(r.id);
      extra.push({ id: r.id, label: r.label, title: r.title || r.label, description: r.description ?? "", image: r.image_url || defaultCategoryImage, order: typeof r.sort_order === "number" ? r.sort_order : 0 });
    }
  }
  extra.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  const out: ServiceCategoryInfo[] = [...serviceCategories, ...extra.map(({ order: _order, ...c }) => c)];
  for (const id of usedIds) {
    if (!known.has(id)) { known.add(id); out.push({ id, label: readable(id), title: readable(id), description: "", image: defaultCategoryImage }); }
  }
  return out;
}

/** Catégories à montrer aux clients : uniquement celles qui comptent au moins une prestation (le site ne reçoit que les prestations actives). */
export function categoriesInUse(categories: readonly ServiceCategoryInfo[], services: readonly { category: string }[]): ServiceCategoryInfo[] {
  const used = new Set(services.map((s) => s.category));
  return categories.filter((c) => used.has(c.id));
}

/** Identifiant de catégorie accepté dans l'adresse (?categorie=) : le format seul est vérifié, l'existence l'est avec le catalogue chargé. */
export const parseCategoryParam = (v: unknown): string | undefined => (typeof v === "string" && ID.test(v) ? v : undefined);
