/**
 * Curated, deterministic datalist suggestions for the free-text profile
 * fields. Suggestions only — every field still accepts free typing, and
 * nothing here is ever written without the user submitting it themselves.
 * Deliberately career-field agnostic: RoleSpec is not a tech-only product.
 */

export const CAPABILITY_NAME_SUGGESTIONS = [
  // Software & data
  "JavaScript",
  "TypeScript",
  "Python",
  "Java",
  "C#",
  "SQL",
  "React",
  "Next.js",
  "Node.js",
  "HTML & CSS",
  "REST APIs",
  "GraphQL",
  "PostgreSQL",
  "AWS",
  "Docker",
  "Kubernetes",
  "CI/CD",
  "Git",
  "Data Analysis",
  "Machine Learning",
  "Excel",
  // Design & product
  "Figma",
  "UI Design",
  "UX Research",
  "Product Management",
  "Agile / Scrum",
  // General professional
  "Project Management",
  "Stakeholder Management",
  "Technical Writing",
  "Public Speaking",
  "Customer Service",
  "Sales",
  "Negotiation",
  "Team Leadership",
  "Coaching & Mentoring",
  "Budgeting",
  "Recruiting",
  "Copywriting",
  "SEO",
  "Social Media Marketing",
  // Virtual support, automation & freelance
  "Calendar Management",
  "Inbox Management",
  "Data Entry",
  "Zapier",
  "Make.com",
  "n8n",
  "ChatGPT",
  "Prompt Engineering",
  "Canva",
  "Video Editing",
  "Bookkeeping",
  "QuickBooks",
  // Healthcare, education & operations
  "Patient Care",
  "Clinical Documentation",
  "Teaching",
  "Lesson Planning",
  "Inventory Management",
  "Quality Assurance",
  // Service & skilled trades
  "Point of Sale",
  "Food Safety",
  "Guest Services",
  "Workplace Safety",
  "Electrical Wiring",
  "Equipment Maintenance",
  "Driving",
] as const

export const CAPABILITY_CATEGORY_SUGGESTIONS = [
  "Frontend",
  "Backend",
  "Full Stack",
  "Mobile",
  "DevOps & Infrastructure",
  "Data & Analytics",
  "Machine Learning & AI",
  "Security",
  "QA & Testing",
  "Design",
  "Product",
  "Project Management",
  "Marketing",
  "Sales",
  "Customer Success",
  "Operations",
  "Finance",
  "Human Resources",
  "Healthcare",
  "Education",
  "Hospitality & Retail",
  "Skilled Trades",
  "Logistics",
  "Automation & AI Tools",
  "Leadership",
  "Communication",
  "Languages",
  "Tools",
] as const

export const TARGET_ROLE_SUGGESTIONS = [
  "Software Engineer",
  "Senior Software Engineer",
  "Frontend Engineer",
  "Backend Engineer",
  "Full Stack Engineer",
  "Mobile Engineer",
  "DevOps Engineer",
  "Site Reliability Engineer",
  "Data Analyst",
  "Data Engineer",
  "Data Scientist",
  "Machine Learning Engineer",
  "QA Engineer",
  "Security Engineer",
  "Engineering Manager",
  "Product Manager",
  "Project Manager",
  "UX Designer",
  "UI Designer",
  "Product Designer",
  "Technical Writer",
  "IT Support Specialist",
  "Systems Administrator",
  "Business Analyst",
  "Account Executive",
  "Sales Development Representative",
  "Customer Success Manager",
  "Marketing Manager",
  "Digital Marketing Specialist",
  "Content Writer",
  "Operations Manager",
  "Financial Analyst",
  "Accountant",
  "Human Resources Specialist",
  "Recruiter",
  "Registered Nurse",
  "Medical Assistant",
  "Virtual Assistant",
  "Executive Assistant",
  "AI Automation Specialist",
  "Customer Support Representative",
  "Social Media Manager",
  "Graphic Designer",
  "Video Editor",
  "Bookkeeper",
  "Online Tutor",
  "Teacher",
  "Retail Associate",
  "Front Desk Agent",
  "Line Cook",
  "Warehouse Associate",
  "Delivery Driver",
  "Electrician",
  "Maintenance Technician",
  "Freelance Consultant",
] as const

export const ROLE_FAMILY_SUGGESTIONS = [
  "Frontend Engineering",
  "Backend Engineering",
  "Full Stack Engineering",
  "Platform Engineering",
  "Mobile Engineering",
  "Data & Analytics",
  "Machine Learning & AI",
  "Quality Engineering",
  "Security",
  "IT & Support",
  "Product Management",
  "Project & Program Management",
  "Design",
  "Marketing",
  "Sales",
  "Customer Success & Support",
  "Operations",
  "Finance & Accounting",
  "People & Recruiting",
  "Healthcare & Nursing",
  "Writing & Content",
  "Virtual & Administrative Support",
  "AI & Automation",
  "Education & Training",
  "Hospitality, Food & Retail",
  "Logistics & Warehousing",
  "Skilled Trades",
  "Freelance & Client Work",
] as const

/**
 * The user's own values first (most relevant), then curated defaults that are
 * not already present. Case-insensitive dedupe so "frontend" suppresses
 * "Frontend" instead of suggesting a near-duplicate spelling.
 */
export function mergeSuggestions(
  own: Array<string | null>,
  curated: readonly string[]
): string[] {
  const seen = new Set<string>()
  const merged: string[] = []
  for (const value of [...own, ...curated]) {
    const trimmed = value?.trim()
    if (!trimmed) continue
    const key = trimmed.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    merged.push(trimmed)
  }
  return merged
}
