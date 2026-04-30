# Fidra Docs

This is the first markdown-first pass of Fidra's documentation.

The goal is not to describe every feature. The goal is to cover the things a real treasurer or committee member needs in order to set Fidra up safely, understand where data lives, and avoid the less obvious mistakes.

The website already contains marketing-style setup guides for the sync options. These docs should not duplicate those walkthroughs.

## Principles

- Write for operators, not developers.
- Prefer task-based pages over feature tours.
- Explain the mechanism only as far as it helps someone use Fidra correctly.
- Keep setup and recovery guidance explicit.
- Do not maintain a second copy of the public setup guides in markdown.

## Use the Website Guides For Setup Walkthroughs

These are the primary click-by-click setup guides:

- [Local Sync website guide](../gh-pages/local-sync.html)
- [Cloud Connect website guide](../gh-pages/cloud-connect.html)

The markdown docs should complement those pages with:

- file layout and storage rules
- recovery and backup guidance
- role and approval behavior
- keyboard shortcuts
- less intuitive conventions like date-based activities

## Suggested Reading Order

1. [Files and Storage](setup/files-and-storage.md)
2. [Local Sync Notes](setup/local-sync.md)
3. [Cloud Connect Notes](setup/cloud-connect.md)
4. [Date-Based Activities](workflows/date-based-activities.md)
5. [Personnel and Approvals](workflows/personnel-and-approvals.md)
6. [Planned Transactions](workflows/planned-transactions.md)
7. [Reports and Invoices](workflows/reports-and-invoices.md)
8. [Keyboard Shortcuts](reference/keyboard-shortcuts.md)
9. [Backups and Restore](operations/backups-and-restore.md)
10. [Treasurer Handover](workflows/treasurer-handover.md)
11. [Troubleshooting and Recovery](operations/troubleshooting-and-recovery.md)

## Current Docs

### Setup

- [Files and Storage](setup/files-and-storage.md)
- [Local Sync Notes](setup/local-sync.md)
- [Cloud Connect Notes](setup/cloud-connect.md)

### Workflows

- [Date-Based Activities](workflows/date-based-activities.md)
- [Personnel and Approvals](workflows/personnel-and-approvals.md)
- [Planned Transactions](workflows/planned-transactions.md)
- [Reports and Invoices](workflows/reports-and-invoices.md)
- [Treasurer Handover](workflows/treasurer-handover.md)

### Reference

- [Keyboard Shortcuts](reference/keyboard-shortcuts.md)

### Operations

- [Backups and Restore](operations/backups-and-restore.md)
- [Troubleshooting and Recovery](operations/troubleshooting-and-recovery.md)

## Planned Next Pages

- Install notes for unsigned desktop builds
- Sync conflict review
- Audit log usage

## Notes for Later

If these docs move onto the website later, the structure above is already suitable for a docs sidebar:

- Setup
- Workflows
- Reference
- Operations

That is the right shape for Fidra. It separates one-time setup from day-to-day usage and from recovery/admin tasks.
