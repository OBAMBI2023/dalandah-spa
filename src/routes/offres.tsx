import { createFileRoute, Link } from "@tanstack/react-router";
import { offers, discounted } from "@/data/offers";
import { services } from "@/data/services";
import { formatFCFA } from "@/lib/format";
import { AppBar, Screen, Img } from "@/components/app";

export const Route = createFileRoute("/offres")({
  head: () => ({ meta: [{ title: "Nos offres | Dalanda Beauty Spa" }, { name: "description", content: "Promotions et offres du moment chez Dalanda Beauty Spa." }] }),
  component: Offres,
});

function Offres() {
  return (
    <Screen>
      <AppBar title="Nos offres" back={false} />
      <ul className="space-y-4 px-4">
        {offers.map((o) => {
          const s = services.find((x) => x.id === o.serviceId);
          if (!s) return null;
          return (
            <li key={o.id} className="overflow-hidden rounded-2xl border bg-card shadow-soft">
              <div className="relative h-36">
                <Img sizes="448px" src={s.image} alt="" className="h-full w-full object-cover" />
                <span className="absolute right-3 top-3 rounded-full bg-gold-deep px-3 py-1 text-sm font-semibold text-white">-{o.percent}%</span>
              </div>
              <div className="p-4">
                <h2 className="text-xl text-deep">{o.title}</h2>
                <p className="mt-1 text-xs text-muted-foreground">{o.description}</p>
                <p className="mt-2 text-sm"><s className="text-muted-foreground">{formatFCFA(s.price)}</s> <b className="text-gold-deep">{formatFCFA(discounted(s.price, o.percent))}</b></p>
                <Link to="/reservation" search={{ service: s.id }} className="btn btn-app mt-3 w-full">Réserver ce soin</Link>
              </div>
            </li>
          );
        })}
      </ul>
      <p className="px-4 pt-4 text-[11px] text-muted-foreground">Offres de démonstration : les promotions réelles seront configurées par l'établissement.</p>
    </Screen>
  );
}
