import { describe, it, expect } from "vitest";
import {
  extractEntities,
  extractQueryEntities,
} from "../entity_extraction.js";

describe("extractEntities", () => {
  it("extracts people from metadata", () => {
    const result = extractEntities("Alice said something", {
      people: ["Alice", "Bob"],
    });
    expect(result).toContainEqual(
      expect.objectContaining({ name: "Alice", type: "person" })
    );
    expect(result).toContainEqual(
      expect.objectContaining({ name: "Bob", type: "person" })
    );
  });

  it("extracts topics from metadata", () => {
    const result = extractEntities("About machine learning", {
      topics: ["machine learning", "neural networks"],
    });
    expect(result).toContainEqual(
      expect.objectContaining({ name: "machine learning", type: "concept" })
    );
  });

  it("extracts multi-word proper nouns from content", () => {
    const result = extractEntities(
      "OpenClaw CLI is a tool created by Anthropic AI Research",
      {}
    );
    const names = result.map((e) => e.name);
    expect(names).toContain("OpenClaw CLI");
    expect(names).toContain("Anthropic AI Research");
  });

  it("extracts single-word product names with digits", () => {
    const result = extractEntities(
      "I am using GPT4o and Hermes Agent for this task",
      {}
    );
    const names = result.map((e) => e.name);
    expect(names).toContain("GPT4o");
    expect(names).toContain("Hermes");
    expect(names).toContain("Agent");
  });

  it("ignores sentence starters and common words", () => {
    const result = extractEntities(
      "The quick brown fox jumps over the lazy dog. I think OpenAI is great.",
      {}
    );
    const names = result.map((e) => e.name);
    expect(names).not.toContain("The");
    expect(names).not.toContain("Fox"); // single capitalised word aft…
    expect(names).not.toContain("I");
    expect(names).toContain("OpenAI");
  });

  it("deduplicates case-insensitively", () => {
    const result = extractEntities(
      "OpenAI is great. openAI is also great.",
      { topics: ["OpenAI"] }
    );
    const openAiEntries = result.filter(
      (e) => e.name.toLowerCase() === "openai"
    );
    expect(openAiEntries).toHaveLength(1);
  });

  it("skips empty or too-short names", () => {
    const result = extractEntities("", { people: ["", "A"] });
    expect(result).toHaveLength(0);
  });
});

describe("extractQueryEntities", () => {
  it("extracts multi-word proper nouns from queries", () => {
    const result = extractQueryEntities("What is OpenClaw CLI used for?");
    expect(result).toContain("OpenClaw CLI");
  });

  it("extracts single-word proper nouns", () => {
    const result = extractQueryEntities("Tell me about Hermes");
    expect(result).toContain("Hermes");
  });

  it("does not extract common words", () => {
    const result = extractQueryEntities("What is the time?");
    expect(result).not.toContain("What");
    expect(result).not.toContain("The");
  });

  it("returns empty array for queries with no proper nouns", () => {
    const result = extractQueryEntities("what is the meaning of life");
    expect(result).toHaveLength(0);
  });
});
