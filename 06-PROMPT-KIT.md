# Open Brain - Prompt Kit

> Five core prompts for the full lifecycle: migration, discovery, daily capture, and weekly synthesis.

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
