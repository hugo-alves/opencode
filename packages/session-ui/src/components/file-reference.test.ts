import { describe, expect, test } from "bun:test"
import { findFileReferences, parseFileReference } from "./file-reference"

describe("parseFileReference", () => {
  test.each([
    ["src/app.ts", { path: "src/app.ts" }],
    ["./src/app.ts", { path: "./src/app.ts" }],
    ["../shared/config.json", { path: "../shared/config.json" }],
    ["src/app.ts:42", { path: "src/app.ts", lineStart: 42 }],
    ["src/app.ts:42:7", { path: "src/app.ts", lineStart: 42, column: 7 }],
    ["src/app.ts:42-48", { path: "src/app.ts", lineStart: 42, lineEnd: 48 }],
    ["src/app.ts#L42", { path: "src/app.ts", lineStart: 42 }],
    ["/Users/hugo/project/output/report.pdf", { path: "/Users/hugo/project/output/report.pdf" }],
    ["C:\\Users\\Hugo\\project\\output\\report.xlsx", { path: "C:\\Users\\Hugo\\project\\output\\report.xlsx" }],
    ["C:/Users/Hugo/project/output/report.xlsx", { path: "C:/Users/Hugo/project/output/report.xlsx" }],
    ["\\\\server\\share\\folder\\file.pdf", { path: "\\\\server\\share\\folder\\file.pdf" }],
    ["file:///Users/hugo/project/output/report.pdf", { path: "/Users/hugo/project/output/report.pdf" }],
    ["file:///C:/Users/Hugo/project/output/report.xlsx", { path: "C:/Users/Hugo/project/output/report.xlsx" }],
    ["output/Quarterly review (final) [PT].pdf", { path: "output/Quarterly review (final) [PT].pdf" }],
    ["relatórios/visão geral.xlsx", { path: "relatórios/visão geral.xlsx" }],
  ])("parses %s", (raw, expected) => {
    expect(parseFileReference(raw)).toMatchObject({ raw, source: "markdown", ...expected })
  })

  test.each([
    "https://example.com/report.pdf",
    "http://example.com",
    "mailto:hugo@example.com",
    "hugo@example.com",
    "1.17.20",
    "ordinary prose containing a dot.",
    "",
  ])("rejects %s", (raw) => {
    expect(parseFileReference(raw)).toBeUndefined()
  })
})

describe("findFileReferences", () => {
  test("finds paths in prose and preserves offsets", () => {
    const text = "Created src/app.ts:42 and output/report.pdf."
    expect(findFileReferences(text)).toEqual([
      {
        raw: "src/app.ts:42",
        path: "src/app.ts",
        lineStart: 42,
        source: "markdown",
        start: 8,
        end: 21,
      },
      {
        raw: "output/report.pdf",
        path: "output/report.pdf",
        source: "markdown",
        start: 26,
        end: 43,
      },
    ])
  })

  test("does not turn web links, emails, versions, or ordinary prose into candidates", () => {
    const text = "See https://example.com/file.pdf, email hugo@example.com, release 1.17.20. This is prose."
    expect(findFileReferences(text)).toEqual([])
  })

  test("handles Windows drive and UNC paths without treating drive letters as line numbers", () => {
    const text = "Open C:\\Users\\Hugo\\report.xlsx or \\\\server\\share\\report.pdf."
    expect(findFileReferences(text).map((item) => item.path)).toEqual([
      "C:\\Users\\Hugo\\report.xlsx",
      "\\\\server\\share\\report.pdf",
    ])
  })
})
