import { describe, expect, it } from "vitest";
import { fitWithin, responsiveSources } from "@/lib/images";
import hero from "@/assets/hero.jpg";

describe("images", () => {
  it("ne dépasse jamais la largeur maximale et n'agrandit pas", () => {
    expect(fitWithin(4000, 3000, 1600)).toEqual({ width: 1600, height: 1200 });
    expect(fitWithin(800, 600, 1600)).toEqual({ width: 800, height: 600 });
  });

  it("fournit des versions WebP réduites pour une image locale, rien pour une image distante", () => {
    const r = responsiveSources(hero);
    expect(r?.srcSet.split(",")).toHaveLength(3);
    expect(r?.fallback).toMatch(/\.webp/);
    expect(responsiveSources("/__l5e/assets-v1/x/facial.jpg")).toBeNull();
  });
});
