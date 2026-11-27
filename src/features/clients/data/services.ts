/**
 * Services a person can sell to clients, and how to look for buyers of each.
 *
 * This is search vocabulary, not a claim about the user: `queries` are what is
 * typed into a marketplace, `terms` are the words a client's post uses when it
 * wants this service, and `localProspects` are the kinds of local businesses
 * that commonly buy it, for on-site prospecting. Nothing here is copied from a
 * marketplace taxonomy, and nothing here is ever written into a resume or
 * profile.
 */

export type ClientServiceGroup = "ADMIN_SUPPORT" | "AI_TECH" | "MARKETING_CREATIVE" | "FINANCE" | "EDUCATION" | "LOCAL" | "OTHER"

export const CLIENT_SERVICE_GROUP_LABELS: Record<ClientServiceGroup, string> = {
  ADMIN_SUPPORT: "Admin & support",
  AI_TECH: "AI, automation & tech",
  MARKETING_CREATIVE: "Marketing & creative",
  FINANCE: "Finance",
  EDUCATION: "Teaching",
  LOCAL: "Local & on-site",
  OTHER: "Other",
}

export interface ClientService {
  id: string
  label: string
  group: ClientServiceGroup
  summary: string
  /** Marketplace search phrases, most specific first. At most three. */
  queries: readonly string[]
  /** Lower-case words or phrases a client post for this service would contain. */
  terms: readonly string[]
  /** Local businesses that commonly buy this service, plural ("law firms"). */
  localProspects: readonly string[]
  /** Whether the service is normally delivered remotely. */
  remoteFriendly: boolean
}

export const CLIENT_SERVICES: readonly ClientService[] = [
  {
    id: "virtual-assistant",
    label: "Virtual assistant",
    group: "ADMIN_SUPPORT",
    summary: "Inbox, calendar, scheduling, research and admin for busy owners.",
    queries: ["virtual assistant", "executive assistant", "admin assistant"],
    terms: [
      "virtual assistant",
      "executive assistant",
      "personal assistant",
      "admin assistant",
      "administrative",
      "admin support",
      "calendar",
      "inbox",
      "email management",
      "scheduling",
      "appointment",
      "travel booking",
      "research",
      "data entry",
    ],
    localProspects: ["real estate agencies", "insurance agencies", "law firms"],
    remoteFriendly: true,
  },
  {
    id: "ai-automation",
    label: "AI automation",
    group: "AI_TECH",
    summary: "Zapier, Make or n8n workflows, AI agents and chatbots that remove manual work.",
    queries: ["AI automation", "zapier automation", "n8n"],
    terms: [
      "automation",
      "automate",
      "workflow",
      "zapier",
      "make.com",
      "integromat",
      "n8n",
      "ai agent",
      "ai agents",
      "chatbot",
      "chatgpt",
      "openai",
      "gpt",
      "llm",
      "claude",
      "prompt",
      "api integration",
      "airtable",
      "gohighlevel",
      "crm",
    ],
    localProspects: ["marketing agencies", "accounting firms", "dental clinics"],
    remoteFriendly: true,
  },
  {
    id: "customer-support",
    label: "Customer support",
    group: "ADMIN_SUPPORT",
    summary: "Answering customers by chat, email or phone, and keeping tickets moving.",
    queries: ["customer support", "customer service representative", "chat support"],
    terms: [
      "customer support",
      "customer service",
      "support agent",
      "chat support",
      "email support",
      "live chat",
      "helpdesk",
      "help desk",
      "zendesk",
      "freshdesk",
      "gorgias",
      "tickets",
      "call center",
    ],
    localProspects: ["online stores", "clinics", "property management companies"],
    remoteFriendly: true,
  },
  {
    id: "lead-generation",
    label: "Lead generation & appointment setting",
    group: "MARKETING_CREATIVE",
    summary: "Finding prospects, cold outreach and booking sales calls for a team.",
    queries: ["lead generation", "appointment setter", "cold calling"],
    terms: [
      "lead generation",
      "lead gen",
      "appointment setter",
      "appointment setting",
      "cold calling",
      "cold email",
      "outbound",
      "prospecting",
      "sales development",
      "linkedin outreach",
      "book meetings",
    ],
    localProspects: ["solar installers", "roofing companies", "home services companies"],
    remoteFriendly: true,
  },
  {
    id: "social-media",
    label: "Social media management",
    group: "MARKETING_CREATIVE",
    summary: "Planning, posting and reporting on social channels for a brand.",
    queries: ["social media manager", "social media marketing"],
    terms: [
      "social media",
      "instagram",
      "facebook",
      "tiktok",
      "linkedin",
      "content calendar",
      "community management",
      "posting",
      "reels",
      "engagement",
    ],
    localProspects: ["restaurants", "salons", "fitness studios"],
    remoteFriendly: true,
  },
  {
    id: "content-writing",
    label: "Writing & copywriting",
    group: "MARKETING_CREATIVE",
    summary: "Blog posts, website copy, emails and product descriptions.",
    queries: ["content writer", "copywriter", "blog writer"],
    terms: [
      "content writer",
      "content writing",
      "copywriter",
      "copywriting",
      "blog",
      "article",
      "seo writing",
      "ghostwriter",
      "newsletter",
      "product descriptions",
      "proofreading",
      "editing",
    ],
    localProspects: ["marketing agencies", "law firms", "clinics"],
    remoteFriendly: true,
  },
  {
    id: "graphic-design",
    label: "Graphic design",
    group: "MARKETING_CREATIVE",
    summary: "Logos, social graphics, decks and print material.",
    queries: ["graphic designer", "canva designer", "logo design"],
    terms: [
      "graphic design",
      "graphic designer",
      "logo",
      "canva",
      "photoshop",
      "illustrator",
      "branding",
      "flyer",
      "presentation design",
      "banner",
    ],
    localProspects: ["print shops", "restaurants", "event venues"],
    remoteFriendly: true,
  },
  {
    id: "video-editing",
    label: "Video editing",
    group: "MARKETING_CREATIVE",
    summary: "Short-form clips, YouTube edits and simple motion graphics.",
    queries: ["video editor", "youtube video editing", "short form video"],
    terms: [
      "video editor",
      "video editing",
      "youtube",
      "premiere",
      "after effects",
      "capcut",
      "davinci",
      "reels",
      "shorts",
      "tiktok",
      "podcast editing",
    ],
    localProspects: ["wedding planners", "real estate agencies", "gyms"],
    remoteFriendly: true,
  },
  {
    id: "web-development",
    label: "Websites & web development",
    group: "AI_TECH",
    summary: "Building and fixing websites, landing pages and online stores.",
    queries: ["web developer", "wordpress website", "shopify developer"],
    terms: [
      "website",
      "web developer",
      "web development",
      "wordpress",
      "shopify",
      "webflow",
      "wix",
      "landing page",
      "react",
      "html",
      "css",
      "javascript",
      "woocommerce",
    ],
    localProspects: ["restaurants", "dental clinics", "auto repair shops"],
    remoteFriendly: true,
  },
  {
    id: "bookkeeping",
    label: "Bookkeeping",
    group: "FINANCE",
    summary: "Reconciling accounts, invoicing and monthly books for small businesses.",
    queries: ["bookkeeper", "bookkeeping", "quickbooks"],
    terms: [
      "bookkeeping",
      "bookkeeper",
      "quickbooks",
      "xero",
      "reconciliation",
      "accounts payable",
      "accounts receivable",
      "invoicing",
      "payroll",
      "financial statements",
      "accounting",
    ],
    localProspects: ["construction companies", "restaurants", "medical practices"],
    remoteFriendly: true,
  },
  {
    id: "data-entry",
    label: "Data entry & research",
    group: "ADMIN_SUPPORT",
    summary: "Spreadsheets, lists, product uploads and web research.",
    queries: ["data entry", "web research", "excel data"],
    terms: [
      "data entry",
      "spreadsheet",
      "excel",
      "google sheets",
      "web research",
      "data collection",
      "copy paste",
      "product listing",
      "data cleaning",
      "typing",
    ],
    localProspects: ["logistics companies", "clinics", "retail stores"],
    remoteFriendly: true,
  },
  {
    id: "online-tutoring",
    label: "Tutoring & teaching",
    group: "EDUCATION",
    summary: "Online or in-person lessons, test prep and language teaching.",
    queries: ["online tutor", "english teacher", "esl tutor"],
    terms: [
      "tutor",
      "tutoring",
      "teacher",
      "teaching",
      "lesson",
      "esl",
      "english teacher",
      "math",
      "test prep",
      "curriculum",
      "course",
    ],
    localProspects: ["learning centers", "language schools", "private schools"],
    remoteFriendly: true,
  },
  {
    id: "local-services",
    label: "Home & local services",
    group: "LOCAL",
    summary: "Cleaning, repairs, photography, events and other work done on site.",
    queries: ["cleaning", "handyman", "event photographer"],
    terms: [
      "cleaning",
      "cleaner",
      "handyman",
      "repair",
      "installation",
      "moving",
      "photographer",
      "photography",
      "event",
      "on-site",
      "onsite",
      "in person",
      "local",
    ],
    localProspects: ["property management companies", "office buildings", "event venues"],
    remoteFriendly: false,
  },
]

export function findClientService(id: string): ClientService | undefined {
  return CLIENT_SERVICES.find((service) => service.id === id)
}

/** Most phrases a custom service is split into for search and scoring. */
const MAX_CUSTOM_TERMS = 8

/**
 * A service the user typed themselves ("Shopify store manager"). The whole
 * phrase is the one query; the phrase and its longer words are the scoring
 * terms, so a custom service still filters out unrelated posts.
 */
export function customClientService(rawLabel: string): ClientService | null {
  const label = rawLabel.replace(/\s+/g, " ").trim().slice(0, 80)
  if (!label) return null
  const words = label
    .toLowerCase()
    .split(/[^\p{L}\p{N}+#.]+/u)
    .map((word) => word.replace(/^\.+|\.+$/g, ""))
    .filter((word) => word.length >= 3)
  const terms = [...new Set([label.toLowerCase(), ...words])].slice(0, MAX_CUSTOM_TERMS)
  return {
    id: "custom",
    label,
    group: "OTHER",
    summary: "A service you described yourself.",
    queries: [label],
    terms,
    localProspects: [],
    remoteFriendly: true,
  }
}
