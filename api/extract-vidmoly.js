const ALLOWED_HOSTS = new Set(["vidmoly.org", "www.vidmoly.org", "vidmoly.me", "www.vidmoly.me"]);
const MAX_HTML_BYTES = 2_000_000;

function isAllowedUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && ALLOWED_HOSTS.has(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}

function decode(value) {
  return value
    .replace(/\\\//g, "/")
    .replace(/\\u0026/gi, "&")
    .replace(/&amp;/gi, "&")
    .replace(/\\u003d/gi, "=")
    .replace(/\\u003f/gi, "?")
    .replace(/\\u0025/gi, "%");
}

function collectSources(html) {
  const candidates = [];
  const patterns = [
    /(?:file|src|source)\s*:\s*["']([^"']+)["']/gi,
    /(?:file|src|source)["']?\s*:\s*["']([^"']+)["']/gi,
    /https?:\\?\/\\?\/[^"'\\s<>]+(?:\.m3u8|\.mp4)(?:\?[^"'\\s<>]*)?/gi
  ];

  for (const pattern of patterns) {
    for (const match of html.matchAll(pattern)) {
      const value = decode(match[1] || match[0]).replace(/\\u0026/gi, "&");
      if (/\.(?:m3u8|mp4)(?:[?#]|$)/i.test(value)) candidates.push(value);
    }
  }

  return [...new Set(candidates)].filter(isMediaUrl);
}

function isMediaUrl(value) {
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) && /\.(?:m3u8|mp4)(?:[?#]|$)/i.test(url.pathname + url.search);
  } catch {
    return false;
  }
}

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "private, no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");

  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    return response.status(405).json({ error: "Method not allowed" });
  }

  const input = typeof request.query?.url === "string" ? request.query.url : "";
  if (!isAllowedUrl(input)) {
    return response.status(400).json({ error: "Only VidMoly HTTPS URLs are supported." });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);

  try {
    const upstream = await fetch(input, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        Accept: "text/html,application/xhtml+xml",
        Referer: "https://vidmoly.org/",
        "User-Agent": "Mozilla/5.0 (compatible; UNHAPPY media player)"
      }
    });

    if (!upstream.ok) return response.status(502).json({ error: "VidMoly source could not be read." });

    const length = Number(upstream.headers.get("content-length") || 0);
    if (length > MAX_HTML_BYTES) return response.status(502).json({ error: "VidMoly response is too large." });

    const html = await upstream.text();
    if (html.length > MAX_HTML_BYTES) return response.status(502).json({ error: "VidMoly response is too large." });

    const sources = collectSources(html);
    const source = sources.find(value => /\.m3u8(?:[?#]|$)/i.test(value)) || sources[0];
    if (!source) return response.status(404).json({ error: "No direct media source was exposed by VidMoly." });

    return response.status(200).json({
      source,
      type: /\.m3u8(?:[?#]|$)/i.test(source) ? "application/x-mpegURL" : "video/mp4"
    });
  } catch (error) {
    const message = error?.name === "AbortError" ? "VidMoly request timed out." : "VidMoly source could not be extracted.";
    return response.status(502).json({ error: message });
  } finally {
    clearTimeout(timeout);
  }
}
