export interface JobLinkOption {
  id: string
  companyName: string
  jobTitle: string
}

export interface TodoRow {
  id: string
  title: string
  done: boolean
  dueDate: Date | null
  jobApplicationId: string | null
  job: JobLinkOption | null
}

export interface NoteRow {
  id: string
  content: string
  updatedAt: Date
}
