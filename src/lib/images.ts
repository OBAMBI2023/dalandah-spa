// Politique d'images : plafonds de dimensions et de poids par emplacement.
// Les versions réduites (WebP) sont générées par `npm run images` dans src/assets/optimized/.
export const IMAGE_LIMITS = {
  hero: { maxWidth: 1024, maxKB: 80 },
  card: { maxWidth: 640, maxKB: 30 },
  thumb: { maxWidth: 320, maxKB: 12 },
  upload: { maxWidth: 1600, maxKB: 300, quality: 0.78 },
} as const;

const originals = import.meta.glob("/src/assets/*.{jpg,jpeg,png}", { eager: true, query: "?url", import: "default" }) as Record<string, string>;
const variants = import.meta.glob("/src/assets/optimized/*.webp", { eager: true, query: "?url", import: "default" }) as Record<string, string>;

// URL d'un original importé -> nom de base ("p-savon").
const nameByUrl = new Map(Object.entries(originals).map(([path, url]) => [url, path.split("/").pop()!.replace(/\.[^.]+$/, "")]));

// nom de base -> [{ width, url }] trié par largeur croissante.
const variantsByName = new Map<string, { width: number; url: string }[]>();
for (const [path, url] of Object.entries(variants)) {
  const m = path.split("/").pop()!.match(/^(.*)-(\d+)\.webp$/);
  if (!m) continue;
  const list = variantsByName.get(m[1]!) ?? [];
  list.push({ width: Number(m[2]), url });
  variantsByName.set(m[1]!, list.sort((a, b) => a.width - b.width));
}

/** Versions réduites d'une image locale, ou null (image distante ou non optimisée : l'URL d'origine est alors utilisée telle quelle). */
export function responsiveSources(src: string) {
  const name = nameByUrl.get(src);
  const list = name ? variantsByName.get(name) : undefined;
  if (!list?.length) return null;
  return {
    srcSet: list.map((v) => `${v.url} ${v.width}w`).join(", "),
    fallback: list[Math.min(1, list.length - 1)]!.url,
    maxWidth: list[list.length - 1]!.width,
  };
}

/** Dimensions réduites pour tenir dans maxWidth sans jamais agrandir. */
export function fitWithin(width: number, height: number, maxWidth: number) {
  if (width <= maxWidth) return { width, height };
  return { width: maxWidth, height: Math.round((height * maxWidth) / width) };
}

/** Redimensionne et compresse une image téléversée en WebP, à utiliser avant tout envoi vers un stockage. */
export async function compressImage(file: File, opts: { maxWidth?: number; quality?: number } = {}): Promise<Blob> {
  const { maxWidth = IMAGE_LIMITS.upload.maxWidth, quality = IMAGE_LIMITS.upload.quality } = opts;
  if (!file.type.startsWith("image/") || file.type === "image/svg+xml") throw new Error("Format d'image non pris en charge.");
  const bitmap = await createImageBitmap(file);
  const { width, height } = fitWithin(bitmap.width, bitmap.height, maxWidth);
  const canvas = document.createElement("canvas");
  canvas.width = width; canvas.height = height;
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/webp", quality));
  if (!blob) throw new Error("Compression impossible sur ce navigateur.");
  return blob;
}
