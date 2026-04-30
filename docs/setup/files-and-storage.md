# Files and Storage

Back to [Docs Index](../README.md)

This page explains where Fidra stores its main database, attachments, and sync-related files.

## The Main Database File

Your ledger lives in a single database file, usually with a `.fdra` extension.

Example:

```text
finances.fdra
```

Fidra uses SQLite in WAL mode. That means extra SQLite files can sit beside the main file while the database is in use, most commonly:

```text
finances.fdra
finances.fdra-wal
finances.fdra-shm
```

Those sidecar files are normal. They are part of how SQLite keeps the database safe and fast.

## Recommended Folder Layout

Use a dedicated folder for each Fidra database.

Example:

```text
Club Finance/
  finances.fdra
  finances.fdra-wal
  finances.fdra-shm
```

This matters even more if you use Local Sync, because it helps keep the database file separate from the shared sync folder.

## Recommended Setup

For most clubs, use three separate locations:

1. A dedicated local folder for the `.fdra` file.
2. A separate shared folder for Local Sync, if you use it.
3. A backup location for backup archives.

Do not treat the Local Sync folder as the same thing as the database folder.

## Where Attachments Live

Attachments are stored separately from the `.fdra` file.

Current location:

```text
~/.fidra/attachments/<databaseId>/
```

On macOS, that normally expands to something like:

```text
/Users/your-name/.fidra/attachments/<databaseId>/
```

This is per database. Each database gets its own attachment directory.

## What This Means in Practice

- Moving the `.fdra` file does not automatically move the attachment directory.
- Backups matter, because attachments are not just "inside the same folder" as the database.
- If you are trying to find a raw file on disk, this is the first place to look.

## Attachment Filenames

Fidra stores attachments using generated filenames based on the transaction, rather than keeping the original filename as the on-disk filename.

That means:

- the display name in Fidra may differ from the physical filename on disk
- the stored filename can change if the transaction's date, type, amount, or party changes

So if you need to manage attachments, do it through Fidra where possible rather than by manually renaming files on disk.

## Legacy Attachment Folder

Older data may have used a sibling folder named `fidra_attachments` next to the database file.

Current Fidra migrates that to the stable `~/.fidra/attachments/<databaseId>/` location when the database is opened.

## If You Use Local Sync

Keep these separate:

- your working database folder
- your Local Sync shared folder

That keeps the setup easier to reason about and avoids mixing normal database files with sync transport data.
