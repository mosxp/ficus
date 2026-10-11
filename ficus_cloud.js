/* FICUS cloud layer.
 *
 * When no local FastAPI backend is reachable (the static site on GitHub Pages),
 * this answers the app's `/api/...` requests from Supabase instead. Ported
 * routes mirror main.py / database.py so the rest of index.html is unchanged.
 * With the local server running, every request passes straight through.
 *
 * Answered here: checklist templates, the scrapbook libraries (sticky
 * pads, stickers, palettes and GIPHY/Tenor GIF search) and /api/upload, which
 * stores files in the Supabase Storage bucket `uploads`. /api/link-preview
 * (titles and thumbnails for shared links) is answered here in both modes.
 */
(function () {
  "use strict";

  const config = window.FICUS_SUPABASE_CONFIG || {};
  const nativeFetch = window.fetch.bind(window);
  const client = window.supabase?.createClient && config.url && config.publishableKey
    ? window.supabase.createClient(config.url, config.publishableKey, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
        global: { fetch: nativeFetch },
      })
    : null;
  window.ficusSupabase = client;

  let session = null;
  const sessionReady = client
    ? client.auth.getSession()
      .then(({ data }) => { session = data?.session || null; })
      .catch(() => { session = null; })
    : Promise.resolve();
  client?.auth.onAuthStateChange((_event, next) => { session = next || null; });

  let backendProbe = null;
  function hasLocalBackend() {
    if (!backendProbe) {
      backendProbe = nativeFetch("/api/health", { cache: "no-store" })
        .then((res) => res.ok && (res.headers.get("content-type") || "").includes("application/json"))
        .catch(() => false)
        .then((local) => {
          // Without the local GIF proxy, scrapboard.js loads GIPHY/Tenor media straight from their CDNs.
          window.FICUS_DIRECT_GIFS = !local;
          return local;
        });
    }
    return backendProbe;
  }
  hasLocalBackend();

  class ApiError extends Error {
    constructor(status, detail) {
      super(detail);
      this.status = status;
    }
  }

  function jsonResponse(status, body) {
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  }

  function text(value) {
    return String(value ?? "").trim();
  }

  function isPlainObject(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }

  function given(value) {
    return value !== undefined && value !== null;
  }

  async function run(query) {
    const { data, error } = await query;
    if (error) throw new ApiError(500, error.message || "Cloud request failed");
    return data;
  }

  // Supabase returns at most 1000 rows per select, so long lists are read in pages.
  // `build` must apply a stable order (e.g. by id) so pages don't overlap.
  const PAGE_SIZE = 1000;
  async function selectAll(build) {
    const rows = [];
    for (let from = 0; ; from += PAGE_SIZE) {
      const page = await run(build().range(from, from + PAGE_SIZE - 1));
      rows.push(...page);
      if (page.length < PAGE_SIZE) return rows;
    }
  }

  /* ---------- Normalizers (ported from database.py) ---------- */

  function intOr(value, fallback) {
    const number = Number.parseInt(value, 10);
    return Number.isFinite(number) ? number : fallback;
  }

  /* ---------- Link previews (for links shared or pasted into a note) ---------- */

  // Answered here even when the local server is running. YouTube, TikTok and Vimeo serve oEmbed
  // with CORS; anything else goes through Microlink's free tier (about 25 lookups a day per
  // visitor). Instagram and Facebook block every free lookup, so those keep their shared title.
  const LINK_PREVIEW_SKIP = /(^|\.)(instagram\.com|facebook\.com|fb\.com|fb\.watch|threads\.net)$/;
  const LINK_PREVIEW_OEMBED = [
    [/(^|\.)(youtube\.com|youtu\.be|youtube-nocookie\.com)$/, "https://www.youtube.com/oembed?format=json&url="],
    [/(^|\.)tiktok\.com$/, "https://www.tiktok.com/oembed?url="],
    [/(^|\.)vimeo\.com$/, "https://vimeo.com/api/oembed.json?url="],
  ];
  const LINK_PREVIEW_TIMEOUT_MS = 8000;

  async function previewJson(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), LINK_PREVIEW_TIMEOUT_MS);
    try {
      const res = await nativeFetch(url, { signal: controller.signal });
      return res.ok ? await res.json() : null;
    } catch (_) {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  function httpsUrl(value) {
    const url = text(value);
    return /^https:\/\//i.test(url) ? clip(url, 2000) : "";
  }

  // Always 200 with whatever was found; empty strings mean "no preview".
  async function linkPreview(raw) {
    let url = null;
    try {
      url = new URL(text(raw));
    } catch (_) {}
    if (!url || !["http:", "https:"].includes(url.protocol)) {
      return jsonResponse(422, { detail: "A full http(s) link is required" });
    }
    const host = url.hostname.toLowerCase();
    const preview = { url: url.href, title: "", description: "", image: "", site: "", author: "" };
    if (LINK_PREVIEW_SKIP.test(host)) return jsonResponse(200, preview);

    const oembed = LINK_PREVIEW_OEMBED.find(([pattern]) => pattern.test(host));
    const embed = oembed ? await previewJson(oembed[1] + encodeURIComponent(url.href)) : null;
    if (text(embed?.title)) {
      return jsonResponse(200, {
        ...preview,
        title: clip(text(embed.title), 300),
        image: httpsUrl(embed.thumbnail_url),
        site: clip(text(embed.provider_name), 80),
        author: clip(text(embed.author_name), 120),
      });
    }
    const found = await previewJson(`https://api.microlink.io/?url=${encodeURIComponent(url.href)}`);
    const meta = found?.status === "success" && isPlainObject(found.data) ? found.data : {};
    return jsonResponse(200, {
      ...preview,
      title: clip(text(meta.title), 300),
      description: clip(text(meta.description), 500),
      image: httpsUrl(meta.image?.url),
      site: clip(text(meta.publisher), 80),
      author: clip(text(meta.author), 120),
    });
  }

  /* ---------- Request body checks ---------- */

  function strictInt(value) {
    if (typeof value === "number") return Number.isFinite(value) ? Math.trunc(value) : null;
    if (typeof value === "string" && /^\s*[-+]?\d+\s*$/.test(value)) return Number.parseInt(value, 10);
    return null;
  }

  function clip(value, length) {
    return Array.from(value).slice(0, length).join("");
  }

  function has(object, key) {
    return Object.prototype.hasOwnProperty.call(object, key);
  }

  function compareText(a, b) {
    return a < b ? -1 : a > b ? 1 : 0;
  }

  // Request bodies are validated like the FastAPI models.
  const FLAG_WORDS = { 1: true, true: true, t: true, yes: true, y: true, on: true, 0: false, false: false, f: false, no: false, n: false, off: false };

  function fieldError(key) {
    return new ApiError(422, `${key} has an invalid value`);
  }

  function flagField(key, value) {
    if (typeof value === "boolean") return value;
    if (value === 0 || value === 1) return value === 1;
    const word = typeof value === "string" ? value.trim().toLowerCase() : null;
    if (word !== null && has(FLAG_WORDS, word)) return FLAG_WORDS[word];
    throw fieldError(key);
  }

  function intField(key, value) {
    const number = typeof value === "number" ? (Number.isInteger(value) ? value : null) : strictInt(value);
    if (number === null) throw fieldError(key);
    return number;
  }

  function coerceField(key, kind, value) {
    if (value === null) return null;
    if (kind === "text" && typeof value === "string") return value;
    if (kind === "flag") return flagField(key, value);
    if (kind === "int") return intField(key, value);
    if (kind === "list" && Array.isArray(value)) return value;
    if (kind === "int_list" && Array.isArray(value)) return value.map((item) => intField(key, item));
    if (kind === "text_list" && Array.isArray(value) && value.every((item) => typeof item === "string")) return value;
    if (kind === "object" && isPlainObject(value)) return value;
    throw fieldError(key);
  }

  /* ---------- Checklist templates ---------- */

  function serializeChecklistTemplate(row) {
    const items = Array.isArray(row.items) ? row.items : [];
    return {
      id: row.id,
      name: row.name,
      items: items.map((item) => String(item)).filter((item) => item.trim()),
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }

  async function checklistTemplateRows() {
    const rows = await run(client.from("checklist_templates").select("*").order("id"));
    return rows.sort((a, b) => compareText(String(a.name).toLowerCase(), String(b.name).toLowerCase()) || a.id - b.id);
  }

  async function listChecklistTemplates() {
    return (await checklistTemplateRows()).map(serializeChecklistTemplate);
  }

  async function saveChecklistTemplate(body, templateId = null) {
    if (given(body.name) && typeof body.name !== "string") throw fieldError("name");
    if (given(body.items) && !Array.isArray(body.items)) throw fieldError("items");
    const name = clip(text(body.name), 120);
    if (!name) throw new ApiError(400, "Template name is required");
    const items = [];
    for (const item of body.items || []) {
      const itemText = text(isPlainObject(item) ? item.text : item || "");
      if (itemText) items.push(clip(itemText, 500));
    }
    if (!items.length) throw new ApiError(400, "Add at least one checklist item before saving a template");
    const rows = await checklistTemplateRows();
    let id = templateId;
    if (id === null) id = rows.find((row) => String(row.name).toLowerCase() === name.toLowerCase())?.id ?? null;
    let saved;
    if (id === null) {
      saved = await run(client.from("checklist_templates").insert({ name, items: items.slice(0, 200) }).select("*").single());
    } else {
      if (!rows.some((row) => row.id === id)) throw new ApiError(404, "Template not found");
      saved = await run(client.from("checklist_templates").update({ name, items: items.slice(0, 200) })
        .eq("id", id).select("*").single());
    }
    return serializeChecklistTemplate(saved);
  }

  async function deleteChecklistTemplate(id) {
    const row = await run(client.from("checklist_templates").select("id").eq("id", id).maybeSingle());
    if (!row) throw new ApiError(404, "Template not found");
    await run(client.from("checklist_templates").delete().eq("id", id));
    return { ok: true, id };
  }

  /* ---------- Uploads (Supabase Storage) ---------- */

  const UPLOAD_BUCKET = "uploads";
  const IMAGE_UPLOADS = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".heic", ".heif"];
  const DOCUMENT_UPLOADS = [
    ".pdf", ".txt", ".md", ".rtf", ".csv", ".json",
    ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
    ".pages", ".numbers", ".key", ".odt", ".ods", ".odp", ".epub", ".zip",
  ];
  const AUDIO_UPLOADS = [".m4a", ".mp3", ".wav", ".aac", ".ogg", ".oga", ".opus", ".flac", ".caf", ".weba"];
  const VIDEO_UPLOADS = [".mp4", ".mov", ".m4v", ".webm"];
  const ALLOWED_UPLOADS = [...IMAGE_UPLOADS, ...DOCUMENT_UPLOADS, ...AUDIO_UPLOADS, ...VIDEO_UPLOADS];
  const MB = 1024 * 1024;
  // The Supabase Free plan stores files up to 50MB, below main.py's audio and video limits.
  const CLOUD_UPLOAD_CAP = 50 * MB;
  // Browsers leave File.type blank for some formats (HEIC photos, iPhone voice memos).
  const UPLOAD_CONTENT_TYPES = {
    ".m4a": "audio/mp4", ".mp3": "audio/mpeg", ".wav": "audio/wav", ".aac": "audio/aac", ".ogg": "audio/ogg",
    ".oga": "audio/ogg", ".opus": "audio/ogg", ".flac": "audio/flac", ".caf": "audio/x-caf", ".weba": "audio/webm",
    ".mp4": "video/mp4", ".mov": "video/quicktime", ".m4v": "video/x-m4v", ".webm": "video/webm",
    ".heic": "image/heic", ".heif": "image/heif", ".pdf": "application/pdf",
  };

  function uploadLimit(suffix) {
    let limit = 25 * MB;
    if (AUDIO_UPLOADS.includes(suffix)) limit = 100 * MB;
    if (VIDEO_UPLOADS.includes(suffix)) limit = 500 * MB;
    return Math.min(limit, CLOUD_UPLOAD_CAP);
  }

  function randomHex() {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  async function uploadFile(form) {
    const file = typeof FormData !== "undefined" && form instanceof FormData ? form.get("file") : null;
    if (!(file instanceof Blob)) throw new ApiError(422, "file is required");
    const name = String(file.name || "file").split(/[\\/]/).pop() || "file";
    const dot = name.lastIndexOf(".");
    const suffix = dot > 0 ? name.slice(dot).toLowerCase() : "";
    if (!ALLOWED_UPLOADS.includes(suffix)) throw new ApiError(400, "Unsupported file type");
    const limit = uploadLimit(suffix);
    if (file.size > limit) throw new ApiError(400, `File is larger than ${limit / MB}MB`);
    if (!file.size) throw new ApiError(400, "Empty file");
    const path = `${session.user.id}/${randomHex()}${suffix}`;
    const bucket = client.storage.from(UPLOAD_BUCKET);
    const { error } = await bucket.upload(path, file, {
      contentType: file.type || UPLOAD_CONTENT_TYPES[suffix] || "application/octet-stream",
      cacheControl: "31536000",
      upsert: false,
    });
    if (error) {
      if (/bucket not found/i.test(error.message || "")) {
        throw new ApiError(503, "File uploads aren't set up yet. Run supabase/04_storage.sql in Supabase.");
      }
      throw new ApiError(Number(error.status || error.statusCode) || 500, error.message || "Upload failed");
    }
    return { url: bucket.getPublicUrl(path).data.publicUrl, bytes: file.size, filename: name };
  }

  /* ---------- Model helpers ---------- */

  // Python truthiness and str(), for fields copied the way database.py copies them.
  function pyFalsy(value) {
    if (Array.isArray(value)) return !value.length;
    if (isPlainObject(value)) return !Object.keys(value).length;
    return value === undefined || value === null || value === false || value === 0 || value === "";
  }

  // Fields present in the body, validated like the FastAPI models (exclude_unset).
  function modelFields(body, kinds) {
    const fields = {};
    for (const [key, kind] of Object.entries(kinds)) {
      if (!has(body, key)) continue;
      const value = body[key];
      if (kind === "blocks") {
        if (value !== null && !Array.isArray(value) && !isPlainObject(value)) throw fieldError(key);
        fields[key] = value;
      } else {
        fields[key] = coerceField(key, kind, value);
      }
    }
    return fields;
  }

  async function requireRow(table, id, detail, columns = "*") {
    const row = await run(client.from(table).select(columns).eq("id", id).maybeSingle());
    if (!row) throw new ApiError(404, detail);
    return row;
  }

  // Python `a or b or ...`: the first truthy value, else the last one.
  function pyOr(...values) {
    for (const value of values) {
      if (!pyFalsy(value)) return value;
    }
    return values[values.length - 1];
  }

  /* ---------- Scrapbook libraries (sticky pads, stickers, palettes) ---------- */

  const SCRAPBOOK_PAD_MAX_BYTES = 3000000;
  const SCRAPBOOK_PAD_MAX_BATCH = 60;
  const SCRAPBOOK_STICKER_MAX_BYTES = 2000000;
  const SCRAPBOOK_STICKER_MAX_BATCH = 150;
  const SCRAPBOOK_STICKER_DEFAULT_COLLECTION = "My stickers";
  const SCRAPBOOK_PALETTE_MAX_COLORS = 16;
  const SCRAPBOOK_PALETTE_DEFAULT_NAME = "My palette";

  function squish(value, length) {
    return clip(String(value || "").replace(/\s+/g, " ").trim(), length);
  }

  function serializeScrapbookImage(row) {
    const data = {
      id: Number(row.id),
      name: String(row.name || ""),
      src: row.src || "",
      width: Number(row.width) || 0,
      height: Number(row.height) || 0,
      created_at: row.created_at,
    };
    if (has(row, "collection")) data.collection = String(row.collection || SCRAPBOOK_STICKER_DEFAULT_COLLECTION);
    return data;
  }

  function serializeScrapbookPalette(row) {
    return {
      id: Number(row.id),
      name: String(row.name || SCRAPBOOK_PALETTE_DEFAULT_NAME),
      colors: (Array.isArray(row.colors) ? row.colors : []).filter((color) => typeof color === "string"),
      source: String(row.source || "custom"),
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }

  function scrapbookImageItems(body, key) {
    if (!Array.isArray(body[key])) throw fieldError(key);
    return body[key].map((item) => {
      if (!isPlainObject(item) || typeof item.src !== "string") throw fieldError(key);
      const f = modelFields(item, { name: "text", width: "int", height: "int" });
      return { name: f.name ?? null, src: item.src, width: f.width ?? null, height: f.height ?? null };
    });
  }

  function cleanScrapbookImages(items, label, maxBytes) {
    return items.map((item) => {
      if (!item.src.startsWith("data:image/")) throw new ApiError(400, `${label} image must be a data:image URL`);
      if (item.src.length > maxBytes) throw new ApiError(413, `${label} image is too large`);
      return {
        name: clip(text(item.name), 80),
        src: item.src,
        width: Math.max(0, item.width || 0),
        height: Math.max(0, item.height || 0),
      };
    });
  }

  function listScrapbookPads() {
    return selectAll(() => client.from("scrapbook_pads").select("*").order("id", { ascending: false }))
      .then((rows) => rows.map(serializeScrapbookImage));
  }

  async function createScrapbookPads(items) {
    if (!items.length) throw new ApiError(400, "No sticky pads to save");
    if (items.length > SCRAPBOOK_PAD_MAX_BATCH) {
      throw new ApiError(400, `Too many sticky pads in one upload (max ${SCRAPBOOK_PAD_MAX_BATCH})`);
    }
    const rows = await run(client.from("scrapbook_pads")
      .insert(cleanScrapbookImages(items, "Sticky pad", SCRAPBOOK_PAD_MAX_BYTES)).select("*"));
    return rows.sort((a, b) => b.id - a.id).map(serializeScrapbookImage);
  }

  function normalizeStickerCollection(name) {
    return squish(name, 40) || SCRAPBOOK_STICKER_DEFAULT_COLLECTION;
  }

  async function listScrapbookStickers(query) {
    const metaOnly = query.has("meta") ? flagField("meta", query.get("meta")) : false;
    const columns = metaOnly ? "id, collection, name, width, height, created_at" : "*";
    const rows = await selectAll(() => client.from("scrapbook_stickers").select(columns).order("id"));
    return rows.map((row) => {
      const sticker = serializeScrapbookImage(row);
      if (metaOnly) delete sticker.src;
      return sticker;
    });
  }

  async function createScrapbookStickers(collection, items) {
    if (!items.length) throw new ApiError(400, "No stickers to save");
    if (items.length > SCRAPBOOK_STICKER_MAX_BATCH) {
      throw new ApiError(400, `Too many stickers in one upload (max ${SCRAPBOOK_STICKER_MAX_BATCH})`);
    }
    const group = normalizeStickerCollection(collection);
    const rows = await run(client.from("scrapbook_stickers")
      .insert(cleanScrapbookImages(items, "Sticker", SCRAPBOOK_STICKER_MAX_BYTES).map((item) => ({ ...item, collection: group })))
      .select("*"));
    return rows.sort((a, b) => a.id - b.id).map(serializeScrapbookImage);
  }

  async function deleteScrapbookRow(table, id, detail) {
    await requireRow(table, id, detail, "id");
    await run(client.from(table).delete().eq("id", id));
    return { ok: true, id };
  }

  async function renameStickerCollection(body) {
    const f = modelFields(body, { name: "text", new_name: "text" });
    if (typeof f.name !== "string") throw fieldError("name");
    if (typeof f.new_name !== "string" || !f.new_name) throw fieldError("new_name");
    const source = normalizeStickerCollection(f.name);
    const target = normalizeStickerCollection(f.new_name);
    const rows = await run(client.from("scrapbook_stickers").update({ collection: target }).eq("collection", source).select("id"));
    if (!rows.length) throw new ApiError(404, "Sticker collection not found");
    return { ok: true, collection: target, updated: rows.length };
  }

  async function deleteStickerCollection(body) {
    const f = modelFields(body, { name: "text" });
    if (typeof f.name !== "string") throw fieldError("name");
    const group = normalizeStickerCollection(f.name);
    const rows = await run(client.from("scrapbook_stickers").delete().eq("collection", group).select("id"));
    if (!rows.length) throw new ApiError(404, "Sticker collection not found");
    return { ok: true, collection: group, deleted: rows.length };
  }

  function paletteBody(body) {
    const f = modelFields(body, { name: "text", colors: "text_list", source: "text" });
    if (!Array.isArray(f.colors) || !f.colors.length || f.colors.length > SCRAPBOOK_PALETTE_MAX_COLORS) {
      throw fieldError("colors");
    }
    return f;
  }

  function cleanPalette(f) {
    const colors = [];
    for (const value of f.colors) {
      const match = /^#?([0-9a-fA-F]{6})$/.exec(text(value));
      if (!match) throw new ApiError(400, `Not a hex colour: ${value}`);
      const hex = `#${match[1].toUpperCase()}`;
      if (!colors.includes(hex)) colors.push(hex);
    }
    if (!colors.length) throw new ApiError(400, "A palette needs at least one colour");
    if (colors.length > SCRAPBOOK_PALETTE_MAX_COLORS) {
      throw new ApiError(400, `Too many colours (max ${SCRAPBOOK_PALETTE_MAX_COLORS})`);
    }
    return { name: squish(f.name, 40) || SCRAPBOOK_PALETTE_DEFAULT_NAME, colors };
  }

  function listScrapbookPalettes() {
    return selectAll(() => client.from("scrapbook_palettes").select("*").order("id", { ascending: false }))
      .then((rows) => rows.map(serializeScrapbookPalette));
  }

  async function createScrapbookPalette(f) {
    const palette = { ...cleanPalette(f), source: f.source === "photo" ? "photo" : "custom" };
    return serializeScrapbookPalette(await run(client.from("scrapbook_palettes").insert(palette).select("*").single()));
  }

  async function updateScrapbookPalette(id, f) {
    const palette = cleanPalette(f);
    await requireRow("scrapbook_palettes", id, "Palette not found", "id");
    return serializeScrapbookPalette(await run(client.from("scrapbook_palettes").update(palette).eq("id", id).select("*").single()));
  }

  /* ---------- Scrapbook GIF search (GIPHY or Tenor, called straight from the browser) ---------- */

  // Each user brings their own free API key, kept in scrapbook_settings. The GIF library
  // (uploaded .gif files) still needs the local server.
  const GIF_PROVIDERS = { giphy: "GIPHY", tenor: "Tenor" };
  const GIF_MEDIA_HOSTS = /^(media\d*\.giphy\.com|i\.giphy\.com|media\d*\.tenor\.com|c\.tenor\.com)$/;
  const GIF_SEARCH_OFF = { configured: false, provider: null, source: null };

  class GifServiceError extends Error {
    constructor(status) {
      super("GIF service unavailable");
      this.status = status;
    }
  }

  async function gifServiceJson(url) {
    let res;
    try {
      res = await nativeFetch(url);
    } catch (_) {
      throw new GifServiceError(0);
    }
    if (!res.ok) throw new GifServiceError(res.status);
    try {
      return await res.json();
    } catch (_) {
      throw new GifServiceError(0);
    }
  }

  function gifRendition(url, width, height) {
    return url ? { url, width: intOr(width, 0), height: intOr(height, 0) } : null;
  }

  // Results are {id, title, preview, gif}; `next` is the cursor for the following page.
  async function fetchGifs(provider, key, query, kind, pos, limit) {
    const stickers = kind === "stickers";
    const results = [];
    const add = (id, title, preview, gif) => {
      if (preview && gif) results.push({ id: String(id), title: title || "", preview, gif });
    };
    if (provider === "giphy") {
      const offset = /^\d+$/.test(pos) ? Number(pos) : 0;
      const params = new URLSearchParams({ api_key: key, limit: String(limit), offset: String(offset), rating: "pg-13" });
      if (query) params.set("q", query);
      const data = await gifServiceJson(
        `https://api.giphy.com/v1/${stickers ? "stickers" : "gifs"}/${query ? "search" : "trending"}?${params}`,
      );
      for (const item of data.data || []) {
        const images = item.images || {};
        const small = pyOr(images.fixed_width_downsampled, images.fixed_width_small, images.fixed_width, {});
        const full = pyOr(images.fixed_width, images.downsized, images.original, {});
        add(item.id, item.title, gifRendition(small.url, small.width, small.height), gifRendition(full.url, full.width, full.height));
      }
      const page = data.pagination || {};
      const consumed = offset + (intOr(page.count, 0) || results.length);
      return { results, next: results.length && consumed < Math.min(intOr(page.total_count, 0), 4999) ? String(consumed) : null };
    }
    const params = new URLSearchParams({
      key,
      client_key: "ficus",
      limit: String(limit),
      contentfilter: "medium",
      media_filter: stickers ? "tinygif_transparent,gif_transparent" : "tinygif,mediumgif,gif",
    });
    if (query) params.set("q", query);
    if (stickers) params.set("searchfilter", "sticker");
    if (pos) params.set("pos", pos);
    const data = await gifServiceJson(`https://tenor.googleapis.com/v2/${query ? "search" : "featured"}?${params}`);
    for (const item of data.results || []) {
      const media = item.media_formats || {};
      const small = media[stickers ? "tinygif_transparent" : "tinygif"] || {};
      const full = (stickers ? media.gif_transparent : pyOr(media.mediumgif, media.gif, null)) || {};
      const [sw, sh] = small.dims || [0, 0];
      const [fw, fh] = full.dims || [0, 0];
      add(item.id, item.content_description, gifRendition(small.url, sw, sh), gifRendition(full.url, fw, fh));
    }
    return { results, next: data.next || null };
  }

  async function gifSettings() {
    const { data, error } = await client.from("scrapbook_settings").select("gif_provider, gif_api_key").maybeSingle();
    if (error) {
      const missing = ["PGRST205", "42P01"].includes(error.code);
      throw new ApiError(500, missing ? "GIF search needs supabase/07_gif_search.sql to be run first." : error.message);
    }
    return data && data.gif_provider && data.gif_api_key ? { provider: data.gif_provider, key: data.gif_api_key } : null;
  }

  async function gifConfig() {
    const settings = await gifSettings();
    return settings ? { configured: true, provider: settings.provider, source: "app" } : GIF_SEARCH_OFF;
  }

  // The key is tried with a one-result search before it's saved.
  async function saveGifConfig(body) {
    const f = modelFields(body, { provider: "text", key: "text" });
    if (!has(GIF_PROVIDERS, f.provider)) throw fieldError("provider");
    if (typeof f.key !== "string" || f.key.length < 8 || f.key.length > 200) throw fieldError("key");
    const key = f.key.trim();
    try {
      await fetchGifs(f.provider, key, "", "gifs", "", 1);
    } catch (err) {
      if (!(err instanceof GifServiceError)) throw err;
      if ([400, 401, 403].includes(err.status)) throw new ApiError(400, `${GIF_PROVIDERS[f.provider]} rejected that key`);
      throw new ApiError(502, "GIF service unavailable");
    }
    await run(client.from("scrapbook_settings")
      .upsert({ user_id: session.user.id, gif_provider: f.provider, gif_api_key: key }, { onConflict: "user_id" }));
    return { configured: true, provider: f.provider, source: "app" };
  }

  async function clearGifConfig() {
    await run(client.from("scrapbook_settings").delete().eq("user_id", session.user.id));
    return GIF_SEARCH_OFF;
  }

  async function searchGifs(query) {
    const settings = await gifSettings();
    if (!settings) throw new ApiError(503, "not_configured");
    let limit = 24;
    if (query.has("limit")) {
      limit = strictInt(query.get("limit"));
      if (limit === null) throw fieldError("limit");
    }
    const kind = query.get("kind") === "stickers" ? "stickers" : "gifs";
    const q = clip(text(query.get("q")), 100);
    const pos = clip(text(query.get("pos")), 200);
    try {
      return await fetchGifs(settings.provider, settings.key, q, kind, pos, Math.max(1, Math.min(limit, 50)));
    } catch (err) {
      if (!(err instanceof GifServiceError)) throw err;
      if (!err.status) throw new ApiError(502, "GIF service unavailable");
      throw new ApiError([401, 403].includes(err.status) ? 401 : 502, "GIF service error");
    }
  }

  // Stand-in for the local server's media proxy. GIPHY and Tenor send CORS headers, so
  // the static site reads their GIFs directly; this only catches stray proxied URLs.
  async function gifMedia(raw) {
    let url = null;
    try {
      url = new URL(raw || "");
    } catch (_) {}
    if (!url || url.protocol !== "https:" || !GIF_MEDIA_HOSTS.test(url.hostname)) {
      return jsonResponse(400, { detail: "Host not allowed" });
    }
    try {
      const res = await nativeFetch(url.href);
      if (res.ok) return res;
    } catch (_) {}
    return jsonResponse(502, { detail: "Couldn't fetch GIF" });
  }

  /* ---------- Request routing ---------- */

  const ROUTES = [
    { methods: ["GET"], pattern: /^\/api\/checklist-templates$/, handle: () => listChecklistTemplates() },
    { methods: ["POST"], pattern: /^\/api\/checklist-templates$/, handle: (m, body) => saveChecklistTemplate(body) },
    { methods: ["PUT"], pattern: /^\/api\/checklist-templates\/(\d+)$/, handle: (m, body) => saveChecklistTemplate(body, Number(m[1])) },
    { methods: ["DELETE"], pattern: /^\/api\/checklist-templates\/(\d+)$/, handle: (m) => deleteChecklistTemplate(Number(m[1])) },
    { methods: ["POST"], pattern: /^\/api\/upload$/, handle: (m, body) => uploadFile(body) },
    { methods: ["GET"], pattern: /^\/api\/scrapbook\/pads$/, handle: () => listScrapbookPads() },
    { methods: ["POST"], pattern: /^\/api\/scrapbook\/pads$/, handle: (m, body) => createScrapbookPads(scrapbookImageItems(body, "pads")) },
    {
      methods: ["DELETE"],
      pattern: /^\/api\/scrapbook\/pads\/(\d+)$/,
      handle: (m) => deleteScrapbookRow("scrapbook_pads", Number(m[1]), "Sticky pad not found"),
    },
    { methods: ["GET"], pattern: /^\/api\/scrapbook\/stickers$/, handle: (m, body, query) => listScrapbookStickers(query) },
    {
      methods: ["POST"],
      pattern: /^\/api\/scrapbook\/stickers$/,
      handle: (m, body) => {
        const f = modelFields(body, { collection: "text" });
        return createScrapbookStickers(f.collection ?? null, scrapbookImageItems(body, "stickers"));
      },
    },
    {
      methods: ["DELETE"],
      pattern: /^\/api\/scrapbook\/stickers\/(\d+)$/,
      handle: (m) => deleteScrapbookRow("scrapbook_stickers", Number(m[1]), "Sticker not found"),
    },
    { methods: ["POST"], pattern: /^\/api\/scrapbook\/stickers\/collections\/rename$/, handle: (m, body) => renameStickerCollection(body) },
    { methods: ["POST"], pattern: /^\/api\/scrapbook\/stickers\/collections\/delete$/, handle: (m, body) => deleteStickerCollection(body) },
    { methods: ["GET"], pattern: /^\/api\/scrapbook\/palettes$/, handle: () => listScrapbookPalettes() },
    { methods: ["POST"], pattern: /^\/api\/scrapbook\/palettes$/, handle: (m, body) => createScrapbookPalette(paletteBody(body)) },
    {
      methods: ["PUT"],
      pattern: /^\/api\/scrapbook\/palettes\/(\d+)$/,
      handle: (m, body) => updateScrapbookPalette(Number(m[1]), paletteBody(body)),
    },
    {
      methods: ["DELETE"],
      pattern: /^\/api\/scrapbook\/palettes\/(\d+)$/,
      handle: (m) => deleteScrapbookRow("scrapbook_palettes", Number(m[1]), "Palette not found"),
    },
    { methods: ["GET"], pattern: /^\/api\/scrapbook\/gifs\/config$/, signedOut: GIF_SEARCH_OFF, handle: () => gifConfig() },
    { methods: ["PUT"], pattern: /^\/api\/scrapbook\/gifs\/config$/, handle: (m, body) => saveGifConfig(body) },
    { methods: ["DELETE"], pattern: /^\/api\/scrapbook\/gifs\/config$/, handle: () => clearGifConfig() },
    { methods: ["GET"], pattern: /^\/api\/scrapbook\/gifs\/search$/, handle: (m, body, query) => searchGifs(query) },
  ];

  const OFFLINE_DETAIL = "This part of FICUS isn't available online yet.";

  // Lists the app loads for features not yet in the cloud (saved GIFs, contacts); empty keeps the page rendering.
  const PENDING_MODULE_LISTS = [/^\/api\/scrapbook\/gif-library$/, /^\/api\/contacts$/];

  function signedOutNoun(path) {
    if (path.startsWith("/api/scrapbook")) return "your scrapbook";
    if (path === "/api/upload") return "files";
    return "checklist templates";
  }

  function describeRequest(input, init) {
    if (typeof input !== "string" && !(input instanceof URL)) return null;
    const url = new URL(String(input), window.location.href);
    if (url.origin !== window.location.origin || !url.pathname.startsWith("/api/")) return null;
    let body = {};
    if (typeof init?.body === "string" && init.body) {
      try {
        const parsed = JSON.parse(init.body);
        if (isPlainObject(parsed)) body = parsed;
      } catch (_) {}
    } else if (typeof FormData !== "undefined" && init?.body instanceof FormData) {
      body = init.body;
    }
    return {
      path: url.pathname.replace(/\/+$/, ""),
      method: String(init?.method || "GET").toUpperCase(),
      body,
      query: url.searchParams,
    };
  }

  window.fetch = async function ficusFetch(input, init) {
    const request = describeRequest(input, init);
    if (!request) return nativeFetch(input, init);
    if (request.method === "GET" && request.path === "/api/link-preview") return linkPreview(request.query.get("url"));
    if (await hasLocalBackend()) return nativeFetch(input, init);
    if (request.method === "GET" && request.path === "/api/scrapbook/gifs/proxy") return gifMedia(request.query.get("url"));

    for (const route of ROUTES) {
      if (!route.methods.includes(request.method)) continue;
      const match = request.path.match(route.pattern);
      if (!match) continue;
      if (!client) return jsonResponse(503, { detail: "Cloud sync is unavailable right now." });
      await sessionReady;
      if (!session) {
        return request.method === "GET"
          ? jsonResponse(200, "signedOut" in route ? route.signedOut : [])
          : jsonResponse(401, { detail: `Sign in with Google to save ${signedOutNoun(request.path)}.` });
      }
      try {
        return jsonResponse(200, await route.handle(match, request.body, request.query));
      } catch (err) {
        const status = err instanceof ApiError ? err.status : 500;
        return jsonResponse(status, { detail: err?.message || "Cloud request failed" });
      }
    }

    if (request.method === "GET" && PENDING_MODULE_LISTS.some((pattern) => pattern.test(request.path))) {
      return jsonResponse(200, []);
    }
    return jsonResponse(503, { detail: OFFLINE_DETAIL });
  };
})();
