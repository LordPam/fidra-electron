# App updates: friction assessment and proposed direction

Assessed and implemented 2026-10-21. The Cue-style verified installer bridge is implemented locally, including shared persistent status, protected all-window handoff, ledger-window restoration, release signing scripts, and a verification-gated release workflow. See `RELEASE_UPDATES.md` for maintained implementation and release instructions. The owner explicitly approved the GitHub signing-key upload, the encrypted Actions secret is configured and verified, and no release has been published. Native automatic app replacement and Apple signing/notarization remain future work.

## Recommendation

Use Cue Workspace's verified-download experience as the near-term model if Developer ID signing is not available. Aim for background download followed by a real “Restart to update” once release signing and platform packaging support it. If signing can be configured now, go straight to the latter rather than maintaining an interim custom downloader.

Application distribution is independent of ledger sync. Serving public release files and update metadata does not require moving financial data, user identities, attachments, or sync keys to an update service. Update requests still expose ordinary connection metadata (such as IP address, platform, and app version); offer manual-only checks for users or organisations that require them.

## Findings in Fidra before implementation

- `src/main/services/update-checker.ts` uses `electron-updater`, disables automatic downloads, and checks on startup through `src/main/index.ts` after five seconds. A native menu offers manual checks.
- `app:quitAndInstall` unconditionally emits `update:installFailed`. It never attempts installation, on any platform. The user can download an update, see “Install & Restart,” and then be directed to a second, manual download.
- `src/renderer/components/UpdateToast.tsx` holds transient event-driven state. Closing the toast loses the visible update action; there is no status query for a newly opened window. Download/install IPC promises are not caught by those click handlers. Error wording assumes every failure is an update-check failure, and the manual fallback button says “Download DMG” on all platforms.
- `forge.config.ts` ad-hoc signs macOS builds. It generates updater metadata by hand and builds Windows installers with Squirrel.Windows, while `electron-updater` selects its NSIS updater on Windows. Generating `latest.yml` does not make those installer formats compatible.
- `.github/workflows/release.yml` builds platform releases on version tags and undrafts the release after the builds succeed. It does not establish successful update installation, signing/notarization, or real previous-version upgrade checks before publication.
- Platform/architecture artifacts and metadata need explicit validation. Separate architecture builds must not overwrite a single metadata file with an entry for only one architecture.

## What the Cue project and installed build actually do

Read-only inspection of `/Applications/Cue.app`, version 0.1.9, bundle ID `com.cueworkspace.cue`. This describes that installed build, not necessarily its latest source or release. The compiled main process and renderer were inspected inside `Contents/Resources/app.asar`; the embedded update public key is Ed25519.

After the user identified the Cue project, also inspected its current local source at `/Users/joshuasullivanpena/Library/Mobile Documents/com~apple~CloudDocs/Documents/03_Projects/Programming/cue-app` (package version 0.1.9). The app's project listing identifies this same path as Cue. `src/main/updater.ts`, `src/main/updaterCore.ts`, `docs/updates.md`, `docs/PILOT_RELEASE.md`, and `docs/PRODUCTION_RELEASE.md` confirm the model below. Source confirmation does not establish that a remote release/deployment has succeeded.

- A small HTTPS JSON feed identifies the release for the current platform and architecture.
- An embedded public key verifies the signed release announcement. It includes the artifact size and SHA-256 digest; downloads are checked against both before use and again before opening the saved installer. The release private key is not in the app.
- Checks run after 30 seconds, every six hours, and on resume when overdue. Available updates download automatically.
- Download status and reminders persist across launches. Main-process status can be queried, so the interface does not depend solely on receiving one event.
- “Save and install” saves the lecture session, opens the verified local installer, and quits. The interface explicitly explains that the user still needs to replace the app. Active tasks delay installation.
- The build calls its install mode `verified-manual`; other platforms report unsupported. Its signed manifests also support mandatory-update metadata. Neither a macOS-only limitation nor mandatory expiry should be copied into Fidra's local workflows.

This removes release hunting and redundant downloads, but does not remove the final manual replacement or provide Apple Developer ID signing/notarization. A release signature proves the publisher authorised an artifact; it does not substitute for the operating system's trust mechanisms.

### Cue's release-management model

The current `.github/workflows/release-pilot.yml` is configured to build and run verification on pushes to `main` and version tags. Only tags run publication: the tag is checked against the package version; a temporary release key is restored from a repository secret; the DMG gets a signed manifest; the update feed/artifact are deployed through Fly; and DMG, ZIP, and manifest are uploaded to a GitHub Release. The configured pilot build is macOS Apple Silicon only. Production signing/notarization has a separate preflight/build route and is not enabled by that pilot workflow.

Fidra already has tag-triggered build/publish automation. Adopt Cue's explicit verification gates, version consistency check, signed release staging, and documented recovery rather than treating tag automation alone as a new capability. Give Fidra its own release authority and hosting; it does not need Cue's AI server, billing, login, or Fly deployment. Preserve immutable versioned artifacts and old supported installers rather than copying the pilot workflow's release-overwrite/old-directory-cleanup behaviour verbatim.

## Proposed user experience

1. Install Fidra once from one clear download page. Detect the likely platform/architecture, with other downloads available. Signed/notarized installers are the goal for reducing first-run friction too.
2. Check quietly and download verified stable updates in the background by default, with a manual-only preference. Failed background checks do not interrupt ledger work.
3. Show a small persistent “Update ready” action and a discoverable update panel in Settings. Include version, short release notes, last check, progress, retry, and “Later.” All windows share the same updater state.
4. For the interim manual route, use an honest “Open installer” action with a short explanation of replacement. Reuse the already downloaded installer. Do not advertise a restart that cannot install anything.
5. For supported signed automatic releases, offer “Restart to update” and “Later.” Installation is deliberate, with no surprise restart. Preserve pending edits across all windows and wait for active imports, exports, and writes to finish before shutdown.
6. Reopen the previous ledger windows after a successful restart. Preserve database paths, attachments, identity, and Local Sync configuration; never require setup or joining again.

Release delivery remains optional and separate from sync. A failed check or postponed update must not block offline ledger use. Changes to sync format/schema require a separate compatibility policy and mixed-version testing.

## Stages and release gates

### 1. Fix the misleading flow and centralise status

Add typed, validated IPC for a main-process updater state machine and status query. Model checking, available, downloading, ready, opening/installing, unsupported, and failed states explicitly, including actual install capability. Add persistent settings/status and recovery actions. Distinguish transport failures from download or install failures. Coalesce duplicate requests from multiple windows.

Until an in-app installer download is implemented, a manual-download action must be presented before downloading an unusable auto-update payload.

### 2. Choose the shortest supported delivery route

- **If signing is available:** complete Developer ID signing, hardened runtime, and notarization for macOS, then enable a supported automatic updater. Keep Forge with Electron's native updater and a compatible feed, or align packaging with `electron-updater` (including NSIS on Windows). Evaluate the migration before committing; a full packaging rewrite is not inherently required.
- **If signing is deferred:** adapt Cue's signed-manifest/download pattern as a coherent interim route. Verify platform, architecture, version, signature, artifact size/digest, approved HTTPS destinations, and persisted downloads. Publish metadata only after artifacts are available. Protect and back up the release key and define a key-rotation route. Use a Fidra-specific key, independent of ledger sync keys. Keep any unsupported platform explicit.

For either route, make one reviewed version tag the maintainer's release action: validate the tag against package/lockfile versions, run required checks, build the supported platform/architecture matrix, stage immutable artifacts and metadata, and publish only after all required gates pass. A failed build must leave the previous published feed usable. This reduces both user update friction and the ongoing work of distributing Fidra.

Static hosting or public GitHub releases can distribute application files; users should not need a GitHub account, token, or a new Fidra service account. Restrict release signing to a controlled publishing workflow. Do not build a custom privileged app-replacement helper simply to avoid normal platform signing.

### 3. Prove upgrades before publishing

Exercise the installed previous release upgrading to the candidate on supported platforms and architectures. Cover interrupted downloads, altered manifests/artifacts, unavailable feed, read-only/translocated macOS apps, snooze/relaunch, multiple windows, pending edits, active jobs, and ledger reopening. Add a recoverable backup before any new database migration; reverting an app binary is not necessarily safe after a schema change.

The currently installed Fidra updater cannot bootstrap a new automatic installation path: its install handler always falls back. Plan for one clearly explained manual bridge installation, then verify that the bridge release can perform the next update.

## Sources

- Local Fidra source, current Cue project source (package version 0.1.9), and installed Cue Workspace 0.1.9, as identified above. No update was downloaded, installed, or published during assessment.
- [electron-builder v26: Auto Update](https://www.electron.build/v26/docs/features/auto-update/) — `electron-updater` targets, macOS signing requirement, Windows NSIS versus Squirrel.Windows, metadata and providers.
- [Electron: Updating Applications](https://www.electronjs.org/docs/latest/tutorial/updates) — Forge-compatible update distribution, including static hosting.
- [Electron: autoUpdater](https://www.electronjs.org/docs/latest/api/auto-updater) — native updater platform behaviour and macOS signing requirement.
- [Apple: Developer ID](https://developer.apple.com/developer-id/) — distribution outside the App Store and notarization.
