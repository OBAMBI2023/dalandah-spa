import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Faux client Supabase : on vérifie l'ordre des opérations Storage / base et la gestion des échecs, pas Supabase lui-même.
const h = vi.hoisted(() => {
  const state = {
    calls: [] as string[],
    uploadError: null as null | { message: string; statusCode?: string },
    updateResult: { data: [{ id: "massage-dos" }] as { id: string }[] | null, error: null as null | { message: string; code?: string } },
    usedElsewhere: 0,
    blobSize: 1000,
  };
  const publicBase = "https://ylixnbhpgbyofhvnfzqw.supabase.co/storage/v1/object/public/catalog-images/";
  const client = {
    storage: {
      from: () => ({
        upload: async (path: string) => {
          state.calls.push(`upload ${path}`);
          return state.uploadError ? { data: null, error: state.uploadError } : { data: { path }, error: null };
        },
        remove: async (paths: string[]) => {
          state.calls.push(`remove ${paths.join(",")}`);
          return { data: [], error: null };
        },
        getPublicUrl: (path: string) => ({ data: { publicUrl: publicBase + path } }),
      }),
    },
    from: () => ({
      update: (values: Record<string, unknown>) => ({
        eq: () => ({
          select: async () => {
            state.calls.push(`update image_url=${values["image_url"] === null ? "null" : "url"}`);
            return state.updateResult;
          },
        }),
      }),
      select: () => ({ eq: () => ({ neq: async () => ({ count: state.usedElsewhere, error: null }) }) }),
    }),
  };
  return { state, client, publicBase };
});

vi.mock("@/lib/supabase", () => ({ adminSupabase: h.client, supabase: null }));
vi.mock("@/lib/images", () => ({ compressImage: async () => new Blob([new Uint8Array(h.state.blobSize)], { type: "image/webp" }) }));

import { AdminError } from "@/lib/admin-api";
import { MAX_IMAGE_BYTES, MAX_INPUT_BYTES, newImagePath, pathFromPublicUrl, removeServiceImage, uploadServiceImage, validateImageFile } from "@/lib/admin-images";

const file = (type = "image/jpeg", size = 2000) => new File([new Uint8Array(size)], "photo.jpg", { type });
const OLD = `${h.publicBase}services/massage-dos/1-old.webp`;

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  h.state.calls = [];
  h.state.uploadError = null;
  h.state.updateResult = { data: [{ id: "massage-dos" }], error: null };
  h.state.usedElsewhere = 0;
  h.state.blobSize = 1000;
});

describe("validation du fichier", () => {
  it("accepte JPEG, PNG et WebP", () => {
    for (const t of ["image/jpeg", "image/png", "image/webp"]) expect(validateImageFile({ type: t, size: 1000 })).toBeNull();
  });
  it("refuse un autre format, un fichier vide et un fichier trop lourd, avec un message clair", () => {
    expect(validateImageFile({ type: "application/pdf", size: 1000 })).toMatch(/JPEG, PNG ou WebP/);
    expect(validateImageFile({ type: "image/gif", size: 1000 })).toMatch(/Format non pris en charge/);
    expect(validateImageFile({ type: "image/svg+xml", size: 1000 })).toMatch(/Format non pris en charge/);
    expect(validateImageFile({ type: "image/png", size: 0 })).toMatch(/vide/);
    expect(validateImageFile({ type: "image/png", size: MAX_INPUT_BYTES + 1 })).toMatch(/trop lourde/);
  });
});

describe("chemins", () => {
  it("génère des chemins uniques par prestation", () => {
    const a = newImagePath("massage-dos", 1, "aaaaaa");
    expect(a).toBe("services/massage-dos/1-aaaaaa.webp");
    expect(newImagePath("massage-dos")).not.toBe(newImagePath("massage-dos"));
  });
  it("retrouve le chemin d'une URL publique du bucket, et seulement de ce bucket", () => {
    expect(pathFromPublicUrl(OLD)).toBe("services/massage-dos/1-old.webp");
    expect(pathFromPublicUrl(`${OLD}?t=1`)).toBe("services/massage-dos/1-old.webp");
    expect(pathFromPublicUrl("https://autre.site/photo.jpg")).toBeNull();
    expect(pathFromPublicUrl("/assets/facial.jpg")).toBeNull();
    expect(pathFromPublicUrl(null)).toBeNull();
  });
});

describe("téléversement d'une photo", () => {
  it("envoie le nouvel objet, met à jour la base, puis supprime l'ancien (dans cet ordre)", async () => {
    const url = await uploadServiceImage("massage-dos", file(), OLD);

    expect(url).toMatch(/^https:\/\/ylixnbhpgbyofhvnfzqw\.supabase\.co\/storage\/v1\/object\/public\/catalog-images\/services\/massage-dos\/\d+-\w+\.webp$/);
    expect(h.state.calls.map((c) => c.split(" ")[0])).toEqual(["upload", "update", "remove"]);
    expect(h.state.calls[2]).toBe("remove services/massage-dos/1-old.webp");
  });

  it("première photo : rien à supprimer", async () => {
    await uploadServiceImage("massage-dos", file(), null);
    expect(h.state.calls.map((c) => c.split(" ")[0])).toEqual(["upload", "update"]);
  });

  it("conserve l'ancien fichier s'il est encore utilisé par une autre prestation", async () => {
    h.state.usedElsewhere = 1;
    await uploadServiceImage("massage-dos", file(), OLD);
    expect(h.state.calls.some((c) => c.startsWith("remove"))).toBe(false);
  });

  it("ne touche pas à une image locale ou externe (jamais supprimée du stockage)", async () => {
    await uploadServiceImage("massage-dos", file(), "https://autre.site/photo.jpg");
    expect(h.state.calls.some((c) => c.startsWith("remove"))).toBe(false);
  });

  it("échec d'enregistrement en base : le nouvel objet est retiré, l'ancien reste, l'erreur est remontée", async () => {
    h.state.updateResult = { data: null, error: { message: "boom", code: "XX000" } };
    await expect(uploadServiceImage("massage-dos", file(), OLD)).rejects.toMatchObject({ code: "server" });

    const removes = h.state.calls.filter((c) => c.startsWith("remove"));
    expect(removes).toHaveLength(1);
    expect(removes[0]).not.toContain("1-old");
  });

  it("aucune ligne modifiée (RLS) : accès refusé et nouvel objet retiré", async () => {
    h.state.updateResult = { data: [], error: null };
    await expect(uploadServiceImage("massage-dos", file(), OLD)).rejects.toMatchObject({ code: "forbidden" });
    expect(h.state.calls.filter((c) => c.startsWith("remove"))).toHaveLength(1);
  });

  it("refus du stockage (utilisateur non autorisé) : aucune écriture en base", async () => {
    h.state.uploadError = { message: "new row violates row-level security policy", statusCode: "403" };
    await expect(uploadServiceImage("massage-dos", file(), OLD)).rejects.toMatchObject({ code: "forbidden" });
    expect(h.state.calls).toHaveLength(1);
  });

  it("panne réseau pendant l'envoi : erreur réseau, aucune écriture en base", async () => {
    h.state.uploadError = { message: "Failed to fetch" };
    await expect(uploadServiceImage("massage-dos", file(), OLD)).rejects.toMatchObject({ code: "network" });
    expect(h.state.calls).toHaveLength(1);
  });

  it("format invalide ou fichier trop lourd : refusé avant tout envoi", async () => {
    await expect(uploadServiceImage("massage-dos", file("application/pdf"), null)).rejects.toThrow(/JPEG, PNG ou WebP/);
    await expect(uploadServiceImage("massage-dos", file("image/png", MAX_INPUT_BYTES + 1), null)).rejects.toThrow(/trop lourde/);
    expect(h.state.calls).toHaveLength(0);
  });

  it("image encore trop lourde après compression : refusée avant tout envoi", async () => {
    h.state.blobSize = MAX_IMAGE_BYTES + 1;
    await expect(uploadServiceImage("massage-dos", file(), null)).rejects.toThrow(/trop lourde/);
    expect(h.state.calls).toHaveLength(0);
  });
});

describe("suppression d'une photo", () => {
  it("efface la référence, puis supprime l'objet", async () => {
    await removeServiceImage("massage-dos", OLD);
    expect(h.state.calls).toEqual(["update image_url=null", "remove services/massage-dos/1-old.webp"]);
  });

  it("aucune ligne modifiée (RLS) : accès refusé, l'objet n'est pas supprimé", async () => {
    h.state.updateResult = { data: [], error: null };
    await expect(removeServiceImage("massage-dos", OLD)).rejects.toBeInstanceOf(AdminError);
    expect(h.state.calls.some((c) => c.startsWith("remove"))).toBe(false);
  });
});

afterEach(() => vi.restoreAllMocks());

describe("erreurs Storage : cause réelle au lieu de « Téléversement impossible »", () => {
  it("bucket introuvable : message explicite sur la migration, erreur journalisée", async () => {
    h.state.uploadError = { message: "Bucket not found", statusCode: "404" };
    const err = await uploadServiceImage("massage-dos", file(), null).catch((e) => e);

    expect(err).toBeInstanceOf(AdminError);
    expect(err.message).toMatch(/bucket « catalog-images » introuvable/);
    expect(err.message).toMatch(/migration/);
    expect(err.message).not.toBe("Téléversement impossible.");
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("Bucket not found"));
    expect(h.state.calls).toHaveLength(1);
  });

  it("politique RLS refusée : accès refusé explicite", async () => {
    h.state.uploadError = { message: "new row violates row-level security policy", statusCode: "403" };
    const err = await uploadServiceImage("massage-dos", file(), null).catch((e) => e);
    expect(err).toMatchObject({ code: "forbidden" });
    expect(err.message).toMatch(/pas autorisé/);
  });

  it("type MIME ou taille refusés par le bucket : message dédié", async () => {
    h.state.uploadError = { message: "mime type image/webp is not supported", statusCode: "415" };
    await expect(uploadServiceImage("massage-dos", file(), null)).rejects.toThrow(/Format refusé par le serveur/);
    h.state.uploadError = { message: "The object exceeded the maximum allowed size", statusCode: "413" };
    await expect(uploadServiceImage("massage-dos", file(), null)).rejects.toThrow(/trop lourde pour le serveur/);
  });

  it("erreur inconnue : repli générique, mais le détail est journalisé", async () => {
    h.state.uploadError = { message: "quelque chose d'inattendu", statusCode: "500" };
    await expect(uploadServiceImage("massage-dos", file(), null)).rejects.toThrow("Téléversement impossible.");
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("quelque chose d'inattendu"));
  });
});
