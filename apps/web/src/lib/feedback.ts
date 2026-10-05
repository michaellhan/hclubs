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
