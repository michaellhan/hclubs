import { z } from "zod";
import { SEASONS } from "./term-utils";

/** Zod schemas for academic terms; everything else is in term-utils.ts. */
export * from "./term-utils";

export const Season = z.enum(SEASONS);
export type Season = z.infer<typeof Season>;

export const TermKey = z.string().regex(/^\d{4}-(spring|summer|fall|winter)$/, "expected YYYY-season");
export type TermKey = z.infer<typeof TermKey>;
