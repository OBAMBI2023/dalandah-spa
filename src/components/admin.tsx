import type { ReactNode } from "react";
import { AlertTriangle, Database, Inbox, RefreshCw } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

/** État d'une source de données du back-office. "unavailable" = aucun backend connecté à ce jour. */
export type DataStatus = "loading" | "error" | "empty" | "unavailable" | "ready";

export function PageHeader({ title, text, actions }: { title: string; text?: string; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-3xl text-deep md:text-4xl">{title}</h1>
        {text && <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{text}</p>}
      </div>
      {actions}
    </div>
  );
}

const messages: Record<Exclude<DataStatus, "ready" | "loading">, { Icon: typeof Inbox; title: string; text: string }> = {
  unavailable: { Icon: Database, title: "Source de données non connectée", text: "Les données apparaîtront ici lorsque la base de données sera connectée. Aucun chiffre n'est affiché d'ici là." },
  empty: { Icon: Inbox, title: "Aucun élément", text: "Rien à afficher pour le moment." },
  error: { Icon: AlertTriangle, title: "Chargement impossible", text: "Les données n'ont pas pu être récupérées. Réessayez dans un instant." },
};

/** Affiche l'état chargement / erreur / vide / indisponible, ou les enfants lorsque les données sont prêtes. */
export function DataState({ status, children, onRetry, title, text }: { status: DataStatus; children?: ReactNode; onRetry?: () => void; title?: string; text?: string }) {
  if (status === "ready") return <>{children}</>;
  if (status === "loading") {
    return (
      <div className="space-y-3 p-4" aria-busy="true" aria-label="Chargement">
        {[0, 1, 2].map((i) => <Skeleton key={i} className="h-10 w-full" />)}
      </div>
    );
  }
  const m = messages[status];
  const Icon = m.Icon;
  return (
    <div role={status === "error" ? "alert" : "status"} className="flex flex-col items-center px-6 py-12 text-center">
      <Icon className="h-8 w-8 text-sage" strokeWidth={1.4} />
      <p className="mt-3 font-display text-xl text-deep">{title ?? m.title}</p>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">{text ?? m.text}</p>
      {status === "error" && onRetry && (
        <button onClick={onRetry} className="btn btn-outline mt-4"><RefreshCw className="h-4 w-4" />Réessayer</button>
      )}
    </div>
  );
}

export function Panel({ title, children, className = "" }: { title?: string; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-2xl border bg-card shadow-soft ${className}`}>
      {title && <h2 className="border-b px-5 py-4 text-xl text-deep">{title}</h2>}
      {children}
    </section>
  );
}
