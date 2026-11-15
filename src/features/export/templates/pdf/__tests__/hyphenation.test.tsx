// @vitest-environment node
import { describe, expect, it } from "vitest"
import { Document, Font, Page, Text, View, renderToBuffer } from "@react-pdf/renderer"
// Importing a template is what pulls in `setup.ts`, exactly as the export path does.
import "../harvard"

/**
 * react-pdf hyphenates by default; the browser preview never does. If the
 * callback ever stops being registered the export fits long words in fewer
 * lines than the preview measured and the page count diverges again.
 */
describe("PDF hyphenation is disabled", () => {
  it("registers a no-op hyphenation callback on the font store", () => {
    const callback = Font.getHyphenationCallback()
    expect(typeof callback).toBe("function")
    expect(callback!("Extraordinarily")).toEqual(["Extraordinarily"])
  })

  it("does not split a long word at a narrow measure in a real render", async () => {
    const buffer = await renderToBuffer(
      <Document>
        <Page size="A4" style={{ padding: 40, fontSize: 11 }}>
          <View style={{ width: 70 }}>
            <Text>Networking Introduction Extraordinarily Essentials</Text>
          </View>
        </Page>
      </Document>
    )

    const { PDFParse } = await import("pdf-parse")
    const { text } = await new PDFParse(new Uint8Array(buffer)).getText()

    // Without the callback textkit emits "Extraordinari-\nly".
    expect(text).toContain("Extraordinarily")
    expect(text).not.toMatch(/\w-\r?\n\w/)
  }, 30000)
})
