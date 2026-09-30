import { eq } from "drizzle-orm";
import type { Queryable } from "../client";
import { ingestionRun } from "../schema";

export type RunCounters = Record<string, number>;

export async function startRun(
  db: Queryable,
  input: { job: string; adapter?: string; adapterVersion?: string; options?: Record<string, unknown> },
): Promise<string> {
  const [row] = await db
    .insert(ingestionRun)
    .values({
      job: input.job,
      adapter: input.adapter ?? null,
      adapterVersion: input.adapterVersion ?? null,
      options: input.options ?? {},
      gitSha: process.env.GIT_SHA ?? process.env.VERCEL_GIT_COMMIT_SHA ?? null,
    })
    .returning({ id: ingestionRun.id });
  if (!row) throw new Error("failed to start ingestion run");
  return row.id;
}

export async function finishRun(
  db: Queryable,
  runId: string,
  result: { status: "succeeded" | "partial" | "failed"; counters: RunCounters; errorSummary?: string | null },
): Promise<void> {
  await db
    .update(ingestionRun)
    .set({
      status: result.status,
      counters: result.counters,
      errorSummary: result.errorSummary ?? null,
      finishedAt: new Date(),
    })
    .where(eq(ingestionRun.id, runId));
}
