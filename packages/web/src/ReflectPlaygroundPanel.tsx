import { useState, type FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { Brain, Clock3, MessageSquareText, Sparkles } from "lucide-react";

import { reflect, type ReflectObservation, type ReflectRawFact, type ReflectRequest, type ReflectResponse } from "./api";
import { Badge } from "./components/ui/badge";
import { Button } from "./components/ui/button";
import { Card, CardContent, CardHeader } from "./components/ui/card";
import { Input } from "./components/ui/input";

function formatMs(value?: number): string {
  return typeof value === "number" ? `${Math.round(value)}ms` : "—";
}

function formatSimilarity(value?: number): string | null {
  return typeof value === "number" ? `${Math.round(value * 100)}% match` : null;
}

function buildReflectPayload(values: {
  query: string;
  bankId: string;
  includeSources: boolean;
  modelHint: string;
  topK: string;
  threshold: string;
}): ReflectRequest {
  const payload: ReflectRequest = {
    query: values.query.trim(),
    bank_id: values.bankId.trim() || "openbrain",
    include_sources: values.includeSources,
  };
  const modelHint = values.modelHint.trim();
  if (modelHint) payload.model_hint = modelHint;

  const topKText = values.topK.trim();
  const topK = Number(topKText);
  if (topKText && Number.isInteger(topK) && topK >= 1 && topK <= 20) payload.top_k = topK;

  const thresholdText = values.threshold.trim();
  const threshold = Number(thresholdText);
  if (thresholdText && Number.isFinite(threshold) && threshold >= 0 && threshold <= 1) payload.threshold = threshold;

  return payload;
}

function SourceCard({ title, subtitle, content }: { title: string; subtitle?: string | null; content: string }) {
  return (
    <article className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="font-medium text-zinc-100">{title}</h4>
        {subtitle ? <Badge>{subtitle}</Badge> : null}
      </div>
      <p className="mt-2 whitespace-pre-wrap text-sm text-zinc-300">{content}</p>
    </article>
  );
}

function SourceSections({ result }: { result: ReflectResponse }) {
  const mentalModels = result.mental_models ?? [];
  const observations = result.observations ?? [];
  const rawFacts = result.raw_facts ?? [];
  const directives = result.memory_bank?.directives ?? [];
  const hasSources = mentalModels.length > 0 || observations.length > 0 || rawFacts.length > 0 || directives.length > 0;

  if (!hasSources) {
    return <p className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3 text-sm text-zinc-400">No source details returned.</p>;
  }

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      {directives.length > 0 ? (
        <section className="space-y-2">
          <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-violet-300">Active directives</h3>
          <div className="grid gap-2">
            {directives.map((directive) => (
              <SourceCard
                key={directive.id}
                title={directive.name}
                subtitle={`${directive.severity} · priority ${directive.priority}`}
                content={`Directive ID: ${directive.id}`}
              />
            ))}
          </div>
        </section>
      ) : null}

      {mentalModels.length > 0 ? (
        <section className="space-y-2">
          <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-blue-300">Mental models</h3>
          <div className="grid gap-2">
            {mentalModels.map((model) => (
              <SourceCard
                key={model.id}
                title={model.name ?? model.query ?? model.id}
                subtitle={model.stale ? "stale" : formatSimilarity(model.similarity)}
                content={model.content}
              />
            ))}
          </div>
        </section>
      ) : null}

      {observations.length > 0 ? (
        <section className="space-y-2">
          <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-emerald-300">Observations</h3>
          <div className="grid gap-2">
            {observations.map((observation: ReflectObservation) => (
              <SourceCard
                key={observation.id}
                title={observation.trend ? `Observation · ${observation.trend}` : "Observation"}
                subtitle={observation.proof_count !== undefined ? `${observation.proof_count} proofs` : formatSimilarity(observation.similarity)}
                content={observation.content}
              />
            ))}
          </div>
        </section>
      ) : null}

      {rawFacts.length > 0 ? (
        <section className="space-y-2">
          <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-amber-300">Raw facts</h3>
          <div className="grid gap-2">
            {rawFacts.map((fact: ReflectRawFact) => (
              <SourceCard
                key={fact.id}
                title={fact.type ? `Raw fact · ${fact.type}` : "Raw fact"}
                subtitle={fact.topics && fact.topics.length > 0 ? fact.topics.join(", ") : formatSimilarity(fact.similarity)}
                content={fact.content}
              />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

export function ReflectPlaygroundPanel() {
  const [query, setQuery] = useState("");
  const [bankId, setBankId] = useState("openbrain");
  const [modelHint, setModelHint] = useState("");
  const [topK, setTopK] = useState("3");
  const [threshold, setThreshold] = useState("0.3");
  const [includeSources, setIncludeSources] = useState(true);
  const [lastIncludedSources, setLastIncludedSources] = useState(true);
  const [validationError, setValidationError] = useState<string | null>(null);

  const reflectMutation = useMutation({ mutationFn: (payload: ReflectRequest) => reflect(payload) });
  const result = reflectMutation.data;
  const telemetry = result?.reflect_telemetry;
  const staleMentalModels = telemetry?.stale_mental_models ?? [];

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedQuery = query.trim();
    if (!trimmedQuery) {
      setValidationError("Reflection query is required.");
      return;
    }
    setValidationError(null);
    setLastIncludedSources(includeSources);
    reflectMutation.mutate(buildReflectPayload({ query, bankId, includeSources, modelHint, topK, threshold }));
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <div className="flex items-center gap-2 text-sm text-zinc-400"><Brain className="h-4 w-4" /> Runtime validation</div>
            <h2 className="mt-1 text-2xl font-semibold">Reflect playground</h2>
            <p className="mt-1 text-sm text-zinc-400">Test active memory-bank directives against POST /reflect before trusting new policy behavior.</p>
          </div>
          {result ? <Badge>{result.bank_id}</Badge> : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <form className="grid gap-3" onSubmit={handleSubmit}>
          <label className="grid gap-1 text-sm text-zinc-300" htmlFor="reflect-query">
            Reflection query
            <textarea
              id="reflect-query"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Ask OpenBrain to synthesize from mental models, observations, and raw facts…"
              className="min-h-24 rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none ring-violet-500/40 placeholder:text-zinc-500 focus:border-violet-500 focus:ring-2"
            />
          </label>

          <div className="grid gap-3 md:grid-cols-4">
            <label className="grid gap-1 text-sm text-zinc-300" htmlFor="reflect-bank-id">
              Memory bank
              <Input id="reflect-bank-id" value={bankId} onChange={(event) => setBankId(event.target.value)} placeholder="openbrain" />
            </label>
            <label className="grid gap-1 text-sm text-zinc-300" htmlFor="reflect-model-hint">
              Model hint
              <Input id="reflect-model-hint" value={modelHint} onChange={(event) => setModelHint(event.target.value)} placeholder="gemma4:31b:cloud" />
            </label>
            <label className="grid gap-1 text-sm text-zinc-300" htmlFor="reflect-top-k">
              Top K
              <Input id="reflect-top-k" type="number" min={1} max={20} value={topK} onChange={(event) => setTopK(event.target.value)} />
            </label>
            <label className="grid gap-1 text-sm text-zinc-300" htmlFor="reflect-threshold">
              Threshold
              <Input id="reflect-threshold" type="number" min={0} max={1} step="0.05" value={threshold} onChange={(event) => setThreshold(event.target.value)} />
            </label>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <label className="inline-flex items-center gap-2 text-sm text-zinc-300">
              <input
                type="checkbox"
                checked={includeSources}
                onChange={(event) => setIncludeSources(event.target.checked)}
                className="h-4 w-4 rounded border-zinc-700 bg-zinc-950 text-violet-500"
              />
              Include source details
            </label>
            <Button type="submit" disabled={!query.trim() || reflectMutation.isPending}>
              <Sparkles className="mr-2 h-4 w-4" /> {reflectMutation.isPending ? "Reflecting…" : "Reflect"}
            </Button>
          </div>
        </form>

        {validationError ? <p role="alert" className="text-sm text-red-300">{validationError}</p> : null}
        {reflectMutation.isError ? <p role="alert" className="text-sm text-red-300">Reflect failed: {String(reflectMutation.error)}</p> : null}

        {result ? (
          <div className="space-y-4">
            <section className="rounded-lg border border-violet-500/30 bg-violet-500/10 p-4">
              <div className="flex flex-wrap items-center gap-2 text-sm text-violet-100">
                <MessageSquareText className="h-4 w-4" />
                <span>Model: {result.model_used}</span>
                <span>Evidence: {result.evidence_count}</span>
                <span>Total: {formatMs(telemetry?.total_ms)}</span>
              </div>
              <p className="mt-3 whitespace-pre-wrap text-sm text-violet-50">
                {result.answer ?? "No synthesized answer returned. Check model availability, quality gates, or source coverage."}
              </p>
            </section>

            {telemetry ? (
              <div className="grid gap-2 rounded-lg border border-zinc-800 bg-zinc-950/60 p-3 text-sm text-zinc-300 md:grid-cols-4">
                <div><Clock3 className="mr-1 inline h-4 w-4" /> Embed: {formatMs(telemetry.embedding_ms)}</div>
                <div>Search: {formatMs(telemetry.search_ms)}</div>
                <div>LLM: {formatMs(telemetry.llm_ms)}</div>
                <div>Sources: {telemetry.mental_model_count} models · {telemetry.observation_count} observations · {telemetry.raw_fact_count} facts</div>
                {staleMentalModels.length > 0 ? (
                  <div className="text-amber-200 md:col-span-4">Stale mental models: {staleMentalModels.join(", ")}</div>
                ) : null}
              </div>
            ) : null}

            {lastIncludedSources ? <SourceSections result={result} /> : <p className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3 text-sm text-zinc-400">Sources omitted for this reflection.</p>}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
