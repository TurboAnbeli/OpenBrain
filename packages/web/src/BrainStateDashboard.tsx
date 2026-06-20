import { useQuery } from "@tanstack/react-query";
import { Activity, Database, FileText, GitBranch, Layers3, Link2, AlertTriangle, CheckCircle2 } from "lucide-react";

import {
  getEmbedderInfo,
  listDocuments,
  listExperiences,
  listMemoryLinks,
  listMentalModels,
  searchConsolidatedObservations,
} from "./api";
import { Badge } from "./components/ui/badge";
import { Card, CardContent, CardHeader } from "./components/ui/card";

function CountCard({ label, count, icon: Icon }: { label: string; count: number | undefined; icon: React.ComponentType<{ className?: string }> }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-4">
      <div className="flex items-center gap-3">
        <Icon className="h-5 w-5 text-violet-400" />
        <div>
          <div data-testid={`count-${label.toLowerCase().replace(/\s+/g, "-")}`} className="text-2xl font-semibold text-zinc-100">{count ?? "—"}</div>
          <div className="text-sm text-zinc-400">{label}</div>
        </div>
      </div>
    </div>
  );
}

export function BrainStateDashboard() {
  const docsQuery = useQuery({ queryKey: ["brain-docs"], queryFn: () => listDocuments({ limit: 1 }) });
  const modelsQuery = useQuery({ queryKey: ["brain-models"], queryFn: () => listMentalModels({ bank_id: "openbrain", limit: 100, include_inactive: true }) });
  const obsQuery = useQuery({ queryKey: ["brain-obs"], queryFn: () => searchConsolidatedObservations({ query: "*", bank_id: "openbrain", limit: 1, threshold: 0 }) });
  const expsQuery = useQuery({ queryKey: ["brain-exps"], queryFn: () => listExperiences({ bank_id: "openbrain", limit: 1 }) });
  const linksQuery = useQuery({ queryKey: ["brain-links"], queryFn: () => listMemoryLinks({ bank_id: "openbrain", limit: 1 }) });
  const embedderQuery = useQuery({ queryKey: ["brain-embedder"], queryFn: () => getEmbedderInfo() });

  const models = modelsQuery.data?.results ?? [];
  const staleModels = models.filter((m) => m.stale === true);
  const embedder = embedderQuery.data;

  return (
    <Card>
      <CardHeader>
        <div>
          <div className="flex items-center gap-2 text-sm text-zinc-400"><Database className="h-4 w-4" /> System overview</div>
          <h2 className="mt-1 text-2xl font-semibold">Brain state overview</h2>
          <p className="mt-1 text-sm text-zinc-400">At-a-glance health and counts for your OpenBrain knowledge system.</p>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 grid-cols-2 md:grid-cols-5">
          <CountCard label="Documents" count={docsQuery.data?.count} icon={FileText} />
          <CountCard label="Mental models" count={modelsQuery.data?.count} icon={Layers3} />
          <CountCard label="Observations" count={obsQuery.data?.count} icon={Activity} />
          <CountCard label="Experiences" count={expsQuery.data?.count} icon={Activity} />
          <CountCard label="Memory links" count={linksQuery.data?.count} icon={Link2} />
        </div>

        {staleModels.length > 0 ? (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
            <div className="flex items-center gap-2 text-amber-200 text-sm font-medium"><AlertTriangle className="h-4 w-4" /> {staleModels.length} stale mental {staleModels.length === 1 ? "model" : "models"}</div>
            <div className="mt-2 flex flex-wrap gap-2">
              {staleModels.map((m) => <Badge key={m.id} className="border-amber-500/40 bg-amber-500/10 text-amber-200">{m.name}</Badge>)}
            </div>
          </div>
        ) : models.length > 0 ? (
          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 flex items-center gap-2 text-emerald-200 text-sm"><CheckCircle2 className="h-4 w-4" /> All mental models up to date</div>
        ) : null}

        {embedder ? (
          <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
            <h3 className="text-sm font-medium text-zinc-300 mb-2">Embedder</h3>
            <div className="grid gap-2 text-sm md:grid-cols-3">
              <div><span className="text-zinc-500">Provider:</span> <span className="text-zinc-200">{embedder.provider}</span></div>
              <div><span className="text-zinc-500">Model:</span> <span className="text-zinc-200">{embedder.model}</span></div>
              <div><span className="text-zinc-500">Dimension:</span> <span className="text-zinc-200">{embedder.dimension}</span></div>
              <div><span className="text-zinc-500">Total chunks:</span> <span className="text-zinc-200">{embedder.total_chunks}</span></div>
              <div><span className="text-zinc-500">Known version:</span> <span className="text-zinc-200">{embedder.chunks_with_known_version}</span></div>
              <div><span className="text-zinc-500">Unknown version:</span> <span className="text-zinc-200">{embedder.chunks_with_unknown_version}</span></div>
            </div>
            {embedder.reindex_required ? (
              <div data-testid="reindex-warning" className="mt-2 flex items-center gap-2 text-amber-200 text-sm"><AlertTriangle className="h-4 w-4" /> Reindex required — {embedder.chunks_with_unknown_version} unknown version chunks need reindexing.</div>
            ) : (
              <div data-testid="reindex-ok" className="mt-2 flex items-center gap-2 text-emerald-200 text-sm"><CheckCircle2 className="h-4 w-4" /> No reindex required</div>
            )}
          </div>
        ) : embedderQuery.isError ? (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">Embedder info unavailable: {String(embedderQuery.error)}</div>
        ) : null}

        {(docsQuery.isError || modelsQuery.isError || obsQuery.isError || expsQuery.isError || linksQuery.isError) ? (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">Some counts failed to load. Check the API connection.</div>
        ) : null}
      </CardContent>
    </Card>
  );
}