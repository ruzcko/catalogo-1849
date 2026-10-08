// POST /api/vote {id, name, reading, device, token}: a reader's reading of a doubtful entry, either one already shown
// (an upvote) or their own. One vote per entry per device. We keep the reading and a hash of a random code the
// browser made up (no IP, no account). A Turnstile check keeps bots out.
import { check, entryContext, json, normalise, seen, STALE, tally } from "../../lib/readings.js";

const DEVICE = /^[0-9a-f]{32}$/;

async function sha256(s) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, "0")).join("");
}

export async function onRequestPost({ request, env }) {
  const body = await request.json().catch(() => null);
  const ctx = await entryContext(env, request, body?.id);
  if (!ctx) return json({ ok: false, error: "unknown" }, 404);
  if (!seen(ctx, body?.name)) return json(STALE, 409);   // the name the reader saw must still be at that id
  const device = String(body?.device || "");
  if (!DEVICE.test(device)) return json({ ok: false, error: "device" }, 400);
  const reading = normalise(body?.reading);
  const why = check(reading, ctx);
  if (why) return json({ ok: false, error: "rule", message: why }, 400);
  const blocked = (await env.DB.prepare("SELECT word FROM blocked").all()).results || [];
  if (blocked.some(b => reading.includes(b.word))) return json({ ok: false, error: "rule", message: "That reading can't be added." }, 400);

  const form = new FormData();
  form.append("secret", env.TURNSTILE_SECRET);
  form.append("response", String(body?.token || ""));
  const verified = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: form })
    .then(r => r.json()).catch(() => ({ success: false }));
  if (!verified.success) return json({ ok: false, error: "verify" }, 403);

  const day = new Date().toISOString().slice(0, 10);
  const voter = await sha256(`${device}:catalogo`);
  const fresh = await env.DB.prepare("INSERT OR IGNORE INTO voters (entry, voter, day) VALUES (?1, ?2, ?3)").bind(ctx.id, voter, day).run();
  if (!fresh.meta.changes) return json({ ok: false, error: "already", options: await tally(env, ctx) }, 409);
  // A reading nobody can see yet (not ours, not the OCR's, not two readers') counts as typed in.
  const visible = (await tally(env, ctx)).map(o => o.r);
  const typed = visible.includes(reading) ? 0 : 1;
  await env.DB.prepare(`INSERT INTO readings (entry, reading, votes, typed, first_day) VALUES (?1, ?2, 1, ?3, ?4)
    ON CONFLICT (entry, reading) DO UPDATE SET votes = votes + 1, typed = typed + excluded.typed`).bind(ctx.id, reading, typed, day).run();
  return json({ ok: true, options: await tally(env, ctx), pending: typed === 1 });
}
