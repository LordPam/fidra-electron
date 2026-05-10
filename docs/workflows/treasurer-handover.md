# Treasurer Handover

Fidra handover is not just "give the next person the file".

The safe handover method depends on how the club is using Fidra:

- standalone local database
- Local Sync
- Cloud Connect

## Core Rule

If you are handing Fidra over to someone else, prefer a backup-based or access-based handover over manually copying raw files around.

That matters because:

- the main `.fdra` file uses SQLite sidecar files while active
- attachments live separately under `~/.fidra/attachments/<databaseId>/`
- sync and personnel settings may matter as much as the database itself

## What the New Treasurer Should Receive

Regardless of sync mode, the incoming treasurer should get:

1. the current database or a restorable backup
2. the current sync mode and how it is configured
3. the backup location
4. any team access details they need
5. any reporting or invoicing defaults the club relies on

At minimum, write down:

- the database path
- whether the club uses standalone, Local Sync, or Cloud Connect
- the Local Sync shared folder, if applicable
- the backup directory, if it has been customized
- who currently has admin access

## Best Handover Method by Setup

### Standalone Local Database

This is the simplest case, but it still should not be done casually.

Recommended process:

1. Create a manual backup in `Settings -> Backup & Restore`.
2. Confirm the backup completed successfully.
3. Move the backup set, not just the raw `.fdra` file, to the new treasurer.
4. Restore the backup on the new machine.
5. Verify that attachments open properly.

Why use a backup instead of just the database file:

- backups include the database and the attachment set
- copying only the `.fdra` file can leave attachments behind

### Local Sync

For Local Sync, the safest handover is not "move ownership". It is "bring the new treasurer in properly, then step the old one out".

Recommended process:

1. Make sure Local Sync is healthy.
2. Run `Sync Now`.
3. Create a manual backup.
4. Invite the incoming treasurer as an admin.
5. Have them join on their own machine and save their own local `.fdra` file in a dedicated folder.
6. Verify that they can sync, access Personnel, and see the correct shared data.
7. Only then demote or remove the outgoing treasurer if appropriate.

This is better than trying to transfer one person's local working copy.

### Cloud Connect

Cloud Connect handover is mostly an access and infrastructure handover.

Recommended process:

1. Invite the incoming treasurer.
2. Promote them to admin if they need administrative access.
3. Verify they can sign in and access the correct database.
4. Transfer any infrastructure knowledge that lives outside Fidra:
   - database server details
   - Supabase project details
   - storage bucket details
5. Only then demote or remove the outgoing treasurer if appropriate.

## Admin Safety Rule

Fidra protects the last admin from being removed or demoted.

That means the correct order is:

1. add the replacement admin
2. verify they are active
3. then remove or demote the outgoing admin

## Invoice and Report Settings to Recheck

If the club uses invoices and reports, the incoming treasurer should verify:

- organisation name for report builder output
- invoice sender name and address
- bank details
- invoice notes / terms
- invoice branding / logo

One subtle point:

- invoice `logoPath` is device-local
- synced invoice `logoData` can act as a fallback

So if the club relies on a specific logo file, re-check invoice appearance on the new machine instead of assuming it will look identical immediately.

## Recommended Handover Checklist

- [ ] Manual backup created
- [ ] Backup restore tested or at least understood
- [ ] Database location recorded
- [ ] Sync mode recorded
- [ ] Local Sync shared folder recorded, if used
- [ ] Backup directory recorded
- [ ] Incoming treasurer confirmed as active
- [ ] Admin access transferred safely
- [ ] Attachments verified
- [ ] Invoice/report defaults verified

## What Not to Do

- do not pass around only the raw `.fdra` file and assume that is everything
- do not point multiple computers directly at one shared live database file instead of using Local Sync or Cloud Connect properly
- do not remove the outgoing admin before the incoming admin is fully active
