# Horizon IDE — local AI Coding Assistant (desktop preview)

This feature runs **in the Tauri desktop application**, not on a hosted website. The UI invokes Rust IPC, which opens a direct TCP connection to one of two fixed localhost addresses and sends a non-streaming OpenAI-compatible `/v1/chat/completions` request.

| Option | Fixed destination | Prerequisite |
| --- | --- | --- |
| LM Studio | `http://127.0.0.1:1234/v1/chat/completions` | Load a model and enable LM Studio's local OpenAI-compatible server |
| Ollama | `http://127.0.0.1:11434/v1/chat/completions` | Run a locally installed Ollama server with a compatible model |
| Demo (mock) | None | Clearly labeled illustrative response only |

## Use it

1. Open Horizon IDE's native desktop window and find **Local AI Coding Assistant** in the sidebar.
2. Start an **independently trusted** LM Studio or Ollama local server. Click **Discover local models** to read its OpenAI-compatible `/v1/models` list and choose a reported ID, or enter the exact loaded model ID manually. Discovery sends no editor code. The IDE does not silently choose a cloud endpoint or download model weights.
3. Write a request. If you want context from the current Monaco buffer, explicitly enable **Include current editor contents in prompt** (off by default, maximum 64 KiB).
4. Confirm sending the selected prompt/context to the local server each time. The proposal appears in the sidebar as **read-only text**.

If the server is offline, returns an invalid HTTP/JSON reply, or does not supply a proper assistant message, the IDE displays an error and does **not** fall back to a fake AI answer.

## Strict trust boundary

- The Rust adapter only connects to IPv4 loopback `127.0.0.1` on ports `1234` or `11434`. User text cannot change the target IP, port or request path.
- There are bounded prompt, document and response lengths; connection and read/write timeouts; explicit per-request approval; no arbitrary network-fetch function.
- **The IDE cannot know whether your chosen local server records or forwards the request**. Review its privacy and model configuration before sending proprietary code.
- AI output is **never** automatically applied to workspace files and never executes shell/build/game-control commands. No agentic patch review/commit or in-game verification is claimed in this PR.
- The current transport supports ordinary HTTP/1.1 responses with a JSON body, including `Content-Length` and chunked transfer encoding; it does not stream tokens yet.
- Mock mode is visible and explicitly separate from actual model inference.

Future gates: model autodiscovery, cancellable inference/streaming, diff-first patch proposals, static checks, permissioned build/test loop, and genuine gameplay assertion via the separate Game Bridge.
