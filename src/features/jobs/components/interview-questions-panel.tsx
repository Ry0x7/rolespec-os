"use client"

import { useTransition } from "react"
import { MessagesSquare, Sparkles } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/shared/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card"
import { EmptyState } from "@/shared/components/empty-state"
import { generateInterviewQuestions } from "../actions/interview-question.actions"
import { AddJobDescriptionButton } from "./job-edit-context"

export interface InterviewQuestionItem {
  id: string
  question: string
}

interface Props {
  jobApplicationId: string
  /** Questions lifted verbatim from the posting when the job was saved. */
  scrapedQuestions: InterviewQuestionItem[]
  /** Questions produced by the on-demand generator. */
  generatedQuestions: InterviewQuestionItem[]
  hasJobDescription: boolean
}

function QuestionGroup({
  title,
  questions,
}: {
  title: string
  questions: InterviewQuestionItem[]
}) {
  if (questions.length === 0) return null

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {title}
      </p>
      <ol className="list-decimal space-y-2 pl-5 text-sm marker:text-muted-foreground">
        {questions.map((item) => (
          <li key={item.id}>{item.question}</li>
        ))}
      </ol>
    </div>
  )
}

/**
 * Display-only interview prep: the questions the posting already asks, plus a
 * generated set. Answering/practice is deliberately out of scope for now.
 */
export function InterviewQuestionsPanel({
  jobApplicationId,
  scrapedQuestions,
  generatedQuestions,
  hasJobDescription,
}: Props) {
  const [isPending, startTransition] = useTransition()

  const hasAny = scrapedQuestions.length > 0 || generatedQuestions.length > 0

  function handleGenerate() {
    startTransition(async () => {
      const result = await generateInterviewQuestions(jobApplicationId)
      if ("error" in result) {
        toast.error(result.error)
        return
      }
      toast.success(`Generated ${result.count} questions`)
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MessagesSquare className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          Interview prep
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {hasAny ? (
          <div className="space-y-5">
            <QuestionGroup title="From the job posting" questions={scrapedQuestions} />
            <QuestionGroup title="AI generated" questions={generatedQuestions} />
          </div>
        ) : (
          <EmptyState
            variant="bare"
            icon={MessagesSquare}
            title="No questions yet"
            description="Questions found in the job posting show up here automatically, or generate a likely set for this role."
          />
        )}

        <div className="flex flex-col items-end gap-2">
          <div className="flex flex-wrap items-center justify-end gap-2">
            {!hasJobDescription && <AddJobDescriptionButton />}
            <Button
              type="button"
              // Same rule as the risk panel: a blocked CTA is not brand violet.
              variant={hasJobDescription ? "default" : "secondary"}
              onClick={handleGenerate}
              disabled={isPending || !hasJobDescription}
            >
              <Sparkles className="h-4 w-4" aria-hidden="true" />
              {isPending
                ? "Generating…"
                : generatedQuestions.length > 0
                  ? "Regenerate"
                  : "Generate questions"}
            </Button>
          </div>
          {!hasJobDescription && (
            <p className="text-xs text-muted-foreground">
              Add a job description to generate questions.
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
