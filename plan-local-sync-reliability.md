# Local Sync reliability, relocation and recovery

Design and implementation tracker, 2026-11-25. The owner selected folder-sync
hardening; Graph is optional and university IT approval is not a viable route.
The two safety milestones below are implemented in source. Provider integration,
legacy upgrade/recovery and organisation relocation remain proposed behaviour;
the complete system is not release-ready.
The existing Local Sync CRDT engine remains the only sync backend. Local SQLite
remains the operational store; transport failure never blocks local ledger use.

## Incident and current limitations

Read-only evidence confirms the owner and teammate are using disjoint local
mailboxes for the same team. The legacy configured root was recreated during
Fidra startup on 25 October; the active OneDrive library mount was created earlier
that afternoon. The owner has 254 outgoing bundles absent from the active mount;
that mount has 14 bundles absent from the owner's configured root. These counts
are a point-in-time inventory, not a count of transactions or a merge plan.

At the incident baseline, `SyncOrchestrator.start()` recursively created the saved root. Green status only
indicates local engine/provider/network health. It proves neither cloud upload
nor peer application. Reconnection changes a path without replaying previously
exported bundles. There is no complete, reviewed organisation-relocation workflow.

Baseline source inspection exposed the hazards below; the milestones record the
implemented protections and remaining compatibility work:

- Import advances the export watermark, potentially hiding an unexported local
  edit if import runs during export debounce or after an export failure.
- The scanner excludes every sequence below the maximum received, even when
  earlier bundles arrived late or failed to import.
- The watcher remembers filenames after a failed import; fallback polling only
  detects previously unseen names, so skipped bundles need not be retried.
- Snapshot coverage is inferred from files present, rather than changes actually
  applied. Snapshot selection compares device-local sequence numbers across
  devices; existing snapshot application bypasses the critical-field merge gate.
- Unequal column versions alone do not establish causal observation. Concurrent
  offline edits, delete/edit conflicts and conflict resolution propagation need
  targeted review before recovery can rely on the current merge gate.
- Attachment transport currently writes plain files despite the documented
  encrypted-transport invariant. Include this in transport hardening and migration
  compatibility work; do not describe the current attachment route as encrypted.

## 1. Bind to identity and show evidence of delivery

Give each sync organisation a stable random group ID, independent of local
database IDs, device IDs, folder names and provider paths. Keep an authenticated,
versioned manifest in the mailbox and pin its identity locally. A copied manifest
alone cannot distinguish an abandoned copy from the live mailbox: also record
the provider location and the authorised relocation generation. Authentication
with a shared secret proves group membership, not administrator authority.
Relocation authorisation needs a separately validated authority model.

For existing groups, establish identity through an explicit upgrade/bootstrap
flow that verifies trusted shared history and previews the binding. A matching
name or successful decryption alone must not silently combine unrelated ledgers.

For desktop-folder transport:

- Check the selected root exists, belongs to the expected provider domain and
  matches the pinned group before startup and before transport writes. A vanished
  root pauses sync; never recreate provider ancestors during normal operation.
  Only explicit first-time setup may initialise an approved root.
- Use supported persistent folder references where possible (macOS bookmarks,
  Windows registered cloud-root information). Re-resolve after filesystem/provider
  changes. Account for races, symlinks, permission loss and re-registration.
- Offer a detected replacement for review; require identity verification before
  switching. An OS folder reference may not survive replacement of the provider
  domain, and a root registration does not prove cloud upload.
- Keep a durable local outbox outside OneDrive. Exported locally, uploaded to
  Microsoft and applied by a peer are separate receipts. Keep failures and queued
  work visible and retry them; receiving remote changes must not clear local work.

For stronger OneDrive integration, add a Microsoft Graph transport adapter to the
same sync engine. Pin the canonical owning `driveId` and folder `itemId` (and
tenant/site context where relevant), rather than a local mount path or shortcut.
Authenticate through Microsoft's supported desktop sign-in flow; keep tokens in
OS-protected storage in main process. Upload/download the same immutable encrypted
bundles directly to the institution's Microsoft storage, with no Fidra data server.
Verify remote bytes/hash before recording cloud delivery. Handle pagination/delta
resets, throttling, revoked permissions, token expiry and offline retries.

IDs survive rename/move within their drive; cross-drive/library replacement needs
an explicit rebind. Institutional consent is a feasibility gate, not assumed.
Folder-selected permissions require both administrator consent and resource
assignment. Retain the hardened folder route for institutions that cannot approve
Graph. Start a small connectivity/consent spike before committing to this adapter.

Show independent evidence in the UI:

| Evidence | Meaning |
| --- | --- |
| Saved on this device | Local database commit succeeded |
| Queued / written to sync folder | Durable outbound data exists locally |
| Verified in Microsoft storage | Graph or another supported remote check verified the bundle |
| Applied by a named device, at a time | Authenticated receipt written after its database commit |
| Review required / delivery unverified | Conflicts, errors or missing evidence remain |

A heartbeat is liveness only. A peer receipt identifies exact bundles and any
conflicts; it does not imply every financial field is resolved. An offline device
must show its last acknowledgement, not a fabricated current success. No promise
of delivery to a powered-off device or unlimited preservation of cloud-deleted
data is possible.

## 2. Separate device reconnection from organisation relocation

The local ledger file and the shared mailbox have different ownership. Moving
the local `.fdra` file is a separate action; never share a live SQLite database
as the sync mechanism. Keep standalone/Local Sync mode immutable.

**Reconnect this computer:** select another local representation of the same
mailbox, verify group/provider identity, inventory the outbox and old-root backlog,
show recovery requirements, then commit only this device's binding. Do not reset
CRDT identity, counters or export history. Failure leaves a resumable operation.

**Move the organisation's shared folder:** expose an admin-only native workflow:

1. Verify the destination, current authority and supported client versions; identify
   devices that are offline. Require an upgrade/coordinated cutover for old clients
   that cannot understand relocation markers.
2. Create consistent local backups and capture both locations' inventories. Pause
   pruning and shared transport during staging; local edits continue into outboxes.
3. Copy verified state, necessary history and attachments without overwriting
   differing objects. Read back and validate destination contents and permissions.
4. Record a durable relocation journal and an authenticated, authorised announcement
   at the old and new locations, carrying group identity, destination identity,
   migration ID and generation. Never put a machine's local path or credentials
   in an organisation-wide redirect.
5. Commit the new binding only after destination verification. Other devices verify
   the announcement and rebind/choose their own local representation. Continue
   collecting late old-location bundles and offline devices' pending edits.
6. Finish only after required device acknowledgements or explicit administrator
   retirement of unavailable devices. Retain the old history/redirect for a defined
   recovery period; do not silently delete it. Concurrent moves require review.

Every phase must be restartable and idempotent. A missing old folder or a device
that never reconnects prevents automatic certainty; show that limitation explicitly.

## 3. Recovery is a reviewed merge of histories

Provide a native recovery wizard using isolated working copies:

1. Capture consistent SQLite backups (including WAL state), both mailboxes,
   attachments, tombstones, receipts and conflict queues. Record hashes and pause
   compaction. For a coordinated repair, prevent peers from importing partial repair
   output until the reviewed recovery has been staged.
2. Validate lineage, integrity, schema compatibility and device identities. Inventory
   each immutable bundle by identity and content, with explicit missing ranges.
   Quarantine corrupt or colliding objects; never replace same-name different bytes.
3. Replay verified history into staged copies using causally informed conflict
   detection. Preserve genuine entity IDs and transfer pairs. Include snapshots
   only with proven coverage; do not use a snapshot to bypass manual review.
4. Present per-account creates/edits/deletes, amounts and balances, unresolved
   conflicts, linked-transfer integrity, orphan references and missing attachments.
   Independent safe edits may merge; divergent financial values, delete/edit
   conflicts and ambiguous financial effects require explicit choices. If a base
   or history is missing, report uncertainty rather than infer a winner.
5. Apply approved resolutions atomically through shared services, with a durable
   audit/recovery journal and retry receipts. Publish staged verified outputs only
   when ready; do not overwrite another device's database.
6. Have each peer import, acknowledge exact coverage and confirm a canonical
   ledger-state digest plus balances/references/attachment hashes. Aggregate balances
   alone do not prove convergence. Distinguish converged data from unresolved review.

Rollback on a synced group must be a coordinated recovery or new compensating
changes. Restoring one old database and reconnecting is not an organisation rollback;
peers can immediately reapply later changes. Preserve pre-recovery evidence.

## Implementation order and acceptance gates

1. Reproduce missing-root recreation, lost export during import, late sequence,
   failed hydration retry, unsafe snapshot coverage and divergent offline edits.
   Fix root validation, durable outbound/receipt tracking, gap-aware retries and
   safe snapshot/conflict behaviour before using automated recovery on real data.
2. Add pinned identity, provider-aware reconnection and honest delivery status.
3. Build staged recovery and admin relocation on the corrected shared services.
4. Evaluate Graph consent/access against the actual institutional library; implement
   the optional adapter only after that gate passes.

Regression gates include disappearing roots while running, root replacement,
provider re-registration, paused/offline peers, duplicate/out-of-order bundles,
crash at every relocation/recovery phase, corrupt/missing snapshots, same-name
collisions, attachment loss, concurrent financial edits with unequal column
versions, deletions, transfer pairs, multi-window access and old-client behaviour.
Run background unit/integration/type/lint checks locally. Desktop/installer tests
remain restricted to isolated CI unless the owner explicitly requests local UI.

## First safety milestone — implemented in source, 2026-11-25

- Require an existing root; create only direct sync subdirectories, refusing
  symlink redirection. Detect realpath/device/inode replacement during a session.
- Save each outgoing encrypted payload in local `sync_outbound_bundles`, in the
  same immediate SQLite transaction as its sequence/checkpoint. Replay exact
  retained bytes after delivery failure/restart. Never replace a differing bundle.
- Preserve local edits before inbound application; never move the outbound
  checkpoint merely because remote changes were imported. Commit incoming data,
  queued conflicts and local dedup records together.
- Deduplicate exact device/sequence pairs rather than a maximum. Do not trust
  legacy snapshot coverage to skip history. Poll reconciliation retries already
  seen files; resume also recovers arrivals during a watcher pause.
- Disable automatic snapshot application to existing ledgers and refuse history
  cleanup. New snapshots advertise empty prune coverage, including to old peers.
- Remove the green idle indicator; explain that a folder export is not proof of
  cloud upload or receipt by another device. Surface skipped-bundle failures.

Validation: 183 sync tests pass, including actual SQLite close/reopen with a
pending outbox, atomic rollback on checkpoint/receipt failures, two connections
reserving sequences, corrupt/out-of-order delivery, collisions, root disappearance
and replacement, and snapshot bypass prevention. TypeScript passes; targeted
ESLint has no errors (existing warnings remain). A full service run passed 728
tests; 15 AI-bridge cases were blocked by sandbox refusal to listen on loopback.
Three subsequent sync regressions also pass. No local desktop/installer tests,
live-ledger recovery, shared-folder writes or configuration changes were made.

Release gates recorded at this first checkpoint: persistent provider/group identity and explicit rebind;
authenticated exact peer delivery receipts; causal critical-field/delete conflict
handling and resolution propagation; snapshot coverage/selection/onboarding;
attachment encryption and integrity migration; staged recovery and relocation;
coordinated multi-version acceptance on macOS and Windows. Root identity is
currently session-only and cannot establish that a pre-existing directory is the
active provider mailbox. Retained journal entries are not yet pruned. Existing
history from before this patch is not automatically reconstructed or acknowledged.
Older running peers can still perform their old unsafe cleanup; upgrade/cutover
coordination remains necessary. A partial final copy or same-name collision is
preserved and reported for review rather than silently overwritten.

## Second safety milestone — implemented in source, 2026-11-25

- Persist an encrypted team/mailbox manifest and pin its exact bytes plus local
  realpath/device/inode across restarts. Explicit reconnect verifies the known
  group and mailbox; it cannot initialise an unrelated organisation. First-peer
  setup is restricted to an empty dedicated folder and retains bootstrap bytes
  locally for retries. This establishes local continuity, not provider membership
  or remote cloud delivery. Legacy roots require reviewed upgrade and pause safely.
- Protocol v2 preserves binary CR-SQLite primary keys exactly and validates wire
  shapes before database access. Legacy protocol imports are reserved for reviewed
  recovery. New protocol objects are rejected by older clients; coordinated upgrade
  is mandatory. Imported device settings and immutable team-ID changes are refused.
- Track exact revision origins and exact accepted bundle ranges, preserving gaps.
  Imported unchanged revisions are not exported again, and later relays cannot
  manufacture edit ancestry. Unproved divergent financial edits require review on
  both peers even with unequal column versions. Delete/edit disagreements hold
  all entity fields together. Real CR-SQLite even/odd existence sentinel behavior
  is covered by integration tests.
- Reviewed field and lifecycle choices create fresh revisions above both
  alternatives, with the audit and queue update in one immediate transaction.
  Stale comparisons refresh before another choice; partial edits cannot recreate
  deleted rows; the last local administrator cannot be deleted or demoted by a
  review. A peer's older conflict clears only when a revision proves descent from
  both alternatives. Conflicting linked transfers hold both incoming halves and
  refuse single-side resolution pending a joint reviewed recovery workflow.
- Record group-key-authenticated, exact ciphertext-hash delivery evidence only
  after incoming data/conflicts commit. Durable encrypted receipt batches retry
  immutable bytes. Settings show historical reports for known personnel devices,
  pending receipts and queued reviews. These are not independent device signatures,
  attachment receipts, cloud-upload confirmation or current convergence proofs.
  Imported bundle hashes are pinned; changed bytes under a received sequence stop
  reconciliation rather than disappearing behind deduplication.
- Attachments use authenticated encrypted envelopes and opaque mailbox names.
  Retained local ciphertext supports retries and recovery of a missing original;
  differing local/shared files are preserved and reported. Legacy plain/encrypted
  layouts are preserved for reviewed migration; no mailbox file is auto-decrypted
  to plaintext. Metadata receipt does not imply attachment receipt.
- Snapshots are immutable, hash-named bootstrap objects with exact causal history.
  Existing ledgers cannot apply them. Creation requires exported, accepted tracked
  revisions and no unresolved review. Selection requires one observed history to
  cover all other snapshots; equal coverage with differing state stops onboarding.
  Snapshot coverage must match its accepted source records. A fresh join replays
  available bundles through the same merge gate and publishes its database only
  after activation succeeds. A present corrupt/incomplete object blocks publication.
  History pruning remains disabled; journals intentionally have no retention policy.

Validation at this checkpoint: the broad service run passed 803 tests; the same
16 unrelated AI-bridge tests were blocked by sandbox loopback-listen `EPERM`.
Subsequent snapshot-metadata and attachment-recovery regressions also pass.
TypeScript passes. Targeted ESLint has no errors (warnings remain). Final sync-only
acceptance is recorded in `AGENTS.md`. All databases and mailbox writes in tests
were temporary fixtures. No live account, shared root, configuration, release or
desktop UI was changed or exercised.

Remaining release gates: native staged legacy identity/attachment upgrade and
split-history recovery, complete joint-transfer review, provider-domain detection
and persistent location references, reviewed organisation relocation, attachment
delivery evidence and canonical multi-device convergence checks. Validate coordinated
modern/legacy client cutover and installer/desktop behavior in isolated macOS and
Windows CI before rollout. A copied manifest is not proof of an active OneDrive
mount; an offline peer cannot prove current delivery. Existing pre-journal exports
are not reconstructed automatically. No production upgrade has been authorised or
performed by these source changes.

## Primary references

- Microsoft item addressing: https://learn.microsoft.com/en-us/graph/onedrive-addressing-driveitems
- Graph files/SharePoint libraries: https://learn.microsoft.com/en-us/graph/api/resources/onedrive?view=graph-rest-1.0
- Graph delta: https://learn.microsoft.com/en-us/graph/api/driveitem-delta?view=graph-rest-1.0
- Selected permissions: https://learn.microsoft.com/en-us/graph/permissions-selected-overview
- Institutional consent: https://learn.microsoft.com/en-us/entra/identity/enterprise-apps/user-admin-consent-overview
- Apple persistent bookmarks: https://developer.apple.com/library/archive/documentation/FileManagement/Conceptual/FileSystemProgrammingGuide/AccessingFilesandDirectories/AccessingFilesandDirectories.html
- Windows sync-root lookup: https://learn.microsoft.com/en-us/windows/win32/api/cfapi/nf-cfapi-cfgetsyncrootinfobypath

## Candidate platform acceptance — 2026-11-27

Version 0.1.31 source `dfab148a589bc74614e62d9392a9c5eb99876cdd` on the isolated candidate branch passed [run 46084657974](https://github.com/LordPam/fidra-electron/actions/runs/46084657974). Both platforms pass all 763 service tests; macOS passes 40 desktop tests and Windows passes 9 desktop tests. Matching plugin checks, actual DMG/Setup.exe creation and artifact upload succeed. The Windows missing-mailbox case now moves the mailbox between sandboxed launches because Windows rejected renaming the actively watched folder; macOS retains the live-disappearance test. Tests keep production cryptography and financial assertions.

The candidate acceptance gate is fulfilled. Native legacy identity/attachment upgrade, reviewed split-history recovery and joint-transfer resolution, provider-aware relocation, coordinated old-client cutover and installer-upgrade acceptance remain before stable publication. The stable updater release remains gated. No live ledger or shared mailbox was modified.

## Native recovery implementation checkpoint — 2026-11-28

Implemented a persistent, private recovery stage with committed WAL-consistent
SQLite backups, read-only external peer capture (no migrations or attachment
relocation on originals), hash-pinned mailbox inventories, exact ciphertext
identity checks, and preservation of local-only unresolved conflict queues.
A copied SQLite site ID is not accepted as causal proof during recovery.

The administrator's Settings dialog prepares/resumes reviews, shows account totals
and individual row changes without exposing personnel credentials, resolves
ordinary conflicts and both linked-transfer entries, and selects differing
attachment contents by hash. Legacy plaintext and encrypted attachments are read
only and retained privately as sealed alternatives. Missing files and incomplete
or unbalanced transfers block publication. Native IPC checks the current live
administrator, serialises recovery operations and rechecks authority/multi-window
state before committing publication.

Publication prepares a separate account and fresh mailbox identity. It retains a
signed predecessor/retirement certificate, actual encrypted baseline and final
snapshot, uses a durable retry plan, verifies original inventories again, and
publishes the mailbox manifest last. The original ledger gets a local transport
pause marker; its ledger data and old shared mailbox are preserved. Other old
clients still require an explicit coordinated pause/rejoin. Invitations now pin
the manifest bytes, mailbox location and administrator authority.

Local acceptance: 19 recovery foundation/session tests pass, including interrupted
publication retry, joint-transfer audit rollback, stale-review rejection, readonly
original preservation, and joining the resulting mailbox in a fresh account.
The existing 35 orchestrator regressions pass. Typecheck passes. The full-schema
recovery tests exposed and fixed an audit action rejected by the production
SQLite CHECK constraint. A native-dialog acceptance scenario has been added for
isolated macOS/Windows runners; no Electron app or live ledger was launched here.

Remaining: full native desktop/installer acceptance of this change, supported
provider-domain/location recovery, signed same-group organisation relocation,
late old-mailbox contributions and peer cutover/convergence evidence. Fresh-group
reviewed recovery must not be presented as completion of those remaining gates.
Stable updater publication remains blocked.

Final-commit crash regression: a durable predecessor transport pause is written before the new mailbox manifest, then replaced atomically with the completed recovery marker. A failed final retirement write remains paused across restart and the same saved publication repairs it on retry. Already committed original accounts cannot start another independent recovery.

Final commit also holds the original database’s SQLite write lock across manifest publication and source retirement. A second writable connection is proven unable to insert an edit in that interval. The earlier durable pause marker survives a transaction/process failure.

Provider conflict-copy filenames now preserve participant identity from authenticated bundle/snapshot contents rather than relying on filenames. Such devices still require a captured ledger or explicit retirement. Mac acceptance at cdd8418 passed all 783 service tests, 41 desktop tests and actual 0.1.23 → 0.1.31 installer replacement; Windows revealed a legitimate inventory barrier hit by its own pending export. Native recovery preparation now drains that pending export before capture, preserving rejection of genuinely late history. The updated build passed on both platforms as recorded below.

## Cross-platform native acceptance — 2026-11-28

Source commit: `50cd964393612ad8b37f9d7ceacc863a05b3f9ba`.
Run: https://github.com/LordPam/fidra-electron/actions/runs/46091031843 (success).

Both OS runners pass 784 service tests and matching plugin smoke checks. macOS
passes 41 real Electron tests; Windows passes 10, including the native recovery
dialog publication scenario. Both build installers and verify their signed
metadata, replace an actual 0.1.23 installation with 0.1.31, boot it and preserve
the synthetic ledger/attachment while refreshing the compatibility helper.

Retained macOS artifact: 15241826329. Retained Windows artifact: 15241716561.
All tests used isolated runner profiles and synthetic accounts. No local Electron
launch, live financial edit, shared mailbox change or local installation occurred.

Native staged recovery acceptance is complete for the supported cases. It still
refuses missing/corrupt evidence, incomplete rows, ambiguous identities and stale
reviews. Remaining release gates now explicitly name supported provider/location
recovery, signed same-group relocation and reviewed late contributions, and
coordinated old-client/peer convergence acceptance. These are not implemented or
accepted merely because fresh-group recovery and installer upgrades passed.
No stable tag, release publication or discoverable updater metadata was created.
