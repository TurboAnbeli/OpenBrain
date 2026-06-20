// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ReflectPlaygroundPanel } from "./ReflectPlaygroundPanel";
import { reflect, type ReflectResponse } from "./api";

vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return {
    ...actual,
    reflect: vi.fn(),
  };
});

const sourcefulResponse: ReflectResponse = {
  query: "How should directives affect reflection?",
  bank_id: "openbrain",
  evidence_count: 3,
  model_used: "gemma4:31b:cloud",
  answer: "Use active reflect directives as binding policy while citing source evidence.",
  reflect_telemetry: {
    model: "gemma4:31b:cloud",
    bank_id: "openbrain",
    embedding_ms: 11,
    search_ms: 22,
    llm_ms: 333,
    total_ms: 366,
    mental_model_count: 1,
    observation_count: 1,
    raw_fact_count: 1,
    stale_mental_models: ["model-old"],
  },
  mental_models: [
    {
      id: "model-1",
      name: "Directive runtime model",
      content: "Active reflect directives are injected at reflection time.",
      similarity: 0.91,
      stale: false,
    },
  ],
  observations: [
    {
      id: "obs-1",
      content: "Directive admin UI edits policy rows before reflect runs.",
      proof_count: 2,
      trend: "stable",
      similarity: 0.82,
    },
  ],
  raw_facts: [
    {
      id: "thought-1",
      content: "The operator can test directive effects through POST /reflect.",
      type: "observation",
      topics: ["reflect"],
      similarity: 0.77,
    },
  ],
  memory_bank: {
    id: "openbrain",
    name: "OpenBrain",
    mission: "Canonical memory bank",
    disposition: {},
    directives: [
      { id: "dir-1", name: "Reflect source guard", severity: "required", priority: 10 },
    ],
  },
};

const omittedSourcesResponse: ReflectResponse = {
  query: "What changed?",
  bank_id: "openbrain",
  evidence_count: 0,
  model_used: "gemma4:31b:cloud",
  answer: null,
  reflect_telemetry: {
    model: "gemma4:31b:cloud",
    bank_id: "openbrain",
    mental_model_count: 0,
    observation_count: 0,
    raw_fact_count: 0,
    stale_mental_models: [],
  },
};

function renderPanel() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  const view = render(
    <QueryClientProvider client={queryClient}>
      <ReflectPlaygroundPanel />
    </QueryClientProvider>
  );

  return { ...view, queryClient };
}

describe("ReflectPlaygroundPanel", () => {
  const reflectMock = vi.mocked(reflect);

  beforeEach(() => {
    reflectMock.mockResolvedValue(sourcefulResponse);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("submits a default openbrain reflect request and renders answer, telemetry, directives, and sources", async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.type(screen.getByLabelText(/reflection query/i), "How should directives affect reflection?");
    await user.click(screen.getByRole("button", { name: /^reflect$/i }));

    await waitFor(() =>
      expect(reflectMock).toHaveBeenCalledWith(
        expect.objectContaining({
          query: "How should directives affect reflection?",
          bank_id: "openbrain",
          include_sources: true,
        })
      )
    );

    expect(await screen.findByText("Use active reflect directives as binding policy while citing source evidence.")).toBeTruthy();
    expect(screen.getByText("Model: gemma4:31b:cloud")).toBeTruthy();
    expect(screen.getByText("Evidence: 3")).toBeTruthy();
    expect(screen.getByText("Total: 366ms")).toBeTruthy();
    expect(screen.getByText("Stale mental models: model-old")).toBeTruthy();

    const directives = screen.getByText("Active directives").closest("section");
    expect(directives).toBeTruthy();
    expect(within(directives as HTMLElement).getByText("Reflect source guard")).toBeTruthy();
    expect(within(directives as HTMLElement).getByText("required · priority 10")).toBeTruthy();

    expect(screen.getByText("Directive runtime model")).toBeTruthy();
    expect(screen.getByText("Directive admin UI edits policy rows before reflect runs.")).toBeTruthy();
    expect(screen.getByText("The operator can test directive effects through POST /reflect.")).toBeTruthy();
  });

  it("supports include_sources=false and handles a null answer without source sections", async () => {
    const user = userEvent.setup();
    reflectMock.mockResolvedValue(omittedSourcesResponse);
    renderPanel();

    await user.type(screen.getByLabelText(/reflection query/i), "What changed?");
    await user.click(screen.getByLabelText(/include source details/i));
    await user.click(screen.getByRole("button", { name: /^reflect$/i }));

    await waitFor(() =>
      expect(reflectMock).toHaveBeenCalledWith(
        expect.objectContaining({
          query: "What changed?",
          bank_id: "openbrain",
          include_sources: false,
        })
      )
    );

    expect(await screen.findByText("No synthesized answer returned. Check model availability, quality gates, or source coverage.")).toBeTruthy();
    expect(screen.getByText("Sources omitted for this reflection.")).toBeTruthy();
    expect(screen.queryByText("Active directives")).toBeNull();
  });

  it("omits blank numeric controls so backend defaults apply", async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.type(screen.getByLabelText(/reflection query/i), "Use backend defaults");
    await user.clear(screen.getByLabelText(/top k/i));
    await user.clear(screen.getByLabelText(/threshold/i));
    await user.click(screen.getByRole("button", { name: /^reflect$/i }));

    await waitFor(() => expect(reflectMock).toHaveBeenCalled());
    const payload = reflectMock.mock.calls[0]?.[0];
    expect(payload).toMatchObject({ query: "Use backend defaults", bank_id: "openbrain", include_sources: true });
    expect(payload).not.toHaveProperty("top_k");
    expect(payload).not.toHaveProperty("threshold");
  });

  it("passes a trimmed model hint only when supplied", async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.type(screen.getByLabelText(/reflection query/i), "Use a specific model");
    await user.type(screen.getByLabelText(/model hint/i), "  custom-model:7b  ");
    await user.click(screen.getByRole("button", { name: /^reflect$/i }));

    await waitFor(() =>
      expect(reflectMock).toHaveBeenCalledWith(
        expect.objectContaining({
          query: "Use a specific model",
          model_hint: "custom-model:7b",
        })
      )
    );
  });
});
