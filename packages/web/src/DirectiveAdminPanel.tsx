import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  createMemoryBankDirective,
  deleteMemoryBankDirective,
  listMemoryBankDirectives,
  updateMemoryBankDirective,
  type MemoryBankDirective,
} from "./api";
import {
  buildDirectivePayload,
  buildDirectiveUpdatePayload,
  createDirectiveDraft,
  createEmptyDirectiveDraft,
  DIRECTIVE_BANK_ID,
  directiveAffectsReflect,
  isDirectiveDraftDirty,
  validateDirectiveDraft,
  type DirectiveDraft,
} from "./directiveEditorState";
import { Badge } from "./components/ui/badge";
import { Button } from "./components/ui/button";
import { Card, CardContent, CardHeader } from "./components/ui/card";
import { Input } from "./components/ui/input";

const DIRECTIVE_FILTERS = { bank_id: DIRECTIVE_BANK_ID, active: true, limit: 50 } as const;
const DIRECTIVE_QUERY_KEY = ["memory-bank-directives", DIRECTIVE_FILTERS] as const;

function errorMessage(error: unknown): string {
  if (!error) return "";
  return error instanceof Error ? error.message : String(error);
}

function DirectiveForm({
  draft,
  mode,
  selectedDirective,
  errors,
  isPending,
  onCancel,
  onChange,
  onSubmit,
}: {
  draft: DirectiveDraft;
  mode: "create" | "edit";
  selectedDirective: MemoryBankDirective | null;
  errors: string[];
  isPending: boolean;
  onCancel: () => void;
  onChange: (draft: DirectiveDraft) => void;
  onSubmit: () => void;
}) {
  const dirty = mode === "create" || !selectedDirective ? true : isDirectiveDraftDirty(selectedDirective, draft);

  return (
    <div className="rounded-lg border border-violet-500/30 bg-violet-500/10 p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h3 className="font-medium text-zinc-100">{mode === "create" ? "New directive" : `Edit ${selectedDirective?.name ?? "directive"}`}</h3>
          <p className="mt-1 text-xs text-zinc-400">Directives are stored in the existing openbrain memory-bank directives API.</p>
        </div>
        <Button onClick={onCancel} disabled={isPending} className="px-2 py-1 text-xs">
          Cancel
        </Button>
      </div>

      {errors.length > 0 ? (
        <div role="alert" className="mb-3 rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-200">
          <div className="font-medium">Fix directive form errors:</div>
          <ul className="mt-1 list-disc space-y-1 pl-5">
            {errors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="grid gap-3">
        <label className="grid gap-1 text-sm text-zinc-300" htmlFor="directive-name">
          Name
        </label>
        <Input
          id="directive-name"
          value={draft.name}
          onChange={(event) => onChange({ ...draft, name: event.target.value })}
          placeholder="source_boundary"
        />

        <label className="grid gap-1 text-sm text-zinc-300" htmlFor="directive-rule-text">
          Rule text
        </label>
        <textarea
          id="directive-rule-text"
          value={draft.ruleText}
          onChange={(event) => onChange({ ...draft, ruleText: event.target.value })}
          placeholder="State the policy the reflection engine should follow."
          rows={4}
          className="rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none ring-violet-500/40 placeholder:text-zinc-500 focus:border-violet-500 focus:ring-2"
        />

        <label className="grid gap-1 text-sm text-zinc-300" htmlFor="directive-applies-to">
          Applies to
        </label>
        <Input
          id="directive-applies-to"
          value={draft.appliesTo}
          onChange={(event) => onChange({ ...draft, appliesTo: event.target.value })}
          placeholder="reflect, capture"
        />
        <p className="-mt-2 text-xs text-zinc-500">Comma or newline separated targets. Include reflect to affect POST /reflect.</p>

        <div className="grid gap-3 sm:grid-cols-[1fr_10rem]">
          <label className="grid gap-1 text-sm text-zinc-300" htmlFor="directive-severity">
            Severity
            <Input
              id="directive-severity"
              value={draft.severity}
              onChange={(event) => onChange({ ...draft, severity: event.target.value })}
              placeholder="required"
            />
          </label>
          <label className="grid gap-1 text-sm text-zinc-300" htmlFor="directive-priority">
            Priority
            <Input
              id="directive-priority"
              inputMode="numeric"
              value={draft.priority}
              onChange={(event) => onChange({ ...draft, priority: event.target.value })}
              placeholder="0"
            />
          </label>
        </div>

        <label className="inline-flex items-center gap-2 text-sm text-zinc-300">
          <input
            type="checkbox"
            checked={draft.active}
            onChange={(event) => onChange({ ...draft, active: event.target.checked })}
            className="h-4 w-4 rounded border-zinc-700 bg-zinc-950 accent-violet-500"
          />
          Active
        </label>

        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={onSubmit} disabled={isPending || !dirty}>
            {isPending ? "Saving…" : mode === "create" ? "Create directive" : "Save directive"}
          </Button>
          {!dirty ? <span className="text-xs text-zinc-500">No changes</span> : null}
        </div>
      </div>
    </div>
  );
}

export function DirectiveAdminPanel() {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<"idle" | "create" | "edit">("idle");
  const [selectedDirective, setSelectedDirective] = useState<MemoryBankDirective | null>(null);
  const [draft, setDraft] = useState<DirectiveDraft>(() => createEmptyDirectiveDraft());
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const directivesQuery = useQuery({
    queryKey: DIRECTIVE_QUERY_KEY,
    queryFn: () => listMemoryBankDirectives(DIRECTIVE_FILTERS),
  });

  const invalidateDirectives = () => queryClient.invalidateQueries({ queryKey: DIRECTIVE_QUERY_KEY });

  const createMutation = useMutation({
    mutationFn: (payload: ReturnType<typeof buildDirectivePayload>) => createMemoryBankDirective(payload),
    onSuccess: async () => {
      setMode("idle");
      setDraft(createEmptyDirectiveDraft());
      setValidationErrors([]);
      setSuccessMessage("Directive created.");
      await invalidateDirectives();
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, draft }: { id: string; draft: DirectiveDraft }) => updateMemoryBankDirective(id, buildDirectiveUpdatePayload(draft)),
    onSuccess: async () => {
      setMode("idle");
      setSelectedDirective(null);
      setValidationErrors([]);
      setSuccessMessage("Directive saved.");
      await invalidateDirectives();
    },
  });

  const deactivateMutation = useMutation({
    mutationFn: (id: string) => deleteMemoryBankDirective(id),
    onSuccess: async () => {
      setSuccessMessage("Directive deactivated.");
      await invalidateDirectives();
    },
  });

  const mutationError = createMutation.error ?? updateMutation.error ?? deactivateMutation.error;
  const pending = createMutation.isPending || updateMutation.isPending;
  const directives = directivesQuery.data?.directives ?? [];
  const sortedDirectives = useMemo(() => [...directives].sort((left, right) => right.priority - left.priority || left.name.localeCompare(right.name)), [directives]);

  function startCreate() {
    setMode("create");
    setSelectedDirective(null);
    setDraft(createEmptyDirectiveDraft());
    setValidationErrors([]);
    setSuccessMessage(null);
    createMutation.reset();
    updateMutation.reset();
  }

  function startEdit(directive: MemoryBankDirective) {
    setMode("edit");
    setSelectedDirective(directive);
    setDraft(createDirectiveDraft(directive));
    setValidationErrors([]);
    setSuccessMessage(null);
    createMutation.reset();
    updateMutation.reset();
  }

  function cancelForm() {
    setMode("idle");
    setSelectedDirective(null);
    setDraft(createEmptyDirectiveDraft());
    setValidationErrors([]);
  }

  function submitForm() {
    const errors = validateDirectiveDraft(draft);
    if (errors.length > 0) {
      setValidationErrors(errors);
      return;
    }

    setValidationErrors([]);
    setSuccessMessage(null);
    if (mode === "create") {
      createMutation.mutate(buildDirectivePayload(draft));
      return;
    }

    if (mode === "edit" && selectedDirective) {
      updateMutation.mutate({ id: selectedDirective.id, draft });
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <div className="text-sm uppercase tracking-[0.2em] text-violet-300">Directive Admin</div>
            <h2 className="mt-1 text-2xl font-semibold">Memory-bank directives</h2>
            <p className="mt-1 text-sm text-zinc-400">Active reflect directives are injected into POST /reflect on the next reflection.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void directivesQuery.refetch()} disabled={directivesQuery.isFetching}>
              {directivesQuery.isFetching ? "Refreshing…" : "Refresh directives"}
            </Button>
            <Button onClick={startCreate}>New directive</Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {directivesQuery.isLoading ? <p className="text-sm text-zinc-400">Loading directives…</p> : null}
        {directivesQuery.isError ? <p role="alert" className="text-sm text-red-300">Directive API error: {errorMessage(directivesQuery.error)}</p> : null}
        {mutationError ? <p role="alert" className="text-sm text-red-300">Directive API error: {errorMessage(mutationError)}</p> : null}
        {successMessage ? <p className="text-sm text-emerald-300">{successMessage}</p> : null}

        {mode !== "idle" ? (
          <DirectiveForm
            draft={draft}
            mode={mode}
            selectedDirective={selectedDirective}
            errors={validationErrors}
            isPending={pending}
            onCancel={cancelForm}
            onChange={setDraft}
            onSubmit={submitForm}
          />
        ) : null}

        <div className="grid gap-3">
          {sortedDirectives.length === 0 && !directivesQuery.isLoading && !directivesQuery.isError ? (
            <p className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3 text-sm text-zinc-400">No active directives found.</p>
          ) : null}

          {sortedDirectives.map((directive) => (
            <article key={directive.id} className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-medium text-zinc-100">{directive.name}</h3>
                    <Badge>{directive.severity}</Badge>
                    {directiveAffectsReflect(directive) ? <Badge className="border-emerald-500/40 bg-emerald-500/10 text-emerald-200">Affects /reflect</Badge> : null}
                  </div>
                  <p className="mt-2 whitespace-pre-wrap text-sm text-zinc-300">{directive.rule_text}</p>
                  <div className="mt-2 flex flex-wrap gap-2 text-xs text-zinc-500">
                    <span>applies_to: {directive.applies_to.join(", ") || "—"}</span>
                    <span>• priority {directive.priority}</span>
                    <span>• rev {directive.revision}</span>
                  </div>
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  <Button aria-label={`Edit ${directive.name}`} onClick={() => startEdit(directive)}>
                    Edit
                  </Button>
                  <Button
                    aria-label={`Deactivate ${directive.name}`}
                    onClick={() => deactivateMutation.mutate(directive.id)}
                    disabled={deactivateMutation.isPending}
                    className="border-red-500/40 text-red-200 hover:border-red-400 hover:bg-red-500/10"
                  >
                    Deactivate
                  </Button>
                </div>
              </div>
            </article>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
