import { getLLMProvider } from "../llm";
import { withStageLog } from "../observability/logger";

/**
 * Trend Scanner — the "Virality Skill" idea from the health/sport channel
 * discussion (2026-09-25): instead of only a static curated topic list
 * (seed-queue.ts), pull real signal on what's currently being covered in
 * health/fitness/sport news and turn it into researchable topic titles.
 *
 * Reddit (the obvious free source for "what's resonating") is unreachable
 * from this environment — DNS just doesn't resolve it, unlike every other
 * host tried. Google News RSS search is free, keyless, and reachable, and
 * gives the same real signal for this purpose: what health/fitness/sport stories
 * are actually running right now, not an evergreen textbook list.
 */

/**
 * The channel's niche is health AND sport, so the seed queries are kept as
 * two explicit halves: with only the health list (where this started) the
 * scan returned almost nothing about training itself — "exercise longevity"
 * was the single sport-adjacent query, and it pulls epidemiology, not
 * strength/performance research. Both halves must stay populated; dropping
 * the sport half would quietly narrow the channel back to medical news.
 */
const HEALTH_SEED_QUERIES = [
  "daily steps mortality study",
  "diet health study",
  "sleep health study",
  "supplement health study",
  "heart disease prevention study",
  "exercise longevity study",
];

const SPORT_SEED_QUERIES = [
  "strength training muscle growth study",
  "protein intake muscle mass study",
  "high intensity interval training fitness study",
  "running injury prevention study",
  "stretching warm up performance study",
  "athletic recovery sleep study",
];

export const NICHE_SEED_QUERIES = [...HEALTH_SEED_QUERIES, ...SPORT_SEED_QUERIES];

const NEWS_RESULTS_PER_QUERY = 8;
const RECENCY_WINDOW = "14d";

interface NewsHeadline {
  title: string;
}

async function fetchHeadlinesForQuery(query: string, signal?: AbortSignal): Promise<string[]> {
  const url = new URL("https://news.google.com/rss/search");
  url.searchParams.set("q", `${query} when:${RECENCY_WINDOW}`);
  url.searchParams.set("hl", "en-US");
  url.searchParams.set("gl", "US");
  url.searchParams.set("ceid", "US:en");

  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new Error(`Google News RSS request failed: ${response.status} ${response.statusText}`);
  }
  const xml = await response.text();

  // Minimal RSS parse — just <title> text, no XML dependency needed for this.
  const titles = [...xml.matchAll(/<title>([\s\S]*?)<\/title>/g)]
    .map((m) => decodeXmlEntities(m[1]).trim())
    .filter((t) => t && !t.includes(" - Google News") && t !== "Google News");

  return titles.slice(0, NEWS_RESULTS_PER_QUERY);
}

function decodeXmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/** Fetches raw headlines across every seed query, deduped. */
export async function fetchTrendingHealthHeadlines(signal?: AbortSignal): Promise<string[]> {
  const results = await Promise.all(
    NICHE_SEED_QUERIES.map((q) => fetchHeadlinesForQuery(q, signal).catch(() => [] as string[]))
  );
  const seen = new Set<string>();
  const headlines: NewsHeadline[] = [];
  for (const list of results) {
    for (const title of list) {
      const key = title.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        headlines.push({ title });
      }
    }
  }
  return headlines.map((h) => h.title);
}

const TOPIC_SYSTEM_PROMPT = `You turn real current health, fitness and sport-science news headlines into
short, neutral, evidence-checkable research topic titles — the same style used to search Europe PMC
(a biomedical literature database), never the sensational framing of the original headline.

Rules, non-negotiable:
- Stay inside the channel's niche: health, fitness, and sport/training. Both sides count — a
  training/performance relationship ("resistance training and muscle hypertrophy", "protein timing
  and strength gains") is as welcome as a clinical one. Anything outside it is skipped, not
  stretched to fit.
- Each output title states a specific factor-outcome relationship, e.g. "daily steps and mortality",
  "sleep duration and cardiovascular mortality", "creatine supplementation and cognitive function",
  "resistance training frequency and muscle hypertrophy".
  Lowercase, no punctuation at the end, in English regardless of the headline's language.
- Strip all sensationalism, brand names, and news-style hooks ("The 10,000-Steps Myth Is Dead") —
  keep only the underlying checkable relationship a scientific search would actually match.
- Skip a headline if it doesn't describe a checkable factor-outcome relationship (pure news,
  opinion, or too vague to search) — return fewer topics rather than force one out of nothing.
- Never duplicate a topic already in the "existing topics" list you're given, even if reworded —
  skip anything covering the same relationship.
- Output at most 15 topics.`;

const TOPIC_JSON_SCHEMA = {
  type: "object",
  properties: {
    topics: {
      type: "array",
      items: { type: "string" },
      maxItems: 15,
    },
  },
  required: ["topics"],
  additionalProperties: false,
} as const;

function parseTopics(raw: unknown): string[] {
  if (typeof raw !== "object" || raw === null || !("topics" in raw)) {
    throw new Error("Expected an object with a 'topics' array");
  }
  const topics = (raw as { topics: unknown }).topics;
  if (!Array.isArray(topics)) {
    throw new Error("'topics' must be an array");
  }
  return topics
    .filter((t): t is string => typeof t === "string" && t.trim().length > 0)
    .map((t) => t.trim().toLowerCase());
}

export interface ScanTrendingTopicsResult {
  headlinesScanned: number;
  topics: string[];
}

/**
 * Scans current health/fitness/sport news and turns it into researchable topic
 * titles, skipping anything already in `existingTopics` (case-insensitive).
 */
export async function scanTrendingHealthTopics(
  existingTopics: string[]
): Promise<ScanTrendingTopicsResult> {
  return withStageLog(
    "trend-scanner",
    {},
    async () => {
      const headlines = await fetchTrendingHealthHeadlines();
      if (headlines.length === 0) {
        return { headlinesScanned: 0, topics: [] };
      }

      const provider = getLLMProvider();
      const result = await provider.generateStructured({
        system: TOPIC_SYSTEM_PROMPT,
        prompt: [
          "Current health/fitness/sport news headlines:",
          ...headlines.map((h) => `- ${h}`),
          "",
          "Existing topics (do not duplicate):",
          ...existingTopics.map((t) => `- ${t}`),
        ].join("\n"),
        schemaName: "trending_topics",
        schema: TOPIC_JSON_SCHEMA,
        parse: parseTopics,
        // Generous: some providers in the fallback chain are reasoning
        // models that spend tokens on hidden chain-of-thought before the
        // JSON answer — 1024 truncated mid-response and broke every
        // provider in one real run (2026-09-25).
        maxTokens: 4096,
      });

      return { headlinesScanned: headlines.length, topics: result };
    },
    (result) => ({ headlinesScanned: result.headlinesScanned, topicsFound: result.topics.length })
  );
}
