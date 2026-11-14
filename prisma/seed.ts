import "dotenv/config"
import { PrismaClient } from "../src/generated/prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
const adapter = new PrismaPg(process.env.DATABASE_URL!)
const prisma = new PrismaClient({ adapter })

const DEFAULT_OWNER_EMAIL = "owner@rolespec.local"
const OWNER_EMAIL = process.env.SEED_OWNER_EMAIL?.trim() || DEFAULT_OWNER_EMAIL
const OWNER_NAME = process.env.SEED_OWNER_NAME?.trim() || "RoleSpec Owner"

const isProduction = process.env.NODE_ENV === "production"

/**
 * Seeds the single owner row. There is no password and no demo login: access is
 * decided by ROLSPEC_ACCESS_MODE, not by a credential.
 *
 * Re-running the seed is safe; it updates the owner and never duplicates rows.
 * Development additionally gets one sample résumé so the editor has something
 * to open, but production only gets the owner.
 */
async function seedOwner(): Promise<{ id: string }> {
  const owner = await prisma.user.upsert({
    where: { email: OWNER_EMAIL },
    update: { role: "ADMIN", status: "ACTIVE", name: OWNER_NAME },
    create: {
      email: OWNER_EMAIL,
      name: OWNER_NAME,
      role: "ADMIN",
      status: "ACTIVE",
    },
  })

  await prisma.playerProfile.upsert({
    where: { userId: owner.id },
    update: {},
    create: isProduction
      ? { userId: owner.id }
      : {
          userId: owner.id,
          currentRole: "Registered Nurse",
          targetRole: "Nurse Manager",
          experienceLevel: "SENIOR",
        },
  })

  console.log(`✓ Seeded owner: ${OWNER_EMAIL}`)
  return owner
}

async function main() {
  const admin = await seedOwner()

  // ── Sample résumé (development only) ──────────────────────────────────────
  const existingResume = admin
    ? await prisma.resume.findFirst({
        where: { userId: admin.id, title: "ICU Registered Nurse Resume" },
      })
    : null

  if (admin && !isProduction && !existingResume) {
    await prisma.resume.create({
      data: {
        userId: admin.id,
        title: "ICU Registered Nurse Resume",
        targetRole: "Nurse Manager",
        targetCompany: "Lakeside Regional Medical Center",
        template: "MODERN",
        status: "ACTIVE",
        sections: {
          create: [
            {
              type: "CONTACT",
              title: "Contact",
              order: 0,
              items: {
                create: [
                  {
                    order: 0,
                    content: {
                      fullName: "RoleSpec Owner",
                      email: "owner@rolespec.local",
                      phone: "+1 555-000-1234",
                      location: "Portland, OR",
                      linkedin: "",
                      github: "",
                    },
                  },
                ],
              },
            },
            {
              type: "SUMMARY",
              title: "Professional Summary",
              order: 1,
              items: {
                create: [
                  {
                    order: 0,
                    content: {
                      text: "Critical care Registered Nurse (BSN, RN, CCRN) with 8+ years in a 24-bed medical ICU and Level II trauma center. Charge nurse for shifts of 12-18 clinical staff, with a record of protocol rollouts that cut medication errors and infection rates. Preparing to step into a nurse manager role focused on staffing, quality metrics, and new-graduate retention.",
                    },
                  },
                ],
              },
            },
            {
              type: "EXPERIENCE",
              title: "Experience",
              order: 2,
              items: {
                create: [
                  {
                    order: 0,
                    content: {
                      title: "Charge Nurse, Medical ICU",
                      company: "Lakeside Regional Medical Center",
                      location: "Portland, OR",
                      startDate: "2021-03",
                      endDate: "",
                      current: true,
                      bullets: [
                        "Ran charge for a 24-bed medical ICU at a 1:2 nurse-to-patient ratio, holding unit overtime under 4% so acuity-based assignments stayed safe through winter surge",
                        "Led a sepsis bundle rollout to 40 nurses, cutting time to first antibiotic from 78 to 41 minutes and raising bundle compliance to 94%, moving the unit off the quality watch list",
                        "Rebuilt barcode medication administration in Epic, reducing reported medication errors 32% year over year by removing the manual override step nurses used most",
                        "Precepted 11 new-graduate nurses through a 16-week residency, retaining 10 past their first year and shortening orientation by two weeks per hire",
                      ],
                    },
                  },
                  {
                    order: 1,
                    content: {
                      title: "Registered Nurse, Medical-Surgical / Telemetry",
                      company: "St. Aubrey Community Hospital",
                      location: "Salem, OR",
                      startDate: "2018-06",
                      endDate: "2021-02",
                      current: false,
                      bullets: [
                        "Carried a 1:5 telemetry assignment on nights and completed hourly rounding on 98% of audited patients, cutting the unit fall rate from 3.4 to 1.9 per 1,000 patient days",
                        "Standardized bedside handoff with an SBAR checklist for 28 nurses, dropping handoff-related incident reports 45% because omitted drip and telemetry details were caught at the bedside",
                        "Revised the CAUTI prevention protocol on the unit practice council, holding zero catheter-associated infections for 9 consecutive months",
                      ],
                    },
                  },
                ],
              },
            },
            {
              type: "SKILLS",
              title: "Skills",
              order: 3,
              items: {
                create: [
                  {
                    order: 0,
                    content: {
                      category: "Clinical Skills",
                      skills: [
                        "Critical care",
                        "Ventilator management",
                        "Vasoactive drips",
                        "Hemodynamic monitoring",
                        "Sepsis bundle",
                        "Patient and family education",
                      ],
                    },
                  },
                  {
                    order: 1,
                    content: {
                      category: "Certifications",
                      skills: ["RN (OR license)", "BSN", "CCRN", "BLS", "ACLS", "PALS", "NIHSS"],
                    },
                  },
                  {
                    order: 2,
                    content: {
                      category: "Systems",
                      skills: ["Epic EHR", "Cerner", "Pyxis MedStation", "Philips IntelliVue"],
                    },
                  },
                ],
              },
            },
            {
              type: "EDUCATION",
              title: "Education",
              order: 4,
              items: {
                create: [
                  {
                    order: 0,
                    content: {
                      degree: "B.S. Nursing (BSN)",
                      school: "Oregon Health & Science University",
                      location: "Portland, OR",
                      graduationDate: "2018-05",
                      gpa: "3.8",
                    },
                  },
                ],
              },
            },
          ],
        },
      },
    })
  }
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
