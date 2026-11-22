# Career Path Intelligence — dataset evaluation

**Status:** implemented with a local, versioned 25-role catalogue. No ESCO or
O*NET content is bundled, imported or redistributed today. This note records
what was evaluated, what was decided, and what would be required before adopting
an upstream dataset.

## Decision summary

The shipped catalogue (`career-path-seed-2026.11.1`) is a locally written
crosswalk seed. Titles, summaries, capability requirements and adjacent/growth
edges are original to this project. It does **not** copy upstream descriptions,
labels or codes, and it contains **no salary data**. The deterministic engine
therefore reports `salaryPotential: null` for every role rather than inventing a
regional pay figure.

That is a deliberate first step, not a claim that a local seed is a substitute
for a maintained taxonomy:

- ESCO and O*NET are large, structurally different datasets that change between
  releases. Bundling them would add a substantial data-ingestion surface to a
  feature that must stay explainable and auditable.
- The ESCO download portal is form-gated and its direct links can lag the
  current release. O*NET distribution has repeatedly changed format and schema
  layout (see 30.3 below).
- Career Path Intelligence only needs a stable capability layer, a small set of
  occupations and an explicit graph. Upstream taxonomies can later enrich that
  layer without making the UI or scoring engine depend on upstream identifiers.
- A local seed can be tested exhaustively, attributed honestly and revised
  without a data-licence review on every code change.

The long-term recommendation is to adopt upstream occupational anchors once a
maintained import pipeline and migration tests exist. Do not silently describe
the current seed as "ESCO" or "O*NET" data.

## ESCO assessment

| Question | Finding |
| --- | --- |
| Current release evaluated | ESCO v1.2.1, December 2025. The release news is dated 22 December 2025; the site footer shows an inconsistent earlier date, so cite "December 2025". The prior major release was v1.2 (May 2024). |
| Nature of v1.2.1 | Quality/maintenance release: translation fixes, duplicate-label removal, revised occupation-skill links, green-skill revisions and alternative labels. It is not a new conceptual model. |
| Machine-readable formats | CSV, ODS, RDF, TTL, JSON-LD and XML. Delta files are CSV. A local API package and an OWL/SKOS model are also published. |
| Access | The download portal is form-gated (privacy statement, email, emailed link). The public web-service API at `https://ec.europa.eu/esco/api` supports `selectedVersion`; it is the more practical integration path than a scraped download link. Do not hard-code a direct archive URL as "latest". |
| Licence | Reuse is permitted under Commission Decision 2011/833/EU on reuse of Commission documents: free of charge, for any purpose, including mapping and commercial reuse. There is no share-alike condition. |
| Required attribution | For a service, tool or application: **"This service uses the ESCO classification of the European Commission."** Modified or adapted versions must be clearly indicated as modified/adapted. |
| Software licence | The ESCO API software is licensed separately under EUPL 1.2. That is not the data licence. |
| Mapping/redistribution | Occupation and skill mappings may be redistributed. Attribution and the modified-version notice still apply. |
| Fit for this feature | Strong occupation and skill vocabulary, with explicit `essential`/`optional` occupation-skill relations. Weaker for transferable/soft skills: ESCO advises against linking transversal skills to occupations, and many such links were removed. Its scope is European, while the catalogue must serve global users. |
| Operational risks | Form-gated downloads, versioned API responses, multilingual labels, and periodic revisions to occupation-skill links. |

The mapping edge that matters most is ESCO's `occupationSkillRelations`:
`occupationUri`, `skillUri`, and `relationType` (`essential` or `optional`).
"Essential" means usually required independent of employer or country;
"optional" means it may be required depending on context. Neither is a
proficiency level.

## O*NET assessment

| Question | Finding |
| --- | --- |
| Current release evaluated | O*NET 31.0, August 2026. Version 30.3 (May 2026) was a structural release that modernised the content model and renamed/restructured files. |
| Important schema change | The old `skills` table is gone in 31.0. Use `essential_skills` and `transferable_skills`, plus `abilities`, `knowledge`, `work_activities`, tasks, detailed work activities, work context, work styles and software skills. |
| Formats | Excel, CSV, JSON, tab-delimited text, SQL, RDF and web services. CSV, JSON and RDF were added in July 2026, so older tutorials may list only Excel/text/SQL. |
| Access | Current and archived releases are published on O*NET Center; the web-service API is rate-limited and keyed. Downloads are more reproducible for an offline import. |
| Licence | Database content is generally CC BY 4.0, except content noted otherwise (Career Exploration Tools, website content, some third-party content and web-service data may have separate terms). Redistribution, adaptation and commercial use are permitted with attribution. |
| Required attribution | **"This page includes information from the O*NET 31.0 Database by the U.S. Department of Labor, Employment and Training Administration (USDOL/ETA). Used under the CC BY 4.0 license. O*NET® is a trademark of USDOL/ETA."** Link to the CC BY 4.0 licence and include the version number. |
| If modified | Add: **"[Your name or company] has modified all or some of this information. USDOL/ETA has not approved, endorsed, or tested these modifications."** Mark where changes were made. |
| Trademark | Always write **O*NET®** as an adjective, not possessively or in the plural. Do not imply endorsement by USDOL/ETA. |
| Fit for this feature | Rich US occupational data for skills, abilities, knowledge and work activities. Useful for weighting and explaining requirements. It is US labour-market information, not a global eligibility or pay source. |
| Operational risks | Taxonomy churn, survey estimates with suppression flags, uneven `date_updated` values, and web-service terms that differ from the database licence. |

O*NET ratings are survey estimates, not facts about an individual or a specific
posting. Any future use must preserve sample size, confidence interval,
`recommend_suppress` and `not_relevant` flags rather than treating a rating as a
hard requirement.

## ESCO ↔ O*NET crosswalk

| Question | Finding |
| --- | --- |
| Exists? | Yes. Jointly produced by the European Commission (DG EMPL) and U.S. DOL/ETA, published October 2022. |
| Scope | **Occupation-level only.** There is no official validated ESCO-skill ↔ O*NET-skill crosswalk. |
| Currency | It maps O*NET to ESCO v1.1. No version number is published on the crosswalk page, and it has not been refreshed for ESCO 1.2.x or O*NET 30.x/31.0. Treat it as a 2022 artifact. |
| Variants | A QA'd exact/narrow/broad/close variant, and a variant that adds "related" matches which were not validated and are explicitly lower quality. Do not use the unvalidated variant for recommendations. |
| Licence | No separate crosswalk licence is stated. Treat it as a derivative of both sources: ESCO reuse terms plus O*NET CC BY 4.0, with both attribution strings and a modification notice. Flag this inference in any future licence review. |
| Fit | Suitable only as an occupation bridge after matching skills inside one taxonomy. It cannot justify a skill-to-skill claim. |

Crosswalk files are distributed through ESCO's "Other Crosswalks" page and
O*NET's crosswalk files. Any import must record the crosswalk's publication
date, source URL, the versions it actually targets, and whether the unvalidated
"related" rows were excluded.

## Mapping design used now

The current contract keeps an explicit local layer between user evidence and
occupations:

- `CareerOccupation.requirements` and `.preferred` reference stable local
  capability keys (`programming`, `customer-success`, `project-management`, …),
  never upstream labels.
- Each capability key has display aliases for free-text profile skills and one
  concrete learning step. Unknown names are ignored, not guessed by substring.
- Each occupation has `adjacentIds` and `growthIds`. These edges drive the three
  recommendation groups and branch navigation.
- `CareerOccupation.references` is optional and currently omitted because no
  upstream identifiers were imported. If identifiers are added later they must
  be accompanied by the source dataset and version; do not invent ESCO URIs or
  O*NET-SOC codes.
- Scoring, evidence status and explanations are deterministic and live in
  `engine.ts`. The UI consumes the serialised result, not Prisma rows or
  upstream files.

### If ESCO or O*NET is adopted

1. Match free-text capabilities **inside one taxonomy first**, then use the
   occupation crosswalk. Do not infer a skill equivalence from an occupation
   mapping.
2. Map ESCO `essential` relations to higher weights and `optional` relations to
   preferred requirements. Preserve the distinction between relevance and
   proficiency; do not convert either into a skill level without data.
3. Store the upstream concept URI, upstream version, import date and relation
   type on every mapping. Keep the local capability key as the stable API.
4. Use O*NET `essential_skills`/`transferable_skills` (31.0+), not the removed
   `skills` table. For older archived data, version the importer separately.
5. Exclude suppressed/not-relevant O*NET ratings from scoring, or surface them
   as unknown. Never turn a survey estimate into a hiring requirement.
6. Keep salary potential absent unless a separate, licensed regional pay series
   with a date and region is imported. Occupational taxonomies do not supply
   trustworthy pay figures, and O*NET is not a global salary source.
7. Add a migration test that fails when expected files, columns, versions or
   relation types change. A green import against stale documentation is worse
   than a failed import.

## Licensing obligations if upstream data is adopted

### ESCO

- Display: **"This service uses the ESCO classification of the European Commission."**
- If requirements were adapted or reweighted: state that the ESCO-derived mapping
  has been modified and is not an official ESCO product.
- Keep the attribution visible where ESCO-derived recommendations or occupation
  labels are shown, not only in a repository README.
- Do not apply the EUPL 1.2 software licence to ESCO data; it covers the API
  software separately.

### O*NET

- Display the exact 31.0 attribution string, including the CC BY 4.0 link and
  the O*NET® trademark statement, wherever O*NET-derived content appears.
- If content is adapted: include the modification notice and identify the
  changes.
- Do not imply USDOL/ETA endorsement. Do not use O*NET® as a possessive or a
  plural noun.
- Keep third-party or website content out unless it has its own permission; the
  CC BY 4.0 database licence does not automatically cover it.

### Crosswalk

- Credit both the European Commission (ESCO v1.1) and USDOL/ETA (O*NET), state
  that the crosswalk was adapted if it was filtered or joined, and include both
  licences' requirements.
- Note the crosswalk's date and the versions it actually targets. Do not present
  it as current for ESCO 1.2.1 or O*NET 31.0.

## Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Dataset staleness | Pin versions in code and tests; record import dates; show the local catalogue version in the UI. |
| Granularity asymmetry | Match at capability-key level; keep occupation mappings many-to-many; never require a 1:1 skill match. |
| Under-linked transferable/soft skills | Keep local transferable keys and broad coordinator/CS/marketing requirements; do not rely solely on ESCO links. |
| O*NET is US labour-market data | Use it for requirement structure, not global eligibility or pay. Mark geography unknown unless a source supports a claim. |
| Free-text lossiness | Exact alias resolution only, conflict reporting, human confirmation of evidence, and explicit "missing" states. ESCO's own ML work reports modest top-5 occupation accuracy, so never auto-confirm a match. |
| Form-gated ESCO downloads | Use the versioned API or a manually approved, checksummed import; do not scrape ephemeral links. |
| O*NET schema churn (30.3/31.0) | Version-specific importers and a failing migration test. The 31.0 `essential_skills`/`transferable_skills` split is mandatory. |
| Licence drift or unclear crosswalk terms | Re-review before redistribution; retain attribution strings and modification notices in the UI, not only in docs. |
| Recommendations read as promises | Explain evidence coverage, missing requirements and feasibility; keep salary absent; never write to confirmed evidence. |

## Version pinning and migration checklist

- [ ] Upstream dataset and version recorded next to every imported row.
- [ ] Local catalogue version bumped and surfaced in the UI.
- [ ] Import fixture for the exact release; checksum or release URL recorded.
- [ ] Expected files/columns asserted (for O*NET 31.0: `essential_skills`,
      `transferable_skills`, not `skills`).
- [ ] ESCO `essential`/`optional` relations preserved; no proficiency inference.
- [ ] Crosswalk date and target versions recorded; unvalidated rows excluded.
- [ ] Attribution and modification notices rendered wherever derived data
      appears.
- [ ] Salary potential stays null unless a dated, regional, licensed series is
      added.
- [ ] Deterministic persona tests still pass after re-import.

## Sources

- ESCO versions: https://esco.ec.europa.eu/en/about-esco/escopedia/escopedia/esco-versions
- ESCO v1.2.1 release: https://esco.ec.europa.eu/en/news/esco-v121-live
- ESCO download: https://esco.ec.europa.eu/en/use-esco/download
- ESCO API: https://ec.europa.eu/esco/api/doc/esco_api_doc.html
- ESCO FAQ and reuse terms: https://esco.ec.europa.eu/en/about-esco/faq
- ESCO structure and datasets: https://esco.ec.europa.eu/en/structure-esco-downloadable-datasets
- ESCO ↔ O*NET crosswalk: https://esco.ec.europa.eu/en/about-esco/data-science-and-esco/crosswalk-between-esco-and-onet
- O*NET database releases: https://www.onetcenter.org/db_releases.html
- O*NET database downloads: https://www.onetcenter.org/database.html
- O*NET database licence: https://www.onetcenter.org/license_db.html
- O*NET crosswalks: https://www.onetcenter.org/crosswalks.html
- O*NET 31.0 essential skills dictionary: https://www.onetcenter.org/dictionary/31.0/mysql/essential_skills.html
- Commission Decision 2011/833/EU: https://eur-lex.europa.eu/eli/dec/2011/833/oj
