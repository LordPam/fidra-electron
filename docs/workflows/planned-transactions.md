# Planned Transactions

Back to [Docs Index](../README.md)

Planned transactions are recurring or future transaction templates.

They are not the same thing as real posted transactions.

## What a Planned Template Contains

A planned template can include:

- start date
- description
- amount
- income or expense type
- frequency
- target sheet
- category
- party
- activity
- notes
- optional end condition

Supported frequencies are:

- once
- weekly
- biweekly
- monthly
- quarterly
- yearly

## End Conditions

Recurring templates can stop in one of two ways:

1. on a fixed end date
2. after a fixed number of occurrences

If neither is set, the template keeps recurring.

## How the Planned View Works

The Planned view expands templates into upcoming instances.

Current behavior:

- it shows the next 180 days of instances
- it also surfaces overdue instances when relevant

That means a planned template is not just one row in the UI. Fidra is turning it into upcoming due items.

## Next Due and Overdue

Fidra tracks:

- next due date
- overdue date, if something should already have happened but has not been fulfilled or skipped

This is why a planned template can still show up even if there are no future visible instances beyond its due state.

## Converting Planned to Actual

When you convert a planned instance into a real transaction:

- a new real transaction is created
- the template is updated to reflect that the instance has been dealt with

The behavior depends on template type:

### One-off templates

If the template frequency is `once`, converting it removes the planned template.

### Recurring templates

If the template is recurring, converting it marks that instance as fulfilled and keeps the template for future occurrences.

## Date on Conversion

There is an important global setting:

`Settings -> Transaction Behavior -> Set date to today when converting planned to actual`

If enabled:

- the created transaction uses today's date

If disabled:

- the created transaction uses the planned instance date

## Status After Conversion

Converted planned transactions do not all get the same status.

- converted income becomes `--`
- converted expense becomes `pending`

That means expenses can still go through the normal approval flow after conversion.

See [Personnel and Approvals](personnel-and-approvals.md).

## Skipping an Instance

You can skip a planned occurrence without deleting the template.

Under the hood, Fidra records that date as skipped, so it does not keep reappearing as still due.

Use skip when:

- the recurring pattern still exists
- one specific occurrence should not happen

Do not delete the whole template if only one occurrence is being dropped.

## Duplication

Duplicating a template creates a new template with:

- a new ID
- fresh skipped dates
- fresh fulfilled dates

That is useful when you want a similar pattern without carrying over the old completion history.

## Planned Transactions and Invoices

Planned transactions can also be used to prefill invoices.

If you create an invoice from a planned template, Fidra uses the template data for:

- recipient name
- description
- amount
- due date

If an invoice already exists for that planned template, Fidra opens the existing invoice instead of creating a duplicate one.

## When a Paid Invoice Is Linked to a Planned Template

If an invoice linked to a planned template is marked as paid:

- Fidra creates the linked income transaction
- one-off planned templates can be cleared out
- recurring planned templates can have the paid occurrence marked fulfilled

This is one of the tighter integrations between the Planned and Invoices views.

## Recommended Usage Pattern

Use planned transactions for:

- predictable subscriptions
- recurring memberships
- regular training or hire costs
- known future income
- events you already know will happen

Use notes and activities consistently so the planned item carries enough context when it eventually becomes real.
