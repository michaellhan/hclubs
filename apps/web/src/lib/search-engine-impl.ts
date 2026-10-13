/**
 * The search engine's heavy half (relevance model, concept tables, facets, similar clubs),
 * loaded by `useSearchEngine` beside the index rather than in a page's first JavaScript.
 */
export { facetCounts, readsAsBrowse, relaxations, searchLocal, similarClubs } from "@hci/db/local";
