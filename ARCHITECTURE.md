# Architecture

## Layers

1. **Frontend UI (React + TypeScript)**
   - Layout orchestration and panel rendering.
   - Monaco editor integration.
   - xterm.js console surface.
   - Persisted settings via Zustand.

2. **Frontend Services**
   - `services/tauri/client.ts`: typed command bridge for IPC.
   - `services/ai/provider.ts`: AI provider interface with mock implementation.

3. **Desktop Runtime (Tauri 2 + Rust)**
   - Workspace root management and path-guarded filesystem operations.
   - External game process lifecycle management.
   - Build command execution and structured diagnostics payloads.

## Core module boundaries

- UI panel state and rendering is isolated from Rust command implementation.
- Workspace and file operations are explicit Tauri commands.
- AI interaction is provider-driven and replaceable.
- Game integration is represented by command boundaries compatible with a future `HorizonGameAdapter` implementation.

## Game integration strategy

Current vertical slice supports **external Horizon process launch only**.

Planned evolution:

- Introduce a dedicated `HorizonGameAdapter` trait and adapter registry.
- Negotiate capabilities for a live-preview bridge between IDE and runtime.
- Add protocol events for scene state, entity updates, and runtime diagnostics.

## Diagnostic event protocol (initial)

Build responses return structured diagnostics:

- `level`: `info | warning | error`
- `message`: diagnostic text
- `file`/`line`: optional source location

This shape is intentionally transport-safe for future expansion (LSP, game runtime, AI validation stages).

## Security model

- Workspace root must be set before file/build operations.
- Canonical path checks prevent workspace escape.
- Launch requests require explicit executable path input.
- No embedded secrets, default credentials, or hardcoded game paths.
