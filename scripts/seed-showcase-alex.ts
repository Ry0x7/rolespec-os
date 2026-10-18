import "dotenv/config"
import { prisma } from "@/shared/lib/prisma"

const DEV_ADMIN_EMAIL = "dev-admin@rolespec.local"

async function main() {
  console.log("Seeding showcase dummy data for Alex Morgan...")

  const user = await prisma.user.findUnique({
    where: { email: DEV_ADMIN_EMAIL },
  })

  if (!user) {
    throw new Error(`User ${DEV_ADMIN_EMAIL} not found. Run seed-dev-admin.ts first.`)
  }

  // 1. Update user profile name
  await prisma.user.update({
    where: { id: user.id },
    data: { name: "Alex Morgan" },
  })

  // 2. Seed Career Profile
  const careerProfile = await prisma.careerProfile.upsert({
    where: { userId: user.id },
    create: {
      userId: user.id,
      contactFullName: "Alex Morgan",
      contactEmail: "alex.morgan@example.com",
      contactPhone: "+1 (555) 349-2041",
      contactLocation: "San Francisco, CA (Remote)",
      githubUrl: "https://github.com/alexmorgan",
      linkedinUrl: "https://linkedin.com/in/alexmorgan",
      websiteUrl: "https://alexmorgan.dev",
      experienceLevel: "SENIOR",
      locations: ["Remote", "San Francisco, CA", "New York, NY"],
      openToRelocation: false,
      workModes: ["REMOTE", "HYBRID"],
      salaryMin: 180000,
      salaryMax: 260000,
      salaryPeriod: "YEARLY",
      salaryCurrency: "USD",
      careerGoals: "Staff/Lead software engineer targeting high-scale distributed backend and platform architecture.",
    },
    update: {
      contactFullName: "Alex Morgan",
      contactEmail: "alex.morgan@example.com",
      contactPhone: "+1 (555) 349-2041",
      contactLocation: "San Francisco, CA (Remote)",
      githubUrl: "https://github.com/alexmorgan",
      linkedinUrl: "https://linkedin.com/in/alexmorgan",
      websiteUrl: "https://alexmorgan.dev",
      experienceLevel: "SENIOR",
      locations: ["Remote", "San Francisco, CA", "New York, NY"],
      salaryMin: 180000,
      salaryMax: 260000,
    },
  })

  // Seed target roles
  const targetRoles = [
    { title: "Staff Infrastructure Engineer", priority: 0 },
    { title: "Senior Distributed Systems Engineer", priority: 1 },
    { title: "Principal Product Engineer", priority: 2 },
  ]

  for (const tr of targetRoles) {
    await prisma.careerTargetRole.upsert({
      where: {
        careerProfileId_title: {
          careerProfileId: careerProfile.id,
          title: tr.title,
        },
      },
      create: {
        careerProfileId: careerProfile.id,
        title: tr.title,
        priority: tr.priority,
        active: true,
      },
      update: {
        priority: tr.priority,
        active: true,
      },
    })
  }

  // 3. Create or update the showcase Master Resume
  const resumeId = "showcase_alex_morgan_resume"
  await prisma.resume.upsert({
    where: { id: resumeId },
    create: {
      id: resumeId,
      userId: user.id,
      title: "Staff Systems & Platform Engineer",
      targetRole: "Staff Software Engineer",
      targetCompany: "Cloud Distributed Platforms",
      template: "MODERN",
      status: "ACTIVE",
      variant: "MASTER",
      atsScore: 94,
    },
    update: {
      title: "Staff Systems & Platform Engineer",
      targetRole: "Staff Software Engineer",
      targetCompany: "Cloud Distributed Platforms",
      template: "MODERN",
      status: "ACTIVE",
      variant: "MASTER",
      atsScore: 94,
    },
  })

  // Rebuild sections
  await prisma.resumeSection.deleteMany({ where: { resumeId } })

  // Contact section
  await prisma.resumeSection.create({
    data: {
      resumeId,
      type: "CONTACT",
      title: "Contact",
      order: 0,
      visible: true,
      items: {
        create: [
          {
            order: 0,
            content: {
              fullName: "Alex Morgan",
              jobTitle: "Staff Software Engineer",
              email: "alex.morgan@example.com",
              phone: "+1 (555) 349-2041",
              location: "San Francisco, CA (Remote)",
              website: "alexmorgan.dev",
              github: "github.com/alexmorgan",
              linkedin: "linkedin.com/in/alexmorgan",
            },
          },
        ],
      },
    },
  })

  // Summary section
  await prisma.resumeSection.create({
    data: {
      resumeId,
      type: "SUMMARY",
      title: "Executive Summary",
      order: 1,
      visible: true,
      items: {
        create: [
          {
            order: 0,
            content: {
              text: "Staff Software Engineer with 8+ years architecting high-throughput distributed systems, real-time web applications, and developer platforms. Track record leading technical initiatives that scale from 0 to 10M+ users with 99.99% reliability. Passionate about database performance, API ergonomics, and reactive systems.",
            },
          },
        ],
      },
    },
  })

  // Experience section
  await prisma.resumeSection.create({
    data: {
      resumeId,
      type: "EXPERIENCE",
      title: "Work Experience",
      order: 2,
      visible: true,
      items: {
        create: [
          {
            order: 0,
            content: {
              role: "Staff Infrastructure Engineer",
              company: "Veloce Cloud",
              location: "San Francisco, CA",
              startDate: "2022-04",
              endDate: "",
              current: true,
              bullets: [
                "Architected real-time event pipeline handling 65,000 ops/sec using Node.js, Go, and Apache Kafka with 99.99% uptime SLA.",
                "Engineered multi-region active-active PostgreSQL sync, cutting cross-region read latency by 42% and eliminating read replica drift.",
                "Mentored 14 engineers across backend and platform guilds, driving automated canary verification and zero-downtime database migrations.",
                "Reduced annual AWS cloud infrastructure expenditures by $180,000 through ARM64 Graviton instances and automated query plan optimization.",
              ],
            },
          },
          {
            order: 1,
            content: {
              role: "Senior Full-Stack Engineer",
              company: "ChronoScale",
              location: "Remote",
              startDate: "2019-06",
              endDate: "2022-03",
              current: false,
              bullets: [
                "Led core engineering team rebuilding the customer telemetry dashboard in Next.js, React, and Tailwind CSS, increasing DAU by 35%.",
                "Designed GraphQL and gRPC microservices reducing API payload size by 60% and cutting client render times in half.",
                "Implemented automated CI/CD canary deployments with Docker and Kubernetes, reducing release rollback frequency to under 1%.",
              ],
            },
          },
          {
            order: 2,
            content: {
              role: "Software Engineer",
              company: "Apex Labs",
              location: "Seattle, WA",
              startDate: "2016-08",
              endDate: "2019-05",
              current: false,
              bullets: [
                "Developed scalable full-stack features using TypeScript, React, and PostgreSQL for over 250 enterprise customers.",
                "Built Redis caching tier saving $45,000/year in database compute costs while improving p95 response time by 210ms.",
              ],
            },
          },
        ],
      },
    },
  })

  // Skills section
  await prisma.resumeSection.create({
    data: {
      resumeId,
      type: "SKILLS",
      title: "Technical Skills",
      order: 3,
      visible: true,
      items: {
        create: [
          {
            order: 0,
            content: {
              category: "Languages",
              skills: ["TypeScript", "JavaScript", "Go", "Python", "SQL", "Rust"],
            },
          },
          {
            order: 1,
            content: {
              category: "Frontend",
              skills: ["React 19", "Next.js 16", "Tailwind CSS", "Framer Motion", "Zustand", "React Query"],
            },
          },
          {
            order: 2,
            content: {
              category: "Backend & Cloud",
              skills: ["Node.js", "PostgreSQL", "Redis", "Apache Kafka", "Docker", "Kubernetes", "AWS", "GraphQL"],
            },
          },
          {
            order: 3,
            content: {
              category: "Architecture & DevOps",
              skills: ["Distributed Systems", "Microservices", "CI/CD Pipelines", "Zero-Trust Security", "Database Tuning"],
            },
          },
        ],
      },
    },
  })

  // Education section
  await prisma.resumeSection.create({
    data: {
      resumeId,
      type: "EDUCATION",
      title: "Education",
      order: 4,
      visible: true,
      items: {
        create: [
          {
            order: 0,
            content: {
              degree: "Bachelor of Science in Computer Science",
              field: "Computer Science & Distributed Systems",
              school: "University of California, Berkeley",
              startDate: "2012-08",
              endDate: "2016-05",
            },
          },
        ],
      },
    },
  })

  // Projects section
  await prisma.resumeSection.create({
    data: {
      resumeId,
      type: "PROJECTS",
      title: "Featured Projects",
      order: 5,
      visible: true,
      items: {
        create: [
          {
            order: 0,
            content: {
              name: "HyperQueue — High-Throughput Distributed Task Engine",
              technologies: ["Go", "Redis", "gRPC", "Docker"],
              bullets: [
                "Engineered distributed worker pool supporting priority queues, dead-letter retries, and exactly-once execution semantics.",
                "Achieved benchmark throughput of 120,000 tasks/second with sub-5ms dispatch latency under sustained load.",
              ],
            },
          },
          {
            order: 1,
            content: {
              name: "PulseStream — Real-Time Telemetry Observability Suite",
              technologies: ["TypeScript", "Next.js", "ClickHouse", "Tailwind CSS"],
              bullets: [
                "Built an open-source analytics monitor rendering real-time metrics with interactive Canvas visualizations.",
                "Adopted by 500+ developers with 1.8k GitHub stars.",
              ],
            },
          },
        ],
      },
    },
  })

  // Seed ATS Analysis for this resume
  await prisma.aTSAnalysis.deleteMany({ where: { resumeId } })
  await prisma.aTSAnalysis.create({
    data: {
      resumeId,
      userId: user.id,
      overallScore: 94,
      scores: {
        formatting: 96,
        impact: 92,
        brevity: 95,
        skills: 94,
      },
      issues: [],
      suggestions: [
        "Include more concrete metrics in earlier roles to match current Staff achievements.",
        "Consider linking directly to live demo URLs for open-source projects.",
      ],
      mode: "QUALITY",
    },
  })

  // 4. Clean up any other old resumes belonging to dev admin to avoid accidental contamination
  const otherResumes = await prisma.resume.findMany({
    where: {
      userId: user.id,
      id: { not: resumeId },
    },
    include: {
      sections: {
        include: { items: true },
      },
    },
  })

  for (const r of otherResumes) {
    for (const s of r.sections) {
      if (s.type === "CONTACT") {
        for (const it of s.items) {
          const content = it.content as Record<string, unknown>
          if (content?.fullName && content.fullName !== "Alex Morgan") {
            await prisma.resumeSectionItem.update({
              where: { id: it.id },
              data: {
                content: {
                  ...content,
                  fullName: "Alex Morgan",
                  email: "alex.morgan@example.com",
                  phone: "+1 (555) 349-2041",
                  github: "github.com/alexmorgan",
                  linkedin: "linkedin.com/in/alexmorgan",
                  location: "San Francisco, CA (Remote)",
                },
              },
            })
          }
        }
      }
    }
  }

  // 5. Seed rich Jobs & Applications for Workspace Kanban and Job Tracker
  // Remove previous dev-admin jobs to keep the board clean and visually pristine
  const existingApps = await prisma.jobApplication.findMany({
    where: { userId: user.id },
    select: { id: true, jobId: true },
  })
  if (existingApps.length > 0) {
    await prisma.jobApplication.deleteMany({ where: { userId: user.id } })
  }
  await prisma.job.deleteMany({ where: { userId: user.id } })

  const showcaseJobs = [
    {
      id: "job_stripe_infra",
      companyName: "Stripe",
      title: "Staff Infrastructure Engineer",
      location: "San Francisco, CA (Remote)",
      jobType: "FULL_TIME" as const,
      workType: "REMOTE" as const,
      salary: 235000,
      salaryPeriod: "YEARLY" as const,
      salaryCurrency: "USD" as const,
      url: "https://stripe.com/jobs/infra",
      description: "Scale core financial infrastructure handling billions in global commerce transactions.",
      status: "INTERESTED" as const,
      matchScore: 96,
      notes: "Referral via Sarah K. Focus on distributed ledger consensus and PostgreSQL multi-region.",
    },
    {
      id: "job_vercel_platform",
      companyName: "Vercel",
      title: "Senior Platform Engineer",
      location: "Remote, US",
      jobType: "FULL_TIME" as const,
      workType: "REMOTE" as const,
      salary: 215000,
      salaryPeriod: "YEARLY" as const,
      salaryCurrency: "USD" as const,
      url: "https://vercel.com/careers/platform",
      description: "Build Next.js deployment runtime and global edge routing infrastructure.",
      status: "INTERESTED" as const,
      matchScore: 92,
      notes: "Matched against Next.js 16 and edge caching requirements.",
    },
    {
      id: "job_supabase_db",
      companyName: "Supabase",
      title: "Senior Database Systems Engineer",
      location: "Remote, Global",
      jobType: "FULL_TIME" as const,
      workType: "REMOTE" as const,
      salary: 205000,
      salaryPeriod: "YEARLY" as const,
      salaryCurrency: "USD" as const,
      url: "https://supabase.com/careers/database-engineer",
      description: "Build extensions, connection pooling, and multi-tenant PostgreSQL clustering.",
      status: "APPLIED" as const,
      matchScore: 94,
      dateApplied: new Date(Date.now() - 4 * 86400000),
      notes: "Applied with tailored distributed systems resume. Highlighted PostgreSQL replication work.",
    },
    {
      id: "job_linear_product",
      companyName: "Linear",
      title: "Principal Product Engineer",
      location: "San Francisco, CA (Remote)",
      jobType: "FULL_TIME" as const,
      workType: "REMOTE" as const,
      salary: 220000,
      salaryPeriod: "YEARLY" as const,
      salaryCurrency: "USD" as const,
      url: "https://linear.app/careers",
      description: "Design high-speed sync engines, keyboard-first UI, and offline-first reactive sync.",
      status: "APPLIED" as const,
      matchScore: 90,
      dateApplied: new Date(Date.now() - 6 * 86400000),
      notes: "Applied via hiring manager reachout on Twitter.",
    },
    {
      id: "job_datadog_dist",
      companyName: "Datadog",
      title: "Distributed Systems Engineer",
      location: "New York, NY (Hybrid)",
      jobType: "FULL_TIME" as const,
      workType: "HYBRID" as const,
      salary: 210000,
      salaryPeriod: "YEARLY" as const,
      salaryCurrency: "USD" as const,
      url: "https://datadoghq.com/careers",
      description: "High-throughput metric ingestion pipelines processing trillions of data points daily.",
      status: "APPLIED" as const,
      matchScore: 88,
      dateApplied: new Date(Date.now() - 8 * 86400000),
      notes: "Passed recruiter phone screen.",
    },
    {
      id: "job_cloudflare_architect",
      companyName: "Cloudflare",
      title: "Senior Systems Architect",
      location: "Austin, TX (Remote)",
      jobType: "FULL_TIME" as const,
      workType: "REMOTE" as const,
      salary: 240000,
      salaryPeriod: "YEARLY" as const,
      salaryCurrency: "USD" as const,
      url: "https://cloudflare.com/careers",
      description: "Lead global network routing and edge worker compute architecture.",
      status: "INTERVIEW" as const,
      matchScore: 95,
      dateApplied: new Date(Date.now() - 14 * 86400000),
      interviewDate: new Date(Date.now() + 2 * 86400000),
      notes: "Technical deep-dive on distributed consensus & BGP routing scheduled for Thursday 2 PM.",
    },
    {
      id: "job_figma_infra",
      companyName: "Figma",
      title: "Senior Infrastructure Engineer",
      location: "San Francisco, CA (Hybrid)",
      jobType: "FULL_TIME" as const,
      workType: "HYBRID" as const,
      salary: 225000,
      salaryPeriod: "YEARLY" as const,
      salaryCurrency: "USD" as const,
      url: "https://figma.com/careers",
      description: "Scale multiplayer WebAssembly collaborative runtime servers and sync infrastructure.",
      status: "INTERVIEW" as const,
      matchScore: 91,
      dateApplied: new Date(Date.now() - 18 * 86400000),
      interviewDate: new Date(Date.now() + 5 * 86400000),
      notes: "Virtual on-site loop scheduled. System design and multiplayer state synchronization.",
    },
    {
      id: "job_neon_cloud",
      companyName: "Neon",
      title: "Senior Cloud Platform Engineer",
      location: "Remote, US/EU",
      jobType: "FULL_TIME" as const,
      workType: "REMOTE" as const,
      salary: 245000,
      salaryPeriod: "YEARLY" as const,
      salaryCurrency: "USD" as const,
      url: "https://neon.tech/careers",
      description: "Serverless PostgreSQL storage engine separation and compute autoscaling.",
      status: "OFFER" as const,
      matchScore: 97,
      dateApplied: new Date(Date.now() - 25 * 86400000),
      notes: "Received written offer! $245k base + 0.15% equity + full remote benefits. Decision by Friday.",
    },
  ]

  for (const item of showcaseJobs) {
    const job = await prisma.job.create({
      data: {
        id: item.id,
        userId: user.id,
        companyName: item.companyName,
        title: item.title,
        location: item.location,
        jobType: item.jobType,
        workType: item.workType,
        salary: item.salary,
        salaryPeriod: item.salaryPeriod,
        salaryCurrency: item.salaryCurrency,
        url: item.url,
        description: item.description,
        source: "MANUAL",
      },
    })

    await prisma.jobApplication.create({
      data: {
        id: `app_${item.id}`,
        userId: user.id,
        jobId: job.id,
        status: item.status,
        matchScore: item.matchScore,
        dateApplied: item.dateApplied,
        interviewDate: item.interviewDate,
        notes: item.notes,
        resumeId,
      },
    })
  }

  console.log("Successfully seeded Alex Morgan showcase dummy data!")
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
