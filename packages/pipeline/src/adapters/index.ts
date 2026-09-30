import type { DiscoveryAdapter } from "../types";
import {
  csClubsAdapter,
  innovationLabsAdapter,
  iopAdapter,
  latinxAdapter,
  mathCommunityAdapter,
  mcbNeuroAdapter,
  mignoneAdapter,
  seasByConcentrationAdapter,
  seasStudentOrgsAdapter,
  socoClubSportsAdapter,
} from "./directories";
import { pbhaProgramsAdapter } from "./pbha-programs";
import { wikipediaAdapter } from "./wikipedia";

export { pbhaProgramsAdapter, parsePbhaListing } from "./pbha-programs";
export * from "./directories";
export * from "./wikipedia";

/**
 * Registered discovery adapters, in run order: official Harvard sources first (so they
 * seed canonical entities), lower-trust breadth sources last. Each needs
 * docs/sources/<name>.md, fixtures, and tests.
 */
export const ADAPTER_ORDER: DiscoveryAdapter[] = [
  seasStudentOrgsAdapter,
  seasByConcentrationAdapter,
  socoClubSportsAdapter,
  pbhaProgramsAdapter,
  iopAdapter,
  csClubsAdapter,
  mcbNeuroAdapter,
  latinxAdapter,
  mathCommunityAdapter,
  mignoneAdapter,
  innovationLabsAdapter,
  wikipediaAdapter,
];

export const ADAPTERS: Record<string, DiscoveryAdapter> = Object.fromEntries(ADAPTER_ORDER.map((a) => [a.name, a]));

/** Saved fixtures per adapter, for `--offline` runs (URL → file relative to test/fixtures). */
export const OFFLINE_FIXTURES: Record<string, Record<string, string>> = {
  "pbha-programs": {
    "https://www.pbha.org/programs": "pbha-programs/listing.html",
    "https://www.pbha.org/programs?offset=1734301560265": "pbha-programs/listing-page-2.html",
    "https://www.pbha.org/programs?offset=1705368180217": "pbha-programs/listing-page-3.html",
  },
  "soco-club-sports": {
    "https://soco.college.harvard.edu/clubsports/club-sport-organizations/": "soco-club-sports/listing.html",
  },
  "seas-student-orgs": { "https://seas.harvard.edu/student-organizations": "seas-student-organizations/listing.html" },
  "seas-orgs-by-concentration": {
    "https://seas.harvard.edu/office-student-organizations/find-seas-affiliated-student-organization":
      "seas-orgs-by-concentration/listing.html",
  },
  "iop-programs": {
    "https://iop.harvard.edu/programs": "iop-programs/listing.html",
    "https://iop.harvard.edu/programs/iop-coalitions": "iop-programs/coalitions.html",
  },
  "dept-computer-science": {
    "https://csadvising.seas.harvard.edu/opportunities/clubs/": "dept-computer-science/listing.html",
  },
  "dept-mcb-neuroscience": {
    "https://www.mcb.harvard.edu/undergraduate/neuroscience/student-groups-resources/":
      "dept-mcb-neuroscience/listing.html",
  },
  "dept-latinx-studies": {
    "https://sites.harvard.edu/latinx/latinx-organizations/": "dept-latinx-studies/listing.html",
  },
  "dept-math-community": {
    "https://sites.harvard.edu/math-community/community-groups/": "dept-math-community/listing.html",
  },
  "mignone-student-clubs": {
    "https://careerservices.fas.harvard.edu/organizations/?ctag[]=student-clubs": "mignone-student-clubs/listing.html",
    "https://careerservices.fas.harvard.edu/organizations/page/2?ctag%5B0%5D=student-clubs":
      "mignone-student-clubs/listing-page-2.html",
    "https://careerservices.fas.harvard.edu/organizations/page/3?ctag%5B0%5D=student-clubs":
      "mignone-student-clubs/listing-page-3.html",
  },
  "innovation-labs-student-groups": {
    "https://innovationlabs.harvard.edu/resources/hub?externalResourceType=student-group":
      "innovation-labs-student-groups/listing.html",
  },
  "wikipedia-harvard-orgs": {
    "https://en.wikipedia.org/wiki/List_of_Harvard_College_undergraduate_organizations":
      "wikipedia-harvard-orgs/list-article.html",
    "https://en.wikipedia.org/wiki/Harvard_College_social_clubs": "wikipedia-harvard-orgs/social-clubs.html",
  },
};
