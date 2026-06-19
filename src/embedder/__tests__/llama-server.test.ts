import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LlamaServerEmbedder } from "../llama-server.js";

const ORIGINAL_ENV = { ...process.env };

describe("LlamaServerEmbedder metadata extraction", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    process.env = { ...ORIGINAL_ENV };
    delete process.env.LLAMA_SERVER_LLM_MODEL;
    delete process.env.LLAMA_SERVER_LLM_ENDPOINT;
    delete process.env.OLLAMA_ENDPOINT;
    process.env.OLLAMA_LLM_MODEL = "llama3.2";
    process.env.OPENBRAIN_LLM_CONSOLIDATION_ENDPOINT = "http://ollama.local:11434";
    process.env.OPENBRAIN_LLM_CONSOLIDATION_MODEL = "gemma4:31b:cloud";
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("uses OpenBrain consolidation LLM env as the default metadata fallback", async () => {
    let requestedUrl: Parameters<typeof fetch>[0] | undefined;
    let requestedInit: Parameters<typeof fetch>[1] | undefined;
    const fetchMock = vi.fn(async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      requestedUrl = input;
      requestedInit = init;
      return new Response(JSON.stringify({
        message: {
          content: JSON.stringify({ type: "observation", topics: ["one-brain"], people: [], action_items: [], dates: [] }),
        },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);

    const embedder = new LlamaServerEmbedder();
    const metadata = await embedder.extractMetadata("OpenBrain should consolidate durable observations.");

    expect(metadata.topics).toEqual(["one-brain"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(requestedUrl).toBe("http://ollama.local:11434/api/chat");
    expect(requestedInit).toBeDefined();
    const body = JSON.parse(String(requestedInit?.body));
    expect(body.model).toBe("gemma4:31b:cloud");
  });

  it("parses metadata JSON wrapped in a Markdown code fence", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      message: {
        content: "```json\n{\"type\":\"decision\",\"topics\":[\"one-brain\"],\"people\":[],\"action_items\":[],\"dates\":[]}\n```",
      },
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const embedder = new LlamaServerEmbedder();
    const metadata = await embedder.extractMetadata("OpenBrain uses PostgreSQL as canonical memory.");

    expect(metadata).toMatchObject({ type: "decision", topics: ["one-brain"] });
    expect(console.warn).not.toHaveBeenCalled();
  });
});
