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

const inactiveRetainDirective: MemoryBankDirective = {
  id: "dir-2",
  bank_id: "openbrain",
  name: "Retain source guard",
  rule_text: "Keep retained experiences scoped to source boundaries.",
  applies_to: ["retain", "custom_target"],
  severity: "required",
  active: false,
  priority: 5,
  revision: 1,
  created_at: "2026-01-03T00:00:00Z",
  updated_at: "2026-01-04T00:00:00Z",
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

  it("lists all directives for the selected bank and labels lifecycle and application targets", async () => {
    listMock.mockResolvedValue({ count: 2, directives: [reflectDirective, inactiveRetainDirective] });

    renderPanel();

    const reflectRow = (await screen.findByText("Reflect source guard")).closest("article");
    const retainRow = (await screen.findByText("Retain source guard")).closest("article");
    expect(reflectRow).toBeTruthy();
    expect(retainRow).toBeTruthy();
    expect(listMock).toHaveBeenCalledWith({ bank_id: "openbrain", limit: 50 });
    expect(screen.getByText("Active reflect directives are injected into POST /reflect on the next reflection.")).toBeTruthy();
    expect(within(reflectRow as HTMLElement).getByText("Active")).toBeTruthy();
    expect(within(reflectRow as HTMLElement).getByText("Affects /reflect")).toBeTruthy();
    expect(within(reflectRow as HTMLElement).getByText("POST /reflect")).toBeTruthy();
    expect(within(retainRow as HTMLElement).getByText("Inactive")).toBeTruthy();
    expect(within(retainRow as HTMLElement).queryByText("Affects /reflect")).toBeNull();
    expect(within(retainRow as HTMLElement).getByText("POST /experiences / retain guard")).toBeTruthy();
    expect(within(retainRow as HTMLElement).getByText("custom_target")).toBeTruthy();
    expect(screen.getByText("Keep retained experiences scoped to source boundaries.")).toBeTruthy();
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

    expect(await screen.findByText("No directives found for openbrain."));
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

  it("edits existing directives and requires inline confirmation before deactivation", async () => {
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
    expect(deleteMock).not.toHaveBeenCalled();
    expect(within(row as HTMLElement).getByText("Deactivate this directive?")).toBeTruthy();

    await user.click(within(row as HTMLElement).getByRole("button", { name: /cancel deactivation for reflect source guard/i }));
    expect(deleteMock).not.toHaveBeenCalled();
    expect(within(row as HTMLElement).queryByText("Deactivate this directive?")).toBeNull();

    await user.click(within(row as HTMLElement).getByRole("button", { name: /deactivate reflect source guard/i }));
    await user.click(within(row as HTMLElement).getByRole("button", { name: /confirm deactivation for reflect source guard/i }));
    await waitFor(() => expect(deleteMock).toHaveBeenCalledWith("dir-1"));
  });

  it("reactivates inactive directives", async () => {
    const user = userEvent.setup();
    listMock.mockResolvedValue({ count: 1, directives: [inactiveRetainDirective] });
    updateMock.mockResolvedValue({ ...inactiveRetainDirective, active: true });

    renderPanel();

    const row = (await screen.findByText("Retain source guard")).closest("article");
    expect(row).toBeTruthy();
    expect(within(row as HTMLElement).getByText("Inactive")).toBeTruthy();
    await user.click(within(row as HTMLElement).getByRole("button", { name: /reactivate retain source guard/i }));

    await waitFor(() => expect(updateMock).toHaveBeenCalledWith("dir-2", { active: true }));
  });

  it("uses the selected bank for listing and creating directives", async () => {
    const user = userEvent.setup();
    listMock.mockResolvedValue({ count: 0, directives: [] });
    renderPanel();

    expect(await screen.findByText("No directives found for openbrain."));
    expect(listMock).toHaveBeenCalledWith({ bank_id: "openbrain", limit: 50 });

    const bankInput = screen.getByLabelText(/memory bank/i);
    await user.clear(bankInput);
    await user.type(bankInput, " research ");
    await user.click(screen.getByRole("button", { name: /load bank/i }));

    await waitFor(() => expect(listMock).toHaveBeenCalledWith({ bank_id: "research", limit: 50 }));
    expect(await screen.findByText("No directives found for research."));

    await user.click(screen.getByRole("button", { name: /new directive/i }));
    await user.type(screen.getByLabelText(/name/i), "Retain policy");
    await user.type(screen.getByLabelText(/rule text/i), "Keep retain path scoped.");
    await user.type(screen.getByLabelText(/applies to/i), "retain");
    await user.click(screen.getByRole("button", { name: /create directive/i }));

    await waitFor(() =>
      expect(createMock).toHaveBeenCalledWith({
        bank_id: "research",
        name: "Retain policy",
        rule_text: "Keep retain path scoped.",
        applies_to: ["retain"],
        severity: "required",
        active: true,
        priority: 0,
      })
    );
  });

  it("orders higher priority directives first, then name ascending", async () => {
    const alphaPriorityDirective: MemoryBankDirective = {
      ...reflectDirective,
      id: "dir-alpha",
      name: "Alpha directive",
      priority: 20,
    };
    const betaPriorityDirective: MemoryBankDirective = {
      ...reflectDirective,
      id: "dir-beta",
      name: "Beta directive",
      priority: 20,
    };
    const lowPriorityDirective: MemoryBankDirective = {
      ...reflectDirective,
      id: "dir-low",
      name: "Low priority directive",
      priority: 1,
    };
    listMock.mockResolvedValue({ count: 3, directives: [lowPriorityDirective, betaPriorityDirective, alphaPriorityDirective] });

    renderPanel();

    const alphaPriorityName = await screen.findByText("Alpha directive");
    const betaPriorityName = screen.getByText("Beta directive");
    const lowPriorityName = screen.getByText("Low priority directive");
    expect(alphaPriorityName.compareDocumentPosition(betaPriorityName)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(betaPriorityName.compareDocumentPosition(lowPriorityName)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it("surfaces API errors in the panel", async () => {
    listMock.mockRejectedValue(new Error("401 Unauthorized: missing admin key"));

    renderPanel();

    expect(await screen.findByText(/401 Unauthorized: missing admin key/)).toBeTruthy();
  });
});
