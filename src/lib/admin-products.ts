import { z } from "zod";
import { adminSupabase } from "@/lib/supabase";
import { AdminError, classify } from "@/lib/admin-api";

// Catalogue de produits côté administration. Tout passe par les quatre fonctions de
// supabase/migrations/20261026000000_products_catalog.sql (rôle `admin` vérifié dans chacune) :
//   admin_list_products() · admin_create_product(...) · admin_update_product(...) · admin_set_product_image(id, url)
// Les droits sont appliqués par la base : ce module ne contourne jamais la RLS et n'écrit jamais dans les tables.

export type AdminProduct = {
  id: string; sku: string; name: string; category: string; shortDescription: string; description: string;
  features: string[]; usageTips: string | null; volume: string | null; imageUrl: string | null;
  price: number; costPrice: number | null; stock: number; lowStockThreshold: number;
  active: boolean; isDemo: boolean; createdAt: string; updatedAt: string;
};

/** Valeurs de la fiche produit, hors identifiant, stock et photo (voir les fonctions ci-dessous). */
export type ProductInput = {
  sku: string; name: string; category: string; shortDescription: string; description: string; features: string[];
  usageTips: string | null; volume: string | null; price: number; costPrice: number | null; lowStockThreshold: number; active: boolean;
};

/** Limites imposées par la base (check_product et contraintes de public.products). */
export const PRODUCT_LIMITS = {
  name: { min: 2, max: 120 }, category: { min: 2, max: 60 }, short: 300, description: 2000,
  features: { count: 20, length: 200 }, usage: 1000, volume: 60, price: 100_000_000, stock: 1_000_000, threshold: 1_000_000,
} as const;

/** Le produit est vendable : actif ET en stock. Ne pas confondre le statut (choix de l'administrateur) et la disponibilité physique. */
export const isAvailable = (p: Pick<AdminProduct, "active" | "stock">) => p.active && p.stock > 0;
export const isLowStock = (p: Pick<AdminProduct, "stock" | "lowStockThreshold">) => p.lowStockThreshold > 0 && p.stock <= p.lowStockThreshold;

export function productStats(rows: AdminProduct[]) {
  const unavailable = rows.filter((p) => !isAvailable(p)).length;
  return { total: rows.length, active: rows.filter((p) => p.active).length, unavailable };
}

// --- Erreurs ---

/** La base répond que les fonctions du catalogue n'existent pas : la migration n'est pas appliquée à ce projet. */
export class CatalogueNotInstalledError extends AdminError {
  constructor() {
    super("server", "Le catalogue de produits n'est pas installé dans la base : la migration 20261026000000_products_catalog.sql n'a pas été appliquée à ce projet.");
  }
}

/** Refus métier renvoyé par une fonction (`{ ok: false, code, error }`) : le message de la base est conservé tel quel. */
export class ProductActionError extends AdminError {
  constructor(readonly reason: string, message: string) { super("server", message); }
}

type Failure = { code?: string; message?: string; status?: number } | null;

const MISSING_FUNCTION = /could not find the function|schema cache|does not exist/i;

function toError(error: NonNullable<Failure>, what: string): AdminError {
  if (error.code === "PGRST202" || error.code === "42883" || (error.status === 404 && MISSING_FUNCTION.test(error.message ?? ""))) {
    return new CatalogueNotInstalledError();
  }
  return classify(error, what);
}

async function rpc<T>(fn: string, args: Record<string, unknown> | undefined, what: string): Promise<T> {
  if (!adminSupabase) throw new AdminError("server", "Base de données non configurée.");
  let res: { data: unknown; error: Failure };
  try {
    res = (await adminSupabase.rpc(fn, args)) as { data: unknown; error: Failure };
  } catch (e) {
    throw classify({ message: e instanceof Error ? e.message : "network" }, what);
  }
  if (res.error) throw toError(res.error, what);
  return res.data as T;
}

/** Une réponse sans `ok: true` n'est jamais prise pour un succès. */
function assertOk(data: unknown, what: string): void {
  const r = data as { ok?: unknown; code?: unknown; error?: unknown } | null;
  if (r && r.ok === true) return;
  if (r && r.ok === false) throw new ProductActionError(String(r.code ?? "error"), typeof r.error === "string" && r.error ? r.error : `${what} impossible.`);
  throw new AdminError("server", `${what} : réponse inattendue du serveur.`);
}

// --- Lecture ---

type ProductRow = {
  id: string; sku: string; name: string; category: string; short_description: string; description: string; features: string[] | null;
  usage_tips: string | null; volume: string | null; image_url: string | null; sale_price: number; cost_price: number | null; stock_qty: number;
  low_stock_threshold: number; active: boolean; is_demo: boolean; created_at: string; updated_at: string;
};

/** Tous les produits, inactifs compris, avec le prix d'achat (null = coût inconnu). Réservé aux administrateurs par la base. */
export async function listAdminProducts(): Promise<AdminProduct[]> {
  const rows = await rpc<ProductRow[] | null>("admin_list_products", undefined, "Lecture des produits");
  return (rows ?? []).map((r) => ({
    id: r.id, sku: r.sku, name: r.name, category: r.category, shortDescription: r.short_description, description: r.description,
    features: r.features ?? [], usageTips: r.usage_tips, volume: r.volume, imageUrl: r.image_url,
    price: r.sale_price, costPrice: r.cost_price, stock: r.stock_qty, lowStockThreshold: r.low_stock_threshold,
    active: r.active, isDemo: r.is_demo, createdAt: r.created_at, updatedAt: r.updated_at,
  }));
}

// --- Écriture ---

/** Crée un produit. Le stock initial n'existe qu'à la création (journalisé par la base) ; la photo se règle ensuite. */
export async function createAdminProduct(input: ProductInput & { id: string; initialQty: number }): Promise<string> {
  const data = await rpc("admin_create_product", {
    p_id: input.id, p_sku: input.sku, p_name: input.name, p_category: input.category, p_short: input.shortDescription,
    p_description: input.description, p_features: input.features, p_usage: input.usageTips, p_volume: input.volume,
    p_image_url: null, p_sale_price: input.price, p_cost_price: input.costPrice, p_threshold: input.lowStockThreshold,
    p_initial_qty: input.initialQty, p_active: input.active,
  }, "Création du produit");
  assertOk(data, "Création du produit");
  return input.id;
}

/**
 * Modifie un produit. admin_update_product REMPLACE tous les champs qu'elle reçoit (un coût `null` efface le prix d'achat),
 * mais elle n'a ni paramètre de photo ni de stock : ni l'un ni l'autre ne peut être touché ici.
 */
export async function updateAdminProduct(id: string, input: ProductInput): Promise<void> {
  const data = await rpc("admin_update_product", {
    p_id: id, p_sku: input.sku, p_name: input.name, p_category: input.category, p_short: input.shortDescription,
    p_description: input.description, p_features: input.features, p_usage: input.usageTips, p_volume: input.volume,
    p_sale_price: input.price, p_cost_price: input.costPrice, p_threshold: input.lowStockThreshold, p_active: input.active,
  }, "Modification du produit");
  assertOk(data, "Modification du produit");
}

export const productToInput = (p: AdminProduct): ProductInput => ({
  sku: p.sku, name: p.name, category: p.category, shortDescription: p.shortDescription, description: p.description,
  features: p.features, usageTips: p.usageTips, volume: p.volume, price: p.price, costPrice: p.costPrice,
  lowStockThreshold: p.lowStockThreshold, active: p.active,
});

/**
 * Désactive ou réactive un produit (jamais de suppression). La fonction de modification remplaçant tous les champs,
 * on repart de la fiche la plus récente lue en base, pour ne pas écraser une modification faite depuis.
 */
export async function setProductActive(id: string, active: boolean): Promise<void> {
  const current = (await listAdminProducts()).find((p) => p.id === id);
  if (!current) throw new ProductActionError("not_found", "Produit introuvable.");
  await updateAdminProduct(id, { ...productToInput(current), active });
}

/** Enregistre (ou, avec null, retire) la référence de photo. Seule fonction qui écrit `image_url`. */
export async function setProductImage(id: string, url: string | null): Promise<void> {
  const data = await rpc("admin_set_product_image", { p_id: id, p_image_url: url }, "Enregistrement de la photo");
  assertOk(data, "Enregistrement de la photo");
}

// --- Formulaire ---

/** Identifiant d'URL (^[a-z0-9-]{2,60}$) tiré du nom : accents retirés, séparateurs en tirets. */
export function slugify(name: string): string {
  return name.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60).replace(/-+$/g, "");
}

const SKU = /^[A-Z0-9][A-Z0-9._-]{1,39}$/;
export const squeeze = (s: string) => s.replace(/[\s\u00a0\u202f]/g, "");

/** Entier positif saisi en texte (les espaces de milliers sont tolérés) ; chaîne vide permise si `optional`. */
function whole(label: string, max: number, optional = false) {
  return z.string().superRefine((raw, ctx) => {
    const s = squeeze(raw);
    if (s === "") { if (!optional) ctx.addIssue({ code: "custom", message: `${label} : indiquez une valeur.` }); return; }
    if (!/^\d+$/.test(s)) ctx.addIssue({ code: "custom", message: `${label} : nombre entier positif uniquement.` });
    else if (Number(s) > max) ctx.addIssue({ code: "custom", message: `${label} : ${new Intl.NumberFormat("fr-FR").format(max).replace(/\u202f|\u00a0/g, " ")} au maximum.` });
  });
}

const featureLines = (raw: string) => raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

export const productFormSchema = z.object({
  name: z.string().trim().min(PRODUCT_LIMITS.name.min, "Indiquez le nom du produit (2 caractères minimum).").max(PRODUCT_LIMITS.name.max, "Nom trop long (120 caractères maximum)."),
  sku: z.string().trim().refine((v) => SKU.test(v.toUpperCase()), "Référence invalide : lettres, chiffres, . _ - (2 à 40 caractères)."),
  category: z.string().trim().min(PRODUCT_LIMITS.category.min, "Choisissez une catégorie.").max(PRODUCT_LIMITS.category.max, "Catégorie trop longue."),
  shortDescription: z.string().max(PRODUCT_LIMITS.short, "Résumé trop long (300 caractères maximum)."),
  description: z.string().max(PRODUCT_LIMITS.description, "Description trop longue (2 000 caractères maximum)."),
  features: z.string().superRefine((raw, ctx) => {
    const lines = featureLines(raw);
    if (lines.length > PRODUCT_LIMITS.features.count) ctx.addIssue({ code: "custom", message: "20 caractéristiques au maximum." });
    else if (lines.some((l) => l.length > PRODUCT_LIMITS.features.length)) ctx.addIssue({ code: "custom", message: "Une caractéristique dépasse 200 caractères." });
  }),
  usageTips: z.string().max(PRODUCT_LIMITS.usage, "Conseils trop longs (1 000 caractères maximum)."),
  volume: z.string().max(PRODUCT_LIMITS.volume, "Contenance trop longue (60 caractères maximum)."),
  price: whole("Prix de vente", PRODUCT_LIMITS.price),
  costPrice: whole("Coût d'achat", PRODUCT_LIMITS.price, true),
  lowStockThreshold: whole("Seuil d'alerte", PRODUCT_LIMITS.threshold),
  initialQty: whole("Stock initial", PRODUCT_LIMITS.stock),
  active: z.boolean(),
});
export type ProductFormValues = z.infer<typeof productFormSchema>;

export const emptyProductForm: ProductFormValues = {
  name: "", sku: "", category: "", shortDescription: "", description: "", features: "", usageTips: "", volume: "",
  price: "", costPrice: "", lowStockThreshold: "0", initialQty: "0", active: true,
};

export const productToForm = (p: AdminProduct): ProductFormValues => ({
  name: p.name, sku: p.sku, category: p.category, shortDescription: p.shortDescription, description: p.description,
  features: p.features.join("\n"), usageTips: p.usageTips ?? "", volume: p.volume ?? "",
  price: String(p.price), costPrice: p.costPrice === null ? "" : String(p.costPrice), lowStockThreshold: String(p.lowStockThreshold),
  initialQty: "0", active: p.active, // le stock existant n'est pas un champ du formulaire de modification
});

/** Valeurs du formulaire (déjà validées) -> arguments des fonctions. Un coût vide devient « coût inconnu ». */
export function formToInput(v: ProductFormValues): ProductInput {
  return {
    sku: v.sku.trim().toUpperCase(), name: v.name.trim(), category: v.category.trim(), shortDescription: v.shortDescription,
    description: v.description, features: featureLines(v.features), usageTips: v.usageTips.trim() || null, volume: v.volume.trim() || null,
    price: Number(squeeze(v.price)), costPrice: squeeze(v.costPrice) === "" ? null : Number(squeeze(v.costPrice)),
    lowStockThreshold: Number(squeeze(v.lowStockThreshold)), active: v.active,
  };
}
