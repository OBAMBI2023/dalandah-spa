import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

// Suivi ANONYME des promotions (migration 20261030000000_promotion_tracking.sql). Aucun outil tiers, aucune donnée personnelle.
//
// RÈGLE DE DÉDUPLICATION (appliquée ici ET garantie par une contrainte d'unicité en base) :
//   une même promotion, un même événement et une même session ne sont comptés QU'UNE FOIS PAR JOUR.
//   - « session » : identifiant aléatoire de 32 caractères hexadécimaux, généré par le navigateur et conservé dans sessionStorage le temps
//     de la visite (il disparaît à la fermeture de l'onglet). Ce n'est ni l'adresse IP, ni un nom, ni un téléphone, ni un e-mail.
//   - impression : la bannière est visible à au moins 50 % (ou occupe au moins la moitié de la hauteur de l'écran si elle est plus haute que lui)
//     pendant 1 seconde sans interruption, ET l'onglet est au premier plan (document.visibilityState = visible). Un nouveau rendu React ne recompte pas.
//   - clic : clic sur la bannière ou sur son bouton d'action. Démarrage de réservation : arrivée sur le parcours de réservation avec ?promo=.
// JOUR = jour UTC (Abidjan est à UTC+0 toute l'année) : le même découpage que la base (promotion_events.day), pour que la déduplication du navigateur
// et celle de la base tombent le même jour, quel que soit le fuseau de l'appareil.
// Le suivi ne bloque jamais la navigation : toute erreur est ignorée. Les statistiques restent indicatives (voir l'administration).

export type PromotionEvent = "impression" | "click" | "booking_started";

export const IMPRESSION_RATIO = 0.5;
export const IMPRESSION_MS = 1000;

/** Jour de comptage : date UTC au format AAAA-MM-JJ, identique à promotion_events.day côté base. */
export const utcDay = (d: Date = new Date()): string => d.toISOString().slice(0, 10);

type ObservedEntry = { isIntersecting: boolean; intersectionRatio: number; intersectionRect?: { height: number }; rootBounds?: { height: number } | null };

/**
 * Assez visible pour compter : au moins 50 % de la bannière, ou — pour une bannière plus haute que l'écran, qui n'atteindra jamais 50 % d'elle-même —
 * une partie visible qui occupe au moins la moitié de la hauteur de l'écran.
 */
export function isVisibleEnough(e: ObservedEntry): boolean {
  if (!e.isIntersecting) return false;
  if (e.intersectionRatio >= IMPRESSION_RATIO) return true;
  const screen = e.rootBounds?.height ?? (typeof window === "undefined" ? 0 : window.innerHeight);
  return screen > 0 && (e.intersectionRect?.height ?? 0) >= screen * IMPRESSION_RATIO;
}

/** Seuils fins : le rappel part à chaque changement de visibilité de 5 %, y compris pour une très grande bannière. */
const THRESHOLDS = Array.from({ length: 21 }, (_, i) => i / 20);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Identifiant de promotion accepté dans l'adresse (?promo=) ; tout autre contenu est ignoré. */
export const parsePromoParam = (v: unknown): string | undefined => (typeof v === "string" && UUID.test(v) ? v.toLowerCase() : undefined);

const SESSION_KEY = "dalanda.promo.session";
const SENT_KEY = "dalanda.promo.sent";
/** Clé de la session administrateur (voir supabase.ts) : un navigateur où l'administrateur est connecté ne compte pas comme un visiteur. */
const ADMIN_AUTH_KEY = "dalanda.admin.auth";

const isAdminBrowser = (): boolean => {
  try { return typeof window !== "undefined" && !!window.localStorage.getItem(ADMIN_AUTH_KEY); } catch { return false; }
};

const storage = (): Storage | null => { try { return typeof window === "undefined" ? null : window.sessionStorage; } catch { return null; } };

let memorySession: string | null = null;
const memorySent = new Set<string>();

const randomHex = (): string => {
  const bytes = new Uint8Array(16);
  if (typeof globalThis.crypto?.getRandomValues === "function") globalThis.crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
};

/** Identifiant de session anonyme (32 caractères hexadécimaux), stable pour la visite. */
export function sessionKey(): string {
  const s = storage();
  // Sans stockage de session (navigation bloquée, mode restreint) : un identifiant tenu en mémoire pour la durée de la page, STABLE entre les appels.
  if (!s) return (memorySession ??= randomHex());
  try {
    const known = s.getItem(SESSION_KEY);
    if (known && /^[0-9a-f]{32}$/.test(known)) return known;
    const fresh = memorySession ?? randomHex();
    s.setItem(SESSION_KEY, fresh);
    memorySession = fresh;
    return fresh;
  } catch {
    return (memorySession ??= randomHex());
  }
}

const readSent = (): Set<string> => {
  try { return new Set<string>(JSON.parse(storage()?.getItem(SENT_KEY) ?? "[]") as string[]); } catch { return new Set(); }
};
const writeSent = (set: Set<string>) => { try { storage()?.setItem(SENT_KEY, JSON.stringify([...set])); } catch { /* sans stockage : déduplication en mémoire seulement */ } };

/**
 * Enregistre un événement, au plus une fois par promotion, événement et jour pour cette session. Rend true si un envoi a eu lieu.
 * Sans Supabase (mode local) ou sans identifiant valide : aucun envoi.
 */
export async function trackPromotion(event: PromotionEvent, promotionId: string, today = utcDay()): Promise<boolean> {
  // Le site public interroge la base en anonyme : la base ne peut pas reconnaître un administrateur ici, c'est donc ce navigateur qui s'abstient
  // (clé de session administrateur présente). Ce n'est pas une garantie : un administrateur en navigation privée, ou une clé périmée, fausse la règle.
  if (!supabase || !parsePromoParam(promotionId) || isAdminBrowser()) return false;
  const id = promotionId.toLowerCase();
  const mark = `${today}:${id}:${event}`;
  const sent = readSent();
  if (memorySent.has(mark) || sent.has(mark)) return false;
  // Marqué AVANT l'envoi : deux déclenchements rapprochés (double rendu, double clic) ne produisent qu'un envoi.
  memorySent.add(mark);
  // Les marques des jours précédents ne servent plus.
  for (const m of [...sent]) if (!m.startsWith(`${today}:`)) sent.delete(m);
  sent.add(mark);
  writeSent(sent);
  const forget = () => { memorySent.delete(mark); const s = readSent(); s.delete(mark); writeSent(s); };
  try {
    const { data, error } = await supabase.rpc("track_promotion_event", { p_promotion_id: id, p_event: event, p_session: sessionKey() });
    // Réseau, limitation de débit ou fonction absente : on pourra réessayer plus tard. Refus définitif (promotion non éligible, etc.) : on garde la marque.
    const code = (data as { code?: string } | null)?.code;
    if (error || code === "rate_limited") forget();
  } catch {
    forget();
  }
  return true;
}

/** Pour les tests : oublie les marques de déduplication en mémoire. */
export function resetPromotionTracking() { memorySent.clear(); memorySession = null; try { storage()?.removeItem(SENT_KEY); storage()?.removeItem(SESSION_KEY); } catch { /* ignoré */ } }

/**
 * Compte UNE impression lorsque l'élément est assez visible (voir isVisibleEnough) pendant 1 seconde sans interruption ET que l'onglet est
 * visible. Une bannière masquée, un onglet en arrière-plan ou un rendu React supplémentaire n'en produisent pas.
 * S'utilise comme référence : `<article ref={usePromotionImpression(id)}>`. Sans IntersectionObserver, rien n'est compté (jamais d'impression présumée).
 */
export function usePromotionImpression(promotionId: string) {
  const [node, setNode] = useState<Element | null>(null);
  useEffect(() => {
    if (!node || typeof IntersectionObserver === "undefined") return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let inView = false;
    let done = false;
    const tabVisible = () => typeof document === "undefined" || document.visibilityState === "visible";
    const stop = () => { if (timer !== undefined) { clearTimeout(timer); timer = undefined; } };
    const onVisibility = () => { if (tabVisible()) start(); else stop(); };
    const finish = () => { done = true; observer.disconnect(); document.removeEventListener("visibilitychange", onVisibility); };
    const start = () => {
      if (done || timer !== undefined || !inView || !tabVisible()) return;
      timer = setTimeout(() => {
        timer = undefined;
        if (!inView || !tabVisible()) return;   // contrôle final : toujours visible, onglet au premier plan
        finish();
        void trackPromotion("impression", promotionId);
      }, IMPRESSION_MS);
    };
    const observer = new IntersectionObserver((entries) => {
      const last = entries[entries.length - 1];
      inView = !!last && isVisibleEnough(last);
      if (inView) start(); else stop();
    }, { threshold: THRESHOLDS });
    document.addEventListener("visibilitychange", onVisibility);
    observer.observe(node);
    return () => { stop(); observer.disconnect(); document.removeEventListener("visibilitychange", onVisibility); };
  }, [node, promotionId]);
  return setNode;
}
