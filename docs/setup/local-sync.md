# Local Sync

For the public click-by-click setup walkthrough, use the [Local Sync website guide](../../gh-pages/local-sync.html).

This markdown page is deliberately narrower. It covers the parts that are easy to get wrong or easy to forget once the initial setup is done.

If your team uses OneDrive or SharePoint to host the shared folder, also read [Shared Folders in OneDrive and SharePoint](shared-folders.md).

Local Sync lets a team share one Fidra dataset through a shared folder, without running a server.

## What Local Sync Is

In plain terms:

- each person keeps their own local `.fdra` database on their own machine
- Fidra writes encrypted sync data into a shared folder
- other devices read that sync data and apply the same changes locally

So the shared folder is not the database itself. It is the transport layer that lets separate local databases stay in sync.

## How It Works Under the Hood

The shared folder contains a small fixed structure:

```text
Shared Fidra Sync/
  sync/
  snapshots/
  attachments/
  invites/
```

What each part does:

- `sync/`: encrypted change bundles exchanged between devices
- `snapshots/`: larger state snapshots that help new devices join faster
- `attachments/`: synced attachment files
- `invites/`: invite data used when a new member joins by invite code

For users, the important point is simple: do not manually edit these folders.

## Recommended Setup

Before you switch Local Sync on, choose two separate locations:

1. A local folder for the real `.fdra` database on this computer.
2. A shared sync root folder that every participating computer can access.

Recommended pattern:

```text
MacBook/
  Club Finance/
    finances.fdra
    finances.fdra-wal
    finances.fdra-shm

Shared Drive or Shared Cloud Folder/
  Fidra Sync/
    sync/
    snapshots/
    attachments/
    invites/
```

That separation is worth keeping. It avoids confusing the working database with the sync transport files.

## When Local Sync Is a Good Fit

Use Local Sync when:

- the team mainly works on Macs or PCs you control
- there is a shared folder everyone can access
- you do not want to run or administer a database server

It is usually the simplest multi-user setup for a small club.

## Joining Another Device

There are two ways to join:

1. Invite code
2. Shared passphrase

Invite code is the easier workflow for most clubs.

### Invite Code Join

The joining user needs:

- the shared sync folder
- the email address they were invited with
- the 8-character invite code
- a new password
- a save location for their local `.fdra` file

### Passphrase Join

This is the lower-level route. The joining user needs:

- the shared sync folder
- the team passphrase
- a save location for their local `.fdra` file

## What Invite Codes Actually Do

Invite codes do not create a second sync system.

They are just a safer way to hand a new member the shared Local Sync passphrase without sending the passphrase itself around directly.

From the user's point of view, the result is the same: their device joins the same Local Sync group.

## Folder Selection Warnings

Fidra checks for common mistakes when you choose a sync folder. For example:

- choosing `sync/` instead of its parent folder
- choosing a folder that already contains sync data
- choosing a parent folder when the real sync root is inside a child folder

If Fidra warns you here, stop and read the warning. It is usually catching the exact mistake you were about to make.

## What This Page Intentionally Does Not Repeat

This page does not try to restate:

- every button in the setup flow
- the exact sequence of the setup dialog
- the public onboarding copy from the website guide

That content should live in one place only: the website guide.

## Conflicts

Different sync methods can store or transport changes differently, but the user-facing rule is simple:

- if two changes conflict, Fidra surfaces that for review

From the user's point of view, conflict review should feel the same regardless of how the sync is implemented underneath.

## Practical Rules

- Keep the working `.fdra` file in a dedicated local folder.
- Keep the Local Sync folder separate from that database folder.
- Do not manually rename, move, or clean up files inside the Local Sync folder.
- Do not open the same `.fdra` file directly from a shared drive on multiple computers. Let Local Sync coordinate separate local databases instead.
- If you are setting this up for a club, document which folder is the real Local Sync root before handing it over.

## Recover Files

If Local Sync is active and attachment files seem to be missing or out of place, check:

`Settings -> Local Sync -> Recover Files`

That is the recovery path for re-copying known attachment files and exporting them back into the shared sync folder.
