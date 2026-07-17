#!/usr/bin/env node
/*
 * quantum-quote-mcp — an MCP server for authoring custom Quantum quotes.
 *
 * A thin, authenticated proxy over the platform quote API so a rep can turn a
 * base quote into a full custom proposal from Claude Code (any folder, no repo
 * to clone). Publishing creates a NEW immutable version of the same quote, so
 * the customer's shareable link never changes.
 *
 * Env (set once by the `claude mcp add` command from the platform):
 *   QUANTUM_API_KEY    — the rep's CLI API key (qq_…)
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

const server = new McpServer({ name: "quantum-quotes", version: "0.1.0" });

/* ---- Tools ---- */
server.tool(
  "list_quotes",
  "List quotes (id, ref, customer, status, total). Start here to find a quote by ref or customer.",
  {},
  () => tool(() => api("/api/quotes")),
);

server.tool(
  "get_quote",
  "Fetch a quote's current document + status by id. Load this before customizing.",
  { id: z.string().describe("The quote id") },
  ({ id }) => tool(() => api(`/api/quotes/${id}`)),
);

server.tool(
  "get_schema",
  "Get the quote document JSON Schema, the active price book, and this rep's authority limits (max discount / deal total).",
  {},
  () => tool(() => api("/api/schema")),
);

/* Drafts — customize a quote BEFORE it's published. The rep builds a base in the
 * platform (saved as a draft), you enrich the draft document, then the rep
 * publishes it once from the builder. */
server.tool(
  "list_drafts",
  "List the rep's in-progress quote drafts (id, title). Use to find a draft to customize before it's published.",
  {},
  () => tool(() => api("/api/quote-drafts")),
);

server.tool(
  "get_draft",
  "Fetch a quote draft's current document by id. Load this before customizing a draft.",
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

/* ---- Prompts ---- */
server.prompt(
  "customize-draft",
  "Customize a quote draft before it's published.",
  { id: z.string().describe("The draft id"), instructions: z.string().optional() },
  ({ id, instructions }) => ({
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text:
            `Use the quantum-quotes tools to customize draft ${id} before it's published.\n\n` +
            `1. Call get_draft(${JSON.stringify(id)}) to load the current document, and read schema://quote (or call get_schema) for the document format, price book, and your authority limits.\n` +
            `2. ${instructions || "Turn it into a full custom proposal — add sections that fit the deal (a hero, prose, a tierSelector, addOns, a timeline, images) while keeping the customer, line items, and totals intact."}\n` +
            `3. Save with update_draft. Then the rep publishes it from the builder.`,
        },
      },
    ],
  }),
);

server.prompt(
  "customize-quote",
  "Turn a base quote into a full custom proposal, published as a new version.",
  { id: z.string().describe("The quote id"), instructions: z.string().optional() },
  ({ id, instructions }) => ({
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text:
            `Use the quantum-quotes tools to customize quote ${id}, publishing a NEW version (the shareable link stays the same).\n\n` +
            `1. Call get_quote(${JSON.stringify(id)}) to load the current document, and read schema://quote (or call get_schema) for the document format, price book, and your authority limits.\n` +
            `2. ${instructions || "Turn it into a full custom proposal — add sections that fit the deal (a hero, prose, a tierSelector, addOns, a timeline, images) while keeping the customer, line items, and totals intact."}\n` +
            `3. Publish with publish_quote_version(id, document). It re-runs the validator + authority checks and keeps the same link.`,
        },
      },
    ],
  }),
);

const transport = new StdioServerTransport();
await server.connect(transport);
