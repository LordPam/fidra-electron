# Cloud Connect

Back to [Docs Index](../README.md)

For the public click-by-click setup walkthrough, use the [Cloud Connect website guide](../../gh-pages/cloud-connect.html).

This markdown page is the companion note, not a second setup manual.

Cloud Connect is Fidra's server-based sharing model.

## What Cloud Connect Is

In plain terms:

- the team works against a shared cloud database
- people sign in rather than joining through a shared folder
- if configured, attachments can also be stored in cloud storage

This is the better fit when a club needs multi-user access without relying on a shared drive.

## When Cloud Connect Is a Good Fit

Use Cloud Connect when:

- members are not all on the same shared file system
- the team wants a more always-connected setup
- someone can manage the server details

For many small clubs, Local Sync is still the simpler option. Cloud Connect is stronger when members are more distributed or when you want a server-backed model.

## Two Main Modes

Fidra's Cloud Connect setup currently reflects two practical roles:

1. Direct database access for setup and administration.
2. Authenticated member access through Supabase.

In the UI, that shows up as server configuration rather than shared-folder setup.

## Attachments in Cloud Connect

Cloud attachments are optional at setup time, but if you want attachment files to live in the cloud as well, you need Supabase Storage configured.

Relevant pieces are:

- Supabase project URL
- Supabase anon key
- storage bucket name, usually `attachments`

Without that storage layer, the structured record of the attachment can still exist, but file handling is not the same as a fully configured cloud attachment setup.

## What This Page Is For

This page should cover:

- how Cloud Connect differs from Local Sync
- what infrastructure pieces exist
- what an admin needs to know before rolling it out
- attachment-storage expectations

It should not restate every field and every click from the website guide.

## What to Document Next

This page is intentionally short for the first markdown pass.

The next fuller version should cover:

- creating a server entry
- direct Postgres setup
- Supabase member setup
- attachment storage setup
- recommended admin/member rollout

For now, treat this page as the conceptual companion to the Local Sync guide: same goal, different transport.
