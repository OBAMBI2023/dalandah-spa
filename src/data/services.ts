import facial from "@/assets/facial.jpg";
import massage from "@/assets/massage.jpg";
import pedicure from "@/assets/pedicure.jpg";
import coiffure from "@/assets/coiffure.jpg";

/** Identifiant d'une catégorie (table public.service_categories) : « visage », « massage »… ou celui d'une catégorie créée depuis l'administration. */
export type ServiceCategory = string;

export type ServiceCategoryInfo = { id: ServiceCategory; label: string; title: string; description: string; image: string };

/** Image des catégories qui n'en ont pas (catégories créées depuis l'administration, sans photo). */
export const defaultCategoryImage = massage;

/**
 * Les 6 catégories d'origine, avec leurs libellés, descriptions, images et leur ordre d'affichage. Elles servent aussi de repli tant que la
 * base ne fournit pas la liste (hors ligne, migration 20261028 pas encore appliquée) ; les catégories créées ensuite viennent de la base.
 */
export const serviceCategories: ServiceCategoryInfo[] = [
  { id: "visage", label: "Visage", title: "Soins du visage", description: "Nettoyage, vapeur et soins doux pour une peau apaisée.", image: facial },
  { id: "massage", label: "Massage", title: "Massages relaxants", description: "Un vrai moment de détente pour relâcher les tensions.", image: massage },
  { id: "corps", label: "Corps", title: "Soins du corps", description: "Gommage, enveloppement et soins pour le corps.", image: massage },
  { id: "onglerie", label: "Onglerie", title: "Onglerie", description: "Manucure, pédicure et soins des ongles.", image: pedicure },
  { id: "coiffure", label: "Coiffure", title: "Coiffure et tresses", description: "Shampoing, soins, nattes et coiffure.", image: coiffure },
  { id: "spa", label: "Spa", title: "Rituels beauté et spa", description: "Des rituels complets pour prendre du temps pour vous.", image: massage },
];

export type Service = {
  id: string; name: string; category: ServiceCategory; description: string;
  duration: string; price: number; image: string;
};

// ⚠️ Prix et durées de DÉMONSTRATION — à remplacer par les tarifs officiels.
export const services: Service[] = [
  { id: "soin-visage-eclat", name: "Soin du visage éclat", category: "visage", description: "Nettoyage, vapeur et masque pour une peau fraîche.", duration: "60 min", price: 15000, image: facial },
  { id: "nettoyage-profond", name: "Nettoyage de peau en profondeur", category: "visage", description: "Un soin complet pour purifier la peau du visage.", duration: "75 min", price: 20000, image: facial },
  { id: "massage-relaxant", name: "Massage relaxant", category: "massage", description: "Massage du corps aux gestes enveloppants.", duration: "60 min", price: 20000, image: massage },
  { id: "massage-dos", name: "Massage dos et nuque", category: "massage", description: "Ciblé sur les zones de tension du haut du corps.", duration: "30 min", price: 10000, image: massage },
  { id: "soin-corps-complet", name: "Soin corps complet", category: "corps", description: "Gommage et enveloppement pour un corps doux et lumineux.", duration: "60 min", price: 25000, image: massage },
  { id: "pedicure", name: "Pédicure soin", category: "onglerie", description: "Soin des pieds et des ongles, en douceur.", duration: "45 min", price: 8000, image: pedicure },
  { id: "manucure", name: "Manucure soin", category: "onglerie", description: "Soin des mains et des ongles.", duration: "40 min", price: 7000, image: pedicure },
  { id: "shampoing-soin", name: "Shampoing et soin capillaire", category: "coiffure", description: "Lavage et soin pour des cheveux nourris.", duration: "45 min", price: 7000, image: coiffure },
  { id: "nattes", name: "Nattes et tresses", category: "coiffure", description: "Nattes collées, tresses et coiffures protectrices.", duration: "2 h et +", price: 15000, image: coiffure },
  { id: "rituel-spa", name: "Rituel spa complet", category: "spa", description: "Massage, soin du visage et soin des pieds réunis.", duration: "2 h", price: 40000, image: massage },
];
