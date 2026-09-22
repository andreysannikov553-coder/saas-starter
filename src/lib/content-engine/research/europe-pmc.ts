import { SourceType } from "@prisma/client";
import { NonRetryableError, withRetry } from "../observability/retry";

/**
 * Europe PMC client.
 *
 * Europe PMC indexes PubMed/MEDLINE plus preprints and Agricola, and its REST
 * API is free and needs no key — which is why it is the first source in the
 * zero-budget launch. The source priority from the discovery doc (meta-analyses
 * and systematic reviews over primary studies) is applied here, at classification
 * time, so everything downstream can sort by evidence strength.
 */

const SEARCH_ENDPOINT = "https://www.ebi.ac.uk/europepmc/webservices/rest/search";

/** A single record as returned by Europe PMC, narrowed to the fields we use. */
interface EuropePmcResult {
  id?: string;
  source?: string;
  pmid?: string;
  doi?: string;
  title?: string;
  journalTitle?: string;
  firstPublicationDate?: string;
  pubYear?: string;
  pubTypeList?: { pubType?: string[] };
}

interface EuropePmcResponse {
  resultList?: { result?: EuropePmcResult[] };
}

/** A source ready to be persisted, independent of Europe PMC's response shape. */
export interface ResearchedSource {
  title: string;
  url: string;
  sourceType: SourceType;
  publishedAt: Date | null;
}

/**
 * Maps Europe PMC publication types to our SourceType.
 *
 * Order matters: a paper tagged both "Journal Article" and "Meta-Analysis" is a
 * meta-analysis, so the strongest evidence type wins. A bare "Review" is not a
 * systematic review and deliberately does not get that rank.
 */
export function classifySourceType(pubTypes: string[]): SourceType {
  const types = pubTypes.map((t) => t.toLowerCase());
  const has = (needle: string) => types.some((t) => t.includes(needle));

  if (has("meta-analysis")) return SourceType.META_ANALYSIS;
  if (has("systematic review")) return SourceType.SYSTEMATIC_REVIEW;
  if (has("guideline") || has("consensus")) return SourceType.OFFICIAL_BODY;
  if (has("journal article") || has("clinical trial") || has("randomized"))
    return SourceType.PRIMARY_STUDY;

  return SourceType.OTHER;
}

/**
 * Builds the most stable public URL available for a record: a DOI resolves
 * forever, a PMID outlives Europe PMC's own ids, and the Europe PMC page is the
 * last resort.
 */
export function buildSourceUrl(result: EuropePmcResult): string | null {
  if (result.doi) return `https://doi.org/${result.doi}`;
  if (result.pmid) return `https://pubmed.ncbi.nlm.nih.gov/${result.pmid}/`;
  if (result.source && result.id)
    return `https://europepmc.org/article/${result.source}/${result.id}`;
  return null;
}

/** Parses Europe PMC's date fields, preferring the full date over the year. */
export function parsePublishedAt(result: EuropePmcResult): Date | null {
  const raw = result.firstPublicationDate ?? result.pubYear;
  if (!raw) return null;

  const parsed = new Date(result.firstPublicationDate ? raw : `${raw}-01-01`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** Turns a raw Europe PMC record into a source, or null if it is unusable. */
export function toResearchedSource(result: EuropePmcResult): ResearchedSource | null {
  const url = buildSourceUrl(result);
  if (!url || !result.title) return null;

  return {
    title: result.title,
    url,
    sourceType: classifySourceType(result.pubTypeList?.pubType ?? []),
    publishedAt: parsePublishedAt(result),
  };
}

export interface SearchOptions {
  /** How many records to request. Europe PMC caps a page at 1000. */
  pageSize?: number;
  /** Restrict to records with a full text we can actually read. */
  openAccessOnly?: boolean;
  signal?: AbortSignal;
}

/**
 * Searches Europe PMC for a topic and returns sources sorted by evidence
 * strength, strongest first.
 */
export async function searchEuropePmc(
  query: string,
  options: SearchOptions = {}
): Promise<ResearchedSource[]> {
  const { pageSize = 25, openAccessOnly = false, signal } = options;

  const url = new URL(SEARCH_ENDPOINT);
  url.searchParams.set("query", openAccessOnly ? `${query} AND OPEN_ACCESS:y` : query);
  url.searchParams.set("format", "json");
  url.searchParams.set("resultType", "core");
  url.searchParams.set("pageSize", String(pageSize));

  const response = await withRetry(
    async () => {
      const res = await fetch(url, {
        headers: { Accept: "application/json" },
        signal,
      });
      if (!res.ok) {
        const message = `Europe PMC search failed: ${res.status} ${res.statusText}`;
        throw res.status < 500 ? new NonRetryableError(message) : new Error(message);
      }
      return res;
    },
    {
      shouldRetry: (error) =>
        !(error instanceof NonRetryableError) &&
        !(error instanceof DOMException && error.name === "AbortError"),
    }
  );

  const body = (await response.json()) as EuropePmcResponse;
  const results = body.resultList?.result ?? [];

  return results
    .map(toResearchedSource)
    .filter((source): source is ResearchedSource => source !== null)
    .sort((a, b) => SOURCE_TYPE_RANK[a.sourceType] - SOURCE_TYPE_RANK[b.sourceType]);
}

/**
 * Source priority from the discovery doc: meta-analyses and systematic reviews
 * outrank single studies, and anything unclassified sinks to the bottom.
 */
const SOURCE_TYPE_RANK: Record<SourceType, number> = {
  [SourceType.META_ANALYSIS]: 0,
  [SourceType.SYSTEMATIC_REVIEW]: 1,
  [SourceType.OFFICIAL_BODY]: 2,
  [SourceType.UNIVERSITY]: 3,
  [SourceType.PROFESSIONAL_ORG]: 4,
  [SourceType.PRIMARY_STUDY]: 5,
  [SourceType.OTHER]: 6,
};
