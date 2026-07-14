import {
  FileReferenceProvider as SessionFileReferenceProvider,
  type FileReferenceContextValue,
} from "@opencode-ai/session-ui/context/file-reference"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import type { ParentProps } from "solid-js"
import { DialogAmbiguousFileReference, DialogExternalFileReference } from "@/components/dialog-file-reference"
import { useFile } from "./file"
import { usePlatform } from "./platform"
import { useSDK } from "./sdk"
import { ServerConnection } from "./server"
import { useServerSDK } from "./server-sdk"
import { useSync } from "./sync"
import { showToast } from "@/utils/toast"

type Reference = Parameters<FileReferenceContextValue["open"]>[0]
type Resolved = Awaited<ReturnType<FileReferenceContextValue["resolve"]>>[number]

const dangerousExtensions = new Set([
  ".app",
  ".bat",
  ".cmd",
  ".com",
  ".command",
  ".cpl",
  ".exe",
  ".jar",
  ".js",
  ".jse",
  ".lnk",
  ".msi",
  ".msp",
  ".pkg",
  ".ps1",
  ".reg",
  ".scr",
  ".sh",
  ".vbs",
  ".vbe",
  ".wsf",
])

const externalExtensions = new Set([
  ".7z",
  ".aac",
  ".avi",
  ".bmp",
  ".doc",
  ".docx",
  ".flac",
  ".gif",
  ".gz",
  ".htm",
  ".html",
  ".jpeg",
  ".jpg",
  ".m4a",
  ".mkv",
  ".mov",
  ".mp3",
  ".mp4",
  ".odp",
  ".ods",
  ".odt",
  ".ogg",
  ".pdf",
  ".png",
  ".ppt",
  ".pptx",
  ".rar",
  ".svg",
  ".tar",
  ".tif",
  ".tiff",
  ".wav",
  ".webm",
  ".webp",
  ".xls",
  ".xlsx",
  ".zip",
])

export function FileReferenceProvider(props: ParentProps) {
  const sync = useSync()
  const sdk = useSDK()
  const file = useFile()
  const platform = usePlatform()
  const serverSDK = useServerSDK()
  const dialog = useDialog()

  const enabled = () =>
    platform.platform === "desktop" && sync().data.config.experimental?.clickableFileReferences === true

  const resolve: FileReferenceContextValue["resolve"] = (references) =>
    sdk()
      .client.file.references.resolve({
        references: [...references],
        refresh: references.some((reference) => reference.source === "tool"),
      })
      .then((response) => response.data ?? [])

  const resolveOne = (reference: Reference) =>
    sdk()
      .client.file.references.resolve({ references: [reference], refresh: true })
      .then((response) => response.data?.[0] ?? ({ kind: "missing" } as const))

  const copyPath = (value: string) => {
    void navigator.clipboard?.writeText(value).catch(() => {})
  }

  const showMissing = (value: string) => {
    showToast({
      variant: "error",
      title: "File not found",
      description: value,
      actions: [{ label: "Copy path", onClick: () => copyPath(value) }],
    })
  }

  const showRemote = (value: string) => {
    showToast({
      variant: "error",
      title: "This file isn't on this computer",
      description: "OpenCode won't pass a remote server path to Windows.",
      actions: [{ label: "Copy path", onClick: () => copyPath(value) }],
    })
  }

  const canUseNativePath = () => {
    if (platform.platform !== "desktop" || !platform.openPath) return false
    const connection = serverSDK().server
    if (connection.type === "sidecar" && connection.variant === "wsl") return !!platform.wslServers
    return ServerConnection.local(connection)
  }

  const nativePath = async (value: string): Promise<string | undefined> => {
    if (platform.platform !== "desktop" || !platform.openPath) return undefined
    const connection = serverSDK().server
    if (connection.type === "sidecar" && connection.variant === "wsl") {
      return platform.wslServers?.translatePath(connection.distro, value)
    }
    if (ServerConnection.local(connection)) return value
    return undefined
  }

  const reveal = async (value: string) => {
    const target = await nativePath(value)
    if (!target) {
      showRemote(value)
      return
    }
    if (!platform.revealPath) {
      showToast({ variant: "error", title: "Can't show this file", description: target })
      return
    }
    await platform.revealPath(target)
    showToast({
      title: "File wasn't opened",
      description: "OpenCode showed it in the file manager because it may run commands.",
    })
  }

  const openNative = async (value: string) => {
    const target = await nativePath(value)
    if (!target) {
      showRemote(value)
      return
    }
    await platform.openPath?.(target)
  }

  const openWorkspaceFile = async (reference: Reference, resolved: Resolved) => {
    if (resolved.kind !== "workspace-file") return
    const unsafe = resolved.executable || dangerousExtensions.has(extension(resolved.absolutePath))
    if (canUseNativePath() && unsafe) {
      await reveal(resolved.absolutePath)
      return
    }
    if (canUseNativePath() && externalExtensions.has(extension(resolved.absolutePath))) {
      await openNative(resolved.absolutePath)
      return
    }

    await file.open(resolved.relativePath)
    if (!reference.lineStart) return
    const content = file.get(resolved.relativePath)?.content?.content
    const finalLine = content ? Math.max(1, content.split(/\r\n|\r|\n/).length) : reference.lineStart
    const start = Math.min(reference.lineStart, finalLine)
    const requestedEnd = Math.max(reference.lineEnd ?? start, start)
    const end = Math.min(requestedEnd, finalLine)
    file.setSelectedLines(resolved.relativePath, { start, end })
    if (start === reference.lineStart && end === requestedEnd) return
    showToast({ title: "Opened the final line", description: `${resolved.relativePath}:${finalLine}` })
  }

  const openExternalFile = (resolved: Extract<Resolved, { kind: "external-file" }>) => {
    if (!canUseNativePath()) {
      showRemote(resolved.absolutePath)
      return
    }
    const revealOnly = resolved.executable || dangerousExtensions.has(extension(resolved.absolutePath))
    void dialog.show(() => (
      <DialogExternalFileReference
        path={resolved.absolutePath}
        revealOnly={revealOnly}
        onConfirm={() => void (revealOnly ? reveal(resolved.absolutePath) : openNative(resolved.absolutePath))}
      />
    ))
  }

  const openDirectory = (resolved: Extract<Resolved, { kind: "directory" }>) => {
    if (!canUseNativePath()) {
      showRemote(resolved.absolutePath)
      return
    }
    const action = () => void openNative(resolved.absolutePath)
    if (!resolved.external) {
      action()
      return
    }
    void dialog.show(() => (
      <DialogExternalFileReference path={resolved.absolutePath} revealOnly={false} onConfirm={action} />
    ))
  }

  const openResolved = async (reference: Reference, resolved: Resolved) => {
    if (resolved.kind === "missing") {
      showMissing(reference.path)
      return
    }
    if (resolved.kind === "ambiguous") {
      void dialog.show(() => (
        <DialogAmbiguousFileReference
          matches={resolved.matches}
          onSelect={(path) => void open({ ...reference, raw: path, path })}
        />
      ))
      return
    }
    if (resolved.kind === "workspace-file") {
      await openWorkspaceFile(reference, resolved)
      return
    }
    if (resolved.kind === "external-file") {
      openExternalFile(resolved)
      return
    }
    openDirectory(resolved)
  }

  const open = async (reference: Reference) => {
    try {
      await openResolved(reference, await resolveOne(reference))
    } catch (error) {
      showToast({
        variant: "error",
        title: "Couldn't open file",
        description: error instanceof Error ? error.message : String(error),
        actions: [{ label: "Copy path", onClick: () => copyPath(reference.path) }],
      })
    }
  }

  return (
    <SessionFileReferenceProvider value={{ enabled, resolve, open }}>{props.children}</SessionFileReferenceProvider>
  )
}

function extension(value: string) {
  return value.match(/\.[^./\\]+$/)?.[0].toLocaleLowerCase() ?? ""
}
