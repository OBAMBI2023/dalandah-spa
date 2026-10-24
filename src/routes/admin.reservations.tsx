import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DataState, PageHeader, Panel, type DataStatus } from "@/components/admin";
import { formatFCFA } from "@/lib/format";
import type { Booking } from "@/lib/bookings";

export const Route = createFileRoute("/admin/reservations")({
  head: () => ({ meta: [{ title: "Réservations | Administration Dalanda" }] }),
  component: Reservations,
});

// Les rendez-vous du navigateur d'un visiteur ne sont pas des données d'établissement : on ne les affiche pas ici.
const status: DataStatus = "unavailable";
const rows: Booking[] = [];

const statusLabel: Record<Booking["status"], string> = { confirmed: "Confirmée", cancelled: "Annulée" };

function Reservations() {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"all" | Booking["status"]>("all");
  const shown = rows.filter((b) => (filter === "all" || b.status === filter) && `${b.name} ${b.serviceName} ${b.ref}`.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <>
      <PageHeader title="Réservations" text="Suivez les rendez-vous et leurs statuts." />
      <Panel>
        <div className="flex flex-wrap gap-3 border-b p-4">
          <div className="relative min-w-52 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher un client, un soin, une référence…" aria-label="Rechercher une réservation" className="pl-9" />
          </div>
          <Select value={filter} onValueChange={(v) => setFilter(v as typeof filter)}>
            <SelectTrigger className="w-44" aria-label="Filtrer par statut"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tous les statuts</SelectItem>
              <SelectItem value="confirmed">Confirmées</SelectItem>
              <SelectItem value="cancelled">Annulées</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <DataState status={status === "unavailable" ? status : shown.length ? "ready" : "empty"}>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow><TableHead>Référence</TableHead><TableHead>Client</TableHead><TableHead>Prestation</TableHead><TableHead>Date</TableHead><TableHead>Statut</TableHead><TableHead className="text-right">Prix</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {shown.map((b) => (
                  <TableRow key={b.ref}>
                    <TableCell className="font-mono text-xs">{b.ref}</TableCell><TableCell>{b.name}</TableCell><TableCell>{b.serviceName}</TableCell>
                    <TableCell>{b.date} · {b.slot}</TableCell><TableCell>{statusLabel[b.status]}</TableCell><TableCell className="text-right">{formatFCFA(b.price)}</TableCell>
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
