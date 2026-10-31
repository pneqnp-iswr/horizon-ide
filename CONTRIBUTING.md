# Contributing

## Development setup

1. Install Node.js 24+ and Rust stable.
2. Install dependencies:

   ```bash
   npm install
   ```

3. Run frontend dev server:

   ```bash
   npm run dev
   ```

4. Run desktop app:

   ```bash
   npm run tauri:dev
   ```

## Validation before opening a PR

```bash
npm run lint
npm run test
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
```

## Scope and quality expectations

- Keep changes focused and reversible.
- Preserve explicit workspace and process security boundaries.
- Mark simulated features clearly.
- Do not introduce hardcoded Horizon paths or hidden side effects.
- Add tests for new logic where practical.
