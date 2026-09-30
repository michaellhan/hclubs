/**
 * Creates the hclubs feedback form in your Google Drive (docs/contributions.md).
 *
 *   1. Open https://script.new (signed in to the Google account that should own the form).
 *   2. Replace the editor's contents with this file, click Run, and approve the permission
 *      prompt ("create and edit your Google Forms").
 *   3. Copy the three lines printed in the Execution log and send them back.
 *
 * The question titles match what `pnpm hci submissions import` looks for. The form doesn't
 * collect email addresses; submissions are anonymous.
 */
function createClubIndexForm() {
  const form = FormApp.create("hclubs: share info or feedback");
  form
    .setDescription(
      "Tell us what's missing or wrong on hclubs.app, share what you know about a club " +
        "(deadlines, comp process, time commitment, size), or send general feedback. " +
        "A person reviews every response before anything changes on the site. " +
        "Please don't include personal information about individual members.",
    )
    .setCollectEmail(false)
    .setAllowResponseEdits(false)
    .setLimitOneResponsePerUser(false)
    .setShowLinkToRespondAgain(true)
    .setConfirmationMessage("Thanks! A person reviews every response before the site changes.");

  const club = form
    .addTextItem()
    .setTitle("Club")
    .setHelpText("Which club is this about? Leave blank for general feedback about the site.");

  form
    .addMultipleChoiceItem()
    .setTitle("What kind of update?")
    .setChoiceValues([
      "Recruiting deadline or dates",
      "How to join / comp process",
      "Time commitment",
      "Size (number of members)",
      "Dues",
      "Website or social link",
      "Club seems inactive",
      "I run this club",
      "Feedback about the site",
      "Other",
    ])
    .setRequired(true);

  form
    .addParagraphTextItem()
    .setTitle("Details")
    .setHelpText("What do you know, and when did it apply? For site feedback, what should we improve?")
    .setRequired(true);

  form.addTextItem().setTitle("Source link (optional)").setHelpText("A page, post or form that shows it.");

  // A link that fills in the Club question; the site swaps in each club's id.
  const prefilled = form.createResponse().withItemResponse(club.createResponse("SLUG_PLACEHOLDER")).toPrefilledUrl();

  Logger.log("FORM_URL=" + form.getPublishedUrl());
  Logger.log("PREFILL_URL=" + prefilled.replace("SLUG_PLACEHOLDER", "{slug}"));
  Logger.log("EDIT_URL=" + form.getEditUrl());
}

/** Renames the form created before the site became hclubs (run once from the same project). */
function renameToHclubs() {
  const form = FormApp.openById("1KGDNX7ZNl-urDd1cFZIc7xb_QG7I-55XvI7Ll7nCZdg");
  form.setTitle("hclubs: share info or feedback");
  Logger.log("Renamed: " + form.getTitle());
}
