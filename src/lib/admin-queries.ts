import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { AdminError, getAdminSettings, listAdminBookings, listAdminServices } from "@/lib/admin-api";
import { listAdminCategories } from "@/lib/admin-categories";
import { listAdminServiceCategories } from "@/lib/admin-service-categories";
import { CatalogueNotInstalledError, listAdminProducts } from "@/lib/admin-products";
import type { DataStatus } from "@/components/admin";

// Les requêtes ne démarrent que sous <AdminGate> (compte connecté, rôle admin vérifié) : voir components/admin-gate.tsx.
const opts = { retry: false, staleTime: 0 } as const;

export const useAdminBookings = () => useQuery({ queryKey: ["admin", "bookings"], queryFn: listAdminBookings, ...opts });
export const useAdminServices = () => useQuery({ queryKey: ["admin", "services"], queryFn: listAdminServices, ...opts });
export const useAdminProducts = () => useQuery({ queryKey: ["admin", "products"], queryFn: listAdminProducts, ...opts });
export const useAdminCategories = () => useQuery({ queryKey: ["admin", "categories"], queryFn: listAdminCategories, ...opts });
export const useAdminServiceCategories = () => useQuery({ queryKey: ["admin", "service-categories"], queryFn: listAdminServiceCategories, ...opts });
export const useAdminSettings = () => useQuery({ queryKey: ["admin", "settings"], queryFn: getAdminSettings, ...opts });

/** État d'affichage d'une requête : chargement, erreur (autorisation / réseau / serveur), vide ou prêt. */
export function viewState(q: UseQueryResult<unknown>, count: number): { status: DataStatus; title?: string; text?: string } {
  if (q.isPending) return { status: "loading" };
  if (q.isError) {
    if (q.error instanceof CatalogueNotInstalledError) return { status: "error", title: "Catalogue non installé", text: q.error.message };
    const code = q.error instanceof AdminError ? q.error.code : "server";
    if (code === "forbidden") return { status: "error", title: "Accès refusé", text: "Votre compte n'est pas autorisé à lire ces données." };
    if (code === "network") return { status: "error", title: "Connexion impossible", text: "Vérifiez votre réseau et réessayez." };
    return { status: "error" };
  }
  return { status: count > 0 ? "ready" : "empty" };
}
