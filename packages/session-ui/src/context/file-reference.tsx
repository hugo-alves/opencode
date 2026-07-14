import type { FileReference } from "@opencode-ai/schema/file-reference"
import { createContext, type Accessor, type ParentProps, useContext } from "solid-js"

export type FileReferenceContextValue = {
  enabled: Accessor<boolean>
  resolve(references: readonly FileReference.Reference[]): Promise<readonly FileReference.Resolved[]>
  open(reference: FileReference.Reference): Promise<void>
}

const Context = createContext<FileReferenceContextValue>()

export function FileReferenceProvider(props: ParentProps<{ value: FileReferenceContextValue }>) {
  return <Context.Provider value={props.value}>{props.children}</Context.Provider>
}

export function useFileReference() {
  return useContext(Context)
}
