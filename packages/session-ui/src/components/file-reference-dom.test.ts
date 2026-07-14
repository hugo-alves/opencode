import { afterAll, describe, expect, test } from "bun:test"
import { GlobalRegistrator } from "@happy-dom/global-registrator"
import {
  applyResolvedFileReferences,
  clearFileReferenceButtons,
  collectFileReferenceCandidates,
  setupFileReferenceOpen,
} from "./file-reference-dom"

GlobalRegistrator.register()
afterAll(() => GlobalRegistrator.unregister())

describe("file reference decoration", () => {
  test("collects normal and inline-code paths while skipping links and fenced code", () => {
    const root = document.createElement("div")
    root.innerHTML = [
      "<p>See src/app.ts:42 and <code>C:\\Reports\\final report.pdf</code>.</p>",
      '<p><a href="https://example.com/src/app.ts">src/app.ts</a></p>',
      "<pre><code>src/ignored.ts</code></pre>",
    ].join("")
    document.body.append(root)

    expect(collectFileReferenceCandidates(root).map((item) => item.reference)).toEqual([
      { raw: "src/app.ts:42", path: "src/app.ts", lineStart: 42, source: "markdown" },
      { raw: "C:\\Reports\\final report.pdf", path: "C:\\Reports\\final report.pdf", source: "markdown" },
    ])
  })

  test("decorates only validated paths and opens the original structured reference", () => {
    const root = document.createElement("div")
    root.textContent = "Open src/app.ts:8, but leave missing.txt alone."
    document.body.append(root)
    const candidates = collectFileReferenceCandidates(root)
    const opened: string[] = []
    const cleanup = setupFileReferenceOpen(root, (reference) => opened.push(reference.path))

    applyResolvedFileReferences(candidates, [
      {
        kind: "workspace-file",
        relativePath: "src/app.ts",
        absolutePath: "/work/src/app.ts",
        executable: false,
      },
      { kind: "missing" },
    ])

    const button = root.querySelector("button")
    expect(button?.type).toBe("button")
    expect(button?.textContent).toBe("src/app.ts:8")
    expect(button?.title).toBe("Open at line 8")
    expect(root.textContent).toBe("Open src/app.ts:8, but leave missing.txt alone.")
    button?.click()
    expect(opened).toEqual(["src/app.ts"])

    clearFileReferenceButtons(root)
    expect(root.querySelector("button")).toBeNull()
    expect(root.textContent).toBe("Open src/app.ts:8, but leave missing.txt alone.")
    cleanup()
  })

  test("caps candidate collection before resolution", () => {
    const root = document.createElement("div")
    root.textContent = Array.from({ length: 120 }, (_, index) => `file-${index}.txt`).join(" ")
    document.body.append(root)
    expect(collectFileReferenceCandidates(root)).toHaveLength(100)
  })
})
