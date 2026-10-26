import { LogOut } from "lucide-react";

/**
 * Zone de compte de l'administration : avatar à initiales « DS » (monogramme typographique sobre, aucun nouveau logo), adresse e-mail du compte
 * réellement connecté et bouton « Se déconnecter ». Présentation seulement : `onSignOut` est la déconnexion existante de AdminGate.
 */
export function AdminAccount({ email, onSignOut }: { email: string; onSignOut: () => void }) {
  return (
    <div className="acct" aria-label="Compte administrateur">
      <span className="acct-avatar" aria-hidden="true">DS</span>
      <span className="acct-email" title={email}>{email}</span>
      <button type="button" className="acct-btn" onClick={onSignOut}>
        <LogOut className="h-4 w-4" aria-hidden="true" />Se déconnecter
      </button>
    </div>
  );
}
