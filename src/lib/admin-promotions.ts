import { z } from "zod";
import { AdminError, classify } from "@/lib/admin-api";
import { squeeze } from "@/lib/admin-products";
import { fromRow, isMissingTable, PROMOTION_COLUMNS, type Promotion, type PromotionKind, type PromotionPublication, type PromotionRow } from "@/lib/promotions";
import { adminSupabase } from "@/lib/supabase";

// Gestion des promotions (table public.promotions) par l'administrateur.
// Les écritures passent par les politiques RLS « admin » (rôle admin vérifié par la base) : ce module ne contourne jamais la RLS.
// Jamais de DELETE : la suppression est LOGIQUE (deleted_at). Les promotions sont informatives : aucune écriture dans services, products
// ni bookings.

/** La table n'existe pas encore : la migration n'est pas appliquée à ce projet. */
export class PromotionsNotInstalledError extends AdminError {
  constructor() {
    super("server", "Les promotions ne sont pas encore installées dans la base : la migration 20261029000000_promotions.sql n'a pas été appliquée à ce projet.");
  }
}

/** Refus métier ou de la base, avec un message affichable. */
export class PromotionActionError extends AdminError {
  constructor(readonly reason: string, message: string) { super("server", message); }
}

type Failure = { code?: string; message?: string; status?: number } | null;

function toError(error: NonNullable<Failure>, what: string): AdminError {
  if (isMissingTable(error)) return new PromotionsNotInstalledError();
  if (error.code === "23514") return new PromotionActionError("invalid_input", "Valeurs refusées par la base (type, prix, pourcentage, dates ou lien incohérents).");
  if (error.code === "23503") return new PromotionActionError("unknown_link", "La prestation ou le produit choisi n'existe plus. Choisissez un autre élément ou retirez le lien.");
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

const touched = (rows: unknown[] | null) => Array.isArray(rows) && rows.length > 0;
const NOT_DONE = () => new PromotionActionError("not_found", "Promotion introuvable ou accès refusé : rien n'a été modifié.");

// --- Données du formulaire ---

export type PromotionInput = {
  title: string; description: string; kind: PromotionKind;
  originalPrice: number | null; promoPrice: number | null; percentOff: number | null;
  startsOn: string | null; endsOn: string | null; publication: PromotionPublication;
  serviceId: string | null; productId: string | null;
};

/** Valeurs enregistrées : les champs qui ne concernent pas le type choisi sont toujours vidés (contrainte de la base). */
export function toRowValues(i: PromotionInput) {
  return {
    title: i.title, description: i.description, kind: i.kind,
    // Type pourcentage : prix de référence ANNONCÉ facultatif (instantané saisi, jamais relié au catalogue) ; aucun prix promotionnel.
    original_price_fcfa: i.kind === "price" || i.kind === "percent" ? i.originalPrice : null,
    promo_price_fcfa: i.kind === "price" ? i.promoPrice : null,
    percent_off: i.kind === "percent" ? i.percentOff : null,
    starts_on: i.startsOn, ends_on: i.endsOn, status: i.publication,
    service_id: i.serviceId, product_id: i.productId,
  };
}

// --- Lecture ---

/** Promotions non supprimées, les plus récentes d'abord (toutes publications et périodes : le statut affiché est calculé). */
export async function listAdminPromotions(): Promise<Promotion[]> {
  const rows = await run<PromotionRow[]>("Lecture des promotions", (c) =>
    c.from("promotions").select(PROMOTION_COLUMNS).is("deleted_at", null).order("created_at", { ascending: false }) as unknown as PromiseLike<{ data: PromotionRow[] | null; error: Failure }>);
  return (rows ?? []).map(fromRow);
}

// --- Écriture ---

/** Identifiant de la nouvelle promotion, choisi ICI : une création rejouée après une réponse perdue ne peut pas faire de doublon. */
export const newPromotionId = () => globalThis.crypto.randomUUID();

/**
 * Crée une promotion avec l'identifiant donné. Une violation d'unicité sur cet identifiant signifie qu'un essai précédent a abouti
 * (la réponse s'est perdue) : la promotion est alors considérée comme créée, sans second enregistrement.
 */
export async function createAdminPromotion(id: string, input: PromotionInput): Promise<{ id: string }> {
  if (!adminSupabase) throw new AdminError("server", "Base de données non configurée.");
  let res: { error: Failure };
  try {
    res = await adminSupabase.from("promotions").insert({ id, ...toRowValues(input) }) as unknown as { error: Failure };
  } catch (e) {
    throw classify({ message: e instanceof Error ? e.message : "network" }, "Création de la promotion");
  }
  if (res.error && res.error.code !== "23505") throw toError(res.error, "Création de la promotion");
  return { id };
}

export async function updateAdminPromotion(id: string, input: PromotionInput): Promise<void> {
  const rows = await run<{ id: string }[]>("Modification de la promotion", (c) =>
    c.from("promotions").update(toRowValues(input)).eq("id", id).is("deleted_at", null).select("id") as unknown as PromiseLike<{ data: { id: string }[] | null; error: Failure }>);
  if (!touched(rows)) throw NOT_DONE();
}

/** Publier (activer) ou désactiver. Le statut affiché dépend en plus des dates. */
export async function setPromotionPublication(id: string, publication: PromotionPublication): Promise<void> {
  const rows = await run<{ id: string }[]>("Changement de statut", (c) =>
    c.from("promotions").update({ status: publication }).eq("id", id).is("deleted_at", null).select("id") as unknown as PromiseLike<{ data: { id: string }[] | null; error: Failure }>);
  if (!touched(rows)) throw NOT_DONE();
}

/** Suppression LOGIQUE : la ligne reste en base (deleted_at) mais disparaît des listes et du site. */
export async function deleteAdminPromotion(id: string): Promise<void> {
  const rows = await run<{ id: string }[]>("Suppression de la promotion", (c) =>
    c.from("promotions").update({ deleted_at: new Date().toISOString() }).eq("id", id).is("deleted_at", null).select("id") as unknown as PromiseLike<{ data: { id: string }[] | null; error: Failure }>);
  if (!touched(rows)) throw NOT_DONE();
}

// --- Formulaire ---

export const PROMOTION_LIMITS = { title: { min: 2, max: 120 }, description: 1000, price: 100_000_000 } as const;

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const isRealDate = (s: string) => DATE.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;
const whole = (s: string) => /^\d+$/.test(squeeze(s));

export const promotionFormSchema = z.object({
  title: z.string().trim().min(PROMOTION_LIMITS.title.min, "Indiquez le titre de la promotion (2 caractères minimum).").max(PROMOTION_LIMITS.title.max, "Titre trop long (120 caractères maximum)."),
  description: z.string().max(PROMOTION_LIMITS.description, "Description trop longue (1 000 caractères maximum)."),
  // Aucun type par défaut : « Choisissez un type de promotion. » tant que l'administrateur n'a pas choisi.
  kind: z.enum(["price", "percent", "announcement"], { message: "Choisissez un type de promotion." }),
  originalPrice: z.string(),
  promoPrice: z.string(),
  percentOff: z.string(),
  startsOn: z.string(),
  endsOn: z.string(),
  publication: z.enum(["draft", "published"], { message: "Choisissez un statut." }),
  linkType: z.enum(["none", "service", "product"]),
  linkId: z.string(),
}).superRefine((v, ctx) => {
  const bad = (path: string, message: string) => ctx.addIssue({ code: "custom", path: [path], message });
  if (v.kind === "price") {
    const o = squeeze(v.originalPrice), p = squeeze(v.promoPrice);
    if (o === "") bad("originalPrice", "Prix initial annoncé : indiquez une valeur.");
    else if (!whole(o)) bad("originalPrice", "Prix initial annoncé : nombre entier positif uniquement.");
    else if (Number(o) < 1) bad("originalPrice", "Prix initial annoncé : 1 FCFA au minimum.");
    else if (Number(o) > PROMOTION_LIMITS.price) bad("originalPrice", "Prix initial annoncé : valeur trop élevée.");
    if (p === "") bad("promoPrice", "Prix promotionnel annoncé : indiquez une valeur.");
    else if (!whole(p)) bad("promoPrice", "Prix promotionnel annoncé : nombre entier positif uniquement (0 si offert).");
    else if (Number(p) > PROMOTION_LIMITS.price) bad("promoPrice", "Prix promotionnel annoncé : valeur trop élevée.");
    else if (whole(o) && Number(o) >= 1 && Number(p) >= Number(o)) bad("promoPrice", "Le prix promotionnel doit être inférieur au prix initial.");
  }
  if (v.kind === "percent") {
    const r = squeeze(v.percentOff);
    if (r === "") bad("percentOff", "Pourcentage de réduction : indiquez une valeur.");
    else if (!whole(r)) bad("percentOff", "Pourcentage de réduction : nombre entier uniquement.");
    else if (Number(r) < 1 || Number(r) > 99) bad("percentOff", "Pourcentage de réduction : de 1 à 99.");
    // Prix de référence annoncé : facultatif, mais valide s'il est renseigné.
    const ref = squeeze(v.originalPrice);
    if (ref !== "") {
      if (!whole(ref)) bad("originalPrice", "Prix de référence annoncé : nombre entier positif uniquement.");
      else if (Number(ref) < 1) bad("originalPrice", "Prix de référence annoncé : 1 FCFA au minimum.");
      else if (Number(ref) > PROMOTION_LIMITS.price) bad("originalPrice", "Prix de référence annoncé : valeur trop élevée.");
    }
  }
  const s = v.startsOn.trim(), e = v.endsOn.trim();
  if (s !== "" && !isRealDate(s)) bad("startsOn", "Date de début invalide.");
  if (e !== "" && !isRealDate(e)) bad("endsOn", "Date de fin invalide.");
  if (s !== "" && e !== "" && isRealDate(s) && isRealDate(e) && e < s) bad("endsOn", "La date de fin ne peut pas précéder la date de début.");
  if (v.linkType !== "none" && v.linkId.trim() === "") bad("linkId", v.linkType === "service" ? "Choisissez la prestation concernée." : "Choisissez le produit concerné.");
});
export type PromotionFormValues = z.infer<typeof promotionFormSchema>;

export const emptyPromotionForm: PromotionFormValues = {
  title: "", description: "", kind: "" as never, originalPrice: "", promoPrice: "", percentOff: "", startsOn: "", endsOn: "",
  publication: "draft", linkType: "none", linkId: "",
};

export const promotionToForm = (p: Promotion): PromotionFormValues => ({
  title: p.title, description: p.description, kind: p.kind,
  originalPrice: p.originalPrice === null ? "" : String(p.originalPrice), promoPrice: p.promoPrice === null ? "" : String(p.promoPrice),
  percentOff: p.percentOff === null ? "" : String(p.percentOff), startsOn: p.startsOn ?? "", endsOn: p.endsOn ?? "",
  // Une promotion « désactivée » est rouverte comme publiée dans le formulaire ; le bouton d'activation reste l'action dédiée.
  publication: p.publication === "published" ? "published" : "draft",
  linkType: p.serviceId ? "service" : p.productId ? "product" : "none", linkId: p.serviceId ?? p.productId ?? "",
});

/** Valeurs validées du formulaire -> données enregistrées. `keepDisabled` : une promotion désactivée le reste tant que l'on n'a pas choisi de la publier. */
export function formToPromotionInput(v: PromotionFormValues, current?: Pick<Promotion, "publication">): PromotionInput {
  const n = (s: string) => Number(squeeze(s));
  const publication: PromotionPublication = current?.publication === "disabled" && v.publication === "draft" ? "disabled" : v.publication;
  return {
    title: v.title.trim(), description: v.description, kind: v.kind,
    originalPrice: v.kind === "price" || (v.kind === "percent" && squeeze(v.originalPrice) !== "") ? n(v.originalPrice) : null,
    promoPrice: v.kind === "price" ? n(v.promoPrice) : null,
    percentOff: v.kind === "percent" ? n(v.percentOff) : null,
    startsOn: v.startsOn.trim() || null, endsOn: v.endsOn.trim() || null, publication,
    serviceId: v.linkType === "service" ? v.linkId : null, productId: v.linkType === "product" ? v.linkId : null,
  };
}
