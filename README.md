# quantum-quote-mcp

An [MCP](https://modelcontextprotocol.io) server for authoring **custom Quantum
quotes** from Claude Code — from any folder, no repo to clone. It's a thin,
authenticated proxy over the platform's quote API. Publishing creates a **new
immutable version** of the same quote, so the customer's link never changes.

## Connect

Generate your connect command from the custom-quote flow in the platform (or
Settings). It looks like this (key + URL filled in for you):

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

> Customize quote Q-2026-0142 — add a tiered plan selector and a rollout
> timeline, keep the totals.

## What it exposes

**Tools**
- `list_quotes` — quotes (id, ref, customer, status, total)
- `get_quote(id)` — a quote's current document + status
- `get_schema` — quote JSON Schema, price book, and your authority limits
- `publish_quote_version(id, document)` — publish a new version (same link)

**Resources**
- `schema://quote` — document schema + price book + authority
- `quote://{id}` — a quote's current document

**Prompt**
- `customize-quote(id, instructions?)`

## Environment

| Var | Meaning |
| --- | --- |
| `QUANTUM_API_KEY` | Your quotes-scoped key (`qk_…`) |
| `QUANTUM_QUOTES_URL` | The platform base URL |

## Requirements

Node ≥ 18 (built-in `fetch`). No build step — plain ESM.
