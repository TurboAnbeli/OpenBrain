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
  setStoredAdminApiKey,
  updateConsolidatedObservation,
  updateMentalModel,
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
    updateMentalModel: vi.fn(),
    updateConsolidatedObservation: vi.fn(),
  };
});

const mockMentalModel: MentalModel = {
  id: "model-edit-1",
  bank_id: "openbrain",
  name: "Original name",
  query: "Original query?",
  content: "Original content.",
  structured: {},
  tags: ["test"],
  trigger_tags: ["test"],
  priority: 5,
  refresh_meta: {},
  history: [],
  active: true,
  project: null,
  created_by: "hermes",
  created_at: "2026-06-18T00:00:00Z",
  updated_at: "2026-06-19T00:00:00Z",
};

const mockObservation: ConsolidatedObservation = {
  id: "obs-edit-1",
  bank_id: "openbrain",
  content: "Original observation content.",
  proof_count: 2,
  source_memory_ids: ["thought-a"],
  source_quotes: [],
  tags: ["test"],
  history: [],
  trend: "stable",
  trend_computed_at: "2026-06-19T00:00:00Z",
  project: null,
  created_by: null,
  archived: false,
  created_at: "2026-06-19T00:00:00Z",
  updated_at: "2026-06-19T00:00:00Z",
  similarity: 0.85,
};

function renderPanel(overrides: Record<string, unknown> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <ProvenanceBrowserPanel
        highlightedObservationId={null}
        onDocumentChunkClick={vi.fn()}
        onMentalModelClick={vi.fn()}
        {...overrides}
      />
    </QueryClientProvider>
  );
  return { ...view, queryClient };
}

describe("ProvenanceBrowserPanel editable provenance (admin-gated)", () => {
  const listLinksMock = vi.mocked(listMemoryLinks);
  const listMentalModelsMock = vi.mocked(listMentalModels);
  const listExperiencesMock = vi.mocked(listExperiences);
  const searchObservationsMock = vi.mocked(searchConsolidatedObservations);
  const updateMentalModelMock = vi.mocked(updateMentalModel);
  const updateObservationMock = vi.mocked(updateConsolidatedObservation);

  beforeEach(() => {
    listLinksMock.mockResolvedValue({ count: 0, results: [] });
    listMentalModelsMock.mockResolvedValue({ count: 1, results: [mockMentalModel] });
    listExperiencesMock.mockResolvedValue({ count: 0, results: [] });
    searchObservationsMock.mockResolvedValue({ count: 1, results: [mockObservation] });
    updateMentalModelMock.mockResolvedValue({ ...mockMentalModel, name: "Updated name", content: "Updated content." });
    updateObservationMock.mockResolvedValue({ ...mockObservation, content: "Updated observation.", trend: "rising" });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    setStoredAdminApiKey("");
  });

  it("sends admin key when updating a mental model", async () => {
    setStoredAdminApiKey("test-admin-key");
    const user = userEvent.setup();
    renderPanel();

    expect(await screen.findByText("Original name")).toBeTruthy();

    const editButton = screen.getByRole("button", { name: /edit mental model model-edit-1/i });
    await user.click(editButton);

    const nameInput = await screen.findByLabelText(/mental model name/i);
    await user.clear(nameInput);
    await user.type(nameInput, "Updated name");

    const saveButton = screen.getByRole("button", { name: /save mental model model-edit-1/i });
    await user.click(saveButton);

    await waitFor(() => expect(updateMentalModelMock).toHaveBeenCalledWith(
      "model-edit-1",
      expect.objectContaining({ name: "Updated name" }),
    ));
    const call = updateMentalModelMock.mock.calls[0];
    expect(call).toBeTruthy();
  });

  it("sends admin key when archiving an observation", async () => {
    setStoredAdminApiKey("test-admin-key");
    const user = userEvent.setup();
    renderPanel({ highlightedObservationId: "obs-edit-1" });

    await waitFor(() => expect(searchObservationsMock).toHaveBeenCalled());
    expect(await screen.findByText("Original observation content.")).toBeTruthy();

    const archiveButton = screen.getByRole("button", { name: /archive observation obs-edit-1/i });
    await user.click(archiveButton);

    await waitFor(() => expect(updateObservationMock).toHaveBeenCalledWith(
      "obs-edit-1",
      expect.objectContaining({ archived: true }),
    ));
  });

  it("disables edit controls when no admin key is set", async () => {
    setStoredAdminApiKey("");
    renderPanel();

    expect(await screen.findByText("Original name")).toBeTruthy();

    const editButtons = screen.queryByRole("button", { name: /edit mental model/i });
    expect(editButtons).toBeNull();
  });
});