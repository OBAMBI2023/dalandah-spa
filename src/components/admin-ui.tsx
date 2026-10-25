import type { ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Info } from "lucide-react";

// Éléments d'interface partagés par les pages d'administration au style « ap- » (voir src/styles.css) : messages, chargement, états vides.

/** Message d'information, de réussite ou d'erreur (les erreurs sont annoncées comme alertes). */
export function Message({ kind, children }: { kind: "info" | "ok" | "error"; children: ReactNode }) {
  const Icon = kind === "ok" ? CheckCircle2 : kind === "error" ? AlertTriangle : Info;
  return (
    <div role={kind === "error" ? "alert" : "status"} className={`ap-notice ap-notice-${kind}`}>
      <Icon aria-hidden="true" /><p>{children}</p>
    </div>
  );
}

/** Squelette d'une liste en cours de chargement. */
export function ListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div aria-busy="true" aria-label="Chargement" className="space-y-1 p-4">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-4 py-2.5">
          <div className="ap-skeleton h-11 w-11 shrink-0" />
          <div className="flex-1 space-y-2"><div className="ap-skeleton h-3.5 w-1/3" /><div className="ap-skeleton h-3 w-1/5" /></div>
          <div className="ap-skeleton hidden h-3.5 w-20 sm:block" /><div className="ap-skeleton h-3.5 w-16" />
        </div>
      ))}
    </div>
  );
}

/** État vide ou « aucun résultat » : icône, titre, texte et action facultative. */
export function EmptyState({ icon: Icon, title, text, action, tone = "neutral" }: {
  icon: typeof Info; title: string; text: string; action?: ReactNode; tone?: "neutral" | "danger";
}) {
  return (
    <div role={tone === "danger" ? "alert" : "status"} className="ap-empty">
      <div className="ap-empty-icon" style={tone === "danger" ? { background: "var(--ap-danger-soft)", color: "var(--ap-danger)" } : undefined}>
        <Icon className="h-6 w-6" strokeWidth={1.5} aria-hidden="true" />
      </div>
      <h3>{title}</h3>
      <p>{text}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
