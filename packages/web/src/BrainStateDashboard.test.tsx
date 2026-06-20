// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BrainStateDashboard } from "./BrainStateDashboard";
import {
  getEmbedderInfo,
  listDocuments,
  listExperiences,
  listMemoryLinks,
  listMentalModels,
  searchConsolidatedObservations,
} from "./api";

vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return {
    ...actual,
    listDocuments: vi.fn(),
    listMentalModels: vi.fn(),
    searchConsolidatedObservations: vi.fn(),
    listExperiences: vi.fn(),
    listMemoryLinks: vi.fn(),
    getEmbedderInfo: vi.fn(),
  };
});

function renderDashboard() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <BrainStateDashboard />
    </QueryClientProvider>
  );
}

describe("BrainStateDashboard", () => {
  const listDocsMock = vi.mocked(listDocuments);
  const listModelsMock = vi.mocked(listMentalModels);
  const searchObsMock = vi.mocked(searchConsolidatedObservations);
  const listExpsMock = vi.mocked(listExperiences);
  const listLinksMock = vi.mocked(listMemoryLinks);
  const embedderMock = vi.mocked(getEmbedderInfo);

  beforeEach(() => {
    listDocsMock.mockResolvedValue({ count: 42, limit: 1, offset: 0, documents: [] });
    listModelsMock.mockResolvedValue({ count: 7, results: [] });
    searchObsMock.mockResolvedValue({ count: 15, results: [] });
    listExpsMock.mockResolvedValue({ count: 23, results: [] });
    listLinksMock.mockResolvedValue({ count: 89, results: [] });
    embedderMock.mockResolvedValue({
      provider: "ollama",
      model: "EmbeddingGemma",
      dimension: 768,
      reindex_required: false,
      total_chunks: 156,
      chunks_with_known_version: 156,
      chunks_with_unknown_version: 0,
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders brain-state overview with counts, embedder info, and stale model flags", async () => {
    listModelsMock.mockResolvedValue({
      count: 7,
      results: [
        { id: "m1", bank_id: "openbrain", name: "Stale model", query: "q?", content: "c", structured: {}, tags: [], trigger_tags: [], priority: 1, refresh_meta: { next_refresh_after: "2020-01-01T00:00:00Z" }, history: [], active: true, project: null, created_by: null, created_at: null, updated_at: null, stale: true },
        { id: "m2", bank_id: "openbrain", name: "Fresh model", query: "q2?", content: "c2", structured: {}, tags: [], trigger_tags: [], priority: 2, refresh_meta: { next_refresh_after: "2099-01-01T00:00:00Z" }, history: [], active: true, project: null, created_by: null, created_at: null, updated_at: null, stale: false },
      ],
    });

    renderDashboard();

    await screen.findByText("Brain state overview");
    await waitFor(() => {
      expect(screen.getByTestId("count-documents").textContent).toBe("42");
      expect(screen.getByTestId("count-mental-models").textContent).toBe("7");
      expect(screen.getByTestId("count-observations").textContent).toBe("15");
      expect(screen.getByTestId("count-experiences").textContent).toBe("23");
      expect(screen.getByTestId("count-memory-links").textContent).toBe("89");
    });
    expect(screen.getByText("EmbeddingGemma")).toBeTruthy();
    expect(screen.getByText("768")).toBeTruthy();
    expect(screen.getByText("1 stale mental model")).toBeTruthy();
    expect(screen.getByTestId("reindex-ok")).toBeTruthy();
  });

  it("calls all count endpoints and embedder info on mount", async () => {
    renderDashboard();

    await waitFor(() => {
      expect(listDocsMock).toHaveBeenCalledWith(expect.objectContaining({ limit: 1 }));
      expect(listModelsMock).toHaveBeenCalledWith(expect.objectContaining({ bank_id: "openbrain", limit: 100, include_inactive: true }));
      expect(searchObsMock).toHaveBeenCalledWith(expect.objectContaining({ query: "*", bank_id: "openbrain", limit: 1 }));
      expect(listExpsMock).toHaveBeenCalledWith(expect.objectContaining({ limit: 1 }));
      expect(listLinksMock).toHaveBeenCalledWith(expect.objectContaining({ limit: 1 }));
      expect(embedderMock).toHaveBeenCalled();
    });
  });

  it("shows reindex required warning when embedder reports reindex_required", async () => {
    embedderMock.mockResolvedValue({
      provider: "ollama",
      model: "EmbeddingGemma",
      dimension: 768,
      reindex_required: true,
      total_chunks: 156,
      chunks_with_known_version: 100,
      chunks_with_unknown_version: 56,
    });

    renderDashboard();

    expect(await screen.findByTestId("reindex-warning")).toBeTruthy();
    expect(screen.getByText(/56 unknown/i)).toBeTruthy();
  });
});