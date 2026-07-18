export interface QuestionOption {
  label: string
  description: string
  preview?: string
}

export interface Question {
  question: string
  header: string
  options: QuestionOption[]
  multiSelect: boolean
}

export interface QuestionAnnotation {
  preview?: string
  notes?: string
}

export interface QuestionAnswerBundle {
  answers: Record<string, string>
  annotations?: Record<string, QuestionAnnotation>
}

export type QuestionRequestState = 'pending' | 'resolved' | 'rejected'

export interface QuestionRequestRecord {
  id: string
  questions: Question[]
  state: QuestionRequestState
  createdAt: string
  source?: string
}
