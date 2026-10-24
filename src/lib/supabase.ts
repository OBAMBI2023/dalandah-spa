import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Seules des clés PUBLIQUES (URL du projet et clé « publishable » / anon) ont leur place ici : elles sont visibles
// dans le navigateur. Ne jamais mettre de clé service_role dans une variable VITE_*.
// Sans ces variables, l'application reste en mode local (réservations stockées sur l'appareil).
// Configuration : copier .env.example en .env.local (ignoré par git).
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

export const supabase: SupabaseClient | null =
  url && key ? createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) : null;

/** true : réservations et catalogue passent par Supabase. false : mode local. */
export const isRemote = supabase !== null;
