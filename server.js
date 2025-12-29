// server.js (patched: mirrors Discord *attachments* locally under /downloads)
// - Images/GIFs/videos/files uploaded to Discord become stable local URLs.
// - Embed media (Tenor/Giphy previews, etc.) remains remote.
// - If mirroring fails, it gracefully falls back to the original URL.

import express from "express";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";

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

// ---------- Local mirroring setup ----------
const DOWNLOADS_DIR = path.join(process.cwd(), "downloads");
fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });

// Serve mirrored files
app.use(
  "/downloads",
  express.static(DOWNLOADS_DIR, {
    etag: true,
    lastModified: true,

    // Browser cache (Cloudflare can override this at the edge)
    maxAge: "1d",

    // Files are immutable once written
    immutable: true,
  })
);

function safeFilename(name = "file") {
  return String(name)
    .replace(/[^a-z0-9._-]+/gi, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 180); // keep it reasonable
}

async function mirrorToLocal({ url, messageId, filename }) {
  const baseName = safeFilename(filename || url.split("/").pop() || "download");
  const localName = `${messageId}-${baseName}`;
  const localPath = path.join(DOWNLOADS_DIR, localName);

  // Already mirrored
  if (fs.existsSync(localPath)) return `/downloads/${localName}`;

  const r = await fetch(url);
  if (!r.ok) throw new Error(`mirror fetch failed: ${r.status}`);

  const buf = Buffer.from(await r.arrayBuffer());
  fs.writeFileSync(localPath, buf);

  return `/downloads/${localName}`;
}

// ---- helpers ----
function authHeader() {
  return { Authorization: `Bot ${DISCORD_BOT_TOKEN}` };
}

// Make Discord mention syntax less ugly on your website.
function sanitizeContent(text = "") {
  return String(text)
    .replace(/\\u003c/g, "<")
    .replace(/\\u003e/g, ">")
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

async function getMediaFromMessage(m) {
  const out = [];
  const seen = new Set();

  const add = (url, type, extra = {}) => {
    if (!url || seen.has(url)) return;
    out.push({ url, type, ...extra });
    seen.add(url);
  };

  // 1) Attachments (uploaded files) -> MIRROR LOCALLY for permanence
  for (const a of (m.attachments || [])) {
    const originalUrl = a.url;
    const ct = (a.content_type || "").toLowerCase();
    const name = a.filename || "download";

    let localUrl = originalUrl;
    try {
      localUrl = await mirrorToLocal({
        url: originalUrl,
        messageId: m.id,
        filename: name,
      });
    } catch {
      // If mirroring fails, fall back to Discord CDN URL
      localUrl = originalUrl;
    }

    if (ct.startsWith("image/") || /\.(png|jpe?g|gif|webp)(\?|$)/i.test(originalUrl)) {
      const type = (ct === "image/gif" || /\.gif(\?|$)/i.test(originalUrl)) ? "gif" : "image";
      add(localUrl, type);
      continue;
    }

    if (ct.startsWith("video/") || /\.(mp4|webm|mov)(\?|$)/i.test(originalUrl)) {
      add(localUrl, "video");
      continue;
    }

    // Everything else: pdf/docs/zips/cad/etc.
    add(localUrl, "file", { name, contentType: ct });
  }

  // 2) Embeds (Tenor/Giphy, etc.) -> keep remote (not mirrored)
  for (const e of (m.embeds || [])) {
    if (e?.video?.url) {
      add(e.video.url, "video");
      continue; // prevents duplicate static image
    }

    if (e?.image?.url) {
      add(e.image.url, /\.gif/i.test(e.image.url) ? "gif" : "image");
    } else if (e?.thumbnail?.url) {
      add(e.thumbnail.url, /\.gif/i.test(e.thumbnail.url) ? "gif" : "image");
    }
  }

  return out;
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

    const mapped = await Promise.all(
      messages
        .filter(
          (m) =>
            m?.type === 0 ||
            (m?.embeds?.length || 0) > 0 ||
            (m?.attachments?.length || 0) > 0
        )
        .map(async (m) => {
          const embed = m.embeds?.[0];
          const fallback =
            (embed?.title ? `${embed.title}\n` : "") + (embed?.description || "");

          const contentRaw =
            m.content && m.content.trim().length ? m.content : fallback || "";

          return {
            id: m.id,
            content: sanitizeContent(contentRaw).trim(),
            timestamp: m.timestamp,
            media: await getMediaFromMessage(m),
          };
        })
    );

    const cleaned = mapped
      .filter((m) => (m.content?.length || 0) > 0 || (m.media?.length || 0) > 0)
      .slice(0, 8);

    res.setHeader("Cache-Control", "no-store");
    res.json(cleaned);
  } catch (e) {
    res.status(500).json({ error: "Server error", details: String(e) });
  }
});

// serve site files AFTER the API routes
app.use(express.static(".", { extensions: ["html"] }));

app.listen(PORT, () => {
  console.log(`✅ Site: http://localhost:${PORT}`);
  console.log(`✅ API:  http://localhost:${PORT}/api/announcements`);
  console.log(`✅ Debug: http://localhost:${PORT}/api/channel`);
  console.log(`✅ Downloads served at: http://localhost:${PORT}/downloads/...`);
});
