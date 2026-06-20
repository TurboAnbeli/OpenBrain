// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ReflectPlaygroundPanel } from "./ReflectPlaygroundPanel";
import { reflect, type ReflectResponse } from "./api";

vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return { ...actual, reflect: vi.fn() };
});

const mockReflectResponse: ReflectResponse = {
  query: "privacy constraints",
  bank_id: "openbrain",
  evidence_count: 3,
  model_used: "gemma4:31b:cloud",
  answer: "Preserve privacy and evidence boundaries.",
  reflect_telemetry: {
    model: "gemma4:31b:cloud",
    bank_id: "openbrain",
    embedding_ms: 50,
    search_ms: 100,
    llm_ms: 200,
    total_ms: 350,
    mental_model_count: 1,
    observation_count: 1,
    raw_fact_count: 1,
    stale_mental_models: [],
  },
  mental_models: [
    { id: "model-1", name: "Privacy constraints", query: "What constraints govern memory?", content: "Preserve privacy.", similarity: 0.95 },
  ],
  observations: [
    { id: "obs-cross-1", content: "Cross-panel observation content.", proof_count: 2, trend: "stable", similarity: 0.88 },
  ],
  raw_facts: [
    { id: "fact-1", content: "Raw fact content.", type: "thought", similarity: 0.80 },
  ],
};

function renderPanel(overrides: { prefilledQuery?: string | null; onObservationClick?: (id: string) => void; onMentalModelClick?: (id: string, query: string) => void } = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const onObservationClick = overrides.onObservationClick ?? vi.fn();
  const onMentalModelClick = overrides.onMentalModelClick ?? vi.fn();
  const view = render(
    <QueryClientProvider client={queryClient}>
      <ReflectPlaygroundPanel
        prefilledQuery={overrides.prefilledQuery ?? null}
        onObservationClick={onObservationClick}
        onMentalModelClick={onMentalModelClick}
      />
    </QueryClientProvider>
  );
  return { ...view, queryClient, onObservationClick, onMentalModelClick };
}

describe("ReflectPlaygroundPanel cross-panel navigation", () => {
  const reflectMock = vi.mocked(reflect);

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("prefills query when prefilledQuery prop is provided", async () => {
    renderPanel({ prefilledQuery: "What constraints govern memory?" });
    const textarea = screen.getByLabelText(/reflection query/i) as HTMLTextAreaElement;
    expect(textarea.value).toBe("What constraints govern memory?");
  });

  it("calls onObservationClick when an observation source card is clicked", async () => {
    const user = userEvent.setup();
    reflectMock.mockResolvedValue(mockReflectResponse);
    const { onObservationClick } = renderPanel();

    await user.type(screen.getByLabelText(/reflection query/i), "privacy");
    await user.click(screen.getByRole("button", { name: /reflect/i }));

    expect(await screen.findByText("Cross-panel observation content.")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /inspect observation obs-cross-1/i }));
    expect(onObservationClick).toHaveBeenCalledWith("obs-cross-1");
  });

  it("calls onMentalModelClick when a mental model source card is clicked", async () => {
    const user = userEvent.setup();
    reflectMock.mockResolvedValue(mockReflectResponse);
    const { onMentalModelClick } = renderPanel();

    await user.type(screen.getByLabelText(/reflection query/i), "privacy");
    await user.click(screen.getByRole("button", { name: /reflect/i }));

    expect(await screen.findByText("Privacy constraints")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /inspect mental model model-1/i }));
    expect(onMentalModelClick).toHaveBeenCalledWith("model-1", "What constraints govern memory?");
  });
});