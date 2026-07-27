#!/usr/bin/env node
/*
 * quantum-quote-mcp — an MCP server for reading and revising Quantum quotes.
 *
 * A thin, authenticated proxy over the platform quote API, usable from Claude
 * Code in any folder with no repo to clone. Publishing creates a NEW immutable
 * version of the same quote, so the customer's shareable link never changes.
 *
 * SCOPE — a quote is line items + Quantum Care, and nothing else.
 * There is no "custom quote" flow any more. Narrative selling (the story, the
 * comparison matrix, the rollout plan) lives in a PROPOSAL, which is a kind of
 * demo authored with the sibling `quantum-demos-mcp` server; a rep then pulls a
 * proposal's priced elements into a quote draft. So use these tools to inspect
 * quotes and to adjust what is priced — do not rebuild a quote into a brochure.
 *
 * The hero/prose/tierSelector/addOns/timeline/image/customHtml block types still
 * exist in the schema, because quote_versions is immutable and already-published
 * quotes contain them. They are legacy: the builder no longer authors them, and
 * new work should not add them. `careMatrix` (Quantum Care) is priced per device
 * per month and is the one tier-bearing block the builder does still author.
 *
 * Env (set once by the `claude mcp add` command from the platform):
 *   QUANTUM_API_KEY    — the rep's quotes-scoped key (qk_…); the full CLI key
 *                        (qq_…) is also accepted on these routes
 *   QUANTUM_QUOTES_URL — the platform base URL
 */

import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const BASE = (process.env.QUANTUM_QUOTES_URL || "").replace(/\/$/, "");
const KEY = process.env.QUANTUM_API_KEY || "";

async function api(path, init = {}) {
  if (!BASE) throw new Error("QUANTUM_QUOTES_URL is not set.");
  if (!KEY) throw new Error("QUANTUM_API_KEY is not set.");
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${KEY}`,
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) {
    const detail = Array.isArray(body?.errors)
      ? `: ${body.errors.join("; ")}`
      : body?.error
        ? `: ${body.error}`
        : text
          ? `: ${text}`
          : "";
    throw new Error(`${init.method || "GET"} ${path} → ${res.status}${detail}`);
  }
  return body;
}

async function tool(fn) {
  try {
    const data = await fn();
    return {
      content: [{ type: "text", text: typeof data === "string" ? data : JSON.stringify(data, null, 2) }],
    };
  } catch (err) {
    return { isError: true, content: [{ type: "text", text: String(err?.message ?? err) }] };
  }
}

const server = new McpServer({ name: "quantum-quotes", version: "0.2.0" });

/* ---- Tools ---- */
server.tool(
  "list_quotes",
  "List quotes (id, ref, customer, status, total). Start here to find a quote by ref or customer.",
  {},
  () => tool(() => api("/api/quotes")),
);

server.tool(
  "get_quote",
  "Fetch a quote's current document + status by id. Load this before revising anything.",
  { id: z.string().describe("The quote id") },
  ({ id }) => tool(() => api(`/api/quotes/${id}`)),
);

server.tool(
  "get_schema",
  "Get the quote document JSON Schema, the active price book, and this rep's authority limits (max discount / deal total). The schema is generated from the live document type, so it always reflects the current block catalog — including careMatrix (Quantum Care).",
  {},
  () => tool(() => api("/api/schema")),
);

/* Drafts — a quote BEFORE it's published. The rep builds it in the platform
 * builder (saved as a draft), or seeds one from a proposal; you can adjust the
 * draft document, then the rep publishes it once from the builder. */
server.tool(
  "list_drafts",
  "List the rep's in-progress quote drafts (id, title) — quotes not yet published. Use to find a draft to adjust.",
  {},
  () => tool(() => api("/api/quote-drafts")),
);

server.tool(
  "get_draft",
  "Fetch a quote draft's current document by id. Load this before editing a draft.",
  { id: z.string().describe("The draft id") },
  ({ id }) => tool(() => api(`/api/quote-drafts/${id}`)),
);

server.tool(
  "update_draft",
  "Validate + save a quote draft's document (WIP — not yet published). The rep publishes it from the builder afterward. Returns validation errors on failure.",
  {
    id: z.string().describe("The draft id"),
    document: z
      .object({})
      .passthrough()
      .describe("The full, updated quote document (keep internal line-item fields intact)"),
  },
  ({ id, document }) =>
    tool(() => api(`/api/quote-drafts/${id}`, { method: "PUT", body: JSON.stringify({ document }) })),
);

server.tool(
  "publish_quote_version",
  "Publish a document as a NEW immutable version of an existing quote (same shareable link). Re-runs the validator + authority checks; a quote over authority may return 202 (pending approval). Returns validation errors on failure so you can fix and retry.",
  {
    id: z.string().describe("The quote id"),
    // Typed object (not z.any): an untyped property has no JSON Schema type,
    // which makes some MCP clients stringify the value before it's sent.
    document: z
      .object({})
      .passthrough()
      .describe("The full, updated quote document"),
  },
  ({ id, document }) =>
    tool(() => api(`/api/quotes/${id}/versions`, { method: "POST", body: JSON.stringify(document) })),
);

/* ---- Resources ---- */
server.resource(
  "quote-schema",
  "schema://quote",
  { mimeType: "application/json", description: "Quote document JSON Schema + price book + authority." },
  async (uri) => {
    const data = await api("/api/schema");
    return { contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(data, null, 2) }] };
  },
);

server.resource(
  "quote",
  new ResourceTemplate("quote://{id}", { list: undefined }),
  { description: "A quote's current document, by id." },
  async (uri, { id }) => {
    const data = await api(`/api/quotes/${id}`);
    return {
      contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(data.document, null, 2) }],
    };
  },
);

/* ---- Prompts ----
 * Renamed from customize-draft/customize-quote in step with the platform: the
 * "customize" flow (bolting narrative sections onto a quote) was removed, and
 * narrative selling moved to proposal demos. These revise what is PRICED. */
const PRICING_RULES =
  `Stay within scope: a quote is line items + Quantum Care. Do NOT add ` +
  `hero/prose/tierSelector/addOns/timeline/image/customHtml blocks — they are legacy, ` +
  `retained only because published versions are immutable. If the deal needs a story, a ` +
  `comparison matrix or a rollout plan, that belongs in a PROPOSAL (the quantum-demos MCP), ` +
  `not here.\n` +
  `Keep every price defensible: a line item's sku must exist in the price book or the ` +
  `authority check flags it as untraceable, and discounts above your limit route the quote ` +
  `to manager approval. Money fields are in dollars. Note that the headline total is the ` +
  `DUE-NOW figure, so a Care-only (monthly) quote legitimately shows 0 there.`;

server.prompt(
  "revise-draft",
  "Revise an unpublished quote draft's pricing (line items / Quantum Care).",
  { id: z.string().describe("The draft id"), instructions: z.string().optional() },
  ({ id, instructions }) => ({
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text:
            `Use the quantum-quotes tools to revise draft ${id} before it's published.\n\n` +
            `1. Call get_draft(${JSON.stringify(id)}) to load the current document, and read schema://quote (or call get_schema) for the document format, price book, and your authority limits.\n` +
            `2. ${instructions || "Review what is priced and correct it — descriptions, quantities, intervals, and any SKU that should trace to the price book. Report anything that looks wrong rather than guessing."}\n` +
            `3. ${PRICING_RULES}\n` +
            `4. Save with update_draft. Then the rep publishes it from the builder.`,
        },
      },
    ],
  }),
);

server.prompt(
  "revise-quote",
  "Revise a published quote's pricing, published as a new immutable version (same link).",
  { id: z.string().describe("The quote id"), instructions: z.string().optional() },
  ({ id, instructions }) => ({
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text:
            `Use the quantum-quotes tools to revise quote ${id}, publishing a NEW version (the shareable link stays the same).\n\n` +
            `1. Call get_quote(${JSON.stringify(id)}) to load the current document, and read schema://quote (or call get_schema) for the document format, price book, and your authority limits.\n` +
            `2. ${instructions || "Apply the pricing change the rep asked for, keeping the customer and everything else intact."}\n` +
            `3. ${PRICING_RULES}\n` +
            `4. Publish with publish_quote_version(id, document). It re-runs the validator + authority checks and keeps the same link; an over-authority quote may come back 202 (pending approval) rather than sent.`,
        },
      },
    ],
  }),
);

const transport = new StdioServerTransport();
await server.connect(transport);
