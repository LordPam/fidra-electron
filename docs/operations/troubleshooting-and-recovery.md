# Troubleshooting and Recovery

This page is for common operational problems: missing files, sync confusion, access issues, and knowing which recovery path to try first.

## First Principle

Do not start by manually moving or deleting files inside Fidra's storage or sync folders.

In most cases, Fidra already has a safer recovery path:

- backups
- Local Sync `Recover Files`
- admin invite flow
- attachment re-open / re-download behavior

## I Cannot Find the Attachments

Current attachments live here:

```text
~/.fidra/attachments/<databaseId>/
```

They are not stored beside the `.fdra` file anymore.

So if you are looking only in the database folder, you are probably looking in the wrong place.

See [Files and Storage](../setup/files-and-storage.md).

## An Attachment Will Not Open

Start with these checks:

1. confirm the attachment row still exists in Fidra
2. try opening it again
3. if you use Local Sync, run `Settings -> Local Sync -> Recover Files`
4. if the file still seems missing, restore from backup if necessary

Fidra already tries a few fallback locations when opening attachments, including legacy storage and cloud download where relevant. If that still fails, treat it as a genuine file recovery problem.

## I Picked the Wrong Local Sync Folder

This is common.

The Local Sync root should be the parent folder containing:

```text
sync/
snapshots/
attachments/
invites/
```

Do not select:

- the `sync/` subfolder itself
- the `snapshots/` subfolder itself
- a parent folder above the real sync root unless you intend that

Fidra warns about many of these mistakes already. If the folder chooser gives you a warning, stop and read it.

## Local Sync Seems to Have Reset

If the database itself is in a cloud-synced path, Local Sync settings can appear to drop out even though the underlying sync data is still there.

If that happens:

1. reconfigure Local Sync
2. point it at the same sync folder

The setup should pick up where it left off.

## Missing Local Sync Attachments

Use:

`Settings -> Local Sync -> Recover Files`

That recovery path is designed to:

- copy known attachment files from known source locations
- export them back into the Local Sync shared folder

It is the right first move before attempting manual folder surgery.

## I Cannot Join With My Invite

Common causes:

- wrong email address
- wrong invite code
- password confirmation mismatch
- trying to sign in before activating the invited account

For Local Sync, invited users must finish the invite join flow and set their password before they can sign in normally.

## I Cannot Remove or Demote an Admin

If Fidra refuses to remove or demote an admin, check whether they are the last admin.

That block is intentional.

Fix:

1. promote or activate another admin first
2. then retry the removal or demotion

## I Need to Restore an Older State

Use:

`Settings -> Backup & Restore`

Important behavior:

- restore creates a pre-restore safety backup first
- if the selected backup contains attachments, those are restored too

Default backup location, if you have not changed it:

```text
<database-folder>/<database-name>_backups/
```

See [Backups and Restore](backups-and-restore.md).

## Reports or Totals Look Wrong

Before assuming corruption, check:

1. the current sheet filter
2. the report date range
3. the activity filter
4. whether you are looking at pending, rejected, planned, or real transactions

In particular:

- quick exports use the currently filtered transaction set
- formal PDF reports treat pending and rejected differently from the main countable totals

So some differences are reporting rules, not broken data.

## I Need More Detail Than the UI Shows

Open:

`Settings -> About`

Fidra exposes the current log path there.

That is the right place to start if:

- sync errors keep recurring
- a recovery action fails
- a backup or restore does not behave as expected

## Recovery Order

If you are unsure what to do, use this order:

1. verify the problem in the UI
2. check the relevant settings page
3. use the built-in recovery action, if one exists
4. check backups
5. check the log path
6. only then start thinking about direct file-level intervention
