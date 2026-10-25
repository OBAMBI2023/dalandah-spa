import { createFileRoute, Link, Outlet } from "@tanstack/react-router";
import { useState } from "react";
import { LayoutDashboard, CalendarDays, Users, Sparkles, Package, Settings, Menu, ExternalLink } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { LogoMark } from "@/components/app";
import { SecurityBanner } from "@/components/admin";
import { AdminGate } from "@/components/admin-gate";

export const Route = createFileRoute("/admin")({
  head: () => ({ meta: [{ title: "Administration | Dalanda Beauty Spa" }, { name: "robots", content: "noindex, nofollow" }] }),
  component: AdminLayout,
});

const nav = [
  { to: "/admin", label: "Vue d'ensemble", Icon: LayoutDashboard, exact: true },
  { to: "/admin/reservations", label: "Réservations", Icon: CalendarDays, exact: false },
  { to: "/admin/clients", label: "Clients", Icon: Users, exact: false },
  { to: "/admin/prestations", label: "Prestations", Icon: Sparkles, exact: false },
  { to: "/admin/produits", label: "Produits", Icon: Package, exact: false },
  { to: "/admin/parametres", label: "Paramètres", Icon: Settings, exact: false },
] as const;

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav aria-label="Administration" className="space-y-1">
      {nav.map(({ to, label, Icon, exact }) => (
        <Link key={to} to={to} activeOptions={{ exact }} onClick={onNavigate}
          className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-foreground/75 transition hover:bg-secondary data-[status=active]:bg-sage data-[status=active]:font-semibold data-[status=active]:text-sage-foreground">
          <Icon className="h-5 w-5" strokeWidth={1.6} />{label}
        </Link>
      ))}
    </nav>
  );
}

function SideFooter() {
  return (
    <Link to="/" className="flex items-center gap-2 rounded-xl px-3 py-2 text-xs text-muted-foreground hover:bg-secondary">
      <ExternalLink className="h-4 w-4" />Voir le site public
    </Link>
  );
}

function AdminLayout() {
  const [open, setOpen] = useState(false);
  return (
    <div className="admin-shell min-h-screen bg-background lg:grid lg:grid-cols-[16rem_1fr]">
      <aside className="sticky top-0 hidden h-screen flex-col border-r bg-card px-4 py-6 lg:flex">
        <div className="px-2"><LogoMark /></div>
        <p className="mt-2 text-center text-[10px] uppercase tracking-[0.25em] text-muted-foreground">Administration</p>
        <div className="mt-8 flex-1"><NavLinks /></div>
        <SideFooter />
      </aside>

      <div className="min-w-0">
        <header className="sticky top-0 z-30 flex items-center justify-between border-b bg-background/95 px-4 py-3 backdrop-blur lg:hidden">
          <button aria-label="Ouvrir le menu" onClick={() => setOpen(true)} className="grid h-10 w-10 place-items-center rounded-full hover:bg-secondary"><Menu className="h-6 w-6" /></button>
          <span className="font-display text-lg tracking-[0.15em] text-deep">DALANDA · ADMIN</span>
          <span className="w-10" />
        </header>
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetContent side="left" className="flex w-72 flex-col bg-card">
            <SheetHeader>
              <SheetTitle className="font-display text-xl">Administration</SheetTitle>
              <SheetDescription className="sr-only">Navigation du back-office</SheetDescription>
            </SheetHeader>
            <div className="mt-4 flex-1"><NavLinks onNavigate={() => setOpen(false)} /></div>
            <SideFooter />
          </SheetContent>
        </Sheet>

        <main className="mx-auto max-w-6xl space-y-6 px-4 py-6 md:px-8 md:py-8">
          <SecurityBanner />
          <AdminGate><Outlet /></AdminGate>
        </main>
      </div>
    </div>
  );
}
