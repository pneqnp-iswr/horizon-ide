# Horizon IDE for Windows — actual desktop application

**Horizon IDE is a Windows desktop program powered by Tauri 2, not a website.** The Monaco code editor, terminal, file explorer, local build runner and Game Bridge are views inside a single native Tauri window. React/Vite are frontend implementation tools, **not** a production web server or hosted account requirement.

## Download the CI preview

1. Open the [GitHub Actions workflow](https://github.com/pneqnp-iswr/horizon-ide/actions/workflows/windows-portable.yml).
2. Select a **successful** run on trusted source and inspect its **Artifacts** section.
3. Download `HorizonIDE-Windows-Portable-Preview`. It contains `HorizonIDE-Windows-preview.zip` and its external SHA-256 checksum file.
4. Compare the ZIP SHA-256 before extraction, then extract it. Run `HorizonIDE.exe` **locally**.
5. On older Windows installations, install Microsoft WebView2 Runtime if it is not present. Do not install additional Minecraft-related components merely to open the IDE.

The portable build embeds its frontend into the Windows executable using Tauri's production build. It does not launch a Vite dev server and does not require `npm` after extracting. Source projects and mod packages are never automatically uploaded to a server.

**This is an UNSIGNED engineering preview, not a trusted or production release.** The build may trigger standard Windows SmartScreen warnings; only run executables you independently trust. GitHub Actions artifacts expire after 14 days. We do not claim Authenticode signing, a Microsoft Store package, a tested updater, or a stable installer.

## Build from source instead

With Windows Rust/Tauri prerequisites and Node.js 24:

```powershell
git clone https://github.com/pneqnp-iswr/horizon-ide.git
cd horizon-ide
npm ci
npm run tauri:dev
```

To create the same local executable yourself:

```powershell
npm run tauri:build -- --no-bundle
# Output: src-tauri\target\release\horizon-ide.exe
```

`npm run dev` runs a **frontend-only development page** and cannot replace the native game/file/build commands. Use `tauri:dev` or the packaged executable for real IDE features.

## Game support remains separate

The Windows desktop binary does not include `horizon-client`, `horizon-ctl`, Mojang/Microsoft assets, user credentials, or a game license. Select your trusted Horizon installation from inside the app to perform supported tests.

The existing Game Bridge can launch an external Horizon process and inspect selected items in an isolated world. A genuinely playable, embedded native 3D viewport is still a separate engineering gate; it must not be inferred from the existence of a packaged desktop executable.
