// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DirectiveAdminPanel } from "./DirectiveAdminPanel";
import {
  createMemoryBankDirective,
  deleteMemoryBankDirective,
  listMemoryBankDirectives,
  updateMemoryBankDirective,
  type MemoryBankDirective,
} from "./api";

vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return {
    ...actual,
    listMemoryBankDirectives: vi.fn(),
    createMemoryBankDirective: vi.fn(),
    updateMemoryBankDirective: vi.fn(),
    deleteMemoryBankDirective: vi.fn(),
  };
});

const reflectDirective: MemoryBankDirective = {
  id: "dir-1",
  bank_id: "openbrain",
  name: "Reflect source guard",
  rule_text: "Preserve explicit source boundaries.",
  applies_to: ["reflect", "capture"],
  severity: "required",
  active: true,
  priority: 10,
  revision: 2,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-02T00:00:00Z",
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
      <DirectiveAdminPanel />
    </QueryClientProvider>
  );

  return { ...view, queryClient };
}

describe("DirectiveAdminPanel", () => {
  const listMock = vi.mocked(listMemoryBankDirectives);
  const createMock = vi.mocked(createMemoryBankDirective);
  const updateMock = vi.mocked(updateMemoryBankDirective);
  const deleteMock = vi.mocked(deleteMemoryBankDirective);

  beforeEach(() => {
    listMock.mockResolvedValue({ count: 1, directives: [reflectDirective] });
    createMock.mockResolvedValue(reflectDirective);
    updateMock.mockResolvedValue(reflectDirective);
    deleteMock.mockResolvedValue({ ...reflectDirective, active: false });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("loads active openbrain directives and labels reflect impact", async () => {
    renderPanel();

    expect(await screen.findByText("Reflect source guard")).toBeTruthy();
    expect(listMock).toHaveBeenCalledWith({ bank_id: "openbrain", active: true, limit: 50 });
    expect(screen.getByText("Active reflect directives are injected into POST /reflect on the next reflection.")).toBeTruthy();
    expect(screen.getByText("Affects /reflect")).toBeTruthy();
    expect(screen.getByText("Preserve explicit source boundaries.")).toBeTruthy();
  });

  it("does not label non-lowercase reflect targets as affecting /reflect", async () => {
    listMock.mockResolvedValue({ count: 1, directives: [{ ...reflectDirective, applies_to: ["Reflect"] }] });

    renderPanel();

    expect(await screen.findByText("Reflect source guard")).toBeTruthy();
    expect(screen.queryByText("Affects /reflect")).toBeNull();
  });

  it("creates directives with normalized payloads", async () => {
    const user = userEvent.setup();
    listMock.mockResolvedValue({ count: 0, directives: [] });
    renderPanel();

    expect(await screen.findByText("No active directives found."));
    await user.click(screen.getByRole("button", { name: /new directive/i }));
    await user.type(screen.getByLabelText(/name/i), "  Reflect policy  ");
    await user.type(screen.getByLabelText(/rule text/i), "  Cite the source document.  ");
    await user.type(screen.getByLabelText(/applies to/i), "Reflect, reflect, Capture");
    await user.clear(screen.getByLabelText(/priority/i));
    await user.type(screen.getByLabelText(/priority/i), "3");
    await user.click(screen.getByRole("button", { name: /create directive/i }));

    await waitFor(() =>
      expect(createMock).toHaveBeenCalledWith({
        bank_id: "openbrain",
        name: "Reflect policy",
        rule_text: "Cite the source document.",
        applies_to: ["reflect", "capture"],
        severity: "required",
        active: true,
        priority: 3,
      })
    );
  });

  it("edits and deactivates existing directives", async () => {
    const user = userEvent.setup();
    renderPanel();

    const row = (await screen.findByText("Reflect source guard")).closest("article");
    expect(row).toBeTruthy();
    await user.click(within(row as HTMLElement).getByRole("button", { name: /edit reflect source guard/i }));
    const ruleField = screen.getByLabelText(/rule text/i);
    await user.clear(ruleField);
    await user.type(ruleField, "Updated reflect rule.");
    await user.click(screen.getByRole("button", { name: /save directive/i }));

    await waitFor(() =>
      expect(updateMock).toHaveBeenCalledWith(
        "dir-1",
        expect.objectContaining({
          name: "Reflect source guard",
          rule_text: "Updated reflect rule.",
          applies_to: ["reflect", "capture"],
          priority: 10,
          active: true,
        })
      )
    );

    await user.click(within(row as HTMLElement).getByRole("button", { name: /deactivate reflect source guard/i }));
    await waitFor(() => expect(deleteMock).toHaveBeenCalledWith("dir-1"));
  });

  it("orders higher priority directives first", async () => {
    const lowPriorityDirective: MemoryBankDirective = {
      ...reflectDirective,
      id: "dir-low",
      name: "Low priority directive",
      priority: 1,
    };
    const highPriorityDirective: MemoryBankDirective = {
      ...reflectDirective,
      id: "dir-high",
      name: "High priority directive",
      priority: 20,
    };
    listMock.mockResolvedValue({ count: 2, directives: [lowPriorityDirective, highPriorityDirective] });

    renderPanel();

    const lowPriorityName = await screen.findByText("Low priority directive");
    const highPriorityName = screen.getByText("High priority directive");
    expect(highPriorityName.compareDocumentPosition(lowPriorityName)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it("surfaces API errors in the panel", async () => {
    listMock.mockRejectedValue(new Error("401 Unauthorized: missing admin key"));

    renderPanel();

    expect(await screen.findByText(/401 Unauthorized: missing admin key/)).toBeTruthy();
  });
});
