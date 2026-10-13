import { describe, expect, it } from "vitest";
import {
  aboutTextProblem,
  announcementProblem,
  donationProblem,
  namesPeopleProblem,
  personalBioProblem,
} from "../src/extract/evidence-rules";
import { extractDeterministic } from "../src/extract/deterministic";
import { htmlToDocument } from "../src/parse/document";

/** Round 6: the Ballroom Dance Club's About candidates were a bio, a bio, a donation ask and a notice. */

const MIKAYLA =
  "Hi! I'm Mikayla, a sophomore in Pfoho studying Math and Physics. I've been dancing since I was 7, but mainly traditional Chinese dance. However, I've always loved Dancing with the Stars and that led me to experiment with Latin in high school. Coming into college, I knew I had to join ballroom and I've absolutely loved my first year. As your Rookie Captain, I can't wait to watch you guys experience the same magic. Outside of ballroom, you can find me watching a romcom (recs please), getting lost on a long walk, or browsing a bookstore.";
const TOLA =
  "Tola's dance journey included working on several productions in Opera Krakowska, like Cinderella, Carmina Burana, and The Nutcracker with ensemble and corps de ballet roles, competing all around England in contemporary and jazz with the Royal Holloway Dance Society, and winning 9th place in classical ballet in the final of Dance World Cup in 2014 in Algarve, Portugal. Focusing solely on ballroom in the last couple of years, she competes in Open Amateur competitions around the country, having finaled or placed in the top 10 in Open Latin events like the Windy City Open, Ohio Star Ball, or MIT Open.";
const ALUMNI =
  "Thanks to the generous support of our alumni, HBDT continues to thrive and fund many of its signature experiences - like our annual trip to Montreal. If you're willing and able to contribute, we and the next generation of dancers are truly grateful. You can donate through the Harvard Athletics Giving Form. If you do, please let us know!";
const REGISTRATION =
  "Registration for Harvard Invitational, as well as all the exciting details about the new elements of this year's competition, are now LIVE! Find more information on our website here.";
const HBDT =
  "HBDT also fosters a love of dance across the Harvard community by hosting regular practices, lessons, social dances, and special events that welcome dancers of all experience levels. Throughout the year, the team travels to competitions in cities such as Montreal and New York, and each fall we host our own competition, Harvard Beginners, which introduces new dancers to the excitement of collegiate ballroom competition.";

describe("member and instructor bios are never club text", () => {
  it("rejects the Ballroom Dance Club's bios", () => {
    expect(namesPeopleProblem(MIKAYLA, ["Harvard Ballroom Dance Team"])?.check).toBe("names_people");
    expect(namesPeopleProblem(TOLA, ["Harvard Ballroom Dance Team"])?.check).toBe("names_people");
    expect(personalBioProblem(TOLA)?.why).toContain("Tola's dance journey");
  });
  it("rejects other self-introductions and bios", () => {
    for (const t of [
      "My name is Jordan and I lead our beginner lessons every week.",
      "Hello everyone, I'm Priya! I'll be your social chair this year.",
      "I'm a junior concentrating in Economics and I joined the club as a first-year.",
      "I am currently a senior living in Dunster.",
      "Jane Doe has performed with the Boston Ballet, and her classes fill up fast.",
      "He has taught salsa for ten years and coaches the competition team.",
      "Our coach began dancing at four; she has won national titles in Latin and Standard.",
    ])
      expect(namesPeopleProblem(t)?.check, t).toBe("names_people");
  });
  it("keeps club descriptions, testimonials aside", () => {
    for (const t of [
      HBDT,
      "Hi! We're the Harvard Ballroom Dance Team, a competitive team open to dancers of every level.",
      "Hi, I'm excited you found us! The Harvard Swing Club teaches lindy hop every Tuesday.",
      "The club's journey began in 1985, when a few students started dancing in Lowell House.",
      "Harvard's dance community is home to more than forty groups.",
      "Members include first-years, sophomores and juniors from every house.",
      "Our mission is to help every member find their own career path in public service.",
      "The team has performed at Sanders Theatre and competed across New England.",
      "We teach every member, whether they have trained for years or never danced before.",
      // Live false positive while building the rule (Faith and Action's activity).
      "Bible Courses taught by seminary-trained ministry fellows",
      "Kuumba Ensemble has performed at the Kennedy Center and toured South Africa.",
    ])
      expect(namesPeopleProblem(t, ["Harvard Ballroom Dance Team"]), t).toBeNull();
  });
  it("never trips on a club named for a person", () => {
    const own = ["John F. Kennedy Jr. Forum", "Phillips Brooks House Association"];
    expect(
      namesPeopleProblem(
        "The John F. Kennedy Jr. Forum hosts speakers in the spirit of John F. Kennedy Jr.'s career in public life.",
        own,
      ),
    ).toBeNull();
    expect(
      namesPeopleProblem(
        "Phillips Brooks House Association carries on Brooks's career of service through student-run programs.",
        own,
      ),
    ).toBeNull();
  });
});

describe("donation asks and registration notices are never About text", () => {
  it("rejects the alumni-donation notice and the registration notice", () => {
    expect(donationProblem(ALUMNI)?.check).toBe("donation");
    expect(aboutTextProblem(ALUMNI)?.check).toBe("donation");
    expect(announcementProblem(REGISTRATION)?.check).toBe("announcement");
    expect(aboutTextProblem(REGISTRATION)?.check).toBe("announcement");
    expect(aboutTextProblem("Registration for the spring competition is now open!")?.check).toBe("announcement");
  });
  it("keeps clubs that raise money for others and events open to all", () => {
    for (const t of [
      HBDT,
      "We raise money and donate to local food banks through our annual charity concert.",
      "Members organize blood drives and fundraisers for Boston-area shelters.",
      "Each fall we host Harvard Beginners; registration is open to dancers from every college.",
      "The Harvard Glee Club is the oldest college chorus in America.",
    ])
      expect(aboutTextProblem(t), t).toBeNull();
  });
});

describe("deterministic extractor skips the bios and notices (1.16.45)", () => {
  it("takes the club's own paragraph, not the captain's bio", () => {
    const html = `<html><head><title>About | Harvard Ballroom</title></head><body><main>
      <p>${MIKAYLA}</p><p>${TOLA}</p><p>${ALUMNI}</p><p>${REGISTRATION}</p><p>${HBDT}</p></main></body></html>`;
    const claims = extractDeterministic({
      doc: htmlToDocument(html, "https://harvardballroom.test/about"),
      role: "about",
      fetchedAt: new Date("2026-10-13T03:00:00Z"),
      clubNames: ["Harvard Ballroom Dance Team"],
      clubAcronyms: ["HBDT"],
    });
    const long = claims.filter((c) => c.fieldKey === "club.long_description").map((c) => c.value);
    expect(long).toEqual([HBDT]);
  });
});
