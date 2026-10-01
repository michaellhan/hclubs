/**
 * The hclubs feedback form (docs/contributions.md). Google Apps Script.
 *
 * To update the live form (keeps its link, prefill links and all responses):
 *   1. Open https://script.new signed in as the form's owner.
 *   2. Replace the editor's contents with this file, choose `updateHclubsForm`, click Run,
 *      and approve the permission prompt ("create and edit your Google Forms").
 *   3. The Execution log lists what changed.
 *
 * `createHclubsForm` builds the same form from scratch (for a new owner); then put the
 * logged PREFILL_URL in NEXT_PUBLIC_CONTRIBUTE_FORM_URL.
 *
 * Keep in sync with the site: every `formOption` in packages/core/src/contribute.ts must
 * be one of CHOICES exactly (a test checks), or Google leaves the question blank. The
 * importer finds columns by the words "club", "kind of update", "details" and "link".
 */

/** The live form (edit id). */
const FORM_ID = "1KGDNX7ZNl-urDd1cFZIc7xb_QG7I-55XvI7Ll7nCZdg";

const TITLE = "Help improve hclubs";

const DESCRIPTION = [
  "Tell us something about a Harvard club, or about the site. It takes about a minute.",
  "",
  "• Answer only what you know. Estimates are fine; just say so (“about 40 members”).",
  "• A person checks every answer before anything changes on hclubs.app.",
  "• This form is anonymous. Please don’t include anyone’s name, email or phone number.",
].join("\n");

const CONFIRMATION =
  "Thanks, that helps! A person will check it before anything changes on hclubs.app. " +
  "You can send another answer below.";

/** Answers to "What kind of update?", most common first. */
const CHOICES = [
  "Add missing info about a club",
  "Fix something that's wrong",
  "Recruiting deadline or dates",
  "Application link",
  "How to join (comp, application, audition…)",
  "Who can join",
  "Time commitment",
  "Number of members",
  "Dues",
  "Website",
  "Instagram or other social account",
  "Club is inactive",
  "Club was renamed",
  "Club is listed twice",
  "A club that's missing from hclubs",
  "I run this club",
  "Feedback about the site",
  "Something else",
];

/** Each question: the titles it may have now (to find it) and what it should say. */
const QUESTIONS = {
  club: {
    was: ["Club", "Which club?"],
    title: "Which club?",
    help:
      "Filled in for you when you come from a club's page. Leave it blank for feedback about the site. " +
      "For a club that isn't on hclubs yet, write its name here.",
  },
  kind: {
    was: ["What kind of update?"],
    title: "What kind of update?",
    help: "Pick the closest one.",
  },
  details: {
    was: ["Details"],
    title: "Details",
    help:
      "Fill in the lines that apply and leave the rest blank. If you know when it applied, say so " +
      "(“Fall 2026”). For site feedback, tell us what to improve.",
  },
  source: {
    was: ["Source link (optional)", "Link where you saw it (optional)"],
    title: "Link where you saw it (optional)",
    help: "A club's page, post or application form that shows it. Instagram links are fine.",
  },
};

function applySettings_(form) {
  form
    .setTitle(TITLE)
    .setDescription(DESCRIPTION)
    .setConfirmationMessage(CONFIRMATION)
    .setCollectEmail(false)
    .setAllowResponseEdits(false)
    .setLimitOneResponsePerUser(false)
    .setShowLinkToRespondAgain(true)
    .setProgressBar(false);
}

function findItem_(form, q) {
  return form.getItems().find((item) => q.was.indexOf(item.getTitle()) !== -1) || null;
}

/** Edits the live form in place. Safe to run more than once. */
function updateHclubsForm() {
  const form = FormApp.openById(FORM_ID);
  applySettings_(form);
  const log = [];
  for (const key of Object.keys(QUESTIONS)) {
    const q = QUESTIONS[key];
    const item = findItem_(form, q);
    if (!item) throw new Error('Question not found: "' + q.was[0] + '". Was it renamed by hand?');
    item.setTitle(q.title).setHelpText(q.help);
    if (key === "kind") {
      const choice = item.asMultipleChoiceItem();
      choice.setChoiceValues(CHOICES).setRequired(true);
    }
    if (key === "details") item.asParagraphTextItem().setRequired(true);
    log.push(q.title);
  }
  Logger.log("Updated: " + TITLE + " — " + log.join(" | "));
  Logger.log("Choices: " + CHOICES.length);
  Logger.log("FORM_URL=" + form.getPublishedUrl());
}

/** Builds the same form from scratch in your Drive. */
function createHclubsForm() {
  const form = FormApp.create(TITLE);
  applySettings_(form);
  const club = form.addTextItem().setTitle(QUESTIONS.club.title).setHelpText(QUESTIONS.club.help);
  const kind = form
    .addMultipleChoiceItem()
    .setTitle(QUESTIONS.kind.title)
    .setHelpText(QUESTIONS.kind.help)
    .setChoiceValues(CHOICES)
    .setRequired(true);
  const details = form
    .addParagraphTextItem()
    .setTitle(QUESTIONS.details.title)
    .setHelpText(QUESTIONS.details.help)
    .setRequired(true);
  form.addTextItem().setTitle(QUESTIONS.source.title).setHelpText(QUESTIONS.source.help);

  // A prefill link with placeholders the site fills per club and kind of update.
  const prefilled = form
    .createResponse()
    .withItemResponse(club.createResponse("CLUBREF"))
    .withItemResponse(kind.createResponse(CHOICES[0]))
    .withItemResponse(details.createResponse("DETAILS"))
    .toPrefilledUrl()
    .replace("CLUBREF", "{clubref}")
    .replace(encodeURIComponent(CHOICES[0]).replace(/%20/g, "+"), "{type}")
    .replace("DETAILS", "{details}");
  Logger.log("FORM_URL=" + form.getPublishedUrl());
  Logger.log("PREFILL_URL=" + prefilled);
  Logger.log("EDIT_URL=" + form.getEditUrl());
}
