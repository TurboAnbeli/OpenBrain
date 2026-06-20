import { useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { GitBranch, Link2, Search, ShieldCheck } from "lucide-react";

import {
  expandMemoryLinks,
  listExperiences,
  listMemoryLinks,
  listMentalModels,
  searchConsolidatedObservations,
  type ConsolidatedObservation,
  type MemoryLink,
  type MemoryLinkExpansionPayload,
  type MemoryLinkExpansionResult,
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

function MemoryLinkCard({ link, onInspect, pending }: { link: MemoryLink; onInspect: (link: MemoryLink) => void; pending: boolean }) {
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

function ExpansionCard({ result }: { result: MemoryLinkExpansionResult }) {
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
      <div className="mt-2 flex flex-wrap gap-2 text-xs text-blue-100/80">
        {linked ? <span>{linked.source_type}:{truncateId(linked.id)}</span> : null}
        {proofCount ? <span>{proofCount} proofs</span> : null}
        {trend ? <span>{trend}</span> : null}
      </div>
    </article>
  );
}

function ObservationCard({ observation }: { observation: ConsolidatedObservation }) {
  const sourceIds = observation.source_memory_ids ?? [];
  const quotes = observation.source_quotes ?? [];
  return (
    <article className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-medium text-emerald-100">Consolidated observation</h3>
        <div className="flex flex-wrap gap-2">
          {observation.trend ? <Badge>{observation.trend}</Badge> : null}
          <Badge>{observation.proof_count} proofs</Badge>
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

export function ProvenanceBrowserPanel() {
  const [bankId, setBankId] = useState("openbrain");
  const [relationship, setRelationship] = useState("");
  const [observationQuery, setObservationQuery] = useState("");
  const trimmedBankId = bankId.trim() || "openbrain";
  const linkFilters = useMemo(
    () => ({ bank_id: trimmedBankId, relationship: relationship.trim() || undefined, limit: 10 }),
    [trimmedBankId, relationship]
  );

  const linksQuery = useQuery({ queryKey: ["memory-links", linkFilters], queryFn: () => listMemoryLinks(linkFilters) });
  const experiencesQuery = useQuery({ queryKey: ["experiences", trimmedBankId], queryFn: () => listExperiences({ bank_id: trimmedBankId, limit: 5 }) });
  const mentalModelsQuery = useQuery({ queryKey: ["mental-models", trimmedBankId], queryFn: () => listMentalModels({ bank_id: trimmedBankId, limit: 5 }) });

  const expandMutation = useMutation({ mutationFn: (payload: MemoryLinkExpansionPayload) => expandMemoryLinks(payload) });
  const observationSearchMutation = useMutation({ mutationFn: (payload: ObservationSearchPayload) => searchConsolidatedObservations(payload) });

  function inspectLink(link: MemoryLink) {
    expandMutation.mutate({
      bank_id: trimmedBankId,
      seeds: [{ source_type: link.source_type, source_id: link.source_id }],
      direction: "both",
      limit: 5,
    });
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

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <div className="flex items-center gap-2 text-sm text-zinc-400"><GitBranch className="h-4 w-4" /> Read-only graph inspection</div>
            <h2 className="mt-1 text-2xl font-semibold">Memory graph / provenance browser</h2>
            <p className="mt-1 text-sm text-zinc-400">Inspect experiences, memory links, mental models, and observation evidence without running inference or writes.</p>
          </div>
          <Badge className="border-emerald-500/40 bg-emerald-500/10 text-emerald-200"><ShieldCheck className="mr-1 h-3 w-3" /> Read-only</Badge>
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

        <div className="grid gap-4 xl:grid-cols-2">
          <section className="space-y-2">
            <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-violet-300">Memory links</h3>
            {linksQuery.isLoading ? <p className="text-sm text-zinc-400">Loading memory links…</p> : null}
            {links.length === 0 && !linksQuery.isLoading ? <p className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3 text-sm text-zinc-400">No memory links found.</p> : null}
            <div className="grid gap-2">
              {links.map((link) => <MemoryLinkCard key={link.id} link={link} onInspect={inspectLink} pending={expandMutation.isPending} />)}
            </div>
          </section>

          <section className="space-y-2">
            <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-blue-300">One-hop linked evidence</h3>
            {expandMutation.isPending ? <p className="text-sm text-zinc-400">Expanding graph links…</p> : null}
            {expanded.length === 0 && !expandMutation.isPending ? <p className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3 text-sm text-zinc-400">Select a memory link to inspect one-hop evidence.</p> : null}
            <div className="grid gap-2">
              {expanded.map((result) => <ExpansionCard key={`${result.link.id}-${result.direction}-${result.linked_memory?.id ?? "missing"}`} result={result} />)}
            </div>
          </section>
        </div>

        <section className="space-y-2">
          <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-emerald-300">Observation provenance search</h3>
          {observationSearchMutation.isPending ? <p className="text-sm text-zinc-400">Searching observations…</p> : null}
          {observations.length === 0 && observationSearchMutation.isSuccess ? <p className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3 text-sm text-zinc-400">No observations matched.</p> : null}
          <div className="grid gap-2">
            {observations.map((observation) => <ObservationCard key={observation.id} observation={observation} />)}
          </div>
        </section>
      </CardContent>
    </Card>
  );
}
