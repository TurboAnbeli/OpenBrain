// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ProvenanceBrowserPanel } from "./ProvenanceBrowserPanel";
import {
  expandMemoryLinks,
  listExperiences,
  listMemoryLinks,
  listMentalModels,
  searchConsolidatedObservations,
  type ConsolidatedObservation,
  type Experience,
  type MemoryLink,
  type MemoryLinkExpansionResult,
  type MentalModel,
} from "./api";

vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return {
    ...actual,
    listMemoryLinks: vi.fn(),
    expandMemoryLinks: vi.fn(),
    listExperiences: vi.fn(),
    listMentalModels: vi.fn(),
    searchConsolidatedObservations: vi.fn(),
  };
});

const memoryLink: MemoryLink = {
  id: "link-1",
  bank_id: "openbrain",
  source_type: "thought",
  source_id: "thought-1",
  target_type: "consolidated_observation",
  target_id: "obs-1",
  relationship: "evidence_for",
  weight: 1,
  inferred: true,
  created_at: "2026-06-19T12:00:00Z",
};

const experience: Experience = {
  id: "exp-1",
  bank_id: "openbrain",
  session_id: "session-1",
  agent_id: "openbrain-system",
  occurred_at: "2026-06-19T12:10:00Z",
  event_type: "decide",
  content: "Consolidation completed and linked explicit evidence.",
  refs: { observation_id: "obs-1", evidence_link_ids: ["link-1"] },
  project: "one-brain",
  created_by: "openbrain-system",
  created_at: "2026-06-19T12:10:00Z",
};

const mentalModel: MentalModel = {
  id: "model-1",
  bank_id: "openbrain",
  name: "Privacy and evidence constraints",
  query: "What constraints govern memory synthesis?",
  content: "Preserve privacy and evidence boundaries.",
  structured: {},
  tags: ["privacy"],
  trigger_tags: ["privacy"],
  priority: 10,
  refresh_meta: { next_refresh_after: "2099-01-01T00:00:00Z" },
  history: [],
  active: true,
  project: "one-brain",
  created_by: "hermes",
  created_at: "2026-06-18T00:00:00Z",
  updated_at: "2026-06-19T00:00:00Z",
};

const observation: ConsolidatedObservation = {
  id: "obs-1",
  bank_id: "openbrain",
  content: "Synthesized observation with explicit source memory evidence.",
  proof_count: 2,
  source_memory_ids: ["thought-1", "thought-2"],
  source_quotes: [
    { source_id: "thought-1", quote: "explicit source quote", source_type: "thought" },
  ],
  tags: ["evidence"],
  history: [],
  trend: "stable",
  trend_computed_at: "2026-06-19T12:11:00Z",
  project: "one-brain",
  created_by: "openbrain-system",
  archived: false,
  created_at: "2026-06-19T12:11:00Z",
  updated_at: "2026-06-19T12:11:00Z",
  similarity: 0.82,
};

const expansion: MemoryLinkExpansionResult = {
  link: memoryLink,
  seed: { source_type: "thought", source_id: "thought-1" },
  direction: "outgoing",
  linked_memory: {
    source_type: "consolidated_observation",
    id: "obs-1",
    content: "Linked observation content from one-hop expansion.",
    title: null,
    metadata: { proof_count: 2, trend: "stable" },
    project: "one-brain",
    created_at: "2026-06-19T12:11:00Z",
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
      <ProvenanceBrowserPanel />
    </QueryClientProvider>
  );

  return { ...view, queryClient };
}

describe("ProvenanceBrowserPanel", () => {
  const listLinksMock = vi.mocked(listMemoryLinks);
  const expandLinksMock = vi.mocked(expandMemoryLinks);
  const listExperiencesMock = vi.mocked(listExperiences);
  const listMentalModelsMock = vi.mocked(listMentalModels);
  const searchObservationsMock = vi.mocked(searchConsolidatedObservations);

  beforeEach(() => {
    listLinksMock.mockResolvedValue({ count: 1, results: [memoryLink] });
    expandLinksMock.mockResolvedValue({ count: 1, results: [expansion] });
    listExperiencesMock.mockResolvedValue({ count: 1, results: [experience] });
    listMentalModelsMock.mockResolvedValue({ count: 1, results: [mentalModel] });
    searchObservationsMock.mockResolvedValue({ count: 1, results: [observation] });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("lists read-only graph surfaces and expands a selected memory link", async () => {
    const user = userEvent.setup();
    renderPanel();

    expect(await screen.findByText("Memory graph / provenance browser")).toBeTruthy();
    await waitFor(() => expect(listLinksMock).toHaveBeenCalledWith({ bank_id: "openbrain", limit: 10 }));
    expect(listExperiencesMock).toHaveBeenCalledWith({ bank_id: "openbrain", limit: 5 });
    expect(listMentalModelsMock).toHaveBeenCalledWith({ bank_id: "openbrain", limit: 5 });

    expect(screen.getByText("1 memory link")).toBeTruthy();
    expect(screen.getByText("1 experience")).toBeTruthy();
    expect(screen.getByText("1 mental model")).toBeTruthy();
    expect(screen.getByText("thought → consolidated_observation")).toBeTruthy();
    expect(screen.getByText("evidence_for")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /create/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /infer/i })).toBeNull();

    await user.click(screen.getByRole("button", { name: /inspect link link-1/i }));

    await waitFor(() =>
      expect(expandLinksMock).toHaveBeenCalledWith({
        bank_id: "openbrain",
        seeds: [{ source_type: "thought", source_id: "thought-1" }],
        direction: "both",
        limit: 5,
      })
    );
    expect(await screen.findByText("Linked observation content from one-hop expansion.")).toBeTruthy();
    expect(screen.getByText("outgoing · evidence_for")).toBeTruthy();
  });

  it("searches consolidated observations and renders proof/source-quote provenance", async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.type(await screen.findByLabelText(/evidence search query/i), "evidence boundaries");
    await user.click(screen.getByRole("button", { name: /search observations/i }));

    await waitFor(() =>
      expect(searchObservationsMock).toHaveBeenCalledWith({
        query: "evidence boundaries",
        bank_id: "openbrain",
        limit: 5,
        threshold: 0.1,
      })
    );

    const observationCard = (await screen.findByText("Synthesized observation with explicit source memory evidence.")).closest("article");
    expect(observationCard).toBeTruthy();
    expect(within(observationCard as HTMLElement).getByText("stable")).toBeTruthy();
    expect(within(observationCard as HTMLElement).getByText("2 proofs")).toBeTruthy();
    expect(within(observationCard as HTMLElement).getByText("Sources: thought-1, thought-2")).toBeTruthy();
    expect(within(observationCard as HTMLElement).getByText("explicit source quote")).toBeTruthy();
  });
});
