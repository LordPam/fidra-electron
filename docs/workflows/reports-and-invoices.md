# Reports and Invoices

Reports and invoices are separate parts of Fidra, but in practice they are both "output" tools: one for internal finance reporting, the other for external billing.

## Reports

The Reports view is split into four tabs:

- Overview
- Breakdowns
- Charts
- Export

The current sheet and the local date/activity filters shape what you are looking at.

## What Reports Include

In normal report filtering:

- planned transactions are excluded from the main transaction set
- date range and activity filters are applied first

That means reports are fundamentally built from real transactions, not from planned templates directly.

## Quick Export

The Quick Export section is the fastest route when you already have the right report filter set.

Current quick exports are:

- CSV
- Markdown
- PDF
- Clipboard

These work from the currently filtered transaction set.

## Custom Report Builder

The Custom Report Builder is the more formal reporting path.

It lets you choose:

- organisation name
- report date range
- output format
- which sections to include

Current output formats:

- PDF
- Markdown

## PDF vs Markdown Reports

The PDF path is richer.

It can include:

- summary
- category breakdowns
- activity breakdowns
- transaction register
- charts
- pending section when relevant
- upcoming planned section when relevant

The Markdown path is simpler and is better thought of as structured export rather than presentation output.

## Category Detail Thresholds

In the PDF builder, category detail can be filtered by:

- minimum transaction count
- minimum total amount
- `OR` / `AND` logic between those two thresholds

That is useful for keeping reports readable when there are many minor categories or descriptions.

## Persistent Report Identity

The report builder remembers the organisation name across sessions.

That makes sense for clubs, because the organisation name usually changes rarely.

## Invoices

The Invoices view is a PDF invoice builder with a live preview.

Each invoice can include:

- sender details
- recipient details
- invoice number
- invoice date
- due date
- multiple line items
- tax rate
- bank details
- notes / terms
- branding accent
- optional logo

## Invoice Lifecycle

In practical terms, invoices move through three states:

- draft
- sent
- paid

Generating the invoice PDF saves the invoice record as sent if it is not already paid.

## Mark as Paid

When you mark an invoice as paid:

- Fidra creates an income transaction
- the invoice is linked to that transaction
- the invoice status changes to paid

If the invoice came from a planned template, marking it paid can also update the planned side appropriately.

## Revert to Draft

Paid is not an irreversible dead end.

You can revert a paid invoice to draft, which also unwinds the linked transaction/template state as needed.

That is useful when something was marked paid too early or against the wrong transaction context.

## What the Invoice Builder Remembers

Some invoice fields are intentionally remembered across sessions, including:

- sender name
- sender address
- bank details
- invoice notes / terms
- invoice numbering counter
- accent choice

This reduces repetitive re-entry for clubs that issue invoices in a consistent format.

## Invoice Logo Caveat

There is one important subtlety with branding:

- the saved `logoPath` is device-local
- synced `logoData` can act as a fallback

So if a new machine or new treasurer opens the same database, re-check the invoice preview rather than assuming the exact same logo file path exists there.

## Planned Transactions and Invoices

Planned transactions and invoices are intentionally linked in a few places:

- creating an invoice from Planned can prefill recipient, description, amount, and date
- a planned template only gets one live invoice at a time
- marking that invoice paid can fulfill the planned item

If you use planned invoices for recurring billing, this linkage is worth understanding up front.

## Recommended Use

Use Reports for:

- internal committee review
- year-end summaries
- grant or society reporting
- committee handover packs

Use Invoices for:

- membership invoices
- reimbursements due back to the club
- external charges
- any case where the club needs a clean PDF billing record
