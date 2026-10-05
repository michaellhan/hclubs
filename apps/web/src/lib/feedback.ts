/** The contribution form's option for site feedback (must match the Google Form exactly). */
export const FEEDBACK_FORM_OPTION = "Feedback about the site";

/** Only a site path the visitor came from (`?from=/clubs/x`), never an outside URL. PURE. */
export function feedbackPage(raw: string | null): string | null {
  const v = raw?.trim() ?? "";
  return /^\/(?!\/)[^\s]{0,200}$/.test(v) ? v : null;
}

/** "Label: value" lines for the shared form's Details question. PURE. */
export function feedbackDetails(message: string, page: string | null): string {
  const text = message.trim();
  if (!text) return "";
  return page ? `${text}\n\nPage: ${page}` : text;
}

/** The club whose profile the visitor came from (`/clubs/<slug>`), else null. PURE. */
export function clubFromPage(page: string | null): string | null {
  const m = page?.match(/^\/clubs\/([a-z0-9-]+)\/?(?:[?#].*)?$/);
  return m?.[1] ?? null;
}

export type FeedbackMode = "club" | "site";

/**
 * Which half of the feedback page opens: a club when the link names one (`?club=`, a topic,
 * or a profile it came from), the site otherwise; `?about=` picks explicitly. PURE.
 */
export function initialFeedbackMode(params: {
  about: string | null;
  club: string | null;
  topic: string | null;
  page: string | null;
}): FeedbackMode {
  if (params.about === "site" || params.about === "club") return params.about;
  return params.club || params.topic || clubFromPage(params.page) ? "club" : "site";
}
