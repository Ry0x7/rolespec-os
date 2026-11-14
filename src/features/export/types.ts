import type { SectionType } from "@/generated/prisma/enums"

export interface ContactContent {
  fullName?: string
  jobTitle?: string
  email?: string
  phone?: string
  location?: string
  linkedin?: string
  github?: string
  website?: string
}

export interface SummaryContent {
  text?: string
  placeholder?: string
}

export interface ExperienceContent {
  company?: string
  role?: string
  location?: string
  startDate?: string
  endDate?: string
  current?: boolean
  bullets?: string[]
}

export interface EducationContent {
  school?: string
  degree?: string
  field?: string
  startDate?: string
  endDate?: string
  gpa?: string
}

export interface SkillsContent {
  category?: string
  skills?: string[]
}

export interface ProjectContent {
  name?: string
  bullets?: string[]
  technologies?: string[]
  url?: string
  urlLabel?: string
  startDate?: string
  endDate?: string
}

export interface CertificationContent {
  name?: string
  organization?: string
  dateObtained?: string
  expirationDate?: string
  credentialId?: string
}

export interface CustomContent {
  title?: string
  content?: string
}

export interface SectionItem {
  id: string
  content: Record<string, unknown>
  order: number
}

export interface Section {
  id: string
  type: SectionType
  title: string
  order: number
  visible: boolean
  items: SectionItem[]
}
