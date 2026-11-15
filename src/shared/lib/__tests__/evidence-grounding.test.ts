import { describe, expect, it } from "vitest"

import {
  classifyKeywordEvidence,
  findIntroducedKeywordContexts,
  findIntroducedKeywords,
  groundKeywords,
  stripIntroducedSkills,
} from "../evidence-grounding"

/**
 * A backend resume with no message-broker and no JPA/JPQL experience anywhere.
 * This is the fixture behind the permanent JPQL/JMS regression case: the job
 * description asks for both, the candidate has neither, and nothing downstream
 * may quietly promote them to claimed experience.
 */
const RESUME = `## Summary
Backend engineer with six years building REST APIs in Java and Spring Boot.

## Experience
Senior Engineer at Acme (2021 - Present)
- Built REST services in Java 17 and Spring Boot, backed by PostgreSQL.
- Migrated the reporting pipeline to Kubernetes, cutting deploy time in half.
- Owned CI/CD in GitHub Actions for eight services.

## Skills
Java, Spring Boot, PostgreSQL, Docker, Kubernetes, REST APIs, GitHub Actions`

describe("classifyKeywordEvidence", () => {
  it("marks a keyword written in the resume as supported", () => {
    const result = classifyKeywordEvidence("Kubernetes", RESUME)
    expect(result.verdict).toBe("supported")
  })

  it("is case- and spacing-insensitive", () => {
    expect(classifyKeywordEvidence("  spring   boot ", RESUME).verdict).toBe(
      "supported"
    )
  })

  it("marks a technology absent from the resume as unsupported", () => {
    const result = classifyKeywordEvidence("JPQL", RESUME)
    expect(result.verdict).toBe("unsupported")
    expect(result.reason).toMatch(/nothing in your resume/i)
  })

  it("does not treat a substring of a longer word as support", () => {
    // "Go" must not be supported by "GitHub Actions" or "Spring Boot".
    expect(classifyKeywordEvidence("Go", RESUME).verdict).toBe("unsupported")
  })

  it("marks a partially evidenced multi-word requirement as ambiguous", () => {
    // The resume has Java but never "Java EE".
    const result = classifyKeywordEvidence("Java EE", RESUME)
    expect(result.verdict).toBe("ambiguous")
    expect(result.reason).toContain("Java")
  })

  it("marks a keyword that only appears inside a longer term as ambiguous", () => {
    const result = classifyKeywordEvidence("Kube", RESUME)
    expect(result.verdict).toBe("ambiguous")
  })

  it("matches a token that sits next to punctuation", () => {
    expect(classifyKeywordEvidence("PostgreSQL", RESUME).verdict).toBe("supported")
    expect(classifyKeywordEvidence("Docker", RESUME).verdict).toBe("supported")
  })

  it("keeps symbol-bearing technology names intact", () => {
    const text = "Wrote C++ and C# services alongside Node.js tooling."
    expect(classifyKeywordEvidence("C++", text).verdict).toBe("supported")
    expect(classifyKeywordEvidence("C#", text).verdict).toBe("supported")
    expect(classifyKeywordEvidence("Node.js", text).verdict).toBe("supported")
    // "C" alone is never whole-token evidence here.
    expect(classifyKeywordEvidence("C", text).verdict).toBe("unsupported")
  })

  it("returns unsupported when there is no resume text at all", () => {
    expect(classifyKeywordEvidence("Java", "").verdict).toBe("unsupported")
  })

  it("returns unsupported for an empty keyword", () => {
    expect(classifyKeywordEvidence("   ", RESUME).verdict).toBe("unsupported")
  })
})

describe("groundKeywords", () => {
  it("partitions a mixed requirement list", () => {
    const result = groundKeywords(
      ["Kubernetes", "JPQL", "JMS", "Java EE", "Docker"],
      RESUME
    )

    expect(result.supported).toEqual(["Kubernetes", "Docker"])
    expect(result.unsupported).toEqual(["JPQL", "JMS"])
    expect(result.ambiguous).toEqual(["Java EE"])
    expect(result.details).toHaveLength(5)
  })

  it("REGRESSION: JPQL and JMS from a job description are never supported", () => {
    const result = groundKeywords(["JPQL", "JMS"], RESUME)

    expect(result.supported).toEqual([])
    expect(result.ambiguous).toEqual([])
    expect(result.unsupported).toEqual(["JPQL", "JMS"])
  })

  it("deduplicates case variants and skips blanks", () => {
    const result = groundKeywords(["Docker", "docker", "  ", "DOCKER"], RESUME)
    expect(result.details).toHaveLength(1)
    expect(result.supported).toEqual(["Docker"])
  })

  it("treats every keyword as unsupported when the resume is empty", () => {
    const result = groundKeywords(["Java", "Docker"], "   ")
    expect(result.unsupported).toEqual(["Java", "Docker"])
  })
})

describe("findIntroducedKeywords", () => {
  it("flags an unsupported keyword the model added to a bullet", () => {
    const introduced = findIntroducedKeywords(
      "Built REST services in Java and Spring Boot.",
      "Built REST services in Java, Spring Boot and JPQL.",
      ["JPQL", "JMS"]
    )
    expect(introduced).toEqual(["JPQL"])
  })

  it("does not flag a keyword the original already contained", () => {
    const introduced = findIntroducedKeywords(
      "Tuned JPQL queries against the reporting schema.",
      "Tuned JPQL queries, cutting report latency.",
      ["JPQL"]
    )
    expect(introduced).toEqual([])
  })

  it("ignores a keyword that appears only as part of a longer word", () => {
    const introduced = findIntroducedKeywords(
      "Owned deployments.",
      "Owned deployments across environments.",
      ["Go"]
    )
    expect(introduced).toEqual([])
  })

  it("returns nothing when there are no keywords to check", () => {
    expect(findIntroducedKeywords("a", "b", [])).toEqual([])
  })
})

describe("findIntroducedKeywordContexts", () => {
  it("reports the sentence a keyword landed in", () => {
    const contexts = findIntroducedKeywordContexts(
      "Built REST services in Java.",
      "I have not used JPQL. Java is most of my work.",
      ["JPQL", "Java"]
    )
    expect(contexts.map((c) => c.keyword)).toEqual(["JPQL"])
    expect(contexts[0].sentences).toEqual(["i have not used jpql."])
  })

  it("splits on ? ! and ; too, and keeps a dotted name whole", () => {
    const contexts = findIntroducedKeywordContexts(
      "Backend engineer.",
      "Do you use Node.js? We do; Kafka too!",
      ["Node.js", "Kafka"]
    )
    expect(contexts.map((c) => c.sentences)).toEqual([
      ["do you use node.js?"],
      ["kafka too!"],
    ])
  })

  it("reports every sentence a repeated keyword occurs in", () => {
    const contexts = findIntroducedKeywordContexts(
      "Backend engineer.",
      "Kafka is new to me. I built Kafka pipelines anyway.",
      ["Kafka"]
    )
    expect(contexts[0].sentences).toHaveLength(2)
  })

  it("reports no sentences when the match only exists across a line break", () => {
    const contexts = findIntroducedKeywordContexts(
      "Nurse.",
      "New to me:\nwound\ncare",
      ["wound care"]
    )
    expect(contexts.map((c) => c.keyword)).toEqual(["wound care"])
    expect(contexts[0].sentences).toEqual([])
  })

  it("pairs each occurrence with the sentence after it, and null at the end", () => {
    const contexts = findIntroducedKeywordContexts(
      "Backend engineer.",
      "Your stack runs on Kafka. I haven't worked with those yet.",
      ["Kafka"]
    )
    expect(contexts[0].occurrences).toEqual([
      {
        sentence: "your stack runs on kafka.",
        nextSentence: "i haven't worked with those yet.",
        keywordsAddedByNextSentence: [],
      },
    ])

    const last = findIntroducedKeywordContexts(
      "Backend engineer.",
      "I haven't worked with those yet. Your stack runs on Kafka.",
      ["Kafka"]
    )
    expect(last[0].occurrences[0].nextSentence).toBeNull()
  })

  it("names the keywords the next sentence brings in on its own", () => {
    const contexts = findIntroducedKeywordContexts(
      "Backend engineer.",
      "Your stack runs on JMS and Kafka. Kubernetes and Kafka are daily tools for me.",
      ["JMS", "Kafka", "Kubernetes"]
    )
    const jms = contexts.find((context) => context.keyword === "JMS")
    // Kafka is in both sentences, so the second one does not "add" it.
    expect(jms?.occurrences[0].keywordsAddedByNextSentence).toEqual(["Kubernetes"])
  })

  it("keeps `sentences` as the flat view of the same occurrences", () => {
    const contexts = findIntroducedKeywordContexts(
      "Backend engineer.",
      "Kafka is new to me. I built Kafka pipelines anyway.",
      ["Kafka"]
    )
    expect(contexts[0].sentences).toEqual(
      contexts[0].occurrences.map((occurrence) => occurrence.sentence)
    )
  })

  it("stops the neighbour link at a line break, so no carry crosses a block", () => {
    // The four prose services join their fields as `${subject}\n${body}`, so
    // the first sentence of the body is not the subject line's neighbour.
    const contexts = findIntroducedKeywordContexts(
      "Backend engineer.",
      "Kafka engineer applying\nI haven't worked with those yet.",
      ["Kafka"]
    )
    expect(contexts[0].occurrences[0].nextSentence).toBeNull()
    expect(contexts[0].occurrences[0].keywordsAddedByNextSentence).toEqual([])
  })

  it("stops the neighbour link at a paragraph break", () => {
    const contexts = findIntroducedKeywordContexts(
      "Backend engineer.",
      "Your stack runs on Kafka.\n\nI haven't worked with those yet.",
      ["Kafka"]
    )
    expect(contexts[0].occurrences[0].nextSentence).toBeNull()
  })

  it("keeps `sentences` identical across a line break", () => {
    const contexts = findIntroducedKeywordContexts(
      "Backend engineer.",
      "Kafka engineer applying\nI shipped Kafka. Then more Kafka.",
      ["Kafka"]
    )
    expect(contexts[0].sentences).toEqual([
      "kafka engineer applying",
      "i shipped kafka.",
      "then more kafka.",
    ])
    expect(contexts[0].sentences).toEqual(
      contexts[0].occurrences.map((occurrence) => occurrence.sentence)
    )
    expect(contexts[0].occurrences.map((o) => o.nextSentence)).toEqual([
      null,
      "then more kafka.",
      null,
    ])
  })

  it("applies the same introduced test as the flat list", () => {
    const contexts = findIntroducedKeywordContexts(
      "Tuned JPQL queries.",
      "Tuned JPQL queries and shipped them.",
      ["JPQL"]
    )
    expect(contexts).toEqual([])
  })
})

describe("stripIntroducedSkills", () => {
  it("drops only the entries that assert an unsupported keyword", () => {
    const result = stripIntroducedSkills(
      "Java, Spring Boot, PostgreSQL",
      "Java, Spring Boot, PostgreSQL, JPQL, JMS",
      ["JPQL", "JMS"]
    )
    expect(result.skills).toBe("Java, Spring Boot, PostgreSQL")
    expect(result.removed).toEqual(["JPQL", "JMS"])
  })

  it("leaves a clean list untouched", () => {
    const result = stripIntroducedSkills(
      "Java, Spring Boot",
      "Java, Spring Boot, Docker",
      ["JPQL"]
    )
    expect(result.skills).toBe("Java, Spring Boot, Docker")
    expect(result.removed).toEqual([])
  })

  it("keeps an entry whose unsupported keyword was already in the original", () => {
    const result = stripIntroducedSkills(
      "Java, JPQL",
      "Java, JPQL, Docker",
      ["JPQL"]
    )
    expect(result.skills).toBe("Java, JPQL, Docker")
    expect(result.removed).toEqual([])
  })

  it("removes a compound entry that carries the unsupported keyword", () => {
    const result = stripIntroducedSkills(
      "Java, Spring Boot",
      "Java, Spring Boot, JMS messaging",
      ["JMS"]
    )
    expect(result.skills).toBe("Java, Spring Boot")
    expect(result.removed).toEqual(["JMS"])
  })
})
