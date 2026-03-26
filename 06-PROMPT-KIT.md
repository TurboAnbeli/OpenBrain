# Open Brain - Prompt Kit

> Prompting guide, five core prompts, and daily workflow for the full lifecycle.

---

## Overview

The Open Brain prompt kit covers the complete lifecycle of your personal knowledge system:

| # | Prompt | Purpose | MCP Required? |
|---|---|---|---|
| 1 | Memory Migration | Pull AI platform memories into Open Brain | Yes |
| 2 | Second Brain Migration | Import from Notion, Obsidian, etc. | Yes |
| 3 | Open Brain Spark | Personalized use case discovery | No |
| 4 | Quick Capture Templates | Optimized daily capture patterns | Yes |
| 5 | The Weekly Review | Synthesize the past 7 days | Yes |

All prompts work with any MCP-connected AI: Claude, ChatGPT, Gemini, Grok.

---

## What's Automatic vs What You Control

When you capture a thought, Open Brain **automatically** extracts:
- **type** — decision, task, idea, observation, person_note, meeting, architecture, pattern, postmortem, requirement, bug, convention, reference
- **topics** — 1-3 tags derived from the content
- **people** — proper names mentioned in the text
- **action_items** — implied tasks extracted from the content
- **dates** — dates mentioned, normalized to YYYY-MM-DD
- **embedding** — 768-dim vector for semantic search

These are all extracted by the LLM at capture time. You don't need to specify them — just write naturally and the metadata is generated.

**Optional parameters you control** (the AI won't use these unless you ask for them):

| Parameter | What It Does | When To Use |
|-----------|-------------|-------------|
| `project` | Scopes the thought to a project/workspace | When working on multiple projects and want isolation |
| `created_by` | Tags who captured the thought | When 2-3 developers share an Open Brain instance |
| `source` | Tracks where the thought came from | When you want to know which tool/session captured it |
| `supersedes` | Links to a prior thought this one replaces | When a decision changed and you want to archivally link them |

For **search and list**, these optional filters are available:

| Parameter | What It Does | When To Use |
|-----------|-------------|-------------|
| `project` | Only search within a specific project | Avoid cross-project noise |
| `created_by` | Only show thoughts from a specific person | Filter to your contributions on a shared instance |
| `type` | Only return a specific thought type | "Show me only decisions" |
| `topic` | Only return thoughts with a specific topic tag | "Show me only thoughts about caching" |
| `include_archived` | Include archived thoughts | When looking for older/superseded content |

---

## How To Prompt Your AI To Use Optional Features

The AI will call `capture_thought` with only `content` unless you explicitly mention the optional parameters. Here's how to trigger them:

### Project Scoping

Without project — thought is unscoped (searchable from all projects):
```
Remember this: We chose Redis for session caching.
```

With project — add the project name naturally:
```
For the "ecommerce-api" project, remember this: We chose Redis for session caching.
```

Or be explicit:
```
Capture this thought for project "ecommerce-api": We chose Redis for session caching.
```

### User Attribution (created_by)

Without user — no attribution (fine for solo use):
```
Remember: The batch endpoint needs rate limiting.
```

With user — mention who you are:
```
Capture this as sarah: The batch endpoint needs rate limiting before public beta.
```

Or in a system prompt / custom instructions (set once, applies to all captures):
```
When using Open Brain tools, always set created_by to "sarah".
```

### Source Tracking

Without source — defaults to `"mcp"`:
```
Save this decision about the API layer.
```

With source — mention the context:
```
Save this from our architecture review: Hono is 3x faster than Express for cold starts.
Set the source to "architecture-review-2026-03".
```

### Superseding a Decision

When a prior decision changed:
```
We switched from Redis to Memcached for session caching. This supersedes thought
a1b2c3d4-1234-5678-9abc-def012345678.
```

### Filtered Search

Default search — searches everything:
```
Search my brain for caching decisions.
```

Scoped search — adds filters:
```
Search my brain for caching decisions in the "ecommerce-api" project,
only show architecture type thoughts.
```

User-scoped search:
```
Search my brain for decisions made by sarah in the "ecommerce-api" project.
```

### Filtered Stats

```
Show me brain stats for the "ecommerce-api" project.
```

```
Show me brain stats for thoughts by sarah.
```

---

## Setting Defaults With System Prompts

If you always work on the same project or want `created_by` set automatically, add a system prompt or custom instruction to your AI client. This avoids repeating yourself in every message.

### Claude Code / VS Code Copilot

Add to your workspace `.github/copilot-instructions.md`:

```markdown
When using Open Brain (capture_thought, search_thoughts, etc.):
- Always set project to "my-project"
- Always set created_by to "sarah"
- When capturing, set source to "copilot"
```

### Claude Desktop

Add to your project system prompt:

```
I use Open Brain for persistent memory. When capturing thoughts:
- Set project to "my-project"
- Set created_by to "sarah"
When searching, default to project "my-project" unless I specify otherwise.
```

### ChatGPT Custom Instructions

Add to your ChatGPT custom instructions:

```
I have Open Brain connected via MCP. When you use capture_thought:
- Always set project to "my-project"
- Always set created_by to "sarah"
When I say "remember this" or "save this", use capture_thought.
When I say "search my brain" or "what do I know about", use search_thoughts.
```

---

## Prompt 1: Memory Migration

**When to use**: Once per AI platform — pull out what each AI already knows about you.

**Purpose**: Your AI tools have accumulated context about you over months of conversations. This prompt extracts that knowledge and stores it in Open Brain so it's accessible from every tool.

### How It Works

1. Open a conversation with your AI tool (MCP must be connected)
2. Paste the Memory Migration prompt
3. The AI will:
   - Reflect on what it knows about you (preferences, projects, relationships, decisions)
   - Organize that knowledge into atomic thoughts
   - Use `capture_thought` to save each one to Open Brain
4. Review what was captured

### Prompt Template

```
You have accumulated knowledge about me across our conversations. I want to
migrate that knowledge into my Open Brain system using the capture_thought tool.

Please do the following:

1. Review everything you know about me — my preferences, projects, decisions,
   key relationships, recurring topics, communication style, and workflow patterns.

2. Organize this into individual, atomic thoughts. Each thought should be
   self-contained and independently retrievable. Use this format:
   - Preferences: "Preference: [what]. Context: [why/when]."
   - Decisions: "Decision: [what was decided]. Context: [why]."
   - People: "[Name] — [relationship, key details, communication preferences]."
   - Projects: "Project: [name]. Status: [current state]. Key details: [summary]."
   - Patterns: "Pattern: [observed behavior/preference]. Evidence: [examples]."

3. Use the capture_thought tool to save EACH thought individually. Do not batch
   them into a single capture.

4. After capturing all thoughts, give me a summary of what was migrated
   (count by type, key topics covered).

Take your time and be thorough. I'd rather capture too much than miss something
important.
```

### Platform-Specific Notes

| Platform | Notes |
|---|---|
| Claude | Has strong conversational memory within projects; migration captures project context |
| ChatGPT | Has explicit "Memories" feature; migration pulls both explicit memories and implicit knowledge |
| Gemini | Less structured memory; focus on extracting key interactions |

**ChatGPT Export Alternative:**
1. Settings → Data Controls → Export Data
2. Download and unzip the export
3. Process the JSON files with AI, pushing relevant insights to Open Brain
4. Warning: Large exports require significant processing effort

---

## Prompt 2: Second Brain Migration

**When to use**: Once — bring your existing notes system into Open Brain.

**Purpose**: Transform notes from Notion, Obsidian, Apple Notes, or any other system into searchable, embedded thoughts.

### Prompt Template

```
I want to migrate my existing notes into Open Brain. I'll provide my notes
(from [Obsidian/Notion/Apple Notes/text files]) and I need you to:

1. Read through each note carefully.
2. Break long notes into atomic thoughts (one concept per thought).
3. For each thought, use the capture_thought tool to save it.
4. Preserve the essential meaning — don't paraphrase away important details.
5. Skip trivial or outdated content that won't be useful for future retrieval.

Guidelines:
- One thought = one retrievable idea
- Keep the original voice where possible
- Tag the source in your capture (e.g., "From Obsidian vault: ...")
- For long documents, chunk into meaningful sections
- Prioritize: decisions > insights > action items > observations > references

Here are my notes to migrate:
[PASTE NOTES HERE]
```

### Supported Formats

| Source | How to Provide | Tips |
|---|---|---|
| Obsidian | Copy/paste individual notes or share vault directory | Process by folder for context |
| Notion | Export as Markdown, share page by page | Use "Export All" for bulk |
| Apple Notes | Copy/paste content | Manual but straightforward |
| Google Keep | Google Takeout → parse HTML | Automate with script |
| Text files | Copy/paste or share directory | Direct and simple |
| Evernote | Export as HTML or ENEX | Convert to text first |

---

## Prompt 3: Open Brain Spark

**When to use**: After initial setup — discover how Open Brain fits your specific workflow.

**Purpose**: A guided interview that generates personalized use cases based on your actual daily work.

### Prompt Template

```
I've set up Open Brain (a personal knowledge system with semantic search).
Help me discover the best ways to use it for MY specific workflow.

Interview me about:

1. **Daily tools**: What software and platforms do I use throughout my day?
2. **Repeated decisions**: What choices do I make over and over that could
   benefit from documented precedent?
3. **Re-explained information**: What do I find myself explaining to people
   repeatedly?
4. **Forgotten details**: What kinds of things do I frequently forget or
   have to look up again?
5. **Key relationships**: Who are the important people in my work/life, and
   what context do I need to remember about them?
6. **Information flow**: Where does valuable information come to me, and
   where does it get lost?

After the interview, generate:
- 5-10 specific, actionable use cases tailored to my workflow
- Suggested capture templates for each use case
- A recommended daily rhythm for capturing thoughts
- Quick wins I can start with today

Ask me these questions one at a time and adapt based on my answers.
```

---

## Prompt 4: Quick Capture Templates

**When to use**: Daily — structured patterns that produce clean, well-classified thoughts.

### The Five Templates

#### Template 1: Decision Capture
```
Decision: [what was decided].
Context: [why this decision was made].
Owner: [who made/owns the decision].
```

**Example:**
```
Decision: Using PostgreSQL with pgvector instead of Pinecone.
Context: Self-hosted, lower cost, simpler stack, and we already use Supabase.
Owner: Mike.
```

**Auto-extracts**: type=decision, topics from context, people from Owner

---

#### Template 2: Person Note
```
[Full Name] — [relevant details, relationship, preferences, key context].
```

**Example:**
```
Sarah Chen — VP of Engineering at Acme Corp. Prefers async communication
over meetings. Key contact for the API partnership. Reports to David Wu.
```

**Auto-extracts**: type=person_note, people=[Sarah Chen, David Wu], topics from context

---

#### Template 3: Insight Capture
```
Insight: [the realization or learning].
Triggered by: [what caused this insight].
```

**Example:**
```
Insight: Our onboarding flow has 40% drop-off at step 3 because the form
asks for payment info before showing value.
Triggered by: Reviewing the analytics dashboard with the growth team.
```

**Auto-extracts**: type=idea, topics=[onboarding, analytics, growth]

---

#### Template 4: Meeting Debrief
```
Meeting with [who] about [topic].
Key points: [bullet items].
Action items: [next steps with owners and dates].
```

**Example:**
```
Meeting with Sarah and Mike about Q2 roadmap.
Key points: Prioritize mobile app, delay admin portal to Q3, hire 2 more engineers.
Action items: Sarah drafts mobile spec by March 14. Mike posts job listings by Monday.
```

**Auto-extracts**: type=meeting, people=[Sarah, Mike], topics=[roadmap, mobile, hiring], action_items, dates

---

#### Template 5: The AI Save
```
Saving from [tool/source]: [key takeaway or output to preserve].
```

**Example:**
```
Saving from Claude: The best approach for vector search pagination in pgvector
is keyset-based pagination using the similarity score as cursor, not OFFSET-based
pagination which requires re-computing all distances.
```

**Auto-extracts**: type=reference, topics=[vector-search, pagination, pgvector]

---

## Prompt 5: The Weekly Review

**When to use**: Friday afternoon or Sunday evening — synthesize the past week.

**Purpose**: Surfaces themes, unresolved action items, forgotten follow-ups, and emerging priorities from your captured thoughts.

### Prompt Template

```
Run my weekly review using Open Brain. Do the following:

1. Use list_thoughts with days=7 to get all thoughts from the past week.
2. Use thought_stats to see the current state of my brain.
3. Analyze the past week's captures and create a synthesis:

   **Activity Summary**
   - Total thoughts captured this week
   - Breakdown by type (decisions, tasks, insights, etc.)
   - Top topics and people mentioned

   **Key Themes**
   - What patterns emerge from this week's thoughts?
   - What topics keep appearing?
   - Are there connections between different thoughts I might have missed?

   **Open Loops**
   - List all unresolved action items
   - Flag any overdue items (mentioned dates that have passed)
   - Identify tasks that were mentioned but never followed up on

   **Insights & Patterns**
   - What decisions were made and their implications?
   - What new relationships or connections emerged?
   - What am I spending the most mental energy on?

   **Priorities for Next Week**
   - Based on open loops and patterns, what should I focus on?
   - What needs follow-up?
   - What can I let go of?

4. After the synthesis, ask me if any insights from this review should be
   captured as new thoughts (using capture_thought).

Be thorough but concise. Flag anything urgent.
```

---

## Daily Rhythm Framework

### Recommended Schedule

| Time | Activity | Template |
|---|---|---|
| Morning | Review yesterday's action items | `list_thoughts(type="task", days=1)` |
| During work | Capture decisions and insights as they happen | Decision / Insight templates |
| After meetings | Debrief key meetings | Meeting Debrief template |
| End of day | Save any valuable AI outputs | AI Save template |
| Friday/Sunday | Run Weekly Review | Weekly Review prompt |

### Building the Habit

1. **Week 1**: Focus on capturing 2-3 thoughts per day using any template
2. **Week 2**: Start using the Meeting Debrief template after every key meeting
3. **Week 3**: Run your first Weekly Review
4. **Week 4**: Optimize based on what's working — adjust templates and rhythm
5. **Ongoing**: The system compounds — more data = better AI assistance over time
