# Personnel and Approvals

This page covers two separate ideas that clubs often mix together:

1. who has access to the database
2. how transactions move through review

They are related operationally, but they are not the same thing.

## Personnel

Personnel is Fidra's list of named people who can access a shared database.

This only becomes relevant when you are using a shared mode such as:

- Local Sync with personnel enabled
- Cloud Connect

If you are using a standalone local database, the Personnel area stays disabled.

## Roles

Fidra currently has two personnel roles:

- `Admin`
- `Member`

### Admin

Admins can manage team access. In practice that means they can:

- invite people
- promote members to admins
- demote admins to members
- remove personnel entries

Fidra protects the last remaining admin from being removed or demoted.

### Member

Members are normal non-admin identities for shared use of the database.

## Personnel Status

Personnel records can effectively be in two practical states:

- `Invited`
- `Active`

`Invited` means the person has been created in the access list but has not completed their join/activation step yet.

`Active` means they have completed that setup and now have a working identity.

## Local Sync Invite Flow

In Local Sync, the common workflow is:

1. an admin invites a person
2. Fidra generates an 8-character invite code
3. the admin shares that code with the person
4. the person joins using their email, the invite code, and a new password

That join flow creates their usable local identity without the admin having to hand over the raw sync passphrase directly.

## Recommended Role Setup for Small Clubs

For most clubs:

- keep admin rights limited to the people who actually need to manage setup and access
- make everyone else a member

That keeps the personnel list simpler and reduces accidental access-management changes.

## Approvals

Approvals are about transaction review, not personnel onboarding.

Fidra uses transaction statuses including:

- `pending`
- `approved`
- `rejected`
- `planned`
- `--` for normal non-pending cases

In practical club use, the common pattern is:

- expenses start as `pending`
- someone reviews them
- they become `approved` or `rejected`

## Where Approvals Happen

The main places to review pending items are:

- Dashboard
- Transactions

Transactions also supports keyboard shortcuts for fast review. See [Keyboard Shortcuts](../reference/keyboard-shortcuts.md).

## Approval Date Behavior

There is an important settings option here:

`Settings -> Transaction Behavior -> Set date to today when approving transactions`

If enabled, approving a pending transaction rewrites its date to today's date.

If disabled, the original date is preserved.

This is a club policy choice, not just a technical toggle.

## Planned Conversion Date Behavior

There is a similar setting for planned transactions:

`Settings -> Transaction Behavior -> Set date to today when converting planned to actual`

That controls whether conversion keeps the planned date or stamps the current date.

## Recommended Review Workflow

For a typical small club:

1. record the expense as soon as it is known
2. leave it pending if it still needs review
3. approve or reject it from Dashboard or Transactions
4. decide once, as a club, whether approval should change the transaction date

That avoids inconsistent handling between different treasurers.
