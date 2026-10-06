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

/**
 * How each prompt is asked on the page. The importer still reads the plain label (sent as
 * "Label: value"); this is only the question a visitor sees, so it never repeats the topic.
 */
const QUESTION: Record<string, string> = {
  [PROMPT_LABEL.howToJoin]: "How do members join?",
  [PROMPT_LABEL.steps]: "What are the steps?",
  [PROMPT_LABEL.deadline]: "When is the deadline?",
  [PROMPT_LABEL.term]: "For which term?",
  [PROMPT_LABEL.applicationLink]: "Link to the application",
  [PROMPT_LABEL.memberHours]: "Hours a week as a member",
  [PROMPT_LABEL.compHours]: "Hours a week during the comp or application",
  [PROMPT_LABEL.eligibility]: "Who can join?",
  [PROMPT_LABEL.dues]: "How much are dues?",
  [PROMPT_LABEL.members]: "About how many members?",
  [PROMPT_LABEL.website]: "The club's website",
  [PROMPT_LABEL.instagram]: "The club's Instagram",
  [PROMPT_LABEL.does]: "What does the club do?",
  [PROMPT_LABEL.wrong]: "What's wrong?",
  [PROMPT_LABEL.right]: "What should it say?",
  [PROMPT_LABEL.inactive]: "Why does it seem inactive?",
  [PROMPT_LABEL.newName]: "What is it called now?",
  [PROMPT_LABEL.oldName]: "What was it called before?",
  [PROMPT_LABEL.duplicate]: "Which club is it the same as?",
};

/** The question shown for a prompt label. PURE. */
export function promptQuestion(label: string): string {
  return QUESTION[label] ?? label;
}

const LINK_ANSWERS: string[] = [PROMPT_LABEL.website, PROMPT_LABEL.instagram, PROMPT_LABEL.applicationLink];

/** The answer is itself a link (a website, account or application), so asking where it's posted repeats it. PURE. */
export function answerIsLink(topic: SuggestTopic): boolean {
  return (
    topic.prompts.some((p) => LINK_ANSWERS.includes(p.label)) &&
    topic.prompts.every((p) => LINK_ANSWERS.includes(p.label) || p.label === PROMPT_LABEL.term)
  );
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
