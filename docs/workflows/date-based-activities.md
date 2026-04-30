# Date-Based Activities

Back to [Docs Index](../README.md)

Fidra can read a leading date prefix from an activity name and use that as structured activity timing.

This is useful for one-off events, month buckets, year buckets, and multi-day activities.

## The Core Rule

Put the date at the start of the activity name, then put the human-readable title after it.

Good:

```text
2026-04-18 Spring Social
2026-05 Training Month
2026 Annual Membership
2026-03-15 to 2026-03-16 Coastal Dive Weekend
```

Less useful:

```text
2026-04-18
Spring Social 2026-04-18
```

The date needs to be first, and the activity should still have a real name after it.

## Supported Formats

### Single day

```text
YYYY-MM-DD Name
```

Example:

```text
2026-04-18 Spring Social
```

### Whole month

```text
YYYY-MM Name
```

Example:

```text
2026-05 Training Month
```

### Whole year

```text
YYYY Name
```

Example:

```text
2026 Annual Membership
```

### Date range

```text
YYYY-MM-DD to YYYY-MM-DD Name
```

Example:

```text
2026-03-15 to 2026-03-16 Coastal Dive Weekend
```

Fidra also recognizes a date range written with a dash between the two dates.

## What Fidra Does With It

Fidra splits the activity into two parts:

1. the structured date prefix
2. the display title after the prefix

So in:

```text
2026-03-15 to 2026-03-16 Coastal Dive Weekend
```

the dates are treated as dates, and `Coastal Dive Weekend` is the activity title.

## Recommended Naming Pattern

Use this format consistently:

```text
<date prefix> <clear activity name>
```

Examples:

- `2026-01-08 Membership Dues Run`
- `2026-02-03 Pool Training Night`
- `2026-04-18 Spring Social`
- `2026-06-12 to 2026-06-14 Skye Weekend`

## When to Use Each Precision

- Use `YYYY-MM-DD` for a specific event day.
- Use `YYYY-MM-DD to YYYY-MM-DD` for trips, camps, or weekends.
- Use `YYYY-MM` for a month-long programme or bucket.
- Use `YYYY` for annual items that do not need more precision.

## Practical Advice

- Always include a readable name after the date.
- Keep one naming convention across the whole club.
- If two activities are genuinely different, give them different titles even if they share the same date.
- Do not hide the date in the middle or end of the activity name and expect Fidra to parse it.
