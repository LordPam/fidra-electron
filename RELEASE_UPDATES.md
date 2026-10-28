# Verified update releases

The Cue-style updater downloads a DMG or Windows Setup.exe, authenticates an Ed25519-signed announcement, checks its signed size/SHA-256, and opens the cached installer after all windows acknowledge that it is safe to close. It never attempts native automatic replacement. Static public GitHub release assets are the only update service; no ledger data or sync credentials are involved.

## One-time signing setup

A Fidra-specific key pair was created during this implementation:

- Public key: `resources/update-public-key.pem` (commit and package this).
- Private key: `~/.fidra/release-keys/fidra-update-private.pem` (outside the repository, mode 0600).

Keep an encrypted backup of the private key separately. Never generate a new pair for an ordinary release: installed copies trust the existing public key. The private key is independent of both Apple signing and Local Sync keys.

The repository secret **FIDRA_UPDATE_PRIVATE_KEY_B64** is configured in `LordPam/fidra-electron`. The owner explicitly approved uploading the matching private release key to GitHub Actions, and the secret metadata was verified after submission. The private value was supplied through a local stdin pipe and was not printed or added to the repository. Keep using this same key for ordinary releases.

For a fresh installation of this workflow on a different project, `npm run update:keygen -- --private-key /absolute/private/path/key.pem` creates a pair. The script refuses to overwrite existing keys and refuses a private-key path inside the project.

## Ordinary releases

1. Review the source and release notes, and update matching versions in `package.json` and `package-lock.json`.
2. Run the checks and test the installed previous version upgrading to the candidate. Use disposable copies of ledgers; cover unfinished edits and at least two windows.
3. Commit the public key and source. Push a matching stable tag such as `v0.1.24`.
4. The release workflow validates versions and the key pair, checks types, runs tests, builds macOS arm64 and Windows x64 installers, and signs per-platform manifests. Both jobs publish into a draft. Each then verifies the signed candidate and actually replaces the 0.1.23 installer on its disposable runner, checks startup and synthetic SQLite/attachment retention, and verifies the repaired helper refresh. Only after both succeed and all required artifacts exist is the release published with the checked-in versioned release notes.
5. Verify the public feed from an installed bridge build, download, complete the installer, and confirm ledger windows, attachments and sessions survive.

The updater supports macOS x64 manifests when that platform is built, but the configured release matrix remains macOS arm64 and Windows x64. Linux and Windows arm64 use the official download page; no incompatible installer is offered. Do not overwrite an existing version's installer: publish a new patch version instead. Publisher signing/notarization is explicitly deferred by the owner (2026-10-24), and is not a rollout gate for the unsigned target. Cross-platform installed-version upgrade tests remain rollout gates; local unit tests do not establish them. The tag workflow automatically publishes only after both builds and installer smoke checks succeed. Review source, local acceptance and versioned release notes before pushing a tag. Disposable macOS launches use Chromium’s test mock Keychain, without changing production settings. The installer smoke probe is a valid isolated SQLite file deliberately not opened as the app ledger; it establishes installer file preservation, not every ledger migration or interactive OS installation flow. Real open-ledger/update-preparation acceptance remains covered separately by the desktop suite.

## Local release staging

Set `FIDRA_UPDATE_PRIVATE_KEY_PATH` to the private key path when running `npm run make`. Forge includes the public key and creates signed metadata alongside each installer. Without that environment variable, a local build can be packaged for development but does not publish signed metadata. The GitHub release workflow requires the key and cannot silently produce an unverified feed.

To sign an already built artifact:

```sh
npm run update:release -- --artifact /absolute/path/Fidra-macOS-arm64.dmg --platform darwin --arch arm64 --version 0.1.24 --private-key /absolute/private/path/key.pem --notes /absolute/path/release-notes.txt
```

The version must match the project package. The private key must match the packaged public key. The manifest records a fixed versioned GitHub URL, so the official repository can serve both release files and the stable feed without another hosting account. Legacy `latest-mac.yml` and `latest.yml` metadata remain in builds so older clients can discover the manual bridge installation.

## Recovery and trust

- A failed build leaves the published release unchanged; investigate the draft before retrying.
- Retain previous versioned assets. Roll back code with a new patch version; do not force clients to install an older version or silently roll back a migrated ledger.
- If the private key is lost, existing clients cannot trust a new key automatically. Use a separately authenticated manual bridge or a transition release trusted by the old key.
- If the key is compromised, stop release publication and document a recovery/rotation plan. Hosting compromise alone cannot produce a newly trusted artifact without the key.
- Public metadata is bounded and strictly validated. Each HTTPS redirect is checked against approved GitHub/CDN hosts before connecting. Saved installer paths are derived from authenticated metadata, never accepted from the renderer or cache state.
- Do not add forced offline expiry or make local operations depend on update availability.

## Implementation and validation

`VerifiedUpdater` owns the single process-wide state and on-disk cache. Typed `updates:*` IPC exposes status and explicit actions. Renderer windows subscribe before querying current status and ignore late older revisions. Background checks respect the persisted automatic/manual preference; snooze persists across launches. The native menu opens Settings so manual check results remain visible.

During an installer handoff all windows are made inert, blur-based and delayed saves settle, invoice builders explicitly flush, and pending native/IPC jobs drain. Unfinished transactions, incomplete invoices, profile edits and open dialogs prevent shutdown. Windows acknowledge a request-specific token; an unresponsive or replaced window aborts the handoff. The installer is verified again immediately before opening. Local databases are closed with existing backup/cleanup logic, and ledger paths are saved for restoration on the next launch. No sync connection or successful network export is required.

Unit tests cover signature/URL/platform validation, streaming corruption/interruption, coalescing, cache recovery, preferences, snooze, and all-window handoff/cancellation. Electron scenarios cover the persistent update UI, shared window state, manual preference persistence, and preservation of unfinished transaction edits.

## Verification recorded for this implementation

- 477 unit tests across 40 files passed after an isolated native-module rebuild for Node (the workspace's default rebuild hit a local Python/path issue).
- 10 real-Electron checks passed against temporary ledgers: five update scenarios and five transaction regressions. These include invoice flushing and reopening two saved ledger windows on the next launch.
- TypeScript, targeted lint for the new update path, macOS packaging, public-key packaging verification, script syntax checks, and an isolated browser demo build passed.
- Actual previous-release installer replacement and Windows runtime installation remain rollout smoke tests. No release was published. The private release key was subsequently stored only in the approved encrypted GitHub Actions secret; its metadata was verified.


## 0.1.25 connection helper rollout

The previously repaired, explicitly installed local helper is refreshed automatically by packaged Fidra startup. See `AI_PLUGIN.md`. Updating/reopening Fidra then restarting the AI desktop app refreshes this tool server without manual file replacement. Saved native grants remain narrow; additional permissions require native review. The separate private account-plugin release updates its packaged skills and portable adapter but is not assumed to update the pinned helper.


For Node 22+ clean dependency installation, use `npm ci --ignore-scripts`, `node scripts/prepare-native-install.mjs`, then `npm rebuild`. The pinned CR-SQLite 0.16.3 install helper uses obsolete JSON import assertion syntax; the preparation script checks the pinned version and exact statement, replacing only package metadata loading before running the usual dependency lifecycle. Its native extension is unchanged. The release workflow performs this sequence. Manual dispatch builds and validates private candidates without publishing; only a matching tag push can publish after all gates pass.
