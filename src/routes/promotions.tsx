import { createFileRoute } from "@tanstack/react-router";
import { RefreshCw, Tag } from "lucide-react";
import { AppBar, Screen } from "@/components/app";
import { PromotionCard } from "@/components/promotion-card";
import { usePromotions } from "@/lib/promotions";

export const Route = createFileRoute("/promotions")({
  head: () => ({ meta: [{ title: "Nos promotions | Dalanda Beauty Spa" }, { name: "description", content: "Les promotions du moment chez Dalanda Beauty Spa." }] }),
  component: Promotions,
});

function Promotions() {
  const q = usePromotions();
  const list = q.data ?? [];
  return (
    <Screen>
      <AppBar title="Nos promotions" back={false} />
      {q.isPending ? (
        <div aria-busy="true" aria-label="Chargement" className="space-y-4 px-4">
          {[0, 1].map((i) => <div key={i} className="h-72 animate-pulse rounded-2xl bg-secondary" />)}
        </div>
      ) : q.isError ? (
        <div role="alert" className="px-6 pt-12 text-center">
          <p className="text-sm text-muted-foreground">Les promotions n'ont pas pu être chargées.</p>
          <button className="btn btn-app-outline mt-4" onClick={() => void q.refetch()}><RefreshCw className="h-4 w-4" aria-hidden />Réessayer</button>
        </div>
      ) : list.length === 0 ? (
        <div role="status" className="px-6 pt-12 text-center">
          <Tag className="mx-auto h-10 w-10 text-gold-deep" strokeWidth={1.3} aria-hidden />
          <p className="mt-3 font-display text-lg text-deep">Aucune promotion en ce moment</p>
          <p className="mt-1 text-sm text-muted-foreground">Revenez bientôt : de nouvelles promotions seront annoncées ici.</p>
        </div>
      ) : (
        <ul className="space-y-4 px-4">
          {list.map((p) => <li key={p.id}><PromotionCard promotion={p} /></li>)}
        </ul>
      )}
    </Screen>
  );
}
