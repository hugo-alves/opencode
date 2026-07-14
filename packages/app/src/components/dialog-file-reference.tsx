import { Button } from "@opencode-ai/ui/button"
import { Dialog } from "@opencode-ai/ui/dialog"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { TextField } from "@opencode-ai/ui/text-field"
import { createMemo, createSignal, For, Show } from "solid-js"

export function DialogExternalFileReference(props: { path: string; revealOnly: boolean; onConfirm: () => void }) {
  const dialog = useDialog()
  const confirm = () => {
    dialog.close()
    props.onConfirm()
  }

  return (
    <Dialog
      title={props.revealOnly ? "Show external file?" : "Open external file?"}
      class="w-full max-w-[520px] mx-auto"
    >
      <div class="flex flex-col gap-5 p-6 pt-0">
        <p class="text-14-regular text-text-base">
          This file is outside the current workspace. Check the location before continuing.
        </p>
        <code class="p-3 rounded-md bg-surface-base text-12-regular text-text-strong break-all select-text">
          {props.path}
        </code>
        <Show when={props.revealOnly}>
          <p class="text-13-regular text-text-weak">
            OpenCode won't launch this file because its type or executable permission can run commands.
          </p>
        </Show>
        <div class="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => void navigator.clipboard?.writeText(props.path)}>
            Copy path
          </Button>
          <Button variant="secondary" onClick={() => dialog.close()}>
            Cancel
          </Button>
          <Button variant="primary" onClick={confirm}>
            {props.revealOnly ? "Show in folder" : "Open file"}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}

export function DialogAmbiguousFileReference(props: { matches: readonly string[]; onSelect: (path: string) => void }) {
  const dialog = useDialog()
  const [query, setQuery] = createSignal("")
  const filtered = createMemo(() => {
    const value = query().trim().toLocaleLowerCase()
    if (!value) return props.matches
    return props.matches.filter((match) => match.toLocaleLowerCase().includes(value))
  })
  const select = (path: string) => {
    dialog.close()
    props.onSelect(path)
  }

  return (
    <Dialog title="Choose a file" class="w-full max-w-[560px] mx-auto">
      <div class="flex flex-col gap-4 p-6 pt-0">
        <TextField
          autofocus
          label="Filter matching files"
          hideLabel
          placeholder="Filter matching files"
          value={query()}
          onChange={setQuery}
        />
        <div class="flex flex-col max-h-[320px] overflow-y-auto rounded-md border border-border-base">
          <For each={filtered()}>
            {(match) => (
              <button
                type="button"
                class="px-3 py-2 text-left text-13-regular text-text-base hover:bg-surface-base focus-visible:bg-surface-base break-all"
                onClick={() => select(match)}
              >
                {match}
              </button>
            )}
          </For>
          <Show when={filtered().length === 0}>
            <p class="p-4 text-13-regular text-text-weak">No matching files</p>
          </Show>
        </div>
      </div>
    </Dialog>
  )
}
