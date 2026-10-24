import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DataState, PageHeader, Panel } from "@/components/admin";
import { clientsFromBookings } from "@/lib/admin-api";
import { useAdminBookings, viewState } from "@/lib/admin-queries";

export const Route = createFileRoute("/admin/clients")({
  head: () => ({ meta: [{ title: "Clients | Administration Dalanda" }] }),
  component: Clients,
});

function Clients() {
  const [q, setQ] = useState("");
  const query = useAdminBookings();
  const all = query.data ? clientsFromBookings(query.data) : [];
  const shown = all.filter((c) => `${c.name} ${c.phone}`.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <>
      <PageHeader title="Clients" text="Clients regroupés par numéro de téléphone, d'après leurs réservations." />
      <Panel>
        <div className="border-b p-4">
          <div className="relative max-w-md">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher par nom ou téléphone…" aria-label="Rechercher un client" className="pl-9" />
          </div>
        </div>
        <DataState {...viewState(query, shown.length)} onRetry={() => void query.refetch()}>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow><TableHead>Nom</TableHead><TableHead>Téléphone</TableHead><TableHead className="text-right">Rendez-vous confirmés</TableHead><TableHead>Dernier rendez-vous</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {shown.map((c) => (
                  <TableRow key={c.key}>
                    <TableCell className="font-medium">{c.name}</TableCell><TableCell>{c.phone}</TableCell>
                    <TableCell className="text-right">{c.bookings}</TableCell><TableCell>{c.lastDate}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </DataState>
      </Panel>
    </>
  );
}
