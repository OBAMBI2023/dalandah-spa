// ⚠️ Offres de DÉMONSTRATION — à remplacer par les promotions réelles de l'établissement.
export type Offer = { id: string; title: string; description: string; serviceId: string; percent: number; until?: string };

export const offers: Offer[] = [
  { id: "demo-decouverte-visage", title: "Découverte soin du visage", description: "Offre d'exemple sur le soin du visage éclat.", serviceId: "soin-visage-eclat", percent: 10 },
  { id: "demo-duo-detente", title: "Duo détente", description: "Offre d'exemple sur le massage relaxant.", serviceId: "massage-relaxant", percent: 15 },
];

export const discounted = (price: number, percent: number) => Math.round((price * (100 - percent)) / 100 / 100) * 100;
