import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { broadcastWsEvent, registerWsClient, wsEvent } from "../ws-broadcaster.js";

describe("WebSocket broadcaster logging", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("broadcasts silently by default and logs only when debug is enabled", () => {
    const send = vi.fn();
    const unregister = registerWsClient({ send, readyState: 1, close: vi.fn() });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => undefined);

    broadcastWsEvent(wsEvent("document_updated", "doc-1"));

    expect(send).toHaveBeenCalledTimes(1);
    expect(logSpy).not.toHaveBeenCalled();
    expect(debugSpy).not.toHaveBeenCalled();

    vi.stubEnv("OPENBRAIN_WS_DEBUG", "true");
    broadcastWsEvent(wsEvent("document_updated", "doc-1"));

    expect(send).toHaveBeenCalledTimes(2);
    expect(debugSpy).toHaveBeenCalledWith(expect.stringContaining("Broadcast document_updated"));
    unregister();
  });
});
