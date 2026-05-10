# Backups and Restore

Backups are part of normal Fidra operation, not just disaster recovery.

## What Backups Cover

Fidra's backup tools are designed to cover:

- the database itself
- attachments associated with that database

That matters because attachments do not live in the same place as the `.fdra` file.

## Where to Manage Backups

Open:

`Settings -> Backup & Restore -> Manage Backups`

From there you can:

- create a backup manually
- choose a backup directory
- enable automatic backups
- restore a previous backup
- delete old backups

## Recommended Times to Create a Manual Backup

Create a backup before:

- a treasurer handover
- a large import
- a large bulk edit
- enabling or migrating sync
- moving the working database to a new location

## Automatic Backups

Fidra can create backups automatically when the database window closes.

For most clubs, that is worth enabling once you have chosen a sensible backup location.

## Backup Location Recommendation

Use a location that is:

- easy to find
- separate from the live database folder
- included in your normal machine backup strategy

Example:

```text
Club Finance/
  Live/
    finances.fdra
  Backups/
    ...
```

## Restoring a Backup

When you restore a backup, treat it as an operational event, not a casual undo.

Before restoring:

1. make sure you understand which backup you want
2. make sure the team knows a restore is happening if the database is shared
3. stop making other changes until the restore is complete

The restore flow creates a safety backup before replacing the current state.

## Local Sync and Missing Files

If you are using Local Sync and attachments look incomplete, also check:

`Settings -> Local Sync -> Recover Files`

That is separate from full backup restore. It is the targeted recovery tool for known attachment files and Local Sync export.

## Minimum Club Policy

If you only adopt three rules, use these:

1. Keep automatic backups on.
2. Create a manual backup before major structural changes.
3. Do not wait for corruption or loss before learning where the backup controls live.
