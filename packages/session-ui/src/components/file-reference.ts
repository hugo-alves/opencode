import { FileReference } from "@opencode-ai/schema/file-reference"

export type ResolvedFileReference = FileReference.Resolved

export type FileReferenceMatch = FileReference.Reference & {
  start: number
  end: number
}

const candidatePattern =
  /(?:file:\/\/\/[^\s<>"'`]+|\\\\[^\s<>"'`]+|[A-Za-z]:[\\/][^\s<>"'`]+|\.{0,2}[\\/][^\s<>"'`]+|(?:[\p{L}\p{N}_()[\].-]+[\\/])+[\p{L}\p{N}_()[\].-]+|[\p{L}_()[\]-][\p{L}\p{N}_()[\].-]*\.[\p{L}][\p{L}\p{N}]{0,15})(?:#L\d+(?:-L?\d+)?|:\d+(?::\d+|-\d+)?)?/gu

const schemePattern = /^[A-Za-z][A-Za-z\d+.-]*:/
const windowsDrivePattern = /^[A-Za-z]:[\\/]/
const uncPattern = /^(?:\\\\|\/\/)[^\\/]+[\\/][^\\/]+/
const versionPattern = /^\d+(?:\.\d+)+$/
const emailPattern = /^[^\s/\\]+@[^\s/\\]+\.[^\s/\\]+$/

export function parseFileReference(
  raw: string,
  source: FileReference.Reference["source"] = "markdown",
): FileReference.Reference | undefined {
  const candidate = raw.trim()
  if (!candidate || candidate.includes("\n") || candidate.includes("\r")) return undefined
  if (emailPattern.test(candidate) || versionPattern.test(candidate)) return undefined
  if (schemePattern.test(candidate) && !windowsDrivePattern.test(candidate) && !candidate.startsWith("file://"))
    return undefined

  const location = parseLocation(candidate)
  const filePath = fileUrlPath(location.path)
  if (!filePath || !looksLikePath(filePath)) return undefined

  return {
    raw: candidate,
    path: filePath,
    ...(location.lineStart === undefined ? {} : { lineStart: location.lineStart }),
    ...(location.lineEnd === undefined ? {} : { lineEnd: location.lineEnd }),
    ...(location.column === undefined ? {} : { column: location.column }),
    source,
  }
}

export function findFileReferences(
  text: string,
  source: FileReference.Reference["source"] = "markdown",
): FileReferenceMatch[] {
  return Array.from(text.matchAll(candidatePattern)).flatMap((match) => {
    if (match.index === undefined) return []
    const tokenStart = Math.max(text.lastIndexOf(" ", match.index - 1), text.lastIndexOf("\n", match.index - 1)) + 1
    const token = text.slice(tokenStart, match.index + match[0].length).replace(/^[([{]+/, "")
    if (/^[A-Za-z][A-Za-z\d+.-]*:\/\//.test(token) && !token.startsWith("file://")) return []
    if (text[match.index - 1] === "@") return []

    const raw = trimTrailingPunctuation(match[0])
    const reference = parseFileReference(raw, source)
    if (!reference) return []
    return [{ ...reference, start: match.index, end: match.index + raw.length }]
  })
}

function parseLocation(raw: string) {
  const hash = raw.match(/#L(\d+)(?:-L?(\d+))?$/)
  if (hash) {
    const lineStart = Number(hash[1])
    return {
      path: raw.slice(0, -hash[0].length),
      lineStart,
      lineEnd: hash[2] ? Number(hash[2]) : undefined,
      column: undefined,
    }
  }

  const suffix = raw.match(/:(\d+)(?::(\d+)|-(\d+))?$/)
  if (!suffix) return { path: raw, lineStart: undefined, lineEnd: undefined, column: undefined }
  const lineStart = Number(suffix[1])
  return {
    path: raw.slice(0, -suffix[0].length),
    lineStart,
    lineEnd: suffix[3] ? Number(suffix[3]) : undefined,
    column: suffix[2] ? Number(suffix[2]) : undefined,
  }
}

function fileUrlPath(value: string): string | undefined {
  if (!value.startsWith("file://")) return value
  try {
    const url = new URL(value)
    if (url.protocol !== "file:") return undefined
    const pathname = decodeURIComponent(url.pathname)
    if (url.host) return `//${url.host}${pathname}`
    if (/^\/[A-Za-z]:\//.test(pathname)) return pathname.slice(1)
    return pathname
  } catch {
    return undefined
  }
}

function looksLikePath(value: string) {
  if (versionPattern.test(value) || emailPattern.test(value)) return false
  if (windowsDrivePattern.test(value) || uncPattern.test(value)) return true
  if (value.startsWith("/") || value.startsWith("./") || value.startsWith("../")) return true
  if (value.startsWith(".\\") || value.startsWith("..\\")) return true
  if (value.includes("/") || value.includes("\\")) return true
  return /^[\p{L}_()[\]-][\p{L}\p{N}_()[\].-]*\.[\p{L}][\p{L}\p{N}]{0,15}$/u.test(value)
}

function trimTrailingPunctuation(value: string) {
  const basic = value.replace(/[.,;!?]+$/g, "")
  const openParen = (basic.match(/\(/g) ?? []).length
  const closeParen = (basic.match(/\)/g) ?? []).length
  const parentheses = closeParen > openParen ? basic.slice(0, -(closeParen - openParen)) : basic
  const openBracket = (parentheses.match(/\[/g) ?? []).length
  const closeBracket = (parentheses.match(/\]/g) ?? []).length
  return closeBracket > openBracket ? parentheses.slice(0, -(closeBracket - openBracket)) : parentheses
}
