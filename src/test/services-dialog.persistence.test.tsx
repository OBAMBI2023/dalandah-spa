import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, configure, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { bridge, BASE_URL } from "./helpers/pglite-supabase";

// Formulaire d'une prestation + listes d'administration et du site public, branchés sur la VRAIE persistance (schéma SQL, contraintes et RLS réels,
// PGlite en mémoire) : le succès n'est annoncé qu'après l'écriture en base, et les deux listes se mettent à jour par invalidation du cache.
// Simulé : transport HTTP, compression d'image, Supabase Storage (voir le pont). Les hooks useAdminServices / useCatalogue sont les vrais.

vi.mock("@/lib/supabase", async () => {
  const { bridge: b } = await import("./helpers/pglite-supabase");
  return { adminSupabase: b.adminClient(), supabase: b.anonClient(), isRemote: true };
});
vi.mock("@/lib/images", async (orig) => ({
  ...(await orig<typeof import("@/lib/images")>()),
  compressImage: async () => new Blob([new Uint8Array(1200)], { type: "image/webp" }),
}));
vi.mock("@/components/app", () => ({ Img: ({ src, alt }: { src?: string; alt?: string }) => <img src={src ?? ""} alt={alt ?? ""} /> }));

import { ServiceFormDialog } from "@/components/service-form-dialog";
import { useAdminServices } from "@/lib/admin-queries";
import { useCatalogue } from "@/lib/catalogue";
import { createAdminService } from "@/lib/admin-services";
import { uploadServiceImage } from "@/lib/admin-images";

const ADMIN = "00000000-0000-0000-0000-0000000000a1";
const CLIENT = "00000000-0000-0000-0000-0000000000c1";
const photo = () => new File([new Uint8Array(2000)], "p.jpg", { type: "image/jpeg" });
const row = async (id: string) => (await bridge.owner<Record<string, unknown>>("select * from public.services where id = $1", [id]))[0]!;

let current = "";
let onSaved: Mock<(text: string, kind?: string) => void>;
let logAtSuccess: string[] = [];

function Harness() {
  const admin = useAdminServices();
  const pub = useCatalogue();
  const svc = admin.data?.find((s) => s.id === current) ?? null;
  const pubSvc = pub.services.find((s) => s.id === current);
  return (
    <>
      <p data-testid="admin">{svc ? `${svc.name}|${svc.price}|${svc.imageUrl ?? ""}` : ""}</p>
      <p data-testid="public">{pubSvc ? `${pubSvc.name}|${pubSvc.price}|${pubSvc.image}` : ""}</p>
      {svc && <ServiceFormDialog key={svc.id} service={svc} existingIds={[]} onClose={() => {}} onSaved={(t, k) => onSaved(t, k)} />}
    </>
  );
}

const show = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><Harness /></QueryClientProvider>);
  return client;
};
const fillName = (v: string) => fireEvent.change(document.getElementById("s-name")!, { target: { value: v } });
const fillPrice = (v: string) => fireEvent.change(document.getElementById("s-price")!, { target: { value: v } });
const save = () => fireEvent.click(screen.getByRole("button", { name: /Enregistrer les modifications/ }));

// La base tourne dans un worker : sous la charge de toute la suite, ses réponses peuvent dépasser le délai par défaut (1 s) de Testing Library.
configure({ asyncUtilTimeout: 10_000 });

beforeAll(async () => {
  await bridge.start();
  await bridge.script(`insert into auth.users (id, email) values ('${ADMIN}', 'admin@example.test'), ('${CLIENT}', 'cliente@example.test');
                       insert into public.user_roles (user_id, role) values ('${ADMIN}', 'admin');`);
}, 90_000);
afterAll(async () => { await bridge.close(); });
beforeEach(async () => {
  bridge.adminCtx = { role: "authenticated", sub: ADMIN };
  bridge.failNextUpload = null;
  bridge.storageOpen = false;
  logAtSuccess = [];
  onSaved = vi.fn((_text: string, _kind?: string) => { logAtSuccess = [...bridge.log]; });
  current = (await createAdminService({ name: `Prestation ${Math.random().toString(36).slice(2, 6)}`, category: "visage", description: "d", durationMin: 60, durationLabel: "60 min", price: 10000, active: true }, [])).id;
  bridge.log.length = 0;   // le journal ne contient plus que les requêtes du test en cours
});
afterEach(cleanup);

describe("formulaire de prestation branché sur la persistance réelle", () => {
  it("modification : succès annoncé après l'écriture, base à jour, administration ET site public actualisés", async () => {
    show();
    await waitFor(() => expect(screen.getByTestId("public").textContent).toContain("|10000|"));   // listes chargées (puis considérées « fraîches » 5 min)
    await screen.findByRole("dialog");
    fillName("Soin renommé"); fillPrice("14500");
    save();
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(onSaved.mock.calls[0]![0]).toMatch(/modifiée/);
    expect(onSaved.mock.calls[0]![1]).toBeUndefined();                                       // pas de variante « erreur »
    expect(logAtSuccess.some((s) => /^update public\.services set/.test(s))).toBe(true);     // l'écriture a eu lieu AVANT le message de succès
    expect(await row(current)).toMatchObject({ name: "Soin renommé", price_fcfa: 14500 });
    await waitFor(() => expect(screen.getByTestId("admin").textContent).toBe("Soin renommé|14500|"));
    await waitFor(() => expect(screen.getByTestId("public").textContent).toBe("Soin renommé|14500|" + (screen.getByTestId("public").textContent!.split("|")[2] ?? "")));
  });

  it("ajout d'une photo : image_url enregistrée, succès après l'écriture, listes admin et publique sur la nouvelle URL", async () => {
    show();
    await screen.findByRole("dialog");
    fireEvent.change(screen.getByLabelText("Choisir une photo"), { target: { files: [photo()] } });
    save();
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    const url = (await row(current))["image_url"] as string;
    expect(url).toMatch(new RegExp(`^${BASE_URL}/storage/v1/object/public/catalog-images/services/${current}/`));
    expect(logAtSuccess.some((s) => /^update public\.services set image_url/.test(s))).toBe(true);
    await waitFor(() => expect(screen.getByTestId("admin").textContent).toContain(url));
    await waitFor(() => expect(screen.getByTestId("public").textContent).toContain(url));
  });

  it("remplacement d'une photo : nouvelle URL partout, ancien objet supprimé", async () => {
    const first = await uploadServiceImage(current, photo(), null);
    show();
    await waitFor(() => expect(screen.getByTestId("admin").textContent).toContain(first));
    await screen.findByRole("dialog");
    fireEvent.change(screen.getByLabelText("Choisir une photo"), { target: { files: [photo()] } });
    save();
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    const second = (await row(current))["image_url"] as string;
    expect(second).not.toBe(first);
    expect(bridge.objects.has(first.slice(`${BASE_URL}/storage/v1/object/public/`.length))).toBe(false);
    await waitFor(() => expect(screen.getByTestId("admin").textContent).toContain(second));
    await waitFor(() => expect(screen.getByTestId("public").textContent).toContain(second));
  });

  it("compte non autorisé : erreur visible, aucun message de succès, base inchangée", async () => {
    show();
    await screen.findByRole("dialog");
    bridge.adminCtx = { role: "authenticated", sub: CLIENT };
    fillName("Piratage"); fillPrice("1");
    save();
    expect((await screen.findByRole("alert")).textContent).toMatch(/rien n'a été modifié|accès refusé/i);
    expect(onSaved).not.toHaveBeenCalled();
    expect(await row(current)).toMatchObject({ price_fcfa: 10000 });
    expect((await row(current))["name"]).not.toBe("Piratage");
  });

  it("échec de l'envoi de la photo : informations enregistrées, erreur explicite, pas de succès, ancienne photo conservée, aucun orphelin", async () => {
    const first = await uploadServiceImage(current, photo(), null);
    const objects = bridge.objects.size;
    show();
    await waitFor(() => expect(screen.getByTestId("admin").textContent).toContain(first));
    await screen.findByRole("dialog");
    fillName("Nom enregistré malgré tout");
    fireEvent.change(screen.getByLabelText("Choisir une photo"), { target: { files: [photo()] } });
    bridge.failNextUpload = { message: "Internal error", statusCode: "500" };
    save();
    expect((await screen.findByRole("alert")).textContent).toMatch(/informations sont enregistrées, mais la photo ne l'est pas/);
    expect(onSaved).not.toHaveBeenCalled();
    expect(await row(current)).toMatchObject({ name: "Nom enregistré malgré tout", image_url: first });
    expect(bridge.objects.size).toBe(objects);
    await waitFor(() => expect(screen.getByTestId("admin").textContent).toBe(`Nom enregistré malgré tout|10000|${first}`));   // liste actualisée malgré l'échec partiel
  });

  it("double clic sur « Enregistrer » : une seule écriture", async () => {
    show();
    await screen.findByRole("dialog");
    fillName("Un seul envoi");
    const btn = screen.getByRole("button", { name: /Enregistrer les modifications/ });
    fireEvent.click(btn); fireEvent.click(btn); fireEvent.click(btn);
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    const writes = bridge.log.filter((s) => /^update public\.services set name/.test(s));
    expect(writes).toHaveLength(1);
  });
});
