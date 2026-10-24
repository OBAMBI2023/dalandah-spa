import facial from "@/assets/facial.jpg.asset.json";
import massage from "@/assets/massage.jpg.asset.json";
import pedicure from "@/assets/pedicure.jpg.asset.json";
import coiffure from "@/assets/coiffure.jpg.asset.json";

export type ServiceCategory = "visage" | "corps" | "massage" | "coiffure" | "onglerie" | "spa";

export const serviceCategories: { id: ServiceCategory; label: string; title: string; description: string; image: string }[] = [
  { id: "visage", label: "Visage", title: "Soins du visage", description: "Nettoyage, vapeur et soins doux pour une peau apaisée.", image: facial.url },
  { id: "massage", label: "Massage", title: "Massages relaxants", description: "Un vrai moment de détente pour relâcher les tensions.", image: massage.url },
  { id: "corps", label: "Corps", title: "Soins du corps", description: "Gommage, enveloppement et soins pour le corps.", image: massage.url },
  { id: "onglerie", label: "Onglerie", title: "Onglerie", description: "Manucure, pédicure et soins des ongles.", image: pedicure.url },
  { id: "coiffure", label: "Coiffure", title: "Coiffure et tresses", description: "Shampoing, soins, nattes et coiffure.", image: coiffure.url },
  { id: "spa", label: "Spa", title: "Rituels beauté et spa", description: "Des rituels complets pour prendre du temps pour vous.", image: massage.url },
];

export type Service = {
  id: string; name: string; category: ServiceCategory; description: string;
  duration: string; price: number; image: string;
};

// ⚠️ Prix et durées de DÉMONSTRATION — à remplacer par les tarifs officiels.
export const services: Service[] = [
  { id: "soin-visage-eclat", name: "Soin du visage éclat", category: "visage", description: "Nettoyage, vapeur et masque pour une peau fraîche.", duration: "60 min", price: 15000, image: facial.url },
  { id: "nettoyage-profond", name: "Nettoyage de peau en profondeur", category: "visage", description: "Un soin complet pour purifier la peau du visage.", duration: "75 min", price: 20000, image: facial.url },
  { id: "massage-relaxant", name: "Massage relaxant", category: "massage", description: "Massage du corps aux gestes enveloppants.", duration: "60 min", price: 20000, image: massage.url },
  { id: "massage-dos", name: "Massage dos et nuque", category: "massage", description: "Ciblé sur les zones de tension du haut du corps.", duration: "30 min", price: 10000, image: massage.url },
  { id: "soin-corps-complet", name: "Soin corps complet", category: "corps", description: "Gommage et enveloppement pour un corps doux et lumineux.", duration: "60 min", price: 25000, image: massage.url },
  { id: "pedicure", name: "Pédicure soin", category: "onglerie", description: "Soin des pieds et des ongles, en douceur.", duration: "45 min", price: 8000, image: pedicure.url },
  { id: "manucure", name: "Manucure soin", category: "onglerie", description: "Soin des mains et des ongles.", duration: "40 min", price: 7000, image: pedicure.url },
  { id: "shampoing-soin", name: "Shampoing et soin capillaire", category: "coiffure", description: "Lavage et soin pour des cheveux nourris.", duration: "45 min", price: 7000, image: coiffure.url },
  { id: "nattes", name: "Nattes et tresses", category: "coiffure", description: "Nattes collées, tresses et coiffures protectrices.", duration: "2 h et +", price: 15000, image: coiffure.url },
  { id: "rituel-spa", name: "Rituel spa complet", category: "spa", description: "Massage, soin du visage et soin des pieds réunis.", duration: "2 h", price: 40000, image: massage.url },
];
