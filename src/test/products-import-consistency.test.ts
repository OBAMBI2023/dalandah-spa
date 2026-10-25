// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { products } from "@/data/products";

// Le script d'import (supabase/data/import_static_products.sql) doit rester identique aux six produits statiques du code,
// qui servent de repli tant que la base n'est pas branchée : mêmes identifiants, prix, stocks et textes.

const sql = readFileSync(resolve(__dirname, "../../supabase/data/import_static_products.sql"), "utf8");

type Row = { id: string; sku: string; name: string; category: string; short: string; description: string; features: string[]; price: number; stock: number; threshold: number; active: boolean; demo: boolean };

/** Lit les tuples de la clause VALUES (chaînes SQL avec '' pour l'apostrophe, array[...], nombres, booléens). */
function parseValues(text: string): Row[] {
  const body = text.replace(/--.*$/gm, "");
  const start = body.indexOf("values") + "values".length;
  const end = body.indexOf("on conflict");
  const src = body.slice(start, end);
  const rows: Row[] = [];
  let i = 0;
  const skip = () => { while (i < src.length && /[\s,]/.test(src[i]!)) i++; };
  const str = () => {
    i++; let out = "";
    while (i < src.length) {
      if (src[i] === "'" && src[i + 1] === "'") { out += "'"; i += 2; }
      else if (src[i] === "'") { i++; break; }
      else out += src[i++];
    }
    return out;
  };
  const value = (): string | number | boolean | string[] => {
    skip();
    if (src[i] === "'") return str();
    if (src.startsWith("array[", i)) {
      i += 6; const items: string[] = [];
      for (skip(); src[i] !== "]"; skip()) items.push(str());
      i++;
      return items;
    }
    const m = /^(true|false|\d+)/.exec(src.slice(i))!;
    i += m[0].length;
    return m[0] === "true" ? true : m[0] === "false" ? false : Number(m[0]);
  };
  for (skip(); i < src.length; skip()) {
    if (src[i] !== "(") throw new Error(`tuple attendu à ${i}`);
    i++;
    const v: unknown[] = [];
    for (let k = 0; k < 12; k++) { v.push(value()); skip(); }
    i++; // ")"
    rows.push({ id: v[0] as string, sku: v[1] as string, name: v[2] as string, category: v[3] as string, short: v[4] as string, description: v[5] as string,
      features: v[6] as string[], price: v[7] as number, stock: v[8] as number, threshold: v[9] as number, active: v[10] as boolean, demo: v[11] as boolean });
  }
  return rows;
}

describe("import des produits de démonstration : cohérence avec le repli statique", () => {
  const rows = parseValues(sql);

  it("contient exactement les six produits statiques, dans le même ordre", () => {
    expect(rows.map((r) => r.id)).toEqual(products.map((p) => p.id));
  });

  it.each(products.map((p) => [p.id, p] as const))("%s : nom, catégorie, prix, textes et caractéristiques identiques", (_id, p) => {
    const r = rows.find((x) => x.id === p.id)!;
    expect(r).toMatchObject({ name: p.name, category: p.category, price: p.price, short: p.shortDescription, description: p.description, features: p.features });
  });

  it.each(products.map((p) => [p.id, p] as const))("%s : stock de démonstration conservé (indisponible = 0)", (_id, p) => {
    const r = rows.find((x) => x.id === p.id)!;
    expect(r.stock).toBe(p.available ? (p.stock ?? 0) : 0);
  });

  it("tous les produits importés sont marqués démonstration et actifs ; références uniques et valides", () => {
    expect(rows.every((r) => r.demo && r.active)).toBe(true);
    expect(new Set(rows.map((r) => r.sku)).size).toBe(rows.length);
    expect(rows.every((r) => /^[A-Z0-9][A-Z0-9._-]{1,39}$/.test(r.sku))).toBe(true);
  });

  it("le script ne contient aucune instruction destructive et ne crée pas de mouvement pour un stock nul", () => {
    const code = sql.replace(/--.*$/gm, "");
    expect(code).not.toMatch(/\b(delete|update|drop|truncate|alter)\b/i);
    expect(code).toMatch(/where\s+stock_qty\s*>\s*0/i);
    expect(code).toMatch(/on\s+conflict\s+do\s+nothing/i);
  });
});
