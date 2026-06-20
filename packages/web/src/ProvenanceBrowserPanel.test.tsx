// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

const mockLink: MemoryLink = {
  id: "link-doc-1",
  bank_id: "openbrain",
  source_type: "document",
  source_id: "doc-abc",
  target_type: "consolidated_observation",
  target_id: "obs-1",
  relationship: "evidence_for",
  weight: 1,
  inferred: false,
  created_at: "2026-06-19T12:00:00Z",
};

const mockMentalModel: MentalModel = {
  id: "model-1",
  bank_id: "openbrain",
  name: "Privacy constraints",
  query: "What constraints govern memory synthesis?",
  content: "Preserve privacy and evidence boundaries.",
  structured: {},
  tags: ["privacy"],
  trigger_tags: ["privacy"],
  priority: 10,
  refresh_meta: { next_refresh_after: "2099-01-01T00:00:00Z" },
  history: [],
  active: true,
  project: null,
  created_by: "hermes",
  created_at: "2026-06-18T00:00:00Z",
  updated_at: "2026-06-19T00:00:00Z",
};

const mockExpansion: MemoryLinkExpansionResult = {
  link: mockLink,
  seed: { source_type: "document", source_id: "doc-abc" },
  direction: "outgoing",
  linked_memory: {
    source_type: "consolidated_observation",
    id: "obs-1",
    content: "Linked observation content.",
    title: null,
    metadata: { proof_count: 2, trend: "stable" },
    project: null,
    created_at: "2026-06-19T12:11:00Z",
  },
};

const mockObservation: ConsolidatedObservation = {
  id: "obs-highlight-1",
  bank_id: "openbrain",
  content: "Highlighted observation from reflect click.",
  proof_count: 3,
  source_memory_ids: ["thought-a", "thought-b"],
  source_quotes: [{ source_id: "thought-a", quote: "source quote text", source_type: "thought" }],
  tags: ["privacy"],
  history: [],
  trend: "stable",
  trend_computed_at: "2026-06-19T12:11:00Z",
  project: null,
  created_by: null,
  archived: false,
  created_at: "2026-06-19T12:11:00Z",
  updated_at: "2026-06-19T12:11:00Z",
  similarity: 0.91,
};

function renderPanel(overrides: { highlightedObservationId?: string | null; onDocumentChunkClick?: (id: string) => void; onMentalModelClick?: (id: string, query: string) => void } = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const onDocumentChunkClick = overrides.onDocumentChunkClick ?? vi.fn();
  const onMentalModelClick = overrides.onMentalModelClick ?? vi.fn();
  const view = render(
    <QueryClientProvider client={queryClient}>
      <ProvenanceBrowserPanel
        highlightedObservationId={overrides.highlightedObservationId ?? null}
        onDocumentChunkClick={onDocumentChunkClick}
        onMentalModelClick={onMentalModelClick}
      />
    </QueryClientProvider>
  );
  return { ...view, queryClient, onDocumentChunkClick, onMentalModelClick };
}

describe("ProvenanceBrowserPanel cross-panel navigation", () => {
  const listLinksMock = vi.mocked(listMemoryLinks);
  const expandLinksMock = vi.mocked(expandMemoryLinks);
  const listExperiencesMock = vi.mocked(listExperiences);
  const listMentalModelsMock = vi.mocked(listMentalModels);
  const searchObservationsMock = vi.mocked(searchConsolidatedObservations);

  beforeEach(() => {
    listLinksMock.mockResolvedValue({ count: 1, results: [mockLink] });
    expandLinksMock.mockResolvedValue({ count: 1, results: [mockExpansion] });
    listExperiencesMock.mockResolvedValue({ count: 0, results: [] });
    listMentalModelsMock.mockResolvedValue({ count: 1, results: [mockMentalModel] });
    searchObservationsMock.mockResolvedValue({ count: 1, results: [mockObservation] });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("calls onDocumentChunkClick when a document-type memory link Inspect button is clicked", async () => {
    const user = userEvent.setup();
    const { onDocumentChunkClick } = renderPanel();

    

    const inspectButton = await screen.findByRole("button", { name: /inspect link link-doc-1/i });
    await user.click(inspectButton);

    await waitFor(() => expect(expandLinksMock).toHaveBeenCalled());
    expect(onDocumentChunkClick).toHaveBeenCalledWith("doc-abc");
  });

  it("calls onMentalModelClick when a mental model card in the provenance browser is clicked", async () => {
    const user = userEvent.setup();
    const { onMentalModelClick } = renderPanel();

    expect(await screen.findByText("Privacy constraints")).toBeTruthy();

    const modelCard = screen.getByText("Privacy constraints").closest("button") ?? screen.getByText("Privacy constraints");
    await user.click(modelCard);

    expect(onMentalModelClick).toHaveBeenCalledWith("model-1", "What constraints govern memory synthesis?");
  });

  it("auto-triggers observation search when highlightedObservationId is provided", async () => {
    renderPanel({ highlightedObservationId: "obs-highlight-1" });

    await waitFor(() => expect(searchObservationsMock).toHaveBeenCalledWith(
      expect.objectContaining({ query: "obs-highlight-1", bank_id: "openbrain" })
    ));
  });
});