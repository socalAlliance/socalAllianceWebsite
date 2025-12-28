import express from "express";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT) || 3000;

const allowedOrigins = new Set([
  "https://socalalliance.org",
  "https://beta.socalalliance.org",
  "https://b1.socalalliance.org",
  "http://localhost:3000",
  "http://127.0.0.1:5500",
]);

app.use((req, res, next) => {
  const origin = req.headers.origin;

  if (origin && allowedOrigins.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }

  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN?.trim();
const DISCORD_CHANNEL_ID = process.env.DISCORD_CHANNEL_ID?.trim();

// ---- helpers ----
function authHeader() {
  return { Authorization: `Bot ${DISCORD_BOT_TOKEN}` };
}

// Make Discord mention syntax less ugly on your website.
// If you want real usernames instead of "@user", tell me and I’ll show the lookup approach.
function sanitizeContent(text = "") {
  return String(text)
    // Discord escapes can show up depending on where you view the JSON
    .replace(/\\u003c/g, "<")
    .replace(/\\u003e/g, ">")
    // Mentions
    .replace(/<@!?(\d+)>/g, "@user")
    .replace(/<@&(\d+)>/g, "@role")
    .replace(/<#(\d+)>/g, "#channel");
}

async function discordFetchJson(url) {
  const r = await fetch(url, { headers: authHeader() });
  const raw = await r.text();

  let data = null;
  try {
    data = raw ? JSON.parse(raw) : null;
  } catch {
    return { ok: false, status: 502, data: { error: "Discord returned non-JSON", raw } };
  }

  return { ok: r.ok, status: r.status, data };
}

function requireEnv(res) {
  if (!DISCORD_BOT_TOKEN) {
    res.status(500).json({ error: "Missing DISCORD_BOT_TOKEN" });
    return false;
  }
  if (!DISCORD_CHANNEL_ID) {
    res.status(500).json({ error: "Missing DISCORD_CHANNEL_ID" });
    return false;
  }
  return true;
}

// ---- routes ----

// Debug: confirm you’re hitting the right channel
app.get("/api/channel", async (_req, res) => {
  if (!requireEnv(res)) return;

  const url = `https://discord.com/api/v10/channels/${DISCORD_CHANNEL_ID}`;
  const result = await discordFetchJson(url);

  if (!result.ok) {
    return res.status(result.status).json({
      error: "Discord API error",
      status: result.status,
      details: result.data,
    });
  }

  // Return just the useful fields
  const c = result.data || {};
  res.setHeader("Cache-Control", "no-store");
  res.json({
    id: c.id,
    name: c.name,
    type: c.type,
    guild_id: c.guild_id,
    last_message_id: c.last_message_id,
  });
});

// Main: latest announcements from Discord
app.get("/api/announcements", async (_req, res) => {
  try {
    if (!requireEnv(res)) return;

    const url = `https://discord.com/api/v10/channels/${DISCORD_CHANNEL_ID}/messages?limit=20`;
    const result = await discordFetchJson(url);

    if (!result.ok) {
      return res.status(result.status).json({
        error: "Discord API error",
        status: result.status,
        details: result.data,
      });
    }

    const messages = Array.isArray(result.data) ? result.data : [];

    const cleaned = messages
      // keep normal messages OR anything with embeds/attachments
      .filter(
        (m) =>
          m?.type === 0 ||
          (m?.embeds?.length || 0) > 0 ||
          (m?.attachments?.length || 0) > 0
      )
      .map((m) => {
        const embed = m.embeds?.[0];
        const fallback =
          (embed?.title ? `${embed.title}\n` : "") + (embed?.description || "");

        const contentRaw =
          m.content && m.content.trim().length ? m.content : fallback || "";

        return {
          id: m.id,
          content: sanitizeContent(contentRaw).trim(),
          timestamp: m.timestamp,
        };
      })
      .filter((m) => m.content.length > 0)
      .slice(0, 8);

    res.setHeader("Cache-Control", "no-store");
    res.json(cleaned);
  } catch (e) {
    res.status(500).json({ error: "Server error", details: String(e) });
  }
});

// serve files AFTER the API routes
app.use(express.static(".", { extensions: ["html"] }));

app.listen(PORT, () => {
  console.log(`✅ Site: http://localhost:${PORT}`);
  console.log(`✅ API:  http://localhost:${PORT}/api/announcements`);
  console.log(`✅ Debug: http://localhost:${PORT}/api/channel`);
});
