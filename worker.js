// Futures Wheel — Cloudflare Worker
// Secrets needed (Settings → Variables and Secrets): ANTHROPIC_API_KEY, NOTION_TOKEN, NOTION_DB_ID

const ORIGIN = "https://welearnwegrow.github.io";
const MODEL = "claude-sonnet-4-5";

const cors = {
  "Access-Control-Allow-Origin": ORIGIN,
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};
const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { ...cors, "Content-Type": "application/json" } });
const txt = (s, n = 1900) => [{ text: { content: String(s || "").slice(0, n) } }];
const validEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

async function notionRow(env, properties) {
  if (!env.NOTION_TOKEN || !env.NOTION_DB_ID) {
    return { ok: false, detail: "Missing NOTION_TOKEN or NOTION_DB_ID secret on the Worker." };
  }
  const r = await fetch("https://api.notion.com/v1/pages", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + env.NOTION_TOKEN,
      "Notion-Version": "2022-06-28",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ parent: { database_id: env.NOTION_DB_ID }, properties }),
  });
  const detail = r.ok ? "" : await r.text();
  if (!r.ok) console.log("Notion error", r.status, detail);
  return { ok: r.ok, status: r.status, detail };
}

export default {
  async fetch(req, env) {
    if (req.method === "OPTIONS") return new Response(null, { headers: cors });
    const url = new URL(req.url);

    if (req.method !== "POST") return json({ error: "method" }, 405);
    const body = await req.json().catch(() => ({}));

    // Save a report request or a deletion request to Notion
    if (url.pathname === "/lead" || url.pathname === "/contact") {
      const email = String(body.email || "").trim();
      if (!validEmail(email)) return json({ ok: false, detail: "Invalid email" }, 400);
      const props = {
        Name: { title: txt(body.name, 200) },
        Email: { email },
        Date: { date: { start: body.date || new Date().toISOString() } },
      };
      if (url.pathname === "/lead") {
        props.Trend = { rich_text: txt(body.trend) };
        props["Noticed in"] = { rich_text: txt(body.where) };
      } else {
        props["Contact Form Message"] = { rich_text: txt(body.message || "DELETE EMAIL") };
      }
      const res = await notionRow(env, props);
      return json(res, res.ok ? 200 : 502);
    }

    // Pass a prompt to Claude
    const prompt = body.prompt;
    if (!prompt || prompt.length > 20000) return json({ error: "bad request" }, 400);
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 2500,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    const data = await r.json().catch(() => ({}));
    const text = (data.content || []).map((c) => c.text || "").join("");
    return json({ text }, r.status);
  },
};
