import { describe, expect, test } from "bun:test"
import { FileReferenceResolver } from "@/file-reference"
import { FileReference } from "@opencode-ai/schema/file-reference"
import { Effect } from "effect"
import { mkdir, realpath, stat, symlink, unlink, writeFile } from "fs/promises"
import path from "path"
import { tmpdir } from "./fixture/fixture"

function reference(value: string): FileReference.Reference {
  return { raw: value, path: value, source: "markdown" }
}

function io(entries: FileReferenceResolver.Entry[] = []): FileReferenceResolver.IO {
  return {
    realPath: (target) => Effect.tryPromise(() => realpath(target)),
    stat: (target) =>
      Effect.tryPromise(async () => {
        const info = await stat(target)
        if (info.isFile()) return { type: "file" as const, executable: (info.mode & 0o111) !== 0 }
        if (info.isDirectory()) return { type: "directory" as const, executable: false }
        throw new Error("Unsupported entry type")
      }),
    search: () => Effect.succeed(entries),
  }
}

describe("FileReferenceResolver", () => {
  test("resolves exact workspace files and directories", async () => {
    await using tmp = await tmpdir()
    const workspace = path.join(tmp.path, "workspace")
    const source = path.join(workspace, "src")
    const file = path.join(source, "app.ts")
    await mkdir(source, { recursive: true })
    await writeFile(file, "export {}")
    const resolver = FileReferenceResolver.createResolver({ io: io(), platform: "posix" })

    expect(await Effect.runPromise(resolver.resolve({ workspace, reference: reference("src/app.ts") }))).toEqual({
      kind: "workspace-file",
      relativePath: "src/app.ts",
      absolutePath: file,
      executable: false,
    })
    expect(await Effect.runPromise(resolver.resolve({ workspace, reference: reference("src") }))).toEqual({
      kind: "directory",
      absolutePath: source,
      external: false,
    })
  })

  test("normalizes backward slashes in POSIX workspace references", async () => {
    await using tmp = await tmpdir()
    const workspace = path.join(tmp.path, "workspace")
    const file = path.join(workspace, "src", "app.ts")
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, "export {}")
    const resolver = FileReferenceResolver.createResolver({ io: io(), platform: "posix" })

    expect(await Effect.runPromise(resolver.resolve({ workspace, reference: reference("src\\app.ts") }))).toMatchObject(
      { kind: "workspace-file", relativePath: "src/app.ts" },
    )
  })

  test("classifies absolute files and traversal outside the workspace as external", async () => {
    await using tmp = await tmpdir()
    const workspace = path.join(tmp.path, "workspace")
    const outside = path.join(tmp.path, "outside.txt")
    await mkdir(workspace)
    await writeFile(outside, "outside")
    const resolver = FileReferenceResolver.createResolver({ io: io(), platform: "posix" })

    expect(await Effect.runPromise(resolver.resolve({ workspace, reference: reference(outside) }))).toEqual({
      kind: "external-file",
      absolutePath: outside,
      executable: false,
    })
    expect(await Effect.runPromise(resolver.resolve({ workspace, reference: reference("../outside.txt") }))).toEqual({
      kind: "external-file",
      absolutePath: outside,
      executable: false,
    })
  })

  test("canonicalizes symlinks before applying the workspace boundary", async () => {
    await using tmp = await tmpdir()
    const workspace = path.join(tmp.path, "workspace")
    const outside = path.join(tmp.path, "outside.txt")
    const link = path.join(workspace, "linked.txt")
    await mkdir(workspace)
    await writeFile(outside, "outside")
    await symlink(outside, link)
    const resolver = FileReferenceResolver.createResolver({ io: io(), platform: "posix" })

    expect(await Effect.runPromise(resolver.resolve({ workspace, reference: reference("linked.txt") }))).toEqual({
      kind: "external-file",
      absolutePath: outside,
      executable: false,
    })
  })

  test("returns every exact basename match instead of guessing", async () => {
    await using tmp = await tmpdir()
    const workspace = path.join(tmp.path, "workspace")
    const first = path.join(workspace, "reports", "report.pdf")
    const second = path.join(workspace, "archive", "report.pdf")
    await mkdir(path.dirname(first), { recursive: true })
    await mkdir(path.dirname(second), { recursive: true })
    await writeFile(first, "first")
    await writeFile(second, "second")
    const resolver = FileReferenceResolver.createResolver({
      io: io([
        { path: "reports/report.pdf", type: "file" },
        { path: "archive/report.pdf", type: "file" },
        { path: "notes/report.pdf.md", type: "file" },
      ]),
      platform: "posix",
    })

    expect(await Effect.runPromise(resolver.resolve({ workspace, reference: reference("report.pdf") }))).toEqual({
      kind: "ambiguous",
      matches: ["archive/report.pdf", "reports/report.pdf"],
    })
  })

  test("limits basename search and resolves a single match", async () => {
    await using tmp = await tmpdir()
    const workspace = path.join(tmp.path, "workspace")
    const file = path.join(workspace, "reports", "report.pdf")
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, "report")
    const calls: { workspace: string; query: string; limit: number }[] = []
    const base = io([{ path: "reports/report.pdf", type: "file" }])
    const resolver = FileReferenceResolver.createResolver({
      io: {
        ...base,
        search: (input) => {
          calls.push(input)
          return base.search(input)
        },
      },
      platform: "posix",
    })

    expect(await Effect.runPromise(resolver.resolve({ workspace, reference: reference("report.pdf") }))).toMatchObject({
      kind: "workspace-file",
      relativePath: "reports/report.pdf",
    })
    expect(calls).toEqual([{ workspace, query: "report.pdf", limit: 50 }])
  })

  test("revalidates cached entries when requested", async () => {
    await using tmp = await tmpdir()
    const workspace = path.join(tmp.path, "workspace")
    const file = path.join(workspace, "report.pdf")
    await mkdir(workspace)
    await writeFile(file, "report")
    const resolver = FileReferenceResolver.createResolver({ io: io(), platform: "posix" })
    const request = { workspace, reference: reference("report.pdf") }

    expect(await Effect.runPromise(resolver.resolve(request))).toMatchObject({ kind: "workspace-file" })
    await unlink(file)
    expect(await Effect.runPromise(resolver.resolve(request))).toMatchObject({ kind: "workspace-file" })
    expect(await Effect.runPromise(resolver.resolve({ ...request, refresh: true }))).toEqual({ kind: "missing" })
  })

  test("supports case-insensitive Windows paths, slash normalization, and UNC files", async () => {
    const entries = new Map([
      ["c:\\work", { absolute: "C:\\Work", type: "directory" as const }],
      ["c:\\work\\src\\app.ts", { absolute: "C:\\Work\\Src\\App.ts", type: "file" as const }],
      ["\\\\server\\share\\report.pdf", { absolute: "\\\\server\\share\\report.pdf", type: "file" as const }],
    ])
    const resolver = FileReferenceResolver.createResolver({
      platform: "win32",
      io: {
        realPath: (target) => {
          const entry = entries.get(target.toLowerCase())
          return entry ? Effect.succeed(entry.absolute) : Effect.fail(new Error("missing"))
        },
        stat: (target) => {
          const entry = entries.get(target.toLowerCase())
          return entry ? Effect.succeed({ type: entry.type, executable: false }) : Effect.fail(new Error("missing"))
        },
        search: () => Effect.succeed([]),
      },
    })

    expect(
      await Effect.runPromise(resolver.resolve({ workspace: "C:\\Work", reference: reference("src/app.ts") })),
    ).toEqual({
      kind: "workspace-file",
      relativePath: "Src/App.ts",
      absolutePath: "C:\\Work\\Src\\App.ts",
      executable: false,
    })
    expect(
      await Effect.runPromise(
        resolver.resolve({ workspace: "C:\\Work", reference: reference("\\\\server\\share\\report.pdf") }),
      ),
    ).toEqual({ kind: "external-file", absolutePath: "\\\\server\\share\\report.pdf", executable: false })
  })

  test("returns missing when exact and workspace search both fail", async () => {
    await using tmp = await tmpdir()
    const workspace = path.join(tmp.path, "workspace")
    await mkdir(workspace)
    const resolver = FileReferenceResolver.createResolver({ io: io(), platform: "posix" })

    expect(await Effect.runPromise(resolver.resolve({ workspace, reference: reference("missing.txt") }))).toEqual({
      kind: "missing",
    })
  })
})
