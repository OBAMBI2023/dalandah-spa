import { createContext, useContext, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DataState } from "@/components/admin";
import { AdminAccount } from "@/components/admin-account";
import { adminConfigured, adminEmail, adminSignIn, adminSignOut, hasAdminRole } from "@/lib/admin-api";

const EmailContext = createContext<string | null>(null);
/** E-mail du compte administrateur connecté (disponible sous <AdminGate>). */
export const useAdminEmail = () => useContext(EmailContext);

const SignOutContext = createContext<(() => void) | null>(null);
/** Déconnexion réelle de AdminGate, pour les pages qui affichent leur propre zone de compte (tableau de bord). */
export const useAdminSignOut = () => useContext(SignOutContext);

function LoginForm({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const signIn = useMutation({
    mutationFn: () => adminSignIn(email, password),
    onSuccess: (r) => { if (r.ok) onDone(); },
  });
  const failed = signIn.data && !signIn.data.ok ? signIn.data.error : "";
  return (
    <form
      onSubmit={(e) => { e.preventDefault(); if (!signIn.isPending) signIn.mutate(); }}
      className="mx-auto max-w-sm space-y-3 rounded-2xl border bg-card p-6 shadow-soft"
    >
      <p className="font-display text-xl text-deep">Connexion administrateur</p>
      <p className="text-sm text-muted-foreground">L'administration est réservée aux comptes ayant le rôle administrateur.</p>
      <label className="block text-sm font-medium">E-mail
        <input className="field mt-1" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
      </label>
      <label className="block text-sm font-medium">Mot de passe
        <input className="field mt-1" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
      </label>
      {failed && <p role="alert" className="text-sm text-destructive">{failed}</p>}
      <button type="submit" disabled={signIn.isPending} className="btn btn-primary w-full">{signIn.isPending ? "Connexion…" : "Se connecter"}</button>
    </form>
  );
}

/**
 * Protège les pages d'administration : connexion, puis vérification du rôle `admin`.
 * C'est un confort d'interface : la vraie protection est la RLS de la base, qui refuse les données à tout autre compte.
 */
export function AdminGate({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const session = useQuery({ queryKey: ["admin", "session"], queryFn: adminEmail, enabled: adminConfigured, staleTime: 0, retry: false });
  const email = session.data ?? null;
  const role = useQuery({ queryKey: ["admin", "role", email], queryFn: hasAdminRole, enabled: !!email, staleTime: 0, retry: false });

  const refresh = () => { void qc.invalidateQueries({ queryKey: ["admin"] }); };
  // Après la déconnexion, on vide le cache puis on RELIT la session : l'écran revient au formulaire de connexion (clear() seul ne relance aucune lecture).
  const signOut = async () => { await adminSignOut(); qc.clear(); await session.refetch(); };

  if (!adminConfigured) {
    return <DataState status="unavailable" title="Base de données non configurée" text="Les variables VITE_SUPABASE_URL et VITE_SUPABASE_PUBLISHABLE_KEY sont absentes : l'application fonctionne en mode local." />;
  }
  if (session.isPending) return <DataState status="loading" />;
  if (session.isError) return <DataState status="error" onRetry={refresh} />;
  if (!email) return <LoginForm onDone={refresh} />;
  if (role.isPending) return <DataState status="loading" />;
  if (role.isError) return <DataState status="error" onRetry={refresh} />;

  const bar = <div className="acct-row"><AdminAccount email={email} onSignOut={() => void signOut()} /></div>;
  if (!role.data) {
    return (
      <div className="space-y-4">
        {bar}
        <div role="alert" className="rounded-2xl border bg-card px-6 py-12 text-center shadow-soft">
          <p className="font-display text-xl text-deep">Accès refusé</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">Ce compte n'a pas le rôle administrateur. Déconnectez-vous et utilisez un compte autorisé.</p>
        </div>
      </div>
    );
  }
  return (
    <EmailContext.Provider value={email}>
      <SignOutContext.Provider value={() => void signOut()}>
        <div className="space-y-6">
          {bar}
          {children}
        </div>
      </SignOutContext.Provider>
    </EmailContext.Provider>
  );
}
