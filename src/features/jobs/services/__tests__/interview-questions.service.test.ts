import { describe, it, expect } from "vitest"
import { extractEmployerQuestions } from "../interview-questions.service"

describe("extractEmployerQuestions", () => {
  it("returns nothing for empty or question-free text", () => {
    expect(extractEmployerQuestions("")).toEqual([])
    expect(
      extractEmployerQuestions("We are hiring a senior engineer. Apply today.")
    ).toEqual([])
  })

  it("finds questions on their own lines", () => {
    const text = [
      "About the role",
      "You will build things.",
      "Why do you want to work at Acme?",
      "What is your experience with TypeScript?",
    ].join("\n")

    expect(extractEmployerQuestions(text)).toEqual([
      "Why do you want to work at Acme?",
      "What is your experience with TypeScript?",
    ])
  })

  it("finds a question that shares a line with prose", () => {
    expect(
      extractEmployerQuestions("Please apply soon. What excites you about this role?")
    ).toEqual(["What excites you about this role?"])
  })

  it("strips bullet and numbering markers", () => {
    const text = [
      "1. How many years of React have you shipped?",
      "- Describe a time you disagreed with a lead?",
      "• What is your notice period like?",
      "Q: Are you comfortable with on-call rotations?",
    ].join("\n")

    expect(extractEmployerQuestions(text)).toEqual([
      "How many years of React have you shipped?",
      "Describe a time you disagreed with a lead?",
      "What is your notice period like?",
      "Are you comfortable with on-call rotations?",
    ])
  })

  it("dedupes case-insensitively, keeping the first form", () => {
    const text = [
      "What is your notice period?",
      "WHAT IS YOUR NOTICE PERIOD?",
      "1. What is your notice period?",
    ].join("\n")

    expect(extractEmployerQuestions(text)).toEqual(["What is your notice period?"])
  })

  it("ignores fragments, punctuation-only lines and over-long paragraphs", () => {
    const text = [
      "…?",
      "???",
      "Why?",
      `${"a".repeat(320)}?`,
      "Which testing frameworks do you prefer?",
    ].join("\n")

    expect(extractEmployerQuestions(text)).toEqual([
      "Which testing frameworks do you prefer?",
    ])
  })

  it("caps the result at 20 questions", () => {
    const text = Array.from(
      { length: 40 },
      (_, i) => `Question number ${i} about the role?`
    ).join("\n")

    const result = extractEmployerQuestions(text)

    expect(result).toHaveLength(20)
    expect(result[0]).toBe("Question number 0 about the role?")
  })
})
