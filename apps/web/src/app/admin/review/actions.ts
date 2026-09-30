"use server";

import { revalidatePath } from "next/cache";
import { mergeClubs, rejectMergeCandidate, undoMerge } from "@hci/db";
import { adminEnabled } from "@/lib/admin";
import { db } from "@/lib/db";

function guard() {
  if (!adminEnabled()) throw new Error("admin tooling is disabled");
}

export async function confirmMerge(formData: FormData) {
  guard();
  const absorbedId = String(formData.get("absorbed"));
  const survivorId = String(formData.get("survivor"));
  await mergeClubs(db(), { absorbedId, survivorId, actor: "dev-review-ui" });
  revalidatePath("/admin/review");
}

export async function rejectCandidate(formData: FormData) {
  guard();
  await rejectMergeCandidate(db(), { candidateId: String(formData.get("candidate")), actor: "dev-review-ui" });
  revalidatePath("/admin/review");
}

export async function undo(formData: FormData) {
  guard();
  await undoMerge(db(), { clubId: String(formData.get("club")), actor: "dev-review-ui" });
  revalidatePath("/admin/review");
}
