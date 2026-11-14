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
  // Healthcare & operations
  "Patient Care",
  "Clinical Documentation",
  "Inventory Management",
  "Quality Assurance",
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
