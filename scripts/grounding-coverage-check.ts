/**
 * Deterministic coverage check for career-neutral requirement extraction.
 *
 * Usage:
 *   npx tsx scripts/grounding-coverage-check.ts     # no AI calls, no database
 *
 * `extractRequirementTerms()` decides what the DO NOT CLAIM block can contain,
 * so whatever it cannot see is a requirement the grounding feature will never
 * protect the user against. Every qualifying shape used to need a capital
 * letter, which read a software posting well and almost nothing else: measured
 * here before the phrase pass, 7/8 on the software posting and 1-2 out of 8-10
 * on the nurse, accountant, cook and warehouse postings.
 *
 * Run this after touching the extractor. A "miss" that names a LONGER phrase
 * than the fixture's ("cold chain handling" for "cold chain") is a pass, not a
 * regression — read the extracted list, not only the score.
 */
import { extractRequirementTerms } from "@/shared/lib/application-grounding"

const POSTINGS: Record<string, { text: string; real: string[] }> = {
  "Software engineer (the shape it was designed on)": {
    text: `Senior Java Engineer
What we are looking for:
- 5+ years of Java, with deep Spring Boot experience
- Strong JPQL and Hibernate skills
- Production experience with JMS and Kafka
- Comfortable with Kubernetes and Terraform`,
    real: ["Java", "Spring Boot", "JPQL", "Hibernate", "JMS", "Kafka", "Kubernetes", "Terraform"],
  },
  "Registered nurse": {
    text: `Registered Nurse — Medical/Surgical Unit
What we are looking for:
- 2+ years of acute care experience in a hospital setting
- Current BLS and ACLS certification
- Proficiency in venipuncture, wound care and catheter insertion
- Experience with electronic health records and medication administration
- Comfortable with patient triage and discharge planning`,
    real: ["acute care", "BLS", "ACLS", "venipuncture", "wound care", "catheter insertion",
      "electronic health records", "medication administration", "triage", "discharge planning"],
  },
  "Staff accountant": {
    text: `Staff Accountant
What we are looking for:
- 3+ years of experience with accounts payable and accounts receivable
- Strong knowledge of month-end close and bank reconciliation
- Proficiency in general ledger maintenance and journal entries
- Experience with payroll processing and sales tax filings
- Advanced Excel; QuickBooks a plus`,
    real: ["accounts payable", "accounts receivable", "month-end close", "bank reconciliation",
      "general ledger", "journal entries", "payroll processing", "sales tax", "Excel", "QuickBooks"],
  },
  "Line cook": {
    text: `Line Cook — Fine Dining
What we are looking for:
- 2 years on a hot line in a high-volume kitchen
- Skilled in butchery, sauce work and pastry
- Experience with a la carte service and banquet plating
- Knowledge of food safety and inventory control
- ServSafe certification preferred`,
    real: ["hot line", "butchery", "sauce work", "pastry", "a la carte", "banquet plating",
      "food safety", "inventory control", "ServSafe"],
  },
  "Warehouse / logistics": {
    text: `Warehouse Associate
What we are looking for:
- Experience with forklift operation and pallet jacks
- Knowledge of inventory control and cycle counting
- Comfortable with order picking and shipping documentation
- Familiarity with cold chain handling
- OSHA certification a plus`,
    real: ["forklift operation", "pallet jacks", "inventory control", "cycle counting",
      "order picking", "shipping documentation", "cold chain", "OSHA"],
  },
}

for (const [career, { text, real }] of Object.entries(POSTINGS)) {
  const got = extractRequirementTerms(text, [])
  const gotLower = got.map((t) => t.toLowerCase())
  const found = real.filter((r) => gotLower.includes(r.toLowerCase()))
  const missed = real.filter((r) => !gotLower.includes(r.toLowerCase()))
  console.log(`\n### ${career}`)
  console.log(`  extracted (${got.length}): ${got.join(", ") || "(none)"}`)
  console.log(`  real requirements caught: ${found.length}/${real.length}`)
  console.log(`  MISSED: ${missed.join(", ") || "(none)"}`)
}
