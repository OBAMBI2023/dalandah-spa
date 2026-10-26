// Génère les versions WebP redimensionnées de src/assets/*.jpg|png dans src/assets/optimized/.
// Les originaux ne sont jamais modifiés. Usage : npm run images
import { readdir, mkdir, stat } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const SRC = "src/assets";
const OUT = "src/assets/optimized";

// Largeurs générées par image (jamais au-delà de la taille d'origine) et qualité WebP.
// Les noms qui ne correspondent à aucune règle utilisent la règle "default".
const rules = [
  { match: /^hero[.-]/, widths: [480, 768, 1024], quality: 64 },
  { match: /^p-/, widths: [320, 640], quality: 74 },
  { match: /./, widths: [480, 960], quality: 74 },
];

await mkdir(OUT, { recursive: true });
let before = 0, after = 0;
for (const file of await readdir(SRC)) {
  if (!/\.(jpe?g|png)$/i.test(file)) continue;
  const rule = rules.find((r) => r.match.test(file));
  const base = path.parse(file).name;
  const input = path.join(SRC, file);
  const { width = 0 } = await sharp(input).metadata();
  before += (await stat(input)).size;
  const widths = [...new Set(rule.widths.map((w) => Math.min(w, width)))];
  for (const w of widths) {
    const out = path.join(OUT, `${base}-${w}.webp`);
    await sharp(input).rotate().resize({ width: w, withoutEnlargement: true }).webp({ quality: rule.quality, effort: 5 }).toFile(out);
    const size = (await stat(out)).size;
    after += size;
    console.log(`${out}  ${(size / 1024).toFixed(1)} Ko`);
  }
}
console.log(`Originaux : ${(before / 1024).toFixed(0)} Ko — versions optimisées (toutes largeurs) : ${(after / 1024).toFixed(0)} Ko`);
