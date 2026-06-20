import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, GitBranch, Link2, Pencil, Search, ShieldCheck, X } from "lucide-react";

import {
  expandMemoryLinks,
  getStoredAdminApiKey,
  listExperiences,
  listMemoryLinks,
  listMentalModels,
  searchConsolidatedObservations,
  updateConsolidatedObservation,
  updateMentalModel,
  type ConsolidatedObservation,
  type MemoryLink,
  type MemoryLinkExpansionPayload,
  type MemoryLinkExpansionResult,
  type MentalModel,
  type ObservationSearchPayload,
} from "./api";
import { Badge } from "./components/ui/badge";
import { Button } from "./components/ui/button";
import { Card, CardContent, CardHeader } from "./components/ui/card";
import { Input } from "./components/ui/input";

function plural(count: number | undefined, noun: string): string {
  const safeCount = count ?? 0;
  return `${safeCount.toLocaleString()} ${noun}${safeCount === 1 ? "" : "s"}`;
}

function truncateId(id: string): string {
  return id.length > 12 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id;
}

function metadataValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  return null;
}

export interface ProvenanceBrowserPanelProps {
  highlightedObservationId?: string | null;
  onDocumentChunkClick?: (documentId: string) => void;
  onMentalModelClick?: (id: string, query: string) => void;
}

function MemoryLinkCard({ link, onInspect, pending, onDocumentChunkClick }: { link: MemoryLink; onInspect: (link: MemoryLink) => void; pending: boolean; onDocumentChunkClick?: (documentId: string) => void }) {
  return (
    <article className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="font-medium text-zinc-100">{link.source_type} → {link.target_type}</h3>
          <p className="mt-1 text-xs text-zinc-500">{truncateId(link.source_id)} → {truncateId(link.target_id)}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge>{link.relationship}</Badge>
          {link.inferred ? <Badge>inferred</Badge> : <Badge>manual</Badge>}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-500">
        <span>weight {link.weight}</span>
        <Button type="button" onClick={() => onInspect(link)} disabled={pending} aria-label={`Inspect link ${link.id}`}>
          <Link2 className="mr-2 h-4 w-4" /> Inspect
        </Button>
      </div>
    </article>
  );
}

function ExpansionCard({ result, onDocumentChunkClick }: { result: MemoryLinkExpansionResult; onDocumentChunkClick?: (documentId: string) => void }) {
  const linked = result.linked_memory;
  const proofCount = metadataValue(linked?.metadata?.proof_count);
  const trend = metadataValue(linked?.metadata?.trend);
  return (
    <article className="rounded-lg border border-blue-500/30 bg-blue-500/10 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-medium text-blue-100">{linked?.title ?? linked?.source_type ?? result.link.target_type}</h3>
        <Badge>{result.direction} · {result.link.relationship}</Badge>
      </div>
      <p className="mt-2 whitespace-pre-wrap text-sm text-blue-50">{linked?.content ?? "Linked memory content unavailable."}</p>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-blue-100/80">
        {linked ? <span>{linked.source_type}:{truncateId(linked.id)}</span> : null}
        {proofCount ? <span>{proofCount} proofs</span> : null}
        {trend ? <span>{trend}</span> : null}
        {linked && linked.source_type === "document" && onDocumentChunkClick ? (
          <Button type="button" onClick={() => onDocumentChunkClick(linked.id)} aria-label={`Inspect document chunk ${linked.id}`}>
            <Link2 className="mr-2 h-4 w-4" /> Inspect
          </Button>
        ) : null}
      </div>
    </article>
  );
}

function ObservationCard({ observation, adminKey, onArchive }: { observation: ConsolidatedObservation; adminKey: string | undefined; onArchive?: (id: string) => void }) {
  const sourceIds = observation.source_memory_ids ?? [];
  const quotes = observation.source_quotes ?? [];
  return (
    <article className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-medium text-emerald-100">Consolidated observation</h3>
        <div className="flex flex-wrap gap-2">
          {observation.trend ? <Badge>{observation.trend}</Badge> : null}
          <Badge>{observation.proof_count} proofs</Badge>
          {observation.archived ? <Badge>archived</Badge> : null}
          {adminKey && !observation.archived && onArchive ? (
            <Button type="button" onClick={() => onArchive(observation.id)} className="border-amber-600/60 text-amber-200" aria-label={`Archive observation ${observation.id}`}>
              <Archive className="mr-1 h-3 w-3" /> Archive
            </Button>
          ) : null}
        </div>
      </div>
      <p className="mt-2 whitespace-pre-wrap text-sm text-emerald-50">{observation.content}</p>
      {sourceIds.length > 0 ? <p className="mt-2 text-xs text-emerald-100/80">Sources: {sourceIds.join(", ")}</p> : null}
      {quotes.length > 0 ? (
        <div className="mt-2 grid gap-1 text-xs text-emerald-100/80">
          {quotes.slice(0, 3).map((quote, index) => (
            <blockquote key={`${quote.source_id ?? "quote"}-${index}`} className="border-l border-emerald-400/40 pl-2">
              {quote.quote ?? JSON.stringify(quote)}
            </blockquote>
          ))}
        </div>
      ) : null}
    </article>
  );
}

function MentalModelCard({ model, onMentalModelClick, adminKey, onEdit }: { model: MentalModel; onMentalModelClick?: (id: string, query: string) => void; adminKey: string | undefined; onEdit?: (model: MentalModel) => void }) {
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(model.name);
  const [editContent, setEditContent] = useState(model.content);
  const [editActive, setEditActive] = useState(model.active);

  if (isEditing) {
    return (
      <article className="rounded-lg border border-violet-500/40 bg-violet-500/10 p-3">
        <div className="grid gap-2">
          <label className="grid gap-1 text-sm text-zinc-300" htmlFor={`mental-model-name-${model.id}`}>
            Mental model name
            <Input id={`mental-model-name-${model.id}`} value={editName} onChange={(e) => setEditName(e.target.value)} />
          </label>
          <label className="grid gap-1 text-sm text-zinc-300" htmlFor={`mental-model-content-${model.id}`}>
            Content
            <textarea id={`mental-model-content-${model.id}`} value={editContent} onChange={(e) => setEditContent(e.target.value)} className="min-h-20 rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none ring-violet-500/40 focus:border-violet-500 focus:ring-2" />
          </label>
          <label className="inline-flex items-center gap-2 text-sm text-zinc-300">
            <input type="checkbox" checked={editActive} onChange={(e) => setEditActive(e.target.checked)} className="h-4 w-4 rounded border-zinc-700 bg-zinc-950 text-violet-500" />
            Active
          </label>
          <div className="flex gap-2">
            <Button type="button" onClick={() => onEdit?.({ ...model, name: editName, content: editContent, active: editActive })} aria-label={`Save mental model ${model.id}`}>Save</Button>
            <Button type="button" onClick={() => { setIsEditing(false); setEditName(model.name); setEditContent(model.content); setEditActive(model.active); }} className="border-zinc-600 text-zinc-300">Cancel</Button>
          </div>
        </div>
      </article>
    );
  }

  return (
    <article className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {onMentalModelClick ? (
            <button type="button" className="font-medium text-zinc-100 hover:text-violet-300 transition" onClick={() => onMentalModelClick(model.id, model.query)}>
              {model.name}
            </button>
          ) : (
            <h3 className="font-medium text-zinc-100">{model.name}</h3>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge>{model.active ? "active" : "inactive"}</Badge>
          <Badge>priority {model.priority}</Badge>
          {adminKey ? (
            <Button type="button" onClick={() => setIsEditing(true)} className="border-zinc-600 text-zinc-300" aria-label={`Edit mental model ${model.id}`}>
              <Pencil className="mr-1 h-3 w-3" /> Edit
            </Button>
          ) : null}
        </div>
      </div>
      <p className="mt-2 line-clamp-3 text-sm text-zinc-300">{model.content}</p>
      <div className="mt-2 flex flex-wrap gap-2 text-xs text-zinc-500">
        <span>{truncateId(model.id)}</span>
        {model.tags.length > 0 ? <span>tags: {model.tags.join(", ")}</span> : null}
      </div>
    </article>
  );
}

export function ProvenanceBrowserPanel({ highlightedObservationId, onDocumentChunkClick, onMentalModelClick }: ProvenanceBrowserPanelProps) {
  const [bankId, setBankId] = useState("openbrain");
  const [relationship, setRelationship] = useState("");
  const [observationQuery, setObservationQuery] = useState("");
  const trimmedBankId = bankId.trim() || "openbrain";
  const adminKey = getStoredAdminApiKey();
  const queryClient = useQueryClient();
  const linkFilters = useMemo(
    () => ({ bank_id: trimmedBankId, relationship: relationship.trim() || undefined, limit: 10 }),
    [trimmedBankId, relationship]
  );

  const linksQuery = useQuery({ queryKey: ["memory-links", linkFilters], queryFn: () => listMemoryLinks(linkFilters) });
  const experiencesQuery = useQuery({ queryKey: ["experiences", trimmedBankId], queryFn: () => listExperiences({ bank_id: trimmedBankId, limit: 5 }) });
  const mentalModelsQuery = useQuery({ queryKey: ["mental-models", trimmedBankId], queryFn: () => listMentalModels({ bank_id: trimmedBankId, limit: 5 }) });

  const expandMutation = useMutation({ mutationFn: (payload: MemoryLinkExpansionPayload) => expandMemoryLinks(payload) });
  const observationSearchMutation = useMutation({ mutationFn: (payload: ObservationSearchPayload) => searchConsolidatedObservations(payload) });
  const updateMentalModelMutation = useMutation({
    mutationFn: (args: { id: string; payload: Parameters<typeof updateMentalModel>[1] }) => updateMentalModel(args.id, args.payload),
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ["mental-models"] }); },
  });
  const archiveObservationMutation = useMutation({
    mutationFn: (args: { id: string; payload: { archived: boolean } }) => updateConsolidatedObservation(args.id, args.payload),
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ["consolidated-observations"] }); },
  });

  useEffect(() => {
    if (highlightedObservationId) {
      observationSearchMutation.mutate({ query: highlightedObservationId, bank_id: trimmedBankId, limit: 5, threshold: 0.1 });
    }
  }, [highlightedObservationId]);

  function inspectLink(link: MemoryLink) {
    expandMutation.mutate({
      bank_id: trimmedBankId,
      seeds: [{ source_type: link.source_type, source_id: link.source_id }],
      direction: "both",
      limit: 5,
    });
    if (link.source_type === "document" && onDocumentChunkClick) {
      onDocumentChunkClick(link.source_id);
    }
  }

  function handleEditMentalModel(model: MentalModel) {
    updateMentalModelMutation.mutate({ id: model.id, payload: { name: model.name, content: model.content, active: model.active } });
  }

  function handleArchiveObservation(id: string) {
    archiveObservationMutation.mutate({ id, payload: { archived: true } });
  }

  function searchObservations(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const query = observationQuery.trim();
    if (!query) return;
    observationSearchMutation.mutate({ query, bank_id: trimmedBankId, limit: 5, threshold: 0.1 });
  }

  const links = linksQuery.data?.results ?? [];
  const expanded = expandMutation.data?.results ?? [];
  const observations = observationSearchMutation.data?.results ?? [];
  const mentalModels = mentalModelsQuery.data?.results ?? [];

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <div className="flex items-center gap-2 text-sm text-zinc-400"><GitBranch className="h-4 w-4" /> Graph inspection {adminKey ? "and editing" : ""}</div>
            <h2 className="mt-1 text-2xl font-semibold">Memory graph / provenance browser</h2>
            <p className="mt-1 text-sm text-zinc-400">Inspect experiences, memory links, mental models, and observation evidence{adminKey ? ". Edit controls require admin key." : " without running inference or writes."}</p>
          </div>
          <Badge className={adminKey ? "border-amber-500/40 bg-amber-500/10 text-amber-200" : "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"}>
            <ShieldCheck className="mr-1 h-3 w-3" /> {adminKey ? "Admin editing" : "Read-only"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 md:grid-cols-3">
          <label className="grid gap-1 text-sm text-zinc-300" htmlFor="provenance-bank-id">
            Memory bank
            <Input id="provenance-bank-id" value={bankId} onChange={(event) => setBankId(event.target.value)} placeholder="openbrain" />
          </label>
          <label className="grid gap-1 text-sm text-zinc-300" htmlFor="provenance-relationship">
            Relationship filter
            <Input id="provenance-relationship" value={relationship} onChange={(event) => setRelationship(event.target.value)} placeholder="evidence_for" />
          </label>
          <form className="grid gap-1 text-sm text-zinc-300" onSubmit={searchObservations}>
            <label htmlFor="provenance-observation-query">Evidence search query</label>
            <div className="flex gap-2">
              <Input id="provenance-observation-query" value={observationQuery} onChange={(event) => setObservationQuery(event.target.value)} placeholder="privacy constraints" />
              <Button type="submit" disabled={!observationQuery.trim() || observationSearchMutation.isPending}>
                <Search className="mr-2 h-4 w-4" /> Search observations
              </Button>
            </div>
          </form>
        </div>

        <div className="grid gap-2 md:grid-cols-3">
          <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3 text-sm text-zinc-300">{plural(linksQuery.data?.count, "memory link")}</div>
          <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3 text-sm text-zinc-300">{plural(experiencesQuery.data?.count, "experience")}</div>
          <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3 text-sm text-zinc-300">{plural(mentalModelsQuery.data?.count, "mental model")}</div>
        </div>

        {linksQuery.isError ? <p role="alert" className="text-sm text-red-300">Memory link API error: {String(linksQuery.error)}</p> : null}
        {expandMutation.isError ? <p role="alert" className="text-sm text-red-300">Expansion failed: {String(expandMutation.error)}</p> : null}
        {observationSearchMutation.isError ? <p role="alert" className="text-sm text-red-300">Observation search failed: {String(observationSearchMutation.error)}</p> : null}
        {updateMentalModelMutation.isError ? <p role="alert" className="text-sm text-red-300">Mental model update failed: {String(updateMentalModelMutation.error)}</p> : null}
        {archiveObservationMutation.isError ? <p role="alert" className="text-sm text-red-300">Observation archive failed: {String(archiveObservationMutation.error)}</p> : null}

        <div className="grid gap-4 xl:grid-cols-2">
          <section className="space-y-2">
            <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-violet-300">Memory links</h3>
            {linksQuery.isLoading ? <p className="text-sm text-zinc-400">Loading memory links…</p> : null}
            {links.length === 0 && !linksQuery.isLoading ? <p className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3 text-sm text-zinc-400">No memory links found.</p> : null}
            <div className="grid gap-2">
              {links.map((link) => <MemoryLinkCard key={link.id} link={link} onInspect={inspectLink} pending={expandMutation.isPending} onDocumentChunkClick={onDocumentChunkClick} />)}
            </div>
          </section>

          <section className="space-y-2">
            <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-blue-300">One-hop linked evidence</h3>
            {expandMutation.isPending ? <p className="text-sm text-zinc-400">Expanding graph links…</p> : null}
            {expanded.length === 0 && !expandMutation.isPending ? <p className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3 text-sm text-zinc-400">Select a memory link to inspect one-hop evidence.</p> : null}
            <div className="grid gap-2">
              {expanded.map((result) => <ExpansionCard key={`${result.link.id}-${result.direction}-${result.linked_memory?.id ?? "missing"}`} result={result} onDocumentChunkClick={onDocumentChunkClick} />)}
            </div>
          </section>
        </div>

        {mentalModels.length > 0 ? (
          <section className="space-y-2">
            <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-blue-300">Mental models</h3>
            <div className="grid gap-2">
              {mentalModels.map((model) => <MentalModelCard key={model.id} model={model} onMentalModelClick={onMentalModelClick} adminKey={adminKey} onEdit={handleEditMentalModel} />)}
            </div>
          </section>
        ) : null}

        <section className="space-y-2">
          <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-emerald-300">Observation provenance search</h3>
          {observationSearchMutation.isPending ? <p className="text-sm text-zinc-400">Searching observations…</p> : null}
          {observations.length === 0 && observationSearchMutation.isSuccess ? <p className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3 text-sm text-zinc-400">No observations matched.</p> : null}
          <div className="grid gap-2">
            {observations.map((observation) => <ObservationCard key={observation.id} observation={observation} adminKey={adminKey} onArchive={handleArchiveObservation} />)}
          </div>
        </section>
      </CardContent>
    </Card>
  );
}
