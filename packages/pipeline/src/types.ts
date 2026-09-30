import type { ExtractionMethod, FieldKey, SourceType } from "@hci/core";

/**
 * Pipeline contracts. CLAUDE.md §10–11.
 *
 *   discover → fetch → parse → extract → entity resolution → claims → reconcile
 *
 * Adapters own source-specific knowledge (seed URLs, pure `parse`). Everything
 * effectful (HTTP, storage, database) is injected so adapters are fixture-testable.
 */

/** A URL we intend to fetch, with what we already know about it. */
export interface SourceCandidate {
  url: string;
  sourceType: SourceType;
  title?: string;
  publisher?: string;
}

export type FetchStatus = "ok" | "not_modified" | "http_error" | "network_error" | "robots_disallowed";

export interface FetchResult {
  status: FetchStatus;
  requestedUrl: string;
  finalUrl: string;
  httpStatus: number | null;
  contentType: string | null;
  etag: string | null;
  lastModified: string | null;
  body: Uint8Array | null;
  fetchedAt: Date;
  attempts: number;
  durationMs: number;
  error: string | null;
  method: "static" | "browser" | "fixture";
}

export interface SourceFetcher {
  fetch(
    candidate: SourceCandidate,
    conditional?: { etag?: string | null; lastModified?: string | null },
  ): Promise<FetchResult>;
}

/** A value extracted from a snapshot, before it is tied to a club. */
export interface ExtractedClaim {
  fieldKey: FieldKey;
  value: unknown;
  assertionKind: "stated" | "inferred";
  isDirect: boolean;
  extractionMethod: ExtractionMethod;
  /** Verbatim text supporting the value (required for LLM extraction). */
  quote?: string;
  /** Where in the snapshot the value came from (selector, index, …). */
  locator?: Record<string, unknown>;
}

/** An organization referenced by a source, with the claims the source makes about it. */
export interface DiscoveredOrganization {
  /** Stable key within the source (e.g. a program slug). */
  externalKey: string;
  name: string;
  acronym?: string;
  identity: {
    urls: string[];
    externalIds: { system: string; id: string }[];
  };
  claims: ExtractedClaim[];
}

export interface PageContent {
  url: string;
  finalUrl: string;
  body: string;
  fetchedAt: Date;
}

export interface ParsedPage {
  organizations: DiscoveredOrganization[];
  /** Further pages of the same listing to fetch (e.g. pagination). */
  nextUrls: string[];
  title: string | null;
  warnings: string[];
}

export interface DiscoveryAdapter {
  name: string;
  version: string;
  description: string;
  sourceType: SourceType;
  publisher: string;
  /** Hard cap on pages per run (pagination safety). */
  maxPages: number;
  seeds(): SourceCandidate[];
  /** PURE: no I/O. Must be covered by fixture tests. */
  parse(page: PageContent): ParsedPage;
}

/** Future: per-page extractors (e.g. club websites). Deterministic first, LLM only where needed. */
export interface Extractor {
  name: string;
  version: string;
  appliesTo(page: PageContent): boolean;
  extract(page: PageContent): Promise<ExtractedClaim[]>;
}
