// @vitest-environment node
import { createElement } from "react"
import { Document, Page, Text, renderToBuffer } from "@react-pdf/renderer"
import { describe, expect, it, vi } from "vitest"

vi.mock("@/shared/lib/ai-generate", () => ({
  AI_USAGE_FEATURES: {},
  generateObjectTracked: vi.fn(() => { throw new Error("No AI provider configured") }),
}))

import { generateObjectTracked } from "@/shared/lib/ai-generate"
import { parseResumeFile } from "../parse-resume"

describe("resume import without AI", () => {
  it("imports a real DOCX with AI off by default", async () => {
    vi.mocked(generateObjectTracked).mockClear()
    // Minimal OOXML document containing only synthetic resume text.
    const docx = Buffer.from("UEsDBBQAAAAIAAuIV11hey9DkAAAAPIAAAALAAAAX3JlbHMvLnJlbHOMzzEOAiEQBdCrkDnAzmphYYDKZluzFyAwuxCBIYBxvb2NxWosbH9+3s+XV4qmB87Nh9LElmJuCnzv5YzYrKdk2sCF8pbiwjWZ3gauKxZjb2YlPI7jCeveAC33ppicgjq5A4j5Wegfm5clWLqwvSfK/cfEVwPEbOpKXcGDq0P3joctRUAt8eOifgEAAP//AwBQSwMEFAAAAAgAC4hXXVEQcsidAAAA/wAAABEAAAB3b3JkL2RvY3VtZW50LnhtbIyPQQrCMBBFrxJ6AKe4cBFqQcGdl4jJ2AaSmZBMTb29pCC6cOHmfRjehz9D1Y7tEpFErTFQ0fXYzSJJAxQ7YzRlxwlpjeHOORopO84TVM4uZbZYiqcpBtj3/QGi8dSNQ9U3ds+WqSE3yHhyRl35gcFYHKBdGvPGzfuWL2vC7JH+UM+LD6JkRkUsqJAmT79a8J4Fn5fHFwAAAP//AwBQSwMEFAAAAAgAC4hXXaxuElqkAAAA3AAAABMAAABbQ29udGVudF9UeXBlc10ueG1sXI8xDsIwDEWvUmVF1IiBAbVd2IGBC1ip20bEdpQYKLdHBakD89d7T7+5vROVauYopXWTWToCFD8RY6k1kcwcB82MVmrNIyT0dxwJ9rvdAbyKkdjWFofrmsuTcg49VVfMdkam1sFLcw+9+geTWD1zdNXphy3l1mFKMXi0oAJP6f+aWx2G4GnlF1vK6qmUICPHel0Yg2wWPXQNfE91HwAAAP//AwBQSwECFAAUAAAACAALiFddYXsvQ5AAAADyAAAACwAAAAAAAAAAAAAAAAAAAAAAX3JlbHMvLnJlbHNQSwECFAAUAAAACAALiFddURByyJ0AAAD/AAAAEQAAAAAAAAAAAAAAAAC5AAAAd29yZC9kb2N1bWVudC54bWxQSwECFAAUAAAACAALiFddrG4SWqQAAADcAAAAEwAAAAAAAAAAAAAAAACFAQAAW0NvbnRlbnRfVHlwZXNdLnhtbFBLBQYAAAAAAwADALkAAABaAgAAAAA=", "base64")
    const result = await parseResumeFile(new Uint8Array(docx),
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "user-1")
    expect(generateObjectTracked).not.toHaveBeenCalled()
    expect(result.importedSections).toContainEqual({ title: "Experience", content: "Built the note engine" })
  })

  it("imports a real text PDF without a provider, preserving its sections and wording", async () => {
    const document = createElement(Document, {}, createElement(Page, {},
      ...["Ada Lovelace", "ada@example.com", "Experience", "Analytical Engines Ltd",
        "Built the note engine", "Skills", "TypeScript, Go"].map((line, key) =>
        createElement(Text, { key }, line)),
    ))
    const pdf = await renderToBuffer(document)
    const result = await parseResumeFile(new Uint8Array(pdf), "application/pdf", "user-1", {
      optimizeBullets: false,
    })

    expect(generateObjectTracked).not.toHaveBeenCalled()
    expect(result.importedSections).toEqual(expect.arrayContaining([
      expect.objectContaining({ title: "Experience", content: expect.stringContaining("Built the note engine") }),
      expect.objectContaining({ title: "Skills", content: expect.stringContaining("TypeScript, Go") }),
    ]))
    expect(JSON.stringify(result)).toContain("ada@example.com")
  }, 15_000)
})
