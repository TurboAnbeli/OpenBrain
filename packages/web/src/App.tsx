import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import CodeMirror from "@uiw/react-codemirror";
import { markdown } from "@codemirror/lang-markdown";
import { Database, FileText, GitCompare, Layers3, RefreshCw, Search } from "lucide-react";

import { getDocument, getRevisionDiff, listDocumentChunks, listDocumentRevisions, listDocuments } from "./api";
import type { DocumentSummary } from "./types";
import { Badge } from "./components/ui/badge";
import { Button } from "./components/ui/button";
import { Card, CardContent, CardHeader } from "./components/ui/card";
import { Input } from "./components/ui/input";

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function DocumentRow({ document, selected, onSelect }: { document: DocumentSummary; selected: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full rounded-lg border p-3 text-left transition ${
        selected ? "border-violet-500 bg-violet-500/10" : "border-zinc-800 bg-zinc-950/60 hover:border-zinc-700 hover:bg-zinc-900/80"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="line-clamp-1 font-medium text-zinc-100">{document.title}</div>
          <div className="mt-1 text-xs text-zinc-500">{document.source_uri ?? document.source_type}</div>
        </div>
        <Badge>{document.status}</Badge>
      </div>
      <p className="mt-3 line-clamp-2 text-sm text-zinc-400">{document.content_preview}</p>
      <div className="mt-3 flex flex-wrap gap-2 text-xs text-zinc-500">
        <span>{document.content_char_count.toLocaleString()} chars</span>
        <span>• {document.chunk_count} chunks</span>
        <span>• {document.revision_count} revisions</span>
        <span>• {formatDate(document.updated_at)}</span>
      </div>
    </button>
  );
}

export default function App() {
  const [query, setQuery] = useState("");
  const [project, setProject] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedRevision, setSelectedRevision] = useState<number | null>(null);

  const filters = useMemo(() => ({ q: query || undefined, project: project || undefined, status: "active", limit: 25 }), [query, project]);
  const documentsQuery = useQuery({ queryKey: ["documents", filters], queryFn: () => listDocuments(filters) });
  const firstDocumentId = documentsQuery.data?.documents[0]?.id ?? null;
  const activeDocumentId = selectedId ?? firstDocumentId;

  const detailQuery = useQuery({
    queryKey: ["document", activeDocumentId],
    queryFn: () => getDocument(activeDocumentId!),
    enabled: Boolean(activeDocumentId),
  });
  const revisionsQuery = useQuery({
    queryKey: ["document-revisions", activeDocumentId],
    queryFn: () => listDocumentRevisions(activeDocumentId!),
    enabled: Boolean(activeDocumentId),
  });
  const chunksQuery = useQuery({
    queryKey: ["document-chunks", activeDocumentId],
    queryFn: () => listDocumentChunks(activeDocumentId!),
    enabled: Boolean(activeDocumentId),
  });
  const diffQuery = useQuery({
    queryKey: ["revision-diff", activeDocumentId, selectedRevision],
    queryFn: () => getRevisionDiff(activeDocumentId!, selectedRevision!),
    enabled: Boolean(activeDocumentId && selectedRevision),
  });

  return (
    <div className="min-h-screen px-6 py-6 text-zinc-100">
      <header className="mx-auto mb-6 flex max-w-7xl flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="flex items-center gap-3 text-sm uppercase tracking-[0.3em] text-violet-300">
            <Database className="h-4 w-4" /> OpenBrain
          </div>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">One Brain Document Browser</h1>
          <p className="mt-1 text-sm text-zinc-400">Direct PostgreSQL-backed explorer for source docs, chunks, revisions, and diff metrics.</p>
        </div>
        <Button onClick={() => void documentsQuery.refetch()} disabled={documentsQuery.isFetching}>
          <RefreshCw className="mr-2 h-4 w-4" /> Refresh
        </Button>
      </header>

      <main className="mx-auto grid max-w-7xl gap-4 lg:grid-cols-[390px_1fr]">
        <Card className="min-h-[calc(100vh-9rem)]">
          <CardHeader>
            <div className="flex items-center gap-2 font-medium"><Search className="h-4 w-4" /> Explorer</div>
            <div className="mt-3 grid gap-2">
              <Input placeholder="Search title/source/body…" value={query} onChange={(event) => setQuery(event.target.value)} />
              <Input placeholder="Project filter" value={project} onChange={(event) => setProject(event.target.value)} />
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {documentsQuery.isLoading ? <p className="text-sm text-zinc-400">Loading documents…</p> : null}
            {documentsQuery.isError ? <p className="text-sm text-red-300">{String(documentsQuery.error)}</p> : null}
            {documentsQuery.data?.documents.map((document) => (
              <DocumentRow
                key={document.id}
                document={document}
                selected={document.id === activeDocumentId}
                onSelect={() => {
                  setSelectedId(document.id);
                  setSelectedRevision(null);
                }}
              />
            ))}
          </CardContent>
        </Card>

        <div className="grid gap-4">
          <Card>
            <CardHeader>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2 text-sm text-zinc-400"><FileText className="h-4 w-4" /> Current source</div>
                  <h2 className="mt-1 text-2xl font-semibold">{detailQuery.data?.title ?? "Select a document"}</h2>
                </div>
                {detailQuery.data ? <Badge>{detailQuery.data.source_type}</Badge> : null}
              </div>
            </CardHeader>
            <CardContent>
              {detailQuery.isError ? <p className="text-sm text-red-300">{String(detailQuery.error)}</p> : null}
              {detailQuery.data ? (
                <div className="grid gap-4">
                  <div className="grid gap-2 text-sm text-zinc-400 md:grid-cols-3">
                    <div><span className="text-zinc-500">Project:</span> {detailQuery.data.project ?? "—"}</div>
                    <div><span className="text-zinc-500">Kind:</span> {detailQuery.data.document_kind ?? "—"}</div>
                    <div><span className="text-zinc-500">Updated:</span> {formatDate(detailQuery.data.updated_at)}</div>
                  </div>
                  <CodeMirror
                    value={detailQuery.data.content}
                    height="420px"
                    extensions={[markdown()]}
                    editable={false}
                    basicSetup={{ lineNumbers: true, foldGutter: true }}
                    theme="dark"
                  />
                </div>
              ) : (
                <p className="text-sm text-zinc-400">Pick a document from the explorer to load full content.</p>
              )}
            </CardContent>
          </Card>

          <div className="grid gap-4 xl:grid-cols-2">
            <Card>
              <CardHeader><div className="flex items-center gap-2 font-medium"><GitCompare className="h-4 w-4" /> Revisions</div></CardHeader>
              <CardContent className="space-y-3">
                {revisionsQuery.data?.revisions.length === 0 ? <p className="text-sm text-zinc-400">No revisions recorded yet.</p> : null}
                {revisionsQuery.data?.revisions.map((revision) => (
                  <button
                    key={revision.id}
                    type="button"
                    onClick={() => setSelectedRevision(revision.revision_number)}
                    className={`w-full rounded-lg border p-3 text-left text-sm transition ${selectedRevision === revision.revision_number ? "border-violet-500 bg-violet-500/10" : "border-zinc-800 hover:border-zinc-700"}`}
                  >
                    <div className="flex items-center justify-between">
                      <span>Revision {revision.revision_number}</span>
                      <Badge>{revision.status}</Badge>
                    </div>
                    <div className="mt-1 text-zinc-500">{revision.edit_reason ?? "No edit reason"}</div>
                    <div className="mt-1 text-xs text-zinc-600">{formatDate(revision.created_at)}</div>
                  </button>
                ))}
                {diffQuery.data ? (
                  <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-sm text-zinc-300">
                    <div className="font-medium text-zinc-100">Diff metrics</div>
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <span>+{diffQuery.data.diff.added_lines} lines</span>
                      <span>-{diffQuery.data.diff.removed_lines} lines</span>
                      <span>{diffQuery.data.diff.char_delta} chars</span>
                      <span>{diffQuery.data.diff.changed ? "changed" : "unchanged"}</span>
                    </div>
                  </div>
                ) : null}
              </CardContent>
            </Card>

            <Card>
              <CardHeader><div className="flex items-center gap-2 font-medium"><Layers3 className="h-4 w-4" /> Chunks</div></CardHeader>
              <CardContent className="space-y-3">
                {chunksQuery.data?.chunks.slice(0, 6).map((chunk) => (
                  <div key={chunk.id} className="rounded-lg border border-zinc-800 bg-zinc-950 p-3">
                    <div className="mb-2 flex items-center justify-between text-xs text-zinc-500">
                      <span>Chunk {chunk.chunk_index}</span>
                      <span>{chunk.token_count ?? "—"} tokens</span>
                    </div>
                    <p className="line-clamp-4 text-sm text-zinc-300">{chunk.content}</p>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </div>
      </main>
    </div>
  );
}
