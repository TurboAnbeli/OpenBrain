import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import CodeMirror from "@uiw/react-codemirror";
import { markdown } from "@codemirror/lang-markdown";
import { CheckCircle2, Database, FileText, GitCompare, Layers3, Pencil, RefreshCw, Save, Search, Upload, X } from "lucide-react";

import { getDocument, getRevisionDiff, getStoredAdminApiKey, importUrlDocument, listDocumentChunks, listDocumentRevisions, listDocuments, reindexDocument, setStoredAdminApiKey, updateDocument, uploadDocument } from "./api";
import { DirectiveAdminPanel } from "./DirectiveAdminPanel";
import { buildDocumentUpdatePayload, buildLineDiffRows, createDocumentDraft, isDocumentDraftDirty, type DocumentDraft } from "./editorState";
import type { DocumentDetail, DocumentSummary } from "./types";
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

function emptyDraft(): DocumentDraft {
  return { title: "", content: "", editReason: "" };
}

function DraftMetadata({ document }: { document: DocumentDetail }) {
  return (
    <div className="grid gap-2 text-sm text-zinc-400 md:grid-cols-3">
      <div><span className="text-zinc-500">Project:</span> {document.project ?? "—"}</div>
      <div><span className="text-zinc-500">Kind:</span> {document.document_kind ?? "—"}</div>
      <div><span className="text-zinc-500">Updated:</span> {formatDate(document.updated_at)}</div>
    </div>
  );
}

export default function App() {
  const [query, setQuery] = useState("");
  const [project, setProject] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedRevision, setSelectedRevision] = useState<number | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState<DocumentDraft>(emptyDraft);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [adminKeyInput, setAdminKeyInput] = useState(() => getStoredAdminApiKey() ?? "");
  const queryClient = useQueryClient();

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

  useEffect(() => {
    if (!detailQuery.data) return;
    setDraft(createDocumentDraft(detailQuery.data));
    setIsEditing(false);
    setSaveMessage(null);
  }, [detailQuery.data?.id, detailQuery.data?.updated_at]);

  const dirty = detailQuery.data ? isDocumentDraftDirty(detailQuery.data, draft) : false;
  const validDraft = draft.title.trim().length > 0 && draft.content.trim().length > 0;
  const lineDiffRows = useMemo(
    () => (diffQuery.data ? buildLineDiffRows(diffQuery.data.revision.content, diffQuery.data.current.content).slice(0, 200) : []),
    [diffQuery.data]
  );

  const saveMutation = useMutation({
    mutationFn: () => {
      if (!activeDocumentId) throw new Error("No active document selected");
      return updateDocument(activeDocumentId, buildDocumentUpdatePayload(draft));
    },
    onSuccess: async (updated) => {
      setDraft(createDocumentDraft(updated));
      setIsEditing(false);
      setSelectedRevision(null);
      setSaveMessage("Saved. Revision history and search chunks were refreshed.");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["documents"] }),
        queryClient.invalidateQueries({ queryKey: ["document", updated.id] }),
        queryClient.invalidateQueries({ queryKey: ["document-revisions", updated.id] }),
        queryClient.invalidateQueries({ queryKey: ["revision-diff", updated.id] }),
      ]);
    },
  });

  const reindexMutation = useMutation({
    mutationFn: () => {
      if (!activeDocumentId) throw new Error("No active document selected");
      return reindexDocument(activeDocumentId);
    },
    onSuccess: async (result) => {
      setSaveMessage(result.reindexed ? `Reindexed: ${result.chunk_count ?? 0} chunks refreshed.` : "Reindex skipped — document unchanged.");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["documents"] }),
        queryClient.invalidateQueries({ queryKey: ["document", activeDocumentId] }),
        queryClient.invalidateQueries({ queryKey: ["document-chunks", activeDocumentId] }),
        queryClient.invalidateQueries({ queryKey: ["document-revisions", activeDocumentId] }),
      ]);
    },
  });

  const [importUrl, setImportUrl] = useState("");
  const [showImport, setShowImport] = useState(false);

  const uploadMutation = useMutation({
    mutationFn: (file: File) => uploadDocument(file, project || undefined, undefined),
    onSuccess: async () => {
      setSaveMessage("File uploaded and indexed.");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["documents"] }),
      ]);
    },
  });

  const importUrlMutation = useMutation({
    mutationFn: () => importUrlDocument(importUrl, undefined, project || undefined, undefined),
    onSuccess: async () => {
      setSaveMessage("URL imported and indexed.");
      setImportUrl("");
      setShowImport(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["documents"] }),
      ]);
    },
  });

  return (
    <div className="min-h-screen px-6 py-6 text-zinc-100">
      <header className="mx-auto mb-6 flex max-w-7xl flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="flex items-center gap-3 text-sm uppercase tracking-[0.3em] text-violet-300">
            <Database className="h-4 w-4" /> OpenBrain
          </div>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">One Brain Document Editor</h1>
          <p className="mt-1 text-sm text-zinc-400">Direct PostgreSQL-backed editor for source docs, chunks, revisions, and diff metrics.</p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <div className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-950/70 px-2 py-1" title="Used for protected write/admin actions only">
            <Input
              type="password"
              placeholder="Admin API key"
              value={adminKeyInput}
              onChange={(event) => setAdminKeyInput(event.target.value)}
              onBlur={() => setStoredAdminApiKey(adminKeyInput)}
              onKeyDown={(event) => {
                if (event.key === "Enter") setStoredAdminApiKey(adminKeyInput);
              }}
              className="h-8 w-40 border-zinc-700 bg-zinc-900 text-xs"
            />
            <Button
              onClick={() => {
                setStoredAdminApiKey(adminKeyInput);
                setSaveMessage(adminKeyInput.trim() ? "Admin key saved for protected actions." : "Admin key cleared.");
              }}
            >
              Save Key
            </Button>
          </div>
          <Button onClick={() => void documentsQuery.refetch()} disabled={documentsQuery.isFetching}>
            <RefreshCw className="mr-2 h-4 w-4" /> Refresh
          </Button>
          <label className="inline-flex cursor-pointer items-center justify-center rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm font-medium text-zinc-100 transition hover:border-violet-500 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50" title="Upload a markdown file">
            <Upload className="mr-2 h-4 w-4" /> Upload
            <input
              type="file"
              accept=".md,.markdown,.txt"
              className="hidden"
              disabled={uploadMutation.isPending}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) uploadMutation.mutate(file);
                e.target.value = "";
              }}
            />
          </label>
          <Button onClick={() => setShowImport((v) => !v)}>
            <FileText className="mr-2 h-4 w-4" /> Import URL
          </Button>
        </div>
      </header>

        {showImport ? (
          <div className="mx-auto mb-4 flex max-w-7xl items-center gap-2">
            <Input
              placeholder="https://example.com/doc.md"
              value={importUrl}
              onChange={(e) => setImportUrl(e.target.value)}
              className="max-w-lg"
              onKeyDown={(e) => { if (e.key === "Enter") importUrlMutation.mutate(); }}
            />
            <Button onClick={() => importUrlMutation.mutate()} disabled={!importUrl || importUrlMutation.isPending}>
              {importUrlMutation.isPending ? "Importing..." : "Import"}
            </Button>
            <Button onClick={() => { setShowImport(false); setImportUrl(""); }}>Cancel</Button>
            {importUrlMutation.isError ? <span className="text-sm text-red-300">{String(importUrlMutation.error)}</span> : null}
          </div>
        ) : null}
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
                  setSaveMessage(null);
                }}
              />
            ))}
          </CardContent>
        </Card>

        <div className="grid gap-4">
          <DirectiveAdminPanel />

          <Card>
            <CardHeader>
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div>
                  <div className="flex items-center gap-2 text-sm text-zinc-400"><FileText className="h-4 w-4" /> Current source</div>
                  <h2 className="mt-1 text-2xl font-semibold">{isEditing ? draft.title || "Untitled draft" : detailQuery.data?.title ?? "Select a document"}</h2>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {detailQuery.data ? <Badge>{detailQuery.data.source_type}</Badge> : null}
                  {detailQuery.data && !isEditing ? (
                    <>
                      <Button onClick={() => setIsEditing(true)}><Pencil className="mr-2 h-4 w-4" /> Edit</Button>
                      <Button
                        onClick={() => reindexMutation.mutate()}
                        disabled={reindexMutation.isPending}
                        className="border-zinc-600 text-zinc-300"
                        title="Regenerate search chunks and embeddings for this document"
                      >
                        <RefreshCw className="mr-2 h-4 w-4" /> {reindexMutation.isPending ? "Reindexing..." : "Reindex"}
                      </Button>
                    </>
                  ) : null}
                  {detailQuery.data && isEditing ? (
                    <>
                      <Button
                        onClick={() => saveMutation.mutate()}
                        disabled={!dirty || !validDraft || saveMutation.isPending}
                        title={!dirty ? "No changes to save" : !validDraft ? "Title and content are required" : "Save document"}
                      >
                        <Save className="mr-2 h-4 w-4" /> {saveMutation.isPending ? "Saving…" : "Save"}
                      </Button>
                      <Button
                        onClick={() => {
                          setDraft(createDocumentDraft(detailQuery.data!));
                          setIsEditing(false);
                          setSaveMessage(null);
                        }}
                        disabled={saveMutation.isPending}
                      >
                        <X className="mr-2 h-4 w-4" /> Cancel
                      </Button>
                    </>
                  ) : null}
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {detailQuery.isError ? <p className="text-sm text-red-300">{String(detailQuery.error)}</p> : null}
              {saveMutation.isError ? <p className="mb-3 text-sm text-red-300">{String(saveMutation.error)}</p> : null}
              {reindexMutation.isError ? <p className="mb-3 text-sm text-red-300">Reindex failed: {String(reindexMutation.error)}</p> : null}
              {saveMessage ? <p className="mb-3 text-sm text-emerald-300">{saveMessage}</p> : null}
              {detailQuery.data ? (
                <div className="grid gap-4">
                  <DraftMetadata document={detailQuery.data} />
                  {isEditing ? (
                    <div className="grid gap-3">
                      <label className="grid gap-1 text-sm text-zinc-300">
                        Title
                        <Input value={draft.title} onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))} />
                      </label>
                      <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-100">
                        <div className="flex items-center gap-2 font-medium"><CheckCircle2 className="h-4 w-4" /> Save behavior</div>
                        <p className="mt-1 text-emerald-100/80">Saving records a revision, regenerates document chunks, and refreshes search embeddings automatically.</p>
                      </div>
                      <CodeMirror
                        value={draft.content}
                        height="520px"
                        extensions={[markdown()]}
                        editable
                        onChange={(value) => setDraft((current) => ({ ...current, content: value }))}
                        basicSetup={{ lineNumbers: true, foldGutter: true }}
                        theme="dark"
                      />
                      <label className="grid gap-1 text-sm text-zinc-300">
                        Edit reason
                        <Input
                          placeholder="Why are you changing this document?"
                          value={draft.editReason}
                          onChange={(event) => setDraft((current) => ({ ...current, editReason: event.target.value }))}
                        />
                      </label>
                      <div className="text-xs text-zinc-500">
                        {dirty ? "Unsaved changes" : "No changes"} · {draft.content.length.toLocaleString()} chars
                      </div>
                    </div>
                  ) : (
                    <CodeMirror
                      value={detailQuery.data.content}
                      height="420px"
                      extensions={[markdown()]}
                      editable={false}
                      basicSetup={{ lineNumbers: true, foldGutter: true }}
                      theme="dark"
                    />
                  )}
                </div>
              ) : (
                <p className="text-sm text-zinc-400">Pick a document from the explorer to load full content.</p>
              )}
            </CardContent>
          </Card>

          <div className="grid gap-4 xl:grid-cols-2">
            <Card>
              <CardHeader><div className="flex items-center gap-2 font-medium"><GitCompare className="h-4 w-4" /> Revisions & diff</div></CardHeader>
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
                      <span className="font-medium">Rev {revision.revision_number}</span>
                      <Badge>{revision.status}</Badge>
                    </div>
                    {revision.edit_reason ? <div className="mt-1 text-zinc-300">{revision.edit_reason}</div> : null}
                    <div className="mt-1 flex items-center gap-2 text-xs text-zinc-500">
                      <span>{revision.created_by ?? "unknown"}</span>
                      <span>·</span>
                      <span>{formatDate(revision.created_at)}</span>
                    </div>
                  </button>
                ))}
                {diffQuery.data ? (
                  <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-sm text-zinc-300">
                    <div className="font-medium text-zinc-100">Revision {diffQuery.data.revision.revision_number} → Current</div>
                    {diffQuery.data.revision.edit_reason ? <div className="mt-1 text-xs text-zinc-400">Reason: {diffQuery.data.revision.edit_reason}</div> : null}
                    {diffQuery.data.revision.created_by ? <div className="text-xs text-zinc-500">By {diffQuery.data.revision.created_by}</div> : null}
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <span>+{diffQuery.data.diff.added_lines} lines</span>
                      <span>-{diffQuery.data.diff.removed_lines} lines</span>
                      <span>{diffQuery.data.diff.char_delta} chars</span>
                      <span>{diffQuery.data.diff.changed ? "changed" : "unchanged"}</span>
                    </div>
                    <div className="mt-3 max-h-80 overflow-auto rounded-md border border-zinc-800 font-mono text-xs">
                      {lineDiffRows.map((row, index) => (
                        <div
                          key={`${row.kind}-${index}-${row.oldLineNumber ?? "n"}-${row.newLineNumber ?? "n"}`}
                          className={`grid grid-cols-[3rem_3rem_1fr] gap-2 px-2 py-0.5 ${
                            row.kind === "added" ? "bg-emerald-500/10 text-emerald-100" : row.kind === "removed" ? "bg-red-500/10 text-red-100" : "text-zinc-400"
                          }`}
                        >
                          <span className="text-right text-zinc-600">{row.oldLineNumber ?? ""}</span>
                          <span className="text-right text-zinc-600">{row.newLineNumber ?? ""}</span>
                          <span><span className="mr-2 text-zinc-500">{row.kind === "added" ? "+" : row.kind === "removed" ? "-" : " "}</span>{row.text || " "}</span>
                        </div>
                      ))}
                      {lineDiffRows.length === 0 ? <div className="p-3 text-zinc-500">No line-level changes.</div> : null}
                    </div>
                    {lineDiffRows.length >= 200 ? <p className="mt-2 text-xs text-zinc-500">Showing first 200 diff rows.</p> : null}
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
