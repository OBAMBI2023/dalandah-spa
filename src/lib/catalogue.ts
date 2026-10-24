import { useQuery } from "@tanstack/react-query";
import { api, localCatalogue, type Catalogue } from "@/lib/api";

/**
 * Catalogue (prestations, grille de créneaux, règles du salon).
 * Mode Supabase : lu depuis la base ; en attendant la réponse (ou en cas d'échec) les données du code servent de repli
 * pour l'affichage, mais `loaded` reste faux : le parcours de réservation attend les vrais tarifs.
 * Mode local : données du code, `loaded` toujours vrai.
 */
export function useCatalogue(): Catalogue & { loaded: boolean; isError: boolean; refetch: () => void } {
  const q = useQuery({
    queryKey: ["catalogue"],
    queryFn: api.fetchCatalogue,
    enabled: api.remote,
    staleTime: 5 * 60_000,
    retry: 1,
  });
  const data = q.data ?? localCatalogue;
  return { ...data, loaded: !api.remote || q.isSuccess, isError: api.remote && q.isError, refetch: () => void q.refetch() };
}
