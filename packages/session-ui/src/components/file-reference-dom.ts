import type { FileReference } from "@opencode-ai/schema/file-reference"
import { findFileReferences, parseFileReference } from "./file-reference"

export type FileReferenceCandidate = {
  node: Text
  start: number
  end: number
  reference: FileReference.Reference
}

const references = new WeakMap<HTMLElement, FileReference.Reference>()

export function collectFileReferenceCandidates(root: HTMLElement, limit = 100) {
  const result: FileReferenceCandidate[] = []
  const walker = root.ownerDocument.createTreeWalker(root, 4)
  let node = walker.nextNode()

  while (node && result.length < limit) {
    if (!(node instanceof Text)) {
      node = walker.nextNode()
      continue
    }
    const text = node
    const parent = text.parentElement
    node = walker.nextNode()
    if (!parent || parent.closest("pre, a, button, script, style, [data-file-reference]")) continue

    if (parent.tagName === "CODE") {
      const reference = parseFileReference(text.data, "markdown")
      if (!reference) continue
      result.push({ node: text, start: 0, end: text.data.length, reference })
      continue
    }

    for (const match of findFileReferences(text.data, "markdown")) {
      const { start, end, ...reference } = match
      result.push({ node: text, start, end, reference })
      if (result.length === limit) break
    }
  }

  return result
}

export function applyResolvedFileReferences(
  candidates: readonly FileReferenceCandidate[],
  resolved: readonly FileReference.Resolved[],
) {
  const grouped = new Map<Text, { candidate: FileReferenceCandidate; resolved: FileReference.Resolved }[]>()
  candidates.forEach((candidate, index) => {
    const resolution = resolved[index]
    if (!resolution || resolution.kind === "missing") return
    const group = grouped.get(candidate.node) ?? []
    group.push({ candidate, resolved: resolution })
    grouped.set(candidate.node, group)
  })

  grouped.forEach((items, text) => {
    if (!text.isConnected) return
    const document = text.ownerDocument
    const fragment = document.createDocumentFragment()
    let cursor = 0

    items
      .sort((left, right) => left.candidate.start - right.candidate.start)
      .forEach((item) => {
        const { candidate, resolved } = item
        if (candidate.start < cursor) return
        fragment.append(text.data.slice(cursor, candidate.start))
        const button = document.createElement("button")
        button.type = "button"
        button.dataset.fileReference = resolved.kind
        button.title = title(candidate.reference, resolved)
        button.setAttribute("aria-label", button.title)
        button.textContent = text.data.slice(candidate.start, candidate.end)
        references.set(button, candidate.reference)
        fragment.append(button)
        cursor = candidate.end
      })

    fragment.append(text.data.slice(cursor))
    text.replaceWith(fragment)
  })
}

export function clearFileReferenceButtons(root: HTMLElement) {
  root.querySelectorAll<HTMLElement>("[data-file-reference]").forEach((button) => {
    button.replaceWith(button.ownerDocument.createTextNode(button.textContent ?? ""))
  })
  root.normalize()
}

export function setupFileReferenceOpen(root: HTMLElement, open: (reference: FileReference.Reference) => void) {
  const handleClick = (event: MouseEvent) => {
    const target = event.target
    if (!(target instanceof Element)) return
    const button = target.closest<HTMLElement>("[data-file-reference]")
    if (!button || !root.contains(button)) return
    const reference = references.get(button)
    if (!reference) return
    event.preventDefault()
    open(reference)
  }
  root.addEventListener("click", handleClick)
  return () => root.removeEventListener("click", handleClick)
}

function title(reference: FileReference.Reference, resolved: FileReference.Resolved) {
  if (reference.lineStart) return `Open at line ${reference.lineStart}`
  if (resolved.kind === "workspace-file") return `Open ${resolved.relativePath}`
  if (resolved.kind === "external-file") return `Open external file ${resolved.absolutePath}`
  if (resolved.kind === "directory") return `Open folder ${resolved.absolutePath}`
  return `Choose a match for ${reference.raw}`
}
