import { createSearchParamsCache } from "nuqs/server";
import { scopeParsers } from "./scope";

/**
 * Server-side scope parser for Server Components. Call
 * `scopeSearchCache.parse(searchParams)` at the top of a page to read the scope
 * for the initial SSR render, then hand the same values to client widgets.
 */
export const scopeSearchCache = createSearchParamsCache(scopeParsers);
