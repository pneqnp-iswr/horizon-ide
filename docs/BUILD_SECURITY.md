# Cargo builds are native code execution

Horizon IDE's **Run Build** button invokes Cargo with explicit per-run confirmation. Cargo build scripts (`build.rs`), procedural macros, custom compiler wrappers and dependencies can execute code with the current user's privileges. **Opening a folder or reading source files must never run Cargo.** An AI suggestion never grants build approval.

## Present build contract

- User must click **Run Build** and accept the specific warning. The Rust command additionally refuses `approved: false`.
- Validate a canonical workspace root and require `Cargo.toml` in that directory.
- Run `cargo check --locked --message-format=json` as a direct child, without invoking a shell or accepting arbitrary command-line arguments from the model.
- Run off the UI thread. Reject simultaneous builds; allow cancellation through `cancel_build`.
- Bound each captured stream to 512 KiB. The reader drains excess bytes without storing them to avoid a child's pipe blocking indefinitely. Mark truncated output.
- Stop the direct Cargo child after 180 seconds (or on cancellation). Normal IDE shutdown also attempts direct-child termination.
- Turn `compiler-message` JSON records into file/line diagnostics, show stderr and clear failure/timeout/cancellation status. A successful Cargo check is **not** proof that a mod loaded in Horizon.

## Important security limitations

- This is a guarded **developer build**, not an OS security sandbox. Do not build untrusted repositories.
- Cargo may spawn descendants. Killing the direct child does not guarantee termination of all subprocesses. Windows Job Objects / Unix process groups and a full sandbox policy require a separate platform-specific implementation.
- The 512 KiB cap bounds retained in-process output, not the amount that an external compiler process could write to other filesystem paths.
- The build's own scripts can access the user's network, credentials and home with the privileges of the desktop process. The user must understand and approve that trust boundary.
- `--locked` prevents Cargo from changing the lockfile to resolve dependencies but does not prohibit build script execution, network access, or filesystem changes.
- Output processing intentionally limits the number of diagnostic records (128) and message size to avoid UI overload.

## Acceptance tests

- Rust unit tests verify stream truncation and parse actual compiler JSON messages.
- UI tests verify that declining the prompt never invokes Cargo and accepting it sends an explicit approval flag.
- Real Windows desktop CI compiles both the Tauri command and the frontend typed client.
- Future: safe process-tree termination, project trust allowlisting with expiry, structured incremental diagnostic events, explicit target profiles, integration tests with controlled projects and real compiler execution.

Tracked security work: [#5](https://github.com/pneqnp-iswr/horizon-ide/issues/5). This PR addresses only build control; CSP, Monaco local workers and race-resistant filesystem handles remain separate subtasks.
