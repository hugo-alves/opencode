import { Schema } from "effect"
import { PositiveInt } from "./schema"

export const Reference = Schema.Struct({
  raw: Schema.String,
  path: Schema.String,
  lineStart: Schema.optional(PositiveInt),
  lineEnd: Schema.optional(PositiveInt),
  column: Schema.optional(PositiveInt),
  source: Schema.Literals(["markdown", "tool"]),
}).annotate({ identifier: "FileReference" })
export type Reference = typeof Reference.Type

export const Resolved = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("workspace-file"),
    relativePath: Schema.String,
    absolutePath: Schema.String,
    executable: Schema.Boolean,
  }),
  Schema.Struct({
    kind: Schema.Literal("external-file"),
    absolutePath: Schema.String,
    executable: Schema.Boolean,
  }),
  Schema.Struct({
    kind: Schema.Literal("directory"),
    absolutePath: Schema.String,
    external: Schema.Boolean,
  }),
  Schema.Struct({
    kind: Schema.Literal("ambiguous"),
    matches: Schema.Array(Schema.String),
  }),
  Schema.Struct({ kind: Schema.Literal("missing") }),
]).annotate({ identifier: "ResolvedFileReference" })
export type Resolved = typeof Resolved.Type

export const ResolveInput = Schema.Struct({
  references: Schema.Array(Reference),
  refresh: Schema.optional(Schema.Boolean),
})

export * as FileReference from "./file-reference"
