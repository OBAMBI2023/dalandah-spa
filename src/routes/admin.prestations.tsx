import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Plus, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { DataState, PageHeader, Panel } from "@/components/admin";
import { Img } from "@/components/app";
import { ServicePhotoDialog } from "@/components/service-photo-dialog";
import { serviceCategories, services as localServices } from "@/data/services";
import { formatFCFA } from "@/lib/format";
import { useAdminServices, viewState } from "@/lib/admin-queries";

export const Route = createFileRoute("/admin/prestations")({
  head: () => ({ meta: [{ title: "Prestations | Administration Dalanda" }] }),
  component: Prestations,
});

const schema = z.object({
  name: z.string().trim().min(2, "Indiquez le nom de la prestation."),
  category: z.string().min(1, "Choisissez une catégorie."),
  description: z.string().trim().min(5, "Ajoutez une courte description."),
  duration: z.string().trim().min(1, "Indiquez la durée (ex. 45 min)."),
  price: z.coerce.number({ invalid_type_error: "Indiquez un prix en FCFA." }).int("Prix entier uniquement.").positive("Le prix doit être supérieur à 0."),
});
type Values = z.infer<typeof schema>;

function NewServiceDialog() {
  const [open, setOpen] = useState(false);
  const { register, handleSubmit, setValue, reset, formState: { errors } } = useForm<Values>({ resolver: zodResolver(schema) });
  const err = (m?: string) => m ? <p role="alert" className="mt-1 text-xs text-destructive">{m}</p> : null;
  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
      <DialogTrigger asChild><button className="btn btn-primary"><Plus className="h-4 w-4" />Nouvelle prestation</button></DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl">Nouvelle prestation</DialogTitle>
          <DialogDescription>Le formulaire est validé, mais l'enregistrement n'est pas encore disponible.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit(() => undefined)} noValidate className="space-y-4">
          <div><Label htmlFor="name">Nom</Label><Input id="name" className="mt-1" {...register("name")} />{err(errors.name?.message)}</div>
          <div>
            <Label>Catégorie</Label>
            <Select onValueChange={(v) => setValue("category", v, { shouldValidate: true })}>
              <SelectTrigger className="mt-1" aria-label="Catégorie"><SelectValue placeholder="Choisir…" /></SelectTrigger>
              <SelectContent>{serviceCategories.map((c) => <SelectItem key={c.id} value={c.id}>{c.label}</SelectItem>)}</SelectContent>
            </Select>
            {err(errors.category?.message)}
          </div>
          <div><Label htmlFor="description">Description</Label><Textarea id="description" className="mt-1" {...register("description")} />{err(errors.description?.message)}</div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label htmlFor="duration">Durée</Label><Input id="duration" className="mt-1" placeholder="45 min" {...register("duration")} />{err(errors.duration?.message)}</div>
            <div><Label htmlFor="price">Prix (FCFA)</Label><Input id="price" type="number" inputMode="numeric" className="mt-1" {...register("price")} />{err(errors.price?.message)}</div>
          </div>
          <p className="rounded-lg bg-secondary p-3 text-xs text-muted-foreground">L'enregistrement depuis cette interface n'est pas encore disponible : aucune prestation ne sera créée.</p>
          <button type="submit" disabled className="btn btn-primary w-full">Enregistrer (indisponible)</button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Prestations() {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("all");
  const query = useAdminServices();
  const norm = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
  const shown = (query.data ?? []).filter((s) => (cat === "all" || s.category === cat) && norm(`${s.name} ${s.description}`).includes(norm(q.trim())));
  const demo = query.data?.some((s) => s.isDemo) ?? false;
  // Les photos restent dans le code (rattachées par identifiant) : la base n'a pas encore d'image_url.
  const imageOf = (id: string) => localServices.find((l) => l.id === id)?.image ?? "";
  const label = (id: string) => serviceCategories.find((c) => c.id === id)?.label ?? id;
  return (
    <>
      <PageHeader title="Prestations" text="Catalogue et tarifs proposés aux clientes." actions={<NewServiceDialog />} />
      {demo && <p className="rounded-xl bg-gold/10 px-4 py-2.5 text-sm text-deep">Tarifs et durées de démonstration : à remplacer par les tarifs officiels. Ce catalogue est lu depuis la base et n'est pas encore modifiable ici.</p>}
      <Panel>
        <div className="flex flex-wrap gap-3 border-b p-4">
          <div className="relative min-w-52 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher une prestation…" aria-label="Rechercher une prestation" className="pl-9" />
          </div>
          <Select value={cat} onValueChange={setCat}>
            <SelectTrigger className="w-44" aria-label="Filtrer par catégorie"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Toutes les catégories</SelectItem>
              {serviceCategories.map((c) => <SelectItem key={c.id} value={c.id}>{c.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <DataState {...viewState(query, shown.length)} onRetry={() => void query.refetch()}>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader><TableRow><TableHead>Prestation</TableHead><TableHead>Catégorie</TableHead><TableHead>Durée</TableHead><TableHead className="text-right">Prix</TableHead><TableHead className="text-right">Photo</TableHead></TableRow></TableHeader>
              <TableBody>
                {shown.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <Img src={s.imageUrl || imageOf(s.id)} sizes="96px" className="h-10 w-10 shrink-0 rounded-lg" />
                        <div><p className="font-medium text-deep">{s.name}{!s.active && <Badge variant="outline" className="ml-2">Inactive</Badge>}</p><p className="line-clamp-1 text-xs text-muted-foreground">{s.description}</p></div>
                      </div>
                    </TableCell>
                    <TableCell><Badge variant="secondary">{label(s.category)}</Badge></TableCell>
                    <TableCell>{s.durationLabel}</TableCell>
                    <TableCell className="text-right">{formatFCFA(s.price)}</TableCell>
                    <TableCell className="text-right"><ServicePhotoDialog service={s} fallbackImage={imageOf(s.id)} /></TableCell>
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
