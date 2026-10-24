import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DataState, PageHeader, Panel, type DataStatus } from "@/components/admin";

export const Route = createFileRoute("/admin/clients")({
  head: () => ({ meta: [{ title: "Clients | Administration Dalanda" }] }),
  component: Clients,
});

type Client = { id: string; name: string; phone: string; email: string; bookings: number; lastVisit: string };

const status: DataStatus = "unavailable";
const rows: Client[] = [];

function Clients() {
  const [q, setQ] = useState("");
  const shown = rows.filter((c) => `${c.name} ${c.phone} ${c.email}`.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <>
      <PageHeader title="Clients" text="Fichier clients et historique des rendez-vous." />
      <Panel>
        <div className="border-b p-4">
          <div className="relative max-w-md">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher par nom, téléphone ou e-mail…" aria-label="Rechercher un client" className="pl-9" />
          </div>
        </div>
        <DataState status={status === "unavailable" ? status : shown.length ? "ready" : "empty"}>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow><TableHead>Nom</TableHead><TableHead>Téléphone</TableHead><TableHead>E-mail</TableHead><TableHead className="text-right">Rendez-vous</TableHead><TableHead>Dernière visite</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {shown.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium">{c.name}</TableCell><TableCell>{c.phone}</TableCell><TableCell>{c.email}</TableCell>
                    <TableCell className="text-right">{c.bookings}</TableCell><TableCell>{c.lastVisit}</TableCell>
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
