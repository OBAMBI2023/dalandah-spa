import { QueryClient } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, rootRouteId } from "@tanstack/react-router";
import { describe, expect, it } from "vitest";

import { routeTree } from "@/routeTree.gen";

// Match routes without running loaders or rendering: loaders may need a server or
// network the test run lacks, and jsdom never loads the stylesheets React waits on.
describe("App routing", () => {
  it("matches a page for / instead of falling back to not found", () => {
    const router = createRouter({ routeTree, context: { queryClient: new QueryClient() } });

    const matches = router.matchRoutes("/");

    expect(matches.at(-1)?.routeId).not.toBe(rootRouteId);
  });
});

describe("Promotions (ex-« Offres »)", () => {
  const router = (path: string) => createRouter({ routeTree, context: { queryClient: new QueryClient() }, history: createMemoryHistory({ initialEntries: [path] }) });

  it("/promotions et /admin/promotions existent", () => {
    for (const path of ["/promotions", "/admin/promotions"]) {
      expect(router(path).matchRoutes(path).at(-1)?.routeId).not.toBe(rootRouteId);
    }
  });

  it("l'ancienne adresse /offres est conservée et redirige vers /promotions", async () => {
    const r = router("/offres");
    await r.load();
    expect(r.state.location.pathname).toBe("/promotions");
  });
});
