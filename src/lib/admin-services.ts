import { z } from "zod";
import { serviceCategories } from "@/data/services";
import { AdminError, classify, type AdminService } from "@/lib/admin-api";
import { slugify, squeeze, withSuffix } from "@/lib/admin-products";
import { startsAtMs } from "@/lib/bookings";
import { adminSupabase } from "@/lib/supabase";

// Gestion des prestations (table public.services) par l'administrateur.
// Les écritures passent par la politique RLS « admin services » (rôle admin vérifié par la base) : ce module ne contourne jamais la RLS.
// Jamais de suppression : une prestation réservée ne peut pas être supprimée (clé étrangère bookings.service_id), et la désactivation
// garde l'historique. Les réservations conservent leur propre copie du nom, de la durée et du prix.

export type ServiceInput = {
  name: string; category: string; description: string; durationMin: number; durationLabel: string; price: number; active: boolean;
};

/** Limites imposées par la base (contraintes de public.services). */
export const SERVICE_LIMITS = { name: { min: 2, max: 120 }, description: 1000, duration: { min: 5, max: 720 }, label: 40, price: 100_000_000 } as const;

// --- Durée ---

/**
 * Libellé de durée, dans la convention du catalogue existant : « 30 min », « 60 min », « 75 min » jusqu'à moins de 2 h, puis « 2 h »,
 * « 2 h 30 ». (Les libellés personnalisés comme « 2 h et + » ne sont jamais écrasés : voir le formulaire.)
 */
export function formatDuration(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return "";
  const m = Math.round(minutes);
  if (m < 120) return `${m} min`;
  const h = Math.floor(m / 60), r = m % 60;
  return r === 0 ? `${h} h` : `${h} h ${String(r).padStart(2, "0")}`;
}

// --- Erreurs ---

/** Refus métier ou de la base, avec un message affichable. */
export class ServiceActionError extends AdminError {
  constructor(readonly reason: string, message: string) { super("server", message); }
}

type Failure = { code?: string; message?: string; status?: number } | null;

function toError(error: NonNullable<Failure>, what: string): AdminError {
  if (error.code === "23505") return new ServiceActionError("id_taken", "Une prestation porte déjà cet identifiant.");
  if (error.code === "23503") return new ServiceActionError("unknown_category", "Cette catégorie n'existe pas (ou plus) : choisissez une catégorie de la liste.");
  if (error.code === "23514") return new ServiceActionError("invalid_input", "Valeurs refusées par la base (durée de 5 à 720 minutes, prix positif, textes dans les limites).");
  return classify(error, what);
}

async function run<T>(what: string, call: (c: NonNullable<typeof adminSupabase>) => PromiseLike<{ data: T | null; error: Failure }>): Promise<T> {
  if (!adminSupabase) throw new AdminError("server", "Base de données non configurée.");
  let res: { data: T | null; error: Failure };
  try {
    res = await call(adminSupabase);
  } catch (e) {
    throw classify({ message: e instanceof Error ? e.message : "network" }, what);
  }
  if (res.error) throw toError(res.error, what);
  return res.data as T;
}

/** Une écriture qui ne touche aucune ligne n'a pas eu lieu (RLS ou prestation disparue) : jamais présentée comme un succès. */
const touched = (rows: unknown[] | null) => Array.isArray(rows) && rows.length > 0;
const NOT_DONE = () => new ServiceActionError("not_found", "Prestation introuvable ou accès refusé : rien n'a été modifié.");

// --- Écriture ---

const payload = (i: ServiceInput) => ({
  name: i.name, category: i.category, description: i.description, duration_min: i.durationMin, duration_label: i.durationLabel,
  price_fcfa: i.price, active: i.active,
});

/** Modifie une prestation. Ne touche jamais à la photo, à l'ordre ni à l'identifiant ; `confirmTariff` retire seulement le marquage « démonstration ». */
export async function updateAdminService(id: string, input: ServiceInput, opts: { confirmTariff?: boolean } = {}): Promise<void> {
  const rows = await run<{ id: string }[]>("Modification de la prestation", (c) =>
    c.from("services").update({ ...payload(input), ...(opts.confirmTariff ? { is_demo: false } : {}) }).eq("id", id).select("id"));
  if (!touched(rows)) throw NOT_DONE();
}

/** Désactive ou réactive une prestation (jamais de suppression). */
export async function setServiceActive(id: string, active: boolean): Promise<void> {
  const rows = await run<{ id: string }[]>(active ? "Réactivation de la prestation" : "Désactivation de la prestation", (c) =>
    c.from("services").update({ active }).eq("id", id).select("id"));
  if (!touched(rows)) throw NOT_DONE();
}

// --- Création ---

export type ServiceAttempt = { id: string };
const MAX_ATTEMPTS = 25;
const ID_MAX = 60;

function freeId(base: string, taken: Set<string>): string {
  for (let n = 1; n < 1000; n++) {
    const v = withSuffix(base, n, ID_MAX);
    if (!taken.has(v)) return v;
  }
  throw new ServiceActionError("invalid_input", "Impossible de générer un identifiant unique.");
}

/** Premier identifiant d'adresse libre pour ce nom ("" si le nom ne donne pas 2 caractères valides). */
export function nextServiceId(name: string, existing: readonly string[]): string {
  const base = slugify(name);
  return base.length >= 2 ? freeId(base, new Set(existing.map((s) => s.toLowerCase()))) : "";
}

/**
 * Crée une prestation (active ou non, jamais « démonstration ») avec un identifiant tiré du nom. La base tranche en cas de doublon : sur
 * une clé primaire déjà prise, on passe à la variante suivante (-2, -3…) ; toute autre erreur (réseau, droits, validation) est renvoyée
 * telle quelle, sans nouvelle tentative. `onAttempt` signale chaque essai juste avant son envoi (réponse perdue : voir findCreatedService).
 * La prestation est placée en dernier dans le catalogue.
 */
export async function createAdminService(
  input: ServiceInput, existingIds: readonly string[], opts: { onAttempt?: (a: ServiceAttempt) => void } = {},
): Promise<{ id: string }> {
  const root = slugify(input.name);
  if (root.length < 2) throw new ServiceActionError("invalid_input", "Le nom doit contenir au moins 2 lettres ou chiffres.");
  const last = await run<{ sort_order: number }[]>("Lecture du catalogue", (c) => c.from("services").select("sort_order").order("sort_order", { ascending: false }).limit(1));
  const sortOrder = ((last ?? [])[0]?.sort_order ?? 0) + 10;
  const taken = new Set(existingIds.map((s) => s.toLowerCase()));
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const id = freeId(root, taken);
    try {
      opts.onAttempt?.({ id });
      const rows = await run<{ id: string }[]>("Création de la prestation", (c) =>
        c.from("services").insert({ id, ...payload(input), is_demo: false, sort_order: sortOrder }).select("id"));
      if (!touched(rows)) throw new ServiceActionError("not_found", "La prestation n'a pas été enregistrée : accès refusé.");
      return { id };
    } catch (e) {
      if (e instanceof ServiceActionError && e.reason === "id_taken") taken.add(id);
      else throw e;
    }
  }
  throw new ServiceActionError("id_taken", "Impossible de générer un identifiant unique pour cette prestation. Réessayez dans un instant.");
}

/** Un essai de création dont la réponse s'est perdue a-t-il abouti ? Oui si le catalogue relu contient CETTE prestation (même identifiant, même nom). */
export function findCreatedService(rows: readonly Pick<AdminService, "id" | "name">[], attempt: ServiceAttempt, name: string) {
  return rows.find((s) => s.id === attempt.id && s.name === name.trim()) ?? null;
}

// --- Réservations à venir (avant une désactivation) ---

/** Nombre de réservations CONFIRMÉES à venir, par identifiant de prestation (lecture réservée à l'administrateur par la RLS). */
export async function upcomingBookingsByService(now = Date.now()): Promise<Record<string, number>> {
  const rows = await run<{ service_id: string; date: string; slot: string }[]>("Lecture des réservations", (c) =>
    c.from("bookings").select("service_id,date,slot").eq("status", "confirmed").limit(1000));
  const out: Record<string, number> = {};
  for (const r of rows ?? []) {
    if (startsAtMs({ date: String(r.date).slice(0, 10), slot: String(r.slot).slice(0, 5) }) >= now) out[r.service_id] = (out[r.service_id] ?? 0) + 1;
  }
  return out;
}

// --- Formulaire ---

/** Catégories d'origine (repli). La liste complète — avec celles créées depuis l'administration — vient de la base : voir admin-service-categories.ts. */
export const SERVICE_CATEGORY_IDS = serviceCategories.map((c) => c.id) as [string, ...string[]];
export const serviceCategoryLabel = (id: string, categories: readonly { id: string; label: string }[] = serviceCategories) => categories.find((c) => c.id === id)?.label ?? id;

function wholeIn(label: string, min: number, max: number, optional = false) {
  return z.string().superRefine((raw, ctx) => {
    const s = squeeze(raw);
    if (s === "") { if (!optional) ctx.addIssue({ code: "custom", message: `${label} : indiquez une valeur.` }); return; }
    if (!/^\d+$/.test(s)) ctx.addIssue({ code: "custom", message: `${label} : nombre entier positif uniquement.` });
    else if (Number(s) < min) ctx.addIssue({ code: "custom", message: `${label} : ${min} au minimum.` });
    else if (Number(s) > max) ctx.addIssue({ code: "custom", message: `${label} : ${new Intl.NumberFormat("fr-FR").format(max).replace(/\s/g, " ")} au maximum.` });
  });
}

export const serviceFormSchema = z.object({
  name: z.string().trim().min(SERVICE_LIMITS.name.min, "Indiquez le nom de la prestation (2 caractères minimum).").max(SERVICE_LIMITS.name.max, "Nom trop long (120 caractères maximum)."),
  // Le format est vérifié ici ; l'existence de la catégorie l'est par la base (clé étrangère) et par la liste proposée dans le formulaire.
  category: z.string({ message: "Choisissez une catégorie." }).regex(/^[a-z0-9-]{2,60}$/, "Choisissez une catégorie."),
  description: z.string().max(SERVICE_LIMITS.description, "Description trop longue (1 000 caractères maximum)."),
  durationMin: wholeIn("Durée (minutes)", SERVICE_LIMITS.duration.min, SERVICE_LIMITS.duration.max),
  durationLabel: z.string().trim().max(SERVICE_LIMITS.label, "Libellé trop long (40 caractères maximum)."),
  price: wholeIn("Prix de vente", 0, SERVICE_LIMITS.price),
  active: z.boolean(),
  confirmTariff: z.boolean(),
});
export type ServiceFormValues = z.infer<typeof serviceFormSchema>;

export const emptyServiceForm: ServiceFormValues = { name: "", category: "" as never, description: "", durationMin: "", durationLabel: "", price: "", active: true, confirmTariff: false };

export const serviceToForm = (s: AdminService): ServiceFormValues => ({
  name: s.name, category: s.category as never, description: s.description, durationMin: String(s.durationMin), durationLabel: s.durationLabel,
  price: String(s.price), active: s.active, confirmTariff: false,
});

/** Valeurs validées du formulaire -> données enregistrées. Libellé vide = libellé généré à partir de la durée. */
export function formToServiceInput(v: ServiceFormValues): ServiceInput {
  const minutes = Number(squeeze(v.durationMin));
  return {
    name: v.name.trim(), category: v.category, description: v.description, durationMin: minutes,
    durationLabel: v.durationLabel.trim() || formatDuration(minutes), price: Number(squeeze(v.price)), active: v.active,
  };
}

export const serviceToInput = (s: AdminService): ServiceInput => ({
  name: s.name, category: s.category, description: s.description, durationMin: s.durationMin, durationLabel: s.durationLabel, price: s.price, active: s.active,
});
