# Reviewed local-AI edits in the native Horizon IDE

This feature extends the genuine LM Studio / Ollama integration inside the Tauri desktop application with **single-file, explicit-review edit proposals**.

## Workflow

1. Open a real UTF-8 source document in Monaco, and optionally save current unsaved edits.
2. Select a locally running AI provider and model ID. Enable **Include current editor contents in prompt** (off by default).
3. Type what you want changed and click **Propose file edit (review diff)**. Confirm sending the selected document and path to your own local model.
4. The model must return **one JSON object** with exactly `path` (the full currently selected path) and `newContent` (a full replacement file). Unknown fields, commands, different paths, empty/unchanged replacements, invalid JSON and oversized outputs are rejected.
5. Inspect the actual original/new file comparison in **Monaco DiffEditor**. The model's response cannot directly edit files or run a process.
6. Choose **Apply to editor** (explicit confirmation, updates only the in-memory Monaco buffer), **Discard proposal**, or **Show code editor** to inspect current work.
7. After applying, use **Undo AI buffer edit** before saving, or the regular revision-protected **Ctrl+S** to save to disk. Building a content mod remains a separate user-approved action. The Game Bridge requires its own approval and real Horizon assets.

## Concurrency protection

The editor stores the exact selected path, original buffer and SHA-256 disk revision at request time. An async response is rejected if the user changed the active buffer/file/revision while the model was responding. Acceptance repeats this check. Undo only works if the current buffer still matches the applied suggestion and the disk revision has not advanced.

**Data is never silently written to disk** and model content is not executed as HTML, shell commands or game instructions. Suggestions are rendered as escaped text/code in Monaco's native diff view. The only current editable scope is one existing opened UTF-8 file, not a multi-file agent workspace.

## Limits and engineering evidence

The prompt is sent to user-selected LM Studio/Ollama on loopback. A local server could have its own network routing/logging policy; the IDE cannot independently guarantee its privacy. The model may return invalid JSON; the IDE shows an explicit refusal instead of inventing a patch.

Tests cover strict schema, file ID mismatch, enormous responses, stale source/disk revision, declined context sharing, Monaco before/after preview, in-memory apply, undo and no automatic save. Real model accuracy and successful game integration still require independent owner-run validation.
