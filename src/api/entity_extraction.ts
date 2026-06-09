/**
 * Entity extraction from thought content + metadata.
 *
 * Extracts typed entities (person, concept, org, product) that can be
 * stored in the entities table and linked to thoughts.  The extractor
 * is intentionally lightweight — no external LLM call — so it can run
 * at capture time without adding latency.
 *
 * Sources:
 *   1. metadata.people  →  type = "person"
 *   2. metadata.topics  →  type = "concept"
 *   3. Proper-noun regex over content  →  type = "unknown" (refinable later)
 *
 * The regex layer is conservative: it only emits multi-word capitalised
 * phrases or single capitalised words that are not common English words
 * and do not appear at sentence start.  This keeps the noise floor low
 * while catching product names ("OpenClaw"), model names ("kimi-k2.6"),
 * and org names ("Anthropic") that embeddings alone may not anchor.
 */

export interface ExtractedEntity {
  name: string;
  type: "person" | "concept" | "org" | "product" | "unknown";
  aliases?: string[];
}

// COMMON_WORDS: capitalised words that are almost never entities in this corpus.
const COMMON_WORDS = new Set([
  "The", "A", "An", "This", "That", "These", "Those", "It", "Its", "Is", "Are",
  "Was", "Were", "Be", "Been", "Being", "Have", "Has", "Had", "Do", "Does",
  "Did", "Will", "Would", "Could", "Should", "May", "Might", "Can", "Shall",
  "If", "Then", "Than", "When", "Where", "Why", "How", "What", "Which", "Who",
  "Whom", "Whose", "So", "Because", "Since", "As", "While", "During", "Before",
  "After", "Above", "Below", "Under", "Over", "Into", "Onto", "Upon", "Within",
  "Without", "Across", "Through", "Throughout", "Against", "Among", "Between",
  "Beyond", "Despite", "Except", "Inside", "Outside", "Until", "Toward", "Towards",
  "He", "She", "They", "We", "You", "I", "Me", "My", "Mine", "Your", "Yours",
  "His", "Her", "Hers", "Their", "Theirs", "Our", "Ours", "One", "Ones",
  "Not", "No", "Nor", "Only", "Just", "Also", "Even", "Still", "Yet", "Already",
  "Very", "Too", "Quite", "Rather", "Enough", "Almost", "Nearly", "Hardly",
  "Scarcely", "Barely", "Simply", "Completely", "Absolutely", "Definitely",
  "Probably", "Possibly", "Perhaps", "Maybe", "Certainly", "Surely", "Clearly",
  "Obviously", "Apparently", "Seemingly", "Presumably", "Supposedly",
  "However", "Therefore", "Thus", "Hence", "Consequently", "Accordingly",
  "Moreover", "Furthermore", "Besides", "Additionally", "Likewise", "Similarly",
  "Otherwise", "Instead", "Meanwhile", "Nevertheless", "Nonetheless",
  "Notwithstanding", "Regardless", "Anyway", "Anyhow", "Though", "Although",
  "Even", "Though", "Whereas", "While", "Unless", "Provided", "Providing",
  "Given", "Considering", "Regarding", "Respecting", "Concerning",
  "Every", "Each", "All", "Some", "Any", "Many", "Much", "More", "Most",
  "Several", "Few", "Little", "Less", "Least", "Another", "Other", "Others",
  "Such", "Same", "Different", "Various", "Certain", "Particular", "Specific",
  "General", "Universal", "Total", "Whole", "Entire", "Complete", "Full",
  "Here", "There", "Now", "Today", "Yesterday", "Tomorrow", "Soon", "Later",
  "Early", "Late", "Often", "Sometimes", "Usually", "Always", "Never",
  "Frequently", "Rarely", "Occasionally", "Regularly", "Constantly",
  "First", "Second", "Third", "Last", "Final", "Next", "Previous",
  "Following", "Preceding", "Subsequent", "Prior", "Former", "Latter",
  "New", "Old", "Young", "Good", "Bad", "Better", "Best", "Worse", "Worst",
  "Big", "Small", "Large", "Little", "High", "Low", "Long", "Short",
  "Great", "Major", "Minor", "Main", "Key", "Primary", "Secondary",
  "Important", "Significant", "Serious", "Critical", "Crucial",
  "Possible", "Impossible", "Available", "Necessary", "Essential",
  "Relevant", "Irrelevant", "Effective", "Ineffective", "Efficient",
  "Successful", "Unsuccessful", "Likely", "Unlikely", "Able", "Unable",
 "True", "False", "Right", "Wrong", "Correct", "Incorrect", "Exact",
  "Accurate", "Inaccurate", "Clear", "Unclear", "Obvious", "Evident",
  "Apparent", "Visible", "Invisible", "Known", "Unknown", "Familiar",
  "Unfamiliar", "Popular", "Unpopular", "Common", "Uncommon", "Rare",
  "Normal", "Abnormal", "Standard", "Nonstandard", "Regular", "Irregular",
  "Typical", "Atypical", "Usual", "Unusual", "Unique", "Special",
  "Particular", "Specific", "General", "Broad", "Narrow", "Wide",
  "Deep", "Shallow", "Strong", "Weak", "Powerful", "Feeble",
  "Hard", "Soft", "Solid", "Liquid", "Gas", "Wet", "Dry",
  "Hot", "Cold", "Warm", "Cool", "Fresh", "Stale", "Clean", "Dirty",
  "Safe", "Dangerous", "Risky", "Secure", "Insecure", "Stable",
  "Unstable", "Fixed", "Flexible", "Rigid", "Elastic", "Plastic",
  "Fast", "Slow", "Quick", "Rapid", "Swift", "Speedy", "Sluggish",
  "Easy", "Difficult", "Simple", "Complex", "Complicated", "Straightforward",
  "Direct", "Indirect", "Immediate", "Delayed", "Instant", "Gradual",
  "Sudden", "Unexpected", "Expected", "Surprising", "Astonishing",
  "Amazing", "Incredible", "Extraordinary", "Remarkable", "Outstanding",
  "Excellent", "Superb", "Wonderful", "Fantastic", "Great", "Fine",
  "Nice", "Lovely", "Beautiful", "Pretty", "Attractive", "Gorgeous",
  "Handsome", "Ugly", "Horrible", "Terrible", "Awful", "Dreadful",
  "Bad", "Poor", "Weak", "Strong", "Powerful", "Mighty", "Potent",
  "Effective", "Efficient", "Productive", "Fruitful", "Profitable",
  "Beneficial", "Advantageous", "Helpful", "Useful", "Valuable",
  "Worthwhile", "Meaningful", "Significant", "Important", "Major",
  "Minor", "Trivial", "Negligible", "Insignificant", "Unimportant",
  "Irrelevant", "Redundant", "Superfluous", "Excessive", "Adequate",
  "Sufficient", "Enough", "Plenty", "Abundant", "Scarce", "Sparse",
  "Dense", "Thick", "Thin", "Heavy", "Light", "Bright", "Dark",
  "Dim", "Dull", "Shiny", "Glossy", "Matte", "Smooth", "Rough",
  "Coarse", "Fine", "Sharp", "Blunt", "Pointed", "Flat", "Round",
  "Square", "Rectangular", "Triangular", "Circular", "Oval",
  "Straight", "Curved", "Crooked", "Bent", "Twisted", "Coiled",
  "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight",
  "Nine", "Ten", "Hundred", "Thousand", "Million", "Billion",
  "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
  "Sunday", "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
]);

// Regexes -------------------------------------------------------------------

// Multi-word proper-noun phrases: "Kimi K2.6", "OpenClaw CLI", "Hermes Agent"
// Matches 2-4 consecutive capitalised words (possibly hyphenated or with version numbers).
const MULTI_WORD_RE = /\b[A-Z][a-zA-Z0-9]*(?:[-.][A-Z]?[a-zA-Z0-9]+)*(?:\s+[A-Z][a-zA-Z0-9]*(?:[-.][A-Z]?[a-zA-Z0-9]+)*){1,3}\b/g;

// Single-word proper nouns that look like product/brand names:
// Must contain at least one uppercase letter beyond position 0, OR be
// all-caps 3+ letter acronym, OR contain digits, OR be any 3+ letter
// capitalised word (filtered by COMMON_WORDS).
const SINGLE_WORD_RE = /\b[A-Z][a-zA-Z]*[A-Z][a-zA-Z]*\b|\b[A-Z]{3,}\b|\b[A-Z][a-zA-Z0-9]*[0-9][a-zA-Z0-9]*\b|\b[A-Z][a-zA-Z]{2,}\b/g;

// Sentence starters to exclude (first word after .!? followed by space)
const SENTENCE_START_RE = /(?:^|[.!?]\s+)([A-Z][a-zA-Z]*)/g;

function collectSentenceStarters(text: string): Set<string> {
  const starters = new Set<string>();
  for (const m of text.matchAll(SENTENCE_START_RE)) {
    starters.add(m[1]!);
  }
  return starters;
}

function normaliseName(name: string): string {
  // Trim trailing punctuation, collapse multiple spaces, title-case.
  return name
    .replace(/[.,;:!?]+$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function dedupeCaseInsensitive(entities: ExtractedEntity[]): ExtractedEntity[] {
  const seen = new Map<string, ExtractedEntity>();
  for (const e of entities) {
    const key = `${e.name.toLowerCase()}|${e.type}`;
    const existing = seen.get(key);
    if (existing && e.aliases) {
      existing.aliases = [...new Set([...(existing.aliases ?? []), ...e.aliases])];
    }
    if (!existing) {
      seen.set(key, { ...e });
    }
  }
  return [...seen.values()];
}

// Public API ----------------------------------------------------------------

export function extractEntities(
  content: string,
  metadata?: { people?: string[]; topics?: string[] }
): ExtractedEntity[] {
  const raw: ExtractedEntity[] = [];

  // 1. metadata.people → person entities
  if (metadata?.people) {
    for (const p of metadata.people) {
      const name = normaliseName(p);
      if (name.length >= 2) {
        raw.push({ name, type: "person" });
      }
    }
  }

  // 2. metadata.topics → concept entities
  if (metadata?.topics) {
    for (const t of metadata.topics) {
      const name = normaliseName(t);
      if (name.length >= 2) {
        raw.push({ name, type: "concept" });
      }
    }
  }

  // 3. Proper-noun regex over content
  const starters = collectSentenceStarters(content);

  // Multi-word phrases first
  for (const m of content.matchAll(MULTI_WORD_RE)) {
    const name = normaliseName(m[0]!);
    if (name.length >= 3 && !name.split(/\s+/).every((w) => COMMON_WORDS.has(w))) {
      raw.push({ name, type: "unknown" });
    }
  }

  // Single-word candidates
  for (const m of content.matchAll(SINGLE_WORD_RE)) {
    const word = m[0]!;
    if (COMMON_WORDS.has(word)) continue;
    if (starters.has(word)) continue;
    if (word.length < 3) continue;
    raw.push({ name: word, type: "unknown" });
  }

  return dedupeCaseInsensitive(raw);
}

/**
 * Extract candidate entity names from a free-text query.
 * Used at query time to find thoughts that mention the same entities.
 * Less conservative than thought-time extraction — we want recall, not precision,
 * because a false-positive entity in the query just means an extra SQL lookup
 * that returns nothing; it does not pollute the graph.
 */
export function extractQueryEntities(query: string): string[] {
  const names: string[] = [];
  const seen = new Set<string>();

  // Multi-word proper nouns
  for (const m of query.matchAll(MULTI_WORD_RE)) {
    const name = normaliseName(m[0]!);
    if (name.length >= 3 && !seen.has(name.toLowerCase())) {
      seen.add(name.toLowerCase());
      names.push(name);
    }
  }

  // Single words: same pattern but don't exclude sentence starters
  // because queries are rarely full sentences.
  for (const m of query.matchAll(SINGLE_WORD_RE)) {
    const word = m[0]!;
    if (COMMON_WORDS.has(word)) continue;
    if (word.length < 3) continue;
    if (!seen.has(word.toLowerCase())) {
      seen.add(word.toLowerCase());
      names.push(word);
    }
  }

  return names;
}
