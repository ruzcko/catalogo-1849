// GET /api/entry?id=<scan>.<column>.<row>&name=<the name shown>: the readings shown for a doubtful entry, with their vote counts (the
// book only shows the counts after you've voted or chosen "Not sure"), and the page's rules for suggestions.
import { entryContext, json, seen, STALE, tally } from "../../lib/readings.js";

export async function onRequestGet({ request, env }) {
  const q = new URL(request.url).searchParams, ctx = await entryContext(env, request, q.get("id"));
  if (!ctx) return json({ ok: false, error: "unknown" }, 404);
  if (q.has("name") && !seen(ctx, q.get("name"))) return json(STALE, 409);
  return json({ ok: true, options: await tally(env, ctx), letters: ctx.letters, prev: ctx.prev, next: ctx.next });
}
