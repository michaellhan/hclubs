import { sql } from "drizzle-orm";
import { normalizeUrl } from "@hci/core";
import type { Db } from "@hci/db";
import type { AuditClaim, AuditClub, AuditCycle, AuditData, AuditEvidence, AuditLink } from "./types";

/** Parking pages and registrars: a club domain that lands here has lapsed. */
/** Postgres regex: a form that has stopped taking responses. */
const CLOSED_FORM_SQL =
  "(is no longer accepting responses|no longer accepting responses|this form is (now )?closed|form has been closed)";
/** Postgres regex (no \\b there): a parking or for-sale page. */
const PARKED_TEXT_SQL =
  "(this domain (name )?(is|may be) for sale|buy this domain|domain is parked|parked free|hugedomains|make an offer on this domain)";
const GRADUATE_NAME =
  /\b(GSAS|HKS|HBS|HLS|HMS|HSPH|GSD|HGSE|HDS|Extension School|Kennedy School|Business School|Law School|Medical School|Divinity School|Graduate)\b/;

const rows = async <T>(db: Db, q: ReturnType<typeof sql>): Promise<T[]> => (await db.execute(q)) as unknown as T[];

/** Claim ids referenced by a club's (or cycle's) projection `fields` JSON. */
function displayedIds(fields: unknown, into: Set<string>) {
  if (!fields || typeof fields !== "object") return;
  for (const f of Object.values(fields as Record<string, unknown>)) {
    const v = f as { current?: { claimId?: string }; values?: { claimId?: string }[] };
    if (v.current?.claimId) into.add(v.current.claimId);
    for (const x of v.values ?? []) if (x.claimId) into.add(x.claimId);
  }
}

/**
 * Load everything the checks need in a few bulk queries. Claims on clubs merged into another
 * are attributed to the surviving club (that is where the site shows them); hidden clubs and
 * fixtures are left out.
 */
export async function loadAuditData(db: Db, now: Date): Promise<AuditData> {
  const clubRows = await rows<{
    id: string;
    slug: string;
    name: string;
    acronym: string | null;
    state: string;
    root: string | null;
    affiliation: string;
    fields: unknown;
    sd: string | null;
    soco: boolean;
  }>(
    db,
    sql`select c.id, c.slug, c.canonical_name as name, c.acronym, c.record_state as state,
          c.merged_into_club_id as root, c.affiliation_scope as affiliation, c.fields,
          c.short_description as sd,
          exists (select 1 from claim cl join claim_evidence e on e.claim_id = cl.id
                  where cl.club_id = c.id and e.extractor_name = 'soco-directory') as soco
        from club c where c.data_origin <> 'fixture'`,
  );
  const rootOf = new Map<string, string>();
  for (const c of clubRows) {
    if (c.state === "active") rootOf.set(c.id, c.id);
    else if (c.state === "merged" && c.root) rootOf.set(c.id, c.root);
  }
  const categoryRows = await rows<{ slug: string; parent: string | null }>(
    db,
    sql`select c.slug, p.slug as parent from category c left join category p on p.id = c.parent_id`,
  );
  const categoryTop = new Map(categoryRows.map((c) => [c.slug, c.parent ?? c.slug]));
  const clubCats = await rows<{ clubId: string; slug: string }>(
    db,
    sql`select cc.club_id as "clubId", cat.slug from club_category cc join category cat on cat.id = cc.category_id`,
  );
  const aliasRows = await rows<{ clubId: string; alias: string }>(
    db,
    sql`select club_id as "clubId", alias from club_alias`,
  );

  const clubs = new Map<string, AuditClub>();
  for (const c of clubRows) {
    if (c.state !== "active") continue;
    const displayed = new Set<string>();
    displayedIds(c.fields, displayed);
    const categories = clubCats.filter((x) => x.clubId === c.id).map((x) => x.slug);
    clubs.set(c.id, {
      id: c.id,
      slug: c.slug,
      name: c.name,
      acronym: c.acronym,
      aliases: aliasRows.filter((a) => a.clubId === c.id).map((a) => a.alias),
      projectedAliases: aliasRows.filter((a) => a.clubId === c.id).map((a) => a.alias),
      affiliation: c.affiliation,
      college:
        !GRADUATE_NAME.test(c.name) &&
        (c.affiliation === "harvard_college" || c.soco || /\b(undergraduate|harvard college)\b/i.test(c.name)),
      categories,
      topCategories: [...new Set(categories.map((s) => categoryTop.get(s) ?? s))],
      displayedClaimIds: displayed,
      shortDescription: c.sd,
    });
  }
  const cycleFields = await rows<{ clubId: string; fields: unknown }>(
    db,
    sql`select club_id as "clubId", fields from recruiting_cycle`,
  );
  for (const r of cycleFields) {
    const club = clubs.get(rootOf.get(r.clubId) ?? "");
    if (club) displayedIds(r.fields, club.displayedClaimIds);
  }

  const claimRows = await rows<{
    id: string;
    clubId: string;
    fieldKey: string;
    value: unknown;
    status: string;
    assertionKind: string;
    termKey: string | null;
    firstObservedAt: Date;
    lastObservedAt: Date;
    createdAt: Date;
  }>(
    db,
    sql`select c.id, c.club_id as "clubId", c.field_key as "fieldKey", c.value, c.status::text as status,
          c.assertion_kind::text as "assertionKind", coalesce(rc.term_key, c.term_key) as "termKey",
          c.first_observed_at as "firstObservedAt", c.last_observed_at as "lastObservedAt", c.created_at as "createdAt"
        from claim c left join recruiting_cycle rc on rc.id = c.recruiting_cycle_id
        where c.status = 'active' or (c.status = 'rejected' and c.field_key = 'club.link')`,
  );
  const evidenceRows = await rows<AuditEvidence & { claimId: string }>(
    db,
    sql`select e.claim_id as "claimId", e.source_id as "sourceId", s.url as "sourceUrl", s.source_type as "sourceType",
          s.trust_tier as tier, s.owner_club_id as "ownerClubId", e.extraction_method as method,
          e.extractor_name as extractor, e.evidence_quote as quote, e.confidence, e.is_direct as "isDirect",
          e.observed_at as "observedAt", e.snapshot_id as "snapshotId", ss.source_id as "snapshotSourceId",
          ss.fetched_at as "snapshotFetchedAt"
        from claim_evidence e
        join claim c on c.id = e.claim_id
        join source s on s.id = e.source_id
        left join source_snapshot ss on ss.id = e.snapshot_id
        where c.status = 'active' or (c.status = 'rejected' and c.field_key = 'club.link')`,
  );
  const evidenceByClaim = new Map<string, AuditEvidence[]>();
  for (const e of evidenceRows) {
    const { claimId, ...ev } = e;
    const list = evidenceByClaim.get(claimId) ?? [];
    list.push({
      ...ev,
      ownerClubId: ev.ownerClubId ? (rootOf.get(ev.ownerClubId) ?? ev.ownerClubId) : null,
      observedAt: new Date(ev.observedAt),
      snapshotFetchedAt: ev.snapshotFetchedAt ? new Date(ev.snapshotFetchedAt) : null,
    });
    evidenceByClaim.set(claimId, list);
  }
  const claims: AuditClaim[] = [];
  const rejectedLinkClaims: AuditClaim[] = [];
  // A club merged into another was the same organization under another name: its name is
  // an alias of the survivor. (Name claims are not used: a wrong link brings a wrong name.)
  for (const c of clubRows) {
    if (c.state !== "merged") continue;
    const club = clubs.get(rootOf.get(c.id) ?? "");
    if (club && c.name !== club.name && !club.aliases.includes(c.name)) club.aliases.push(c.name);
  }
  for (const r of claimRows) {
    const root = rootOf.get(r.clubId);
    if (!root || !clubs.has(root)) continue;
    const claim: AuditClaim = {
      ...r,
      clubId: root,
      firstObservedAt: new Date(r.firstObservedAt),
      lastObservedAt: new Date(r.lastObservedAt),
      createdAt: new Date(r.createdAt),
      evidence: evidenceByClaim.get(r.id) ?? [],
    };
    (r.status === "active" ? claims : rejectedLinkClaims).push(claim);
  }

  const linkRows = await rows<{
    clubId: string;
    kind: string;
    url: string;
    normalizedUrl: string;
    handle: string | null;
    label: string | null;
    status: string;
    discoveredVia: string[];
    fetchStatus: string | null;
    httpStatus: number | null;
    fetchError: string | null;
    fetchedAt: Date | null;
    finalUrl: string | null;
    snapAt: Date | null;
    parkedText: boolean | null;
    pageTitle: string | null;
    formClosed: boolean | null;
  }>(
    db,
    sql`select l.club_id as "clubId", l.kind, l.url, l.normalized_url as "normalizedUrl", l.handle, l.label,
          l.status, l.discovered_via as "discoveredVia", s.title as "pageTitle",
          fa.status::text as "fetchStatus", fa.http_status as "httpStatus", fa.started_at as "fetchedAt", fa.error_message as "fetchError",
          ss.final_url as "finalUrl", ss.fetched_at as "snapAt", ss.extracted_text ~* ${PARKED_TEXT_SQL} as "parkedText",
          ss.extracted_text ~* ${CLOSED_FORM_SQL} as "formClosed"
        from club_link l
        join club k on k.id = l.club_id and k.record_state = 'active'
        left join source s on s.normalized_url = l.normalized_url
        left join lateral (select status, http_status, started_at, error_message from fetch_attempt f
                           where f.source_id = s.id order by started_at desc limit 1) fa on true
        left join lateral (select final_url, fetched_at, extracted_text from source_snapshot x
                           where x.source_id = s.id order by fetched_at desc limit 1) ss on true`,
  );
  const linkClaimsByKey = new Map<string, string[]>();
  for (const c of claims) {
    if (c.fieldKey !== "club.link") continue;
    const url = (c.value as { url?: string }).url ?? "";
    const key = `${c.clubId}|${normalizeUrl(url) ?? url}`;
    linkClaimsByKey.set(key, [...(linkClaimsByKey.get(key) ?? []), c.id]);
  }
  const links: AuditLink[] = linkRows.map((l) => ({
    clubId: l.clubId,
    kind: l.kind,
    url: l.url,
    normalizedUrl: l.normalizedUrl,
    handle: l.handle,
    label: l.label,
    status: l.status,
    discoveredVia: l.discoveredVia,
    claimIds: linkClaimsByKey.get(`${l.clubId}|${l.normalizedUrl}`) ?? [],
    pageTitle: l.snapAt ? l.pageTitle : null,
    formClosed: Boolean(l.formClosed),
    lastFetch:
      l.fetchStatus && l.fetchedAt
        ? { status: l.fetchStatus, httpStatus: l.httpStatus, at: new Date(l.fetchedAt), error: l.fetchError }
        : null,
    lastSnapshot:
      l.finalUrl && l.snapAt
        ? {
            finalUrl: l.finalUrl,
            at: new Date(l.snapAt),
            parked: Boolean(l.parkedText) || PARKED_HOSTS.test(new URL(l.finalUrl).hostname),
          }
        : null,
  }));

  const cycleRows = await rows<AuditCycle>(
    db,
    sql`select rc.id, rc.club_id as "clubId", rc.term_key as "termKey", rc.opens_value as opens,
          rc.deadline_value as deadline, rc.stated_status as "statedStatus"
        from recruiting_cycle rc join club k on k.id = rc.club_id and k.record_state = 'active'`,
  );

  const decided = await rows<{ a: string; b: string }>(
    db,
    sql`select club_a_id as a, club_b_id as b from merge_candidate where status <> 'proposed'`,
  );
  const summarySnapshots = [
    ...new Set(
      claims
        .filter((c) => c.fieldKey === "club.summary")
        .flatMap((c) => c.evidence.map((e) => e.snapshotId))
        .filter((s): s is string => Boolean(s)),
    ),
  ];
  const snapshotText = new Map<string, string>();
  if (summarySnapshots.length) {
    const texts = await rows<{ id: string; text: string | null }>(
      db,
      sql`select id, extracted_text as text from source_snapshot where id in (${sql.join(
        summarySnapshots.map((s) => sql`${s}`),
        sql`, `,
      )})`,
    );
    for (const t of texts) if (t.text) snapshotText.set(t.id, t.text);
  }

  // News quotes are cut at 240 characters; the article itself tells whether it names the club.
  const cutPress = [
    ...new Set(
      claims
        .filter((c) => c.fieldKey === "club.press_mention")
        .flatMap((c) => c.evidence.filter((e) => (e.quote ?? "").length >= 239).map((e) => e.snapshotId))
        .filter((x): x is string => Boolean(x)),
    ),
  ];
  const articleText = new Map<string, string>();
  if (cutPress.length) {
    const texts = await rows<{ id: string; text: string | null }>(
      db,
      sql`select id, extracted_text as text from source_snapshot where id in (${sql.join(
        cutPress.map((x) => sql`${x}`),
        sql`, `,
      )})`,
    );
    for (const t of texts) if (t.text) articleText.set(t.id, t.text);
  }
  const dismissals = await rows<{ clubId: string; check: string; subject: string }>(
    db,
    sql`select target_id as "clubId", payload->>'check' as check, coalesce(payload->>'subject', '*') as subject
        from editorial_decision where action = 'audit_dismiss'`,
  );

  return {
    now,
    articleText,
    dismissed: new Set(dismissals.map((d) => `${d.check}|${rootOf.get(d.clubId) ?? d.clubId}|${d.subject}`)),
    clubs,
    claims,
    rejectedLinkClaims,
    links,
    cycles: cycleRows,
    decidedPairs: new Set(decided.map((d) => `${d.a}|${d.b}`)),
    snapshotText,
    categoryTop,
  };
}

/** Domain-parking and resale services. */
export const PARKED_HOSTS =
  /(^|\.)(hugedomains\.com|sedo\.com|sedoparking\.com|dan\.com|afternic\.com|parkingcrew\.net|bodis\.com|godaddy\.com|undeveloped\.com|domainmarket\.com)$/i;
