import { FileReference } from "@opencode-ai/schema/file-reference"
import { Effect } from "effect"
import path from "path"

export type Platform = "posix" | "win32"

export type Entry = {
  path: string
  type: "file" | "directory"
}

export type IO = {
  realPath: (target: string) => Effect.Effect<string, unknown>
  stat: (target: string) => Effect.Effect<{ type: "file" | "directory"; executable: boolean }, unknown>
  search: (input: { workspace: string; query: string; limit: number }) => Effect.Effect<Entry[], unknown>
}

export function createResolver(input: { io: IO; platform?: Platform }) {
  const platform = input.platform ?? (process.platform === "win32" ? "win32" : "posix")
  const paths = platform === "win32" ? path.win32 : path.posix
  const cache = new Map<string, FileReference.Resolved>()

  const resolve = Effect.fn("FileReference.resolve")(function* (request: {
    workspace: string
    reference: FileReference.Reference
    refresh?: boolean
  }) {
    const key = comparison(request.workspace, platform) + "\0" + comparison(request.reference.path, platform)
    const cached = cache.get(key)
    if (!request.refresh && cached) return cached

    const workspace =
      (yield* optional(input.io.realPath(normalize(request.workspace, platform)))) ??
      paths.resolve(normalize(request.workspace, platform))
    const result = yield* resolveUncached({
      io: input.io,
      paths,
      platform,
      workspace,
      candidate: normalize(request.reference.path, platform),
    })
    cache.set(key, result)
    return result
  })

  return {
    resolve,
    resolveBatch: (request: { workspace: string; references: readonly FileReference.Reference[]; refresh?: boolean }) =>
      Effect.all(
        request.references.map((reference) =>
          resolve({ workspace: request.workspace, reference, refresh: request.refresh }),
        ),
        { concurrency: 10 },
      ),
    invalidate(workspace?: string) {
      if (!workspace) {
        cache.clear()
        return
      }
      const prefix = comparison(workspace, platform) + "\0"
      Array.from(cache.keys())
        .filter((key) => key.startsWith(prefix))
        .forEach((key) => cache.delete(key))
    },
    cacheSize() {
      return cache.size
    },
  }
}

function resolveUncached(input: {
  io: IO
  paths: path.PlatformPath
  platform: Platform
  workspace: string
  candidate: string
}) {
  return Effect.gen(function* () {
    const absolute = input.paths.isAbsolute(input.candidate)
    const exact = absolute
      ? input.paths.resolve(input.candidate)
      : input.paths.resolve(input.workspace, input.candidate)
    const match = yield* inspect(input, exact)
    if (match) return classify(match)
    if (absolute) return { kind: "missing" } satisfies FileReference.Resolved

    const requested = input.candidate.replace(/^\.[\\/]/, "")
    const found = yield* input.io
      .search({ workspace: input.workspace, query: input.paths.basename(requested), limit: 50 })
      .pipe(Effect.catch(() => Effect.succeed([] as Entry[])))
    const candidates = found.filter((entry) => matches(entry.path, requested, input.paths, input.platform))
    const inspected = yield* Effect.all(
      candidates.map((entry) =>
        inspect(input, input.paths.resolve(input.workspace, normalize(entry.path, input.platform))),
      ),
      { concurrency: 10 },
    )
    const valid = inspected
      .filter((entry): entry is NonNullable<typeof entry> => !!entry && entry.inside)
      .filter(
        (entry, index, entries) =>
          entries.findIndex((item) => equal(item.absolute, entry.absolute, input.platform)) === index,
      )

    if (valid.length === 0) return { kind: "missing" } satisfies FileReference.Resolved
    if (valid.length > 1)
      return {
        kind: "ambiguous",
        matches: valid.map((entry) => entry.relative).sort((a, b) => a.localeCompare(b)),
      } satisfies FileReference.Resolved
    return classify(valid[0])
  })
}

function inspect(input: { io: IO; paths: path.PlatformPath; platform: Platform; workspace: string }, target: string) {
  return Effect.gen(function* () {
    const absolute = yield* optional(input.io.realPath(target))
    if (!absolute) return undefined
    const info = yield* optional(input.io.stat(absolute))
    if (!info) return undefined
    const relative = input.paths.relative(input.workspace, absolute)
    return {
      absolute,
      ...info,
      relative: relative.replaceAll("\\", "/"),
      inside:
        relative === "" ||
        (relative !== ".." && !relative.startsWith(`..${input.paths.sep}`) && !input.paths.isAbsolute(relative)),
    }
  })
}

function classify(entry: {
  absolute: string
  type: "file" | "directory"
  executable: boolean
  relative: string
  inside: boolean
}): FileReference.Resolved {
  if (entry.type === "directory") return { kind: "directory", absolutePath: entry.absolute, external: !entry.inside }
  if (!entry.inside) return { kind: "external-file", absolutePath: entry.absolute, executable: entry.executable }
  return {
    kind: "workspace-file",
    relativePath: entry.relative,
    absolutePath: entry.absolute,
    executable: entry.executable,
  }
}

function matches(relative: string, requested: string, paths: path.PlatformPath, platform: Platform) {
  const candidate = normalize(relative, platform).replace(/[\\/]$/, "")
  const target = normalize(requested, platform).replace(/[\\/]$/, "")
  if (!target.includes(paths.sep)) return equal(paths.basename(candidate), paths.basename(target), platform)
  return (
    equal(candidate, target, platform) ||
    comparison(candidate, platform).endsWith(paths.sep + comparison(target, platform))
  )
}

function optional<A>(effect: Effect.Effect<A, unknown>) {
  return effect.pipe(Effect.catch(() => Effect.succeed(undefined)))
}

function normalize(value: string, platform: Platform) {
  return platform === "win32" ? value.replaceAll("/", "\\") : value.replaceAll("\\", "/")
}

function comparison(value: string, platform: Platform) {
  const normalized = normalize(value, platform)
  return platform === "win32" ? normalized.toLowerCase() : normalized
}

function equal(left: string, right: string, platform: Platform) {
  return comparison(left, platform) === comparison(right, platform)
}

export * as FileReferenceResolver from "./file-reference"
