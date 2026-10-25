import savon from "@/assets/p-savon.jpg";
import mousse from "@/assets/p-mousse.jpg";
import gel from "@/assets/p-gel.jpg";
import huile from "@/assets/p-huile.jpg";
import gamme from "@/assets/gamme.jpg.asset.json";

export const productCategories = [
  "Soins du visage", "Nettoyants", "Hydratation", "Sérums et soins ciblés",
  "Soins du corps", "Coffrets beauté", "Routines beauté",
] as const;
export type ProductCategory = (typeof productCategories)[number];

export type Product = {
  id: string; name: string; category: string; price: number; images: string[];   // category : texte libre côté base
  shortDescription: string; description: string;
  features: string[];      // Caractéristiques validées uniquement
  usage?: string;          // Conseils d'utilisation, uniquement si fournis
  volume?: string;         // Contenance, si connue
  available: boolean; stock?: number; seo: string;
};

// ⚠️ Prix de DÉMONSTRATION — à remplacer. Ne pas ajouter d'ingrédients ou d'effets non validés.
export const products: Product[] = [
  { id: "savon-melisse-2en1", name: "Savon Mélisse 2 en 1", category: "Nettoyants", price: 6000, images: [savon, gamme.url],
    shortDescription: "Le savon de la gamme Dalanda Cosmétique.", description: "Savon Mélisse 2 en 1 de la gamme Dalanda Cosmétique, pour votre routine de toilette au quotidien.",
    features: ["Gamme Dalanda Cosmétique", "Format pot"], available: true, stock: 20, seo: "Savon Mélisse 2 en 1 Dalanda Cosmétique Abidjan" },
  { id: "mousse-nettoyante", name: "Mousse nettoyante", category: "Soins du visage", price: 5000, images: [mousse, gamme.url],
    shortDescription: "Une mousse légère pour le nettoyage du visage.", description: "Mousse nettoyante en flacon pompe de la gamme Dalanda Cosmétique.",
    features: ["Gamme Dalanda Cosmétique", "Flacon pompe"], available: true, stock: 15, seo: "Mousse nettoyante visage Dalanda Cosmétique" },
  { id: "gel-douche", name: "Gel douche", category: "Soins du corps", price: 5500, images: [gel, gamme.url],
    shortDescription: "Gel douche pour un moment de douceur sous la douche.", description: "Gel douche de la gamme Dalanda Cosmétique.",
    features: ["Gamme Dalanda Cosmétique"], available: true, stock: 12, seo: "Gel douche Dalanda Cosmétique" },
  { id: "huile-caviar", name: "Huile Caviar", category: "Hydratation", price: 8000, images: [huile, gamme.url],
    shortDescription: "Huile de la gamme Dalanda Cosmétique.", description: "Huile Caviar en flacon pompe de la gamme Dalanda Cosmétique.",
    features: ["Gamme Dalanda Cosmétique", "Flacon pompe"], available: true, stock: 10, seo: "Huile Caviar Dalanda Cosmétique" },
  { id: "savon-cristal", name: "Savon cristal", category: "Soins du corps", price: 5000, images: [gamme.url],
    shortDescription: "Savon en cristaux de la gamme Dalanda.", description: "Savon cristal de la gamme Dalanda Cosmétique.",
    features: ["Gamme Dalanda Cosmétique", "Format pot"], available: true, stock: 8, seo: "Savon cristal Dalanda Cosmétique" },
  { id: "coffret-routine", name: "Coffret routine Dalanda", category: "Coffrets beauté", price: 25000, images: [gamme.url, savon, gel],
    shortDescription: "Une sélection de produits pour une routine complète.", description: "Coffret réunissant plusieurs produits Dalanda Cosmétique. Composition exacte à confirmer avec la boutique.",
    features: ["Plusieurs produits de la gamme", "Composition à confirmer"], available: false, seo: "Coffret beauté Dalanda Cosmétique" },
];

export const getProduct = (id: string) => products.find((p) => p.id === id);
