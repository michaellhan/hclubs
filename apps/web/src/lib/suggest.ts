import { PROMPT_LABEL } from "@hci/core/browser";

/** One topic of the on-site suggest form: what the shared Google Form's option is and what it asks. */
export interface SuggestTopic {
  key: string;
  label: string;
  formOption: string;
  prompts: { label: string; hint: string | null }[];
}

export type FieldKind = "url" | "long" | "text";

const URL_LABELS: string[] = [
  PROMPT_LABEL.website,
  PROMPT_LABEL.applicationLink,
  PROMPT_LABEL.anyLink,
  PROMPT_LABEL.shownAt,
];
const LONG_LABELS: string[] = [
  PROMPT_LABEL.does,
  PROMPT_LABEL.wrong,
  PROMPT_LABEL.right,
  PROMPT_LABEL.update,
  PROMPT_LABEL.inactive,
  PROMPT_LABEL.notes,
];

/** How a prompt is asked: a link, a sentence or two, or a short answer. PURE. */
export function fieldKind(label: string): FieldKind {
  return URL_LABELS.includes(label) ? "url" : LONG_LABELS.includes(label) ? "long" : "text";
}

const oneLine = (v: string | undefined) => v?.replace(/\s+/g, " ").trim() ?? "";

/**
 * The visitor's answers as the "Label: value" lines the importer reads (ADR 0035), one per
 * answered prompt, then the source link on its own line and any free message. Blanks send
 * nothing, so an untouched form produces "". PURE.
 */
export function suggestDetails(
  topic: SuggestTopic,
  answers: Record<string, string>,
  extra: { source?: string; message?: string } = {},
): string {
  const lines = topic.prompts
    .map((p) => [p.label, oneLine(answers[p.label])] as const)
    .filter(([, v]) => v)
    .map(([l, v]) => `${l}: ${v}`);
  const answered = lines.length > 0 || oneLine(extra.message) !== "";
  const source = oneLine(extra.source);
  if (answered && source) lines.push(`${PROMPT_LABEL.shownAt}: ${source}`);
  const message = extra.message?.trim();
  if (message) lines.push(message);
  return lines.join("\n");
}
