import { describe, expect, it } from "vitest";
import { createApi, type DataClient } from "@/lib/api";
import { services as localServices } from "@/data/services";

// Le site public lit services.image_url : la photo téléversée passe avant l'image locale, qui sert d'image par défaut.
const row = (id: string, image_url: string | null) => ({
  id, name: id, category: "visage", description: "", duration_label: "60 min", price_fcfa: 1000, image_url, sort_order: 1,
});

function clientWith(services: ReturnType<typeof row>[]): DataClient {
  const ok = (data: unknown) => ({ data, error: null });
  return {
    rpc: async () => ok(null),
    from: (table: string) => {
      const data = table === "services" ? services : table === "time_slots" ? [{ slot: "09:00" }] : [{ min_notice_hours: 2, cancel_notice_hours: 2, max_days_ahead: 180, max_active_bookings_per_phone: 3 }];
      const result = Promise.resolve(ok(data));
      return { select: () => Object.assign(result, { order: () => Object.assign(Promise.resolve(ok(data)), {}) }) } as never;
    },
  };
}

describe("catalogue public : photos", () => {
  const known = localServices[0]!;

  it("utilise la photo téléversée quand elle existe", async () => {
    const url = "https://ylixnbhpgbyofhvnfzqw.supabase.co/storage/v1/object/public/catalog-images/services/x/1.webp";
    const cat = await createApi(clientWith([row(known.id, url)])).fetchCatalogue();
    expect(cat.services[0]!.image).toBe(url);
  });

  it("sans photo téléversée : image locale de même identifiant (image par défaut)", async () => {
    const cat = await createApi(clientWith([row(known.id, null)])).fetchCatalogue();
    expect(cat.services[0]!.image).toBe(known.image);
  });

  it("prestation inconnue du code et sans photo : chaîne vide (placeholder élégant côté interface)", async () => {
    const cat = await createApi(clientWith([row("nouvelle-prestation", null)])).fetchCatalogue();
    expect(cat.services[0]!.image).toBe("");
  });
});
