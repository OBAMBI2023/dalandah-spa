// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { bridge, BASE_URL } from "./helpers/pglite-supabase";

// Test de contrat de la gestion des prestations : les VRAIES fonctions de persistance de l'application (admin-services, admin-images,
// admin-api, api) sont exécutées contre le VRAI schéma SQL, ses contraintes et ses politiques RLS (migrations + seed, PGlite en mémoire).
// Chaque test vérifie l'état de la base par une lecture directe, pas seulement la valeur de retour.
// Simulé : le transport HTTP (PostgREST), la compression d'image (canvas) et Supabase Storage (mêmes règles administrateur, voir le pont).
// Non couvert : la vraie ligne Storage RLS et le réseau, à vérifier sur un projet Supabase (voir le rapport d'audit).

vi.mock("@/lib/supabase", async () => {
  const { bridge: b } = await import("./helpers/pglite-supabase");
  return { adminSupabase: b.adminClient(), supabase: b.anonClient(), isRemote: true };
});
vi.mock("@/lib/images", async (orig) => ({
  ...(await orig<typeof import("@/lib/images")>()),
  compressImage: async () => new Blob([new Uint8Array(1200)], { type: "image/webp" }),
}));

import { createApi, type DataClient } from "@/lib/api";
import { listAdminServices } from "@/lib/admin-api";
import { createAdminService, updateAdminService, setServiceActive, ServiceActionError, type ServiceInput } from "@/lib/admin-services";
import { removeServiceImage, uploadServiceImage } from "@/lib/admin-images";

const ADMIN = "00000000-0000-0000-0000-0000000000a1";
const CLIENT = "00000000-0000-0000-0000-0000000000c1";
const input = (o: Partial<ServiceInput> = {}): ServiceInput => ({ name: "Soin test", category: "visage", description: "Texte", durationMin: 60, durationLabel: "60 min", price: 12000, active: true, ...o });
const photo = () => new File([new Uint8Array(2000)], "p.jpg", { type: "image/jpeg" });
const row = async (id: string) => (await bridge.owner<Record<string, unknown>>("select * from public.services where id = $1", [id]))[0];
const publicApi = () => createApi(bridge.anonClient() as unknown as DataClient);
const publicService = async (id: string) => (await publicApi().fetchCatalogue()).services.find((s) => s.id === id);
const ids = () => bridge.objects.size;

beforeAll(async () => {
  await bridge.start();
  await bridge.script(`insert into auth.users (id, email) values ('${ADMIN}', 'admin@example.test'), ('${CLIENT}', 'cliente@example.test');
                      insert into public.user_roles (user_id, role) values ('${ADMIN}', 'admin');`);
}, 90_000);
afterAll(async () => { await bridge.close(); });
beforeEach(() => {
  bridge.adminCtx = { role: "authenticated", sub: ADMIN };
  bridge.failNextUpload = null;
  bridge.storageOpen = false;
});

describe("création", () => {
  it("insère la prestation en base (et seulement après confirmation de l'écriture)", async () => {
    const before = (await bridge.owner<{ n: number }>("select count(*)::int n from public.services"))[0]!.n;
    const max = (await bridge.owner<{ m: number }>("select max(sort_order)::int m from public.services"))[0]!.m;
    const { id } = await createAdminService(input({ name: "Soin visage test", price: 18000 }), []);
    const r = await row(id);
    expect(r).toMatchObject({ id, name: "Soin visage test", category: "visage", price_fcfa: 18000, duration_min: 60, duration_label: "60 min", active: true, is_demo: false, image_url: null });
    expect(r!["sort_order"]).toBe(max + 10);
    expect((await bridge.owner<{ n: number }>("select count(*)::int n from public.services"))[0]!.n).toBe(before + 1);
  });

  it("la prestation créée se retrouve dans l'administration et sur le site public après « rechargement » (nouvelles lectures)", async () => {
    const { id } = await createAdminService(input({ name: "Gommage test" }), []);
    expect((await listAdminServices()).find((s) => s.id === id)).toMatchObject({ name: "Gommage test", price: 12000, active: true });
    expect(await publicService(id)).toMatchObject({ name: "Gommage test", price: 12000, duration: "60 min" });
  });

  it("un nom déjà utilisé reçoit un autre identifiant (-2) sans écraser l'existante", async () => {
    const a = await createAdminService(input({ name: "Doublon test", price: 1000 }), []);
    const b = await createAdminService(input({ name: "Doublon test", price: 2000 }), [a.id]);
    expect(b.id).toBe(`${a.id}-2`);
    expect((await row(a.id))!["price_fcfa"]).toBe(1000);
    expect((await row(b.id))!["price_fcfa"]).toBe(2000);
  });

  it("catégorie inexistante : refusée par la base, rien n'est créé", async () => {
    const before = (await bridge.owner<{ n: number }>("select count(*)::int n from public.services"))[0]!.n;
    await expect(createAdminService(input({ name: "Sans catégorie", category: "inexistante" }), [])).rejects.toMatchObject({ reason: "unknown_category" });
    expect((await bridge.owner<{ n: number }>("select count(*)::int n from public.services"))[0]!.n).toBe(before);
  });

  it("compte non administrateur : refus explicite, rien n'est créé", async () => {
    bridge.adminCtx = { role: "authenticated", sub: CLIENT };
    const before = (await bridge.owner<{ n: number }>("select count(*)::int n from public.services"))[0]!.n;
    await expect(createAdminService(input({ name: "Intrus" }), [])).rejects.toBeInstanceOf(Error);
    expect((await bridge.owner<{ n: number }>("select count(*)::int n from public.services"))[0]!.n).toBe(before);
  });

  it("durée hors limites : refusée par la base (message explicite), rien n'est créé", async () => {
    await expect(createAdminService(input({ name: "Durée folle", durationMin: 2 }), [])).rejects.toMatchObject({ reason: "invalid_input" });
    expect((await bridge.owner<{ n: number }>("select count(*)::int n from public.services where name = 'Durée folle'"))[0]!.n).toBe(0);
  });
});

describe("modification", () => {
  it("enregistre nom et prix dans la bonne ligne, sans toucher aux autres champs ni aux autres prestations", async () => {
    const { id } = await createAdminService(input({ name: "À modifier", price: 10000 }), []);
    const other = await row("massage-dos");
    const sortBefore = (await row(id))!["sort_order"];
    await updateAdminService(id, input({ name: "Modifiée", price: 14500 }));
    expect(await row(id)).toMatchObject({ id, name: "Modifiée", price_fcfa: 14500, category: "visage", sort_order: sortBefore, is_demo: false });
    expect(await row("massage-dos")).toEqual(other);
    expect((await listAdminServices()).find((s) => s.id === id)).toMatchObject({ name: "Modifiée", price: 14500 });
    expect(await publicService(id)).toMatchObject({ name: "Modifiée", price: 14500 });
  });

  it("ne modifie ni la photo, ni la catégorie quand elles ne sont pas envoyées dans le formulaire", async () => {
    const { id } = await createAdminService(input({ name: "Garde sa photo" }), []);
    const url = await uploadServiceImage(id, photo(), null);
    await updateAdminService(id, input({ name: "Garde sa photo 2", price: 9999 }));
    expect((await row(id))!["image_url"]).toBe(url);
  });

  it("compte non administrateur : la RLS ne touche aucune ligne, l'erreur est visible et la base est inchangée", async () => {
    const { id } = await createAdminService(input({ name: "Protégée", price: 5000 }), []);
    bridge.adminCtx = { role: "authenticated", sub: CLIENT };
    await expect(updateAdminService(id, input({ name: "Piratée", price: 1 }))).rejects.toThrow(/rien n'a été modifié|accès refusé/i);
    expect(await row(id)).toMatchObject({ name: "Protégée", price_fcfa: 5000 });
  });

  it("valeurs refusées par les contraintes (prix négatif) : erreur explicite, base inchangée", async () => {
    const { id } = await createAdminService(input({ name: "Prix négatif", price: 7000 }), []);
    await expect(updateAdminService(id, input({ name: "Prix négatif", price: -5 }))).rejects.toBeInstanceOf(ServiceActionError);
    expect((await row(id))!["price_fcfa"]).toBe(7000);
  });

  it("désactivation : la prestation disparaît du site public mais reste dans l'administration", async () => {
    const { id } = await createAdminService(input({ name: "À désactiver" }), []);
    await setServiceActive(id, false);
    expect((await row(id))!["active"]).toBe(false);
    expect(await publicService(id)).toBeUndefined();
    expect((await listAdminServices()).find((s) => s.id === id)?.active).toBe(false);
  });
});

describe("photos", () => {
  it("ajout sur une prestation sans photo : objet envoyé, URL publique enregistrée dans image_url, visible dans l'admin et sur le site", async () => {
    const { id } = await createAdminService(input({ name: "Sans photo" }), []);
    const url = await uploadServiceImage(id, photo(), null);
    expect(url).toMatch(new RegExp(`^${BASE_URL}/storage/v1/object/public/catalog-images/services/${id}/\\d+-[a-z0-9]+\\.webp$`));
    const path = url.slice(`${BASE_URL}/storage/v1/object/public/`.length);
    expect(bridge.objects.has(path)).toBe(true);
    expect((await row(id))!["image_url"]).toBe(url);
    expect((await listAdminServices()).find((s) => s.id === id)?.imageUrl).toBe(url);
    expect((await publicService(id))?.image).toBe(url);
  });

  it("remplacement : nouvelle URL en base, nouvel objet présent, ancien objet supprimé, site public à jour", async () => {
    const { id } = await createAdminService(input({ name: "À remplacer" }), []);
    const first = await uploadServiceImage(id, photo(), null);
    const second = await uploadServiceImage(id, photo(), first);
    expect(second).not.toBe(first);
    const p = (u: string) => u.slice(`${BASE_URL}/storage/v1/object/public/`.length);
    expect(bridge.objects.has(p(second))).toBe(true);
    expect(bridge.objects.has(p(first))).toBe(false);
    expect((await row(id))!["image_url"]).toBe(second);
    expect((await publicService(id))?.image).toBe(second);
  });

  it("échec de l'envoi : erreur explicite, ancienne photo intacte en base et dans le stockage, aucun objet orphelin", async () => {
    const { id } = await createAdminService(input({ name: "Échec envoi" }), []);
    const first = await uploadServiceImage(id, photo(), null);
    const objects = ids();
    bridge.failNextUpload = { message: "Internal error", statusCode: "500" };
    await expect(uploadServiceImage(id, photo(), first)).rejects.toBeInstanceOf(Error);
    expect((await row(id))!["image_url"]).toBe(first);
    expect(bridge.objects.has(first.slice(`${BASE_URL}/storage/v1/object/public/`.length))).toBe(true);
    expect(ids()).toBe(objects);
  });

  it("compte non administrateur : Storage refuse, la base n'est pas modifiée", async () => {
    const { id } = await createAdminService(input({ name: "Photo protégée" }), []);
    const first = await uploadServiceImage(id, photo(), null);
    bridge.adminCtx = { role: "authenticated", sub: CLIENT };
    await expect(uploadServiceImage(id, photo(), first)).rejects.toMatchObject({ code: "forbidden" });
    expect((await row(id))!["image_url"]).toBe(first);
  });

  it("envoi réussi mais écriture en base refusée (RLS) : accès refusé, le nouvel objet est retiré, l'ancienne photo reste", async () => {
    const { id } = await createAdminService(input({ name: "Base refuse" }), []);
    const first = await uploadServiceImage(id, photo(), null);
    const objects = ids();
    bridge.storageOpen = true;                                                // Storage laisse passer : on atteint l'étape base de données
    bridge.adminCtx = { role: "authenticated", sub: CLIENT };
    await expect(uploadServiceImage(id, photo(), first)).rejects.toMatchObject({ code: "forbidden" });
    expect((await row(id))!["image_url"]).toBe(first);
    expect(ids()).toBe(objects);                                              // l'objet envoyé a été supprimé
  });

  it("une photo partagée par une autre prestation n'est jamais supprimée du stockage", async () => {
    const a = await createAdminService(input({ name: "Partage A" }), []);
    const b = await createAdminService(input({ name: "Partage B" }), []);
    const shared = await uploadServiceImage(a.id, photo(), null);
    await bridge.owner("update public.services set image_url = $1 where id = $2", [shared, b.id]);
    await uploadServiceImage(a.id, photo(), shared);
    expect(bridge.objects.has(shared.slice(`${BASE_URL}/storage/v1/object/public/`.length))).toBe(true);
    expect((await row(b.id))!["image_url"]).toBe(shared);
  });

  it("retrait de la photo : référence effacée en base, repli côté site, objet supprimé", async () => {
    const { id } = await createAdminService(input({ name: "À retirer" }), []);
    const url = await uploadServiceImage(id, photo(), null);
    await removeServiceImage(id, url);
    expect((await row(id))!["image_url"]).toBeNull();
    expect(bridge.objects.has(url.slice(`${BASE_URL}/storage/v1/object/public/`.length))).toBe(false);
    expect((await publicService(id))?.image).not.toBe(url);
  });

  it("l'image d'une prestation modifiée n'est pas écrasée par une ancienne valeur : deux envois successifs gardent le dernier", async () => {
    const { id } = await createAdminService(input({ name: "Dernier gagne" }), []);
    const a = await uploadServiceImage(id, photo(), null);
    const b = await uploadServiceImage(id, photo(), a);
    const c = await uploadServiceImage(id, photo(), b);
    expect((await row(id))!["image_url"]).toBe(c);
    expect([a, b, c].filter((u) => bridge.objects.has(u.slice(`${BASE_URL}/storage/v1/object/public/`.length)))).toEqual([c]);
  });
});
