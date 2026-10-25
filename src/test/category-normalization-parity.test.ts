// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { categoryKey, normalizeCategoryName, validateCategoryName } from "@/lib/admin-categories";

// Parité entre la normalisation de l'interface (src/lib/admin-categories.ts) et celle de la migration (private.category_name /
// private.category_key) : on applique la VRAIE migration sur une base PostgreSQL locale en mémoire et on compare sur un corpus.
// Le formulaire empêche les doublons évidents ; la base reste la protection définitive (voir scripts/tests/supabase/categories.mjs).

const MIGRATIONS = resolve(__dirname, "../../supabase/migrations");
const C = (...codes: number[]) => String.fromCharCode(...codes);

let db: PGlite;
const sqlName = async (s: string) => ((await db.query<{ r: string }>("select private.category_name($1) as r", [s])).rows[0]!.r);
const sqlKey = async (s: string) => ((await db.query<{ r: string }>("select private.category_key($1) as r", [s])).rows[0]!.r);

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema auth; create table auth.users (id uuid primary key default gen_random_uuid(), email text);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema public, auth to anon, authenticated, service_role;`);
  await db.exec(readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort().map((f) => readFileSync(resolve(MIGRATIONS, f), "utf8")).join("\n"));
}, 120_000);
afterAll(async () => { await db?.close(); });

// Entrées dont le traitement est commun à l'interface et à la base.
const corpus = [
  "Soins du corps", "  Soins   du corps  ", "Soins\tdu\ncorps", "Soins" + C(0xa0) + "du corps", "Soins" + C(0xa0), C(0xa0) + "Soins",
  "Soins" + C(0x2003) + "du" + C(0x3000) + "corps", "Soins" + C(0x1680) + C(0x2009) + C(0x202f) + C(0x205f) + "du corps", "Soins" + C(0x2028) + "du corps",
  "Hydra" + C(0x200b) + "tation", "Hydra" + C(0xad) + "tation", "Hydra" + C(0x200c) + C(0x200d) + "tation", "Hydra" + C(0x2060) + "tation", C(0xfeff) + "Hydratation",
  "Se" + C(0x301) + "rums et soins cible" + C(0x301) + "s", "S" + C(0xe9) + "rums et soins cibl" + C(0xe9) + "s", "Cre" + C(0x300) + "mes", "Cr" + C(0xe8) + "mes",
  "Hydratati" + C(0xf3) + "n", "HYDRATATION", "hydratation", C(0xff28) + "ydratation", "Cœur", "Coeur", "Straße", "Strasse", "Ça" + C(0x327) + " va", "ø æ đ ł",
  "Coffrets beauté", "Soins du visage", "a", "ab", "x".repeat(60), "x".repeat(61),
];

describe("normalisation du nom : l'interface et la migration rendent la même forme", () => {
  it.each(corpus.map((s, i) => [i, s] as const))("entrée n°%i", async (_i, input) => {
    expect(normalizeCategoryName(input)).toBe(await sqlName(input));
  });
  it("espaces de toute sorte, invisibles et NFD : mêmes résultats attendus, vérifiés au cas par cas", () => {
    expect(normalizeCategoryName("Soins" + C(0xa0) + "du" + C(0x3000) + "corps")).toBe("Soins du corps");
    expect(normalizeCategoryName("Hydra" + C(0x200b) + "tation")).toBe("Hydratation");
    expect(normalizeCategoryName("Se" + C(0x301) + "rums")).toBe("S" + C(0xe9) + "rums");
  });
});

describe("clé d'unicité : l'interface et la base rapprochent exactement les mêmes noms", () => {
  const classes: string[][] = [
    ["Hydratation", "hydratation", "  HYDRATATION  ", "Hydratati" + C(0xf3) + "n", C(0xff28) + "ydratation", "Hydra" + C(0x200b) + "tation", "Hydratation" + C(0xa0)],
    ["Sérums et soins ciblés", "Se" + C(0x301) + "rums et soins cible" + C(0x301) + "s", "serums et soins cibles", "SÉRUMS  ET  SOINS  CIBLÉS"],
    ["Crèmes", "Cre" + C(0x300) + "mes", "CREMES", "Cr" + C(0xe8) + "mes"],
    ["Soins du corps", "soins" + C(0xa0) + "du" + C(0x2003) + "corps"],
  ];
  const distinct: [string, string][] = [
    ["Soins du corps", "Soins du visage"], ["Hydratation", "Hydratations"], ["Hydratation", "Hydrata tion"],
    // LIMITES documentées dans la migration : lettres sans décomposition Unicode.
    ["Cœur", "Coeur"], ["Straße", "Strasse"], ["Ørsted", "Orsted"], ["Æther", "Aether"], ["Đạt", "Dat"], ["Łódź", "Lodz"],
  ];
  it.each(classes.map((c, i) => [i, c] as const))("classe d'équivalence n°%i : une seule clé, côté interface comme côté base", async (_i, names) => {
    const clientKeys = new Set(names.map(categoryKey));
    const dbKeys = new Set(await Promise.all(names.map(sqlKey)));
    expect(clientKeys.size).toBe(1);
    expect(dbKeys.size).toBe(1);
    expect([...clientKeys][0]).toBe([...dbKeys][0]);
  });
  it.each(distinct)("noms distincts « %s » / « %s » : deux clés différentes des deux côtés (limites documentées incluses)", async (a, b) => {
    expect(categoryKey(a)).not.toBe(categoryKey(b));
    expect(await sqlKey(a)).not.toBe(await sqlKey(b));
  });
  it("la clé calculée côté interface est identique à celle de la base sur tout le corpus latin", async () => {
    for (const s of corpus.filter((x) => x.length <= 60)) expect(categoryKey(s)).toBe(await sqlKey(s));
  });
});

describe("divergence volontaire et documentée : commandes de sens d'écriture", () => {
  it("l'interface les retire silencieusement ; la base, elle, les REJETTE (la base reste le garde-fou)", async () => {
    const hostile = "Par" + C(0x202e) + "fums";
    expect(normalizeCategoryName(hostile)).toBe("Parfums"); // jamais envoyé tel quel par le formulaire
    expect(await sqlName(hostile)).toBe(hostile); // la base ne le réécrit pas…
    await db.exec(`insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000a1', 'a@x.test');
                   insert into public.user_roles (user_id, role) values ('00000000-0000-0000-0000-0000000000a1', 'admin');
                   grant usage on schema private to authenticated; grant execute on function private.is_admin(), private.has_role(public.app_role) to authenticated;
                   grant execute on function public.admin_create_category(text) to authenticated;`);
    await db.exec("set role authenticated");
    await db.query("select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false)");
    const r = (await db.query<{ r: { ok: boolean; code?: string } }>("select public.admin_create_category($1) as r", [hostile])).rows[0]!.r;
    await db.exec("reset role");
    expect(r).toMatchObject({ ok: false, code: "invalid_input" }); // … elle la refuse
  });
});

describe("validation du formulaire : mêmes refus évidents que la base", () => {
  it("refus d'un nom vide, trop court, trop long ou fait d'espaces/invisibles ; doublon repéré sans appel réseau", () => {
    expect(validateCategoryName("", [])).not.toBeNull();
    expect(validateCategoryName(C(0xa0, 0x200b), [])).not.toBeNull();
    expect(validateCategoryName("a", [])).not.toBeNull();
    expect(validateCategoryName("x".repeat(61), [])).not.toBeNull();
    expect(validateCategoryName("Hydratati" + C(0xf3) + "n", ["Hydratation"])).toMatch(/existe déjà/);
    expect(validateCategoryName("Cœur", ["Coeur"])).toBeNull(); // même limite que la base : non rapprochés
  });
});
