# quantum-quote-mcp

An [MCP](https://modelcontextprotocol.io) server for reading and revising
**Quantum quotes** from Claude Code — from any folder, no repo to clone. It's a
thin, authenticated proxy over the platform's quote API. Publishing creates a
**new immutable version** of the same quote, so the customer's link never changes.

## Scope: a quote is line items + Quantum Care

There is no "custom quote" flow. Narrative selling — the story, the comparison
matrix, the rollout plan — lives in a **proposal**, which is a kind of demo
authored with the sibling
[quantum-demos-mcp](https://github.com/quantumtechnologies876/quantum-demos-mcp)
server; the rep then pulls a proposal's priced elements into a quote draft.

So use this server to inspect quotes and adjust what is *priced*. The
`hero`/`prose`/`tierSelector`/`addOns`/`timeline`/`image`/`customHtml` block types
still exist in the schema — published versions are immutable, so old quotes
contain them — but they are legacy and new work should not add them.
`careMatrix` (Quantum Care, priced per device per month) is the one tier-bearing
block the platform still authors.

## Connect

Generate your connect command in the platform under **Settings → Quote
Authoring**. It looks like this (key + URL filled in for you):

```bash
claude mcp add quantum-quotes \
  --env QUANTUM_API_KEY=qk_xxxxxxxx \
  --env QUANTUM_QUOTES_URL=https://your-quantum-app \
  -- npx -y github:quantumtechnologies876/quantum-quote-mcp
```

The key is a **quotes-scoped** key (`qk_…`) — separate from your CLI key, and
limited to quote authoring.

Run it once (terminal, or paste into Claude Code and let it set up).

## Use

> Show me quote Q-2026-0142 and check every line's SKU against the price book.

> Bump the device count on the Northwind draft to 60 and tell me what that does
> to the monthly figure.

## What it exposes

**Tools**
- `list_quotes` — quotes (id, ref, customer, status, total)
- `get_quote(id)` — a quote's current document + status
- `get_schema` — quote JSON Schema, price book, and your authority limits
- `list_drafts` — unpublished quote drafts (id, title)
- `get_draft(id)` — a draft's current document
- `update_draft(id, document)` — validate + save a draft (the rep publishes it)
- `publish_quote_version(id, document)` — publish a new version (same link)

**Resources**
- `schema://quote` — document schema + price book + authority
- `quote://{id}` — a quote's current document

**Prompts**
- `revise-draft(id, instructions?)` — revise an unpublished draft
- `revise-quote(id, instructions?)` — revise a published quote as a new version

> Renamed from `customize-draft` / `customize-quote`, which described the removed
> custom-quote flow.

## Totals

`totalCents` on a quote is the **due-now** figure, not the contract value — a
Care-only (monthly) quote shows `0` there and carries its money in the recurring
monthly figure. Don't read the headline as the deal size.

## Environment

| Var | Meaning |
| --- | --- |
| `QUANTUM_API_KEY` | Your quotes-scoped key (`qk_…`) |
| `QUANTUM_QUOTES_URL` | The platform base URL |

## Requirements

Node ≥ 18 (built-in `fetch`). No build step — plain ESM.
