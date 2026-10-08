// GET /api/entry?id=<scan>.<column>.<row>: the readings shown for a doubtful entry, with their vote counts (the
// book only shows the counts after you've voted or chosen "Not sure"), and the page's rules for suggestions.
import { entryContext, json, tally } from "../../lib/readings.js";

export async function onRequestGet({ request, env }) {
  const ctx = await entryContext(env, request, new URL(request.url).searchParams.get("id"));
  if (!ctx) return json({ ok: false, error: "unknown" }, 404);
  return json({ ok: true, options: await tally(env, ctx), letters: ctx.letters, prev: ctx.prev, next: ctx.next });
}
