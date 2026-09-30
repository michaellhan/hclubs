"use server";

import { createSubmission } from "@hci/db";
import { db } from "@/lib/db";
import { submitterRef } from "@/lib/submitter";

export interface SuggestState {
  status: "idle" | "ok" | "error";
  message: string;
}

export async function suggestUpdate(_prev: SuggestState, form: FormData): Promise<SuggestState> {
  // Honeypot: real users never see or fill this field.
  if (String(form.get("website") ?? "") !== "") return { status: "ok", message: "Thanks — we'll review it." };
  const now = new Date();
  const result = await createSubmission(
    db(),
    {
      kind: form.get("kind"),
      clubSlug: form.get("clubSlug"),
      message: form.get("message"),
      evidenceUrl: form.get("evidenceUrl") ?? "",
    },
    { submitterRef: await submitterRef(now), now },
  );
  return result.ok
    ? { status: "ok", message: "Thanks — a person will review this before anything changes." }
    : { status: "error", message: result.message };
}
