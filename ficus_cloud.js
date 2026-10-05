/* FICUS cloud layer.
 *
 * When no local FastAPI backend is reachable (the static site on GitHub Pages),
 * this answers the app's `/api/...` requests from Supabase instead. Ported
 * routes mirror main.py / database.py so the rest of index.html is unchanged.
 * With the local server running, every request passes straight through.
 *
 * Ported so far: Figs (inbox sparks), tags, Trackers (habits), the Log and
 * Time pages (tasks, events and log entries, plus checklist templates), the
 * Project page (binders and their ship dates), Vision boards and their
 * scrapbook libraries (with GIPHY/Tenor GIF search), the Vault (notebooks, shelves and references), the
 * Legacy page, and /api/upload, which stores files in the Supabase Storage
 * bucket `uploads`. /api/link-preview (titles and thumbnails for shared links)
 * is answered here in both modes.
 */
(function () {
  "use strict";

  // Pages whose data lives in Supabase; index.html locks the other nav tabs on the static site.
  window.FICUS_ONLINE_VIEWS = ["cover", "sparks", "habits", "today", "tasks", "projects", "vision", "reference", "legacy"];

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

  function pad2(value) {
    return String(value).padStart(2, "0");
  }

  function hhmmOf(stamp) {
    const parsed = stamp ? new Date(stamp) : new Date();
    const date = Number.isNaN(parsed.getTime()) ? new Date() : parsed;
    return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
  }

  function localHhmm() {
    return hhmmOf();
  }

  const NOTEPADS_SQL_HINT = "Notepads need supabase/09_notepads.sql to be run in Supabase first.";

  function isMissingTable(error, table) {
    return ["PGRST205", "42P01"].includes(error?.code) && String(error.message || "").includes(table);
  }

  async function run(query) {
    const { data, error } = await query;
    if (error) {
      if (error.code === "42P17" && /project_sections/.test(error.message || "")) {
        throw new ApiError(500, "Project sections can't be saved until supabase/08_project_section_policies.sql is run in Supabase.");
      }
      if (isMissingTable(error, "notepads")) throw new ApiError(500, NOTEPADS_SQL_HINT);
      throw new ApiError(500, error.message || "Cloud request failed");
    }
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

  const ITEM_TYPES = ["spark", "task", "habit", "project", "reference"];
  const TAG_COLORS = ["slate", "iris", "mint", "amber", "rose", "sky", "violet", "coral"];
  const TAG_COLOR_ALIASES = {
    indigo: "iris", purple: "violet", emerald: "mint", green: "mint", pink: "rose",
    blue: "sky", orange: "coral", neutral: "slate", gray: "slate", grey: "slate",
  };
  const DESK_THEMES = ["warm_gray", "beige", "sage", "coffee", "rose", "blue"];

  function normalizeTopicTag(raw) {
    if (!given(raw)) return null;
    const slug = String(raw).trim().replace(/^#+/, "").trim().toLowerCase().split(/\s+/).filter(Boolean).join("-");
    return slug || null;
  }

  function normalizeTagList(raw) {
    let values = [];
    if (Array.isArray(raw)) values = raw;
    else if (typeof raw === "string" && raw.trim()) values = raw.split(/[,;\s]+/).filter((part) => part.trim());
    const tags = [];
    for (const value of values) {
      const tag = normalizeTopicTag(given(value) ? String(value) : null);
      if (tag && !tags.includes(tag)) tags.push(tag);
    }
    return tags;
  }

  function normalizeTagColor(raw) {
    let value = String(raw || "slate").trim().toLowerCase();
    value = TAG_COLOR_ALIASES[value] || value;
    return TAG_COLORS.includes(value) ? value : "slate";
  }

  function intentOf(raw) {
    const value = text(raw).toLowerCase();
    return ["task", "event", "log"].includes(value) ? value : null;
  }

  function cleanEntities(raw, allowType) {
    const entities = [];
    for (const row of Array.isArray(raw) ? raw : []) {
      if (!isPlainObject(row)) continue;
      const type = text(row.type || row.kind).toLowerCase();
      const name = text(row.name || row.label || row.val);
      if (!type || !name || !allowType(type)) continue;
      const entity = { type, name };
      const url = text(row.url);
      if (url) entity.url = url;
      const contactId = row.contact_id || row.contactId;
      if (given(contactId) && contactId !== "") entity.contact_id = String(contactId);
      entities.push(entity);
    }
    return entities;
  }

  const isPersonOrPlace = (type) => type === "person" || type === "place";
  const isNotTag = (type) => type !== "tag";

  function cleanBlocks(raw) {
    const blocks = [];
    for (const row of Array.isArray(raw) ? raw : []) {
      if (!isPlainObject(row)) continue;
      const type = text(row.type || row.kind).toLowerCase();
      if (type === "photo") {
        const url = text(row.url || row.src || row.photo_url);
        if (!url) continue;
        blocks.push({
          id: String(row.id || ""),
          type: "photo",
          url,
          caption: text(row.caption),
          filename: text(row.filename || row.name),
          size: text(row.size).toLowerCase() === "expanded" ? "expanded" : "compact",
        });
      } else if (type === "link") {
        const url = text(row.url || row.href);
        if (!url) continue;
        const preview = isPlainObject(row.preview) ? row.preview : null;
        let mode = text(row.display_mode || row.layout || "compact").toLowerCase();
        if (mode !== "compact" && mode !== "card") mode = "compact";
        blocks.push({
          id: String(row.id || ""),
          type: "link",
          url,
          title: text(row.title || row.label),
          display_mode: mode,
          preview_image: text(row.preview_image || preview?.image || preview?.thumbnail),
          description: text(row.description || preview?.description),
          preview,
        });
      }
    }
    return blocks;
  }

  function photoBlock(url) {
    return { id: "", type: "photo", url, caption: "", filename: "", size: "compact" };
  }

  function linkBlock(url) {
    return { id: "", type: "link", url, title: "", display_mode: "compact", preview_image: "", description: "", preview: null };
  }

  function optionalInt(value) {
    return given(value) && value !== "" ? Number.parseInt(value, 10) : null;
  }

  function intOr(value, fallback) {
    const number = Number.parseInt(value, 10);
    return Number.isFinite(number) ? number : fallback;
  }

  function serializeSpark(row) {
    const data = { ...row };
    delete data.user_id;
    const itemType = ITEM_TYPES.includes(row.item_type) ? row.item_type : "spark";
    const extra = isPlainObject(row.extra_data) ? { ...row.extra_data } : {};
    data.item_type = itemType;
    data.is_done = row.is_done ? 1 : 0;
    data.assignee = given(row.assignee) ? String(row.assignee) : "";
    data.due_date = row.due_date || null;
    data.due_time = row.due_time || null;
    data.project_id = optionalInt(row.project_id);
    data.phase_id = row.phase_id ? String(row.phase_id) : null;
    data.folder_id = optionalInt(row.folder_id);
    data.is_pinned = row.is_pinned ? 1 : 0;
    data.linked_vision_id = optionalInt(row.linked_vision_id);
    data.deadline = row.deadline || null;
    data.extra_data = extra;
    data.pos_x = intOr(row.pos_x, 100);
    data.pos_y = intOr(row.pos_y, 100);
    if (itemType === "habit") return serializeHabitFields(data, row);
    if (itemType === "task") return serializeTaskFields(data, row);
    if (itemType === "reference") data.extra_data = normalizeReferenceExtra(extra);
    if (itemType !== "spark") return data;

    data.color_theme = text(row.color_theme || "beige").toLowerCase() || "beige";
    data.group_name = given(row.group_name) && row.group_name !== "" ? String(row.group_name).trim() : null;
    const intent = intentOf(extra.intent_hint || extra.quick_mark);
    data.intent_hint = intent;
    data.quick_mark = intent || "none";
    data.is_highlighted = Boolean(extra.is_highlighted);
    data.photo_url = text(extra.photo_url) || null;
    data.link_url = text(extra.link_url || row.source_url) || null;
    const tags = [];
    for (const tag of Array.isArray(extra.tags) ? extra.tags : []) {
      const cleaned = String(tag || "").trim().replace(/^#+/, "");
      if (cleaned && !tags.includes(cleaned)) tags.push(cleaned);
    }
    if (!tags.length && row.topic_tag) tags.push(String(row.topic_tag).replace(/^#+/, ""));
    data.tags = tags;
    data.entities = cleanEntities(extra.entities, isNotTag);
    const blocks = cleanBlocks(extra.blocks);
    if (!blocks.length) {
      if (data.photo_url) blocks.push(photoBlock(data.photo_url));
      if (data.link_url) blocks.push(linkBlock(data.link_url));
    }
    data.blocks = blocks;
    return data;
  }

  /* ---------- Figs ---------- */

  async function requireSpark(id) {
    const row = await run(client.from("sparks").select("*").eq("id", id).maybeSingle());
    if (!row) throw new ApiError(404, "Spark not found");
    return row;
  }

  function requireTitle(body) {
    if (typeof body.title !== "string" || !body.title) throw new ApiError(422, "Title is required");
    const title = body.title.trim();
    if (!title) throw new ApiError(400, "Title is required");
    return title;
  }

  async function ensureTagsForNames(names) {
    const rows = (names || []).map(normalizeTopicTag).filter(Boolean).map((name) => ({ name, color: "slate" }));
    if (!rows.length) return;
    await run(client.from("tags").upsert(rows, { onConflict: "user_id,name", ignoreDuplicates: true }));
  }

  async function nextDeskPosition() {
    const rows = await run(client.from("sparks").select("pos_x, pos_y").eq("item_type", "spark"));
    const occupied = rows.map((row) => [intOr(row.pos_x, 0), intOr(row.pos_y, 0)]);
    const count = rows.length;
    for (let offset = 0; offset < Math.max(count + 8, 12); offset += 1) {
      const idx = count + offset;
      const x = 80 + (idx % 4) * 240;
      const y = 80 + Math.floor(idx / 4) * 160;
      if (!occupied.some(([ox, oy]) => Math.abs(ox - x) < 120 && Math.abs(oy - y) < 100)) return [x, y];
    }
    return [80 + (count % 4) * 240, 80 + Math.floor(count / 4) * 160];
  }

  async function listFigs() {
    const rows = await run(client.from("sparks").select("*")
      .eq("status", "in_cloud").eq("item_type", "spark")
      .order("created_at", { ascending: false }));
    return rows.map(serializeSpark);
  }

  async function createFig(body) {
    const title = requireTitle(body);
    const history = Array.isArray(body.migration_history) && body.migration_history.length
      ? body.migration_history
      : [{ action: "created", type: "spark", timestamp: localHhmm() }];
    const extra = isPlainObject(body.extra_data) ? { ...body.extra_data } : {};
    extra.migration_history = history;
    if (body.notes) {
      extra.notes = body.notes;
      extra.rich_notes = body.notes;
    }
    extra.intent_hint = intentOf(body.intent_hint || body.quick_mark);
    extra.quick_mark = extra.intent_hint || "none";
    extra.is_highlighted = Boolean(body.is_highlighted);
    let photo = text(body.photo_url) || null;
    let link = text(body.link_url || body.source_url) || null;
    extra.photo_url = photo;
    extra.link_url = link;

    const tags = normalizeTagList(Array.isArray(body.tags) ? body.tags : []);
    const topicFromBody = normalizeTopicTag(body.topic_tag);
    if (topicFromBody && !tags.includes(topicFromBody)) tags.unshift(topicFromBody);
    extra.tags = tags;
    extra.entities = cleanEntities(Array.isArray(body.entities) ? body.entities : extra.entities, isPersonOrPlace);

    const blocks = cleanBlocks(Array.isArray(body.blocks) ? body.blocks : extra.blocks);
    if (!blocks.length) {
      if (photo) blocks.push(photoBlock(photo));
      if (link) blocks.push(linkBlock(link));
    }
    extra.blocks = blocks;
    const firstPhoto = blocks.find((block) => block.type === "photo");
    const firstLink = blocks.find((block) => block.type === "link");
    if (firstPhoto) extra.photo_url = photo = firstPhoto.url;
    if (firstLink) extra.link_url = link = firstLink.url;

    let theme = text(body.color_theme || "beige").toLowerCase() || "beige";
    if (!DESK_THEMES.includes(theme)) theme = "beige";
    let posX = given(body.pos_x) ? intOr(body.pos_x, 100) : null;
    let posY = given(body.pos_y) ? intOr(body.pos_y, 100) : null;
    if (posX === null || posY === null) {
      const [autoX, autoY] = await nextDeskPosition();
      posX = posX ?? autoX;
      posY = posY ?? autoY;
    }
    if (tags.length) await ensureTagsForNames(tags);

    const row = await run(client.from("sparks").insert({
      title,
      raw_content: text(body.raw_content) || null,
      source_url: link,
      topic_tag: tags[0] || topicFromBody,
      source_type: text(body.source_type) || null,
      status: "in_cloud",
      item_type: "spark",
      extra_data: extra,
      notes: body.notes ?? null,
      pos_x: posX,
      pos_y: posY,
      color_theme: theme,
      group_name: given(body.group_name) && body.group_name !== "" ? String(body.group_name).trim() : null,
    }).select("*").single());
    return serializeSpark(row);
  }

  async function updateFig(id, body) {
    const title = requireTitle(body);
    const existing = await requireSpark(id);
    const current = serializeSpark(existing);
    const extra = { ...current.extra_data };
    if (isPlainObject(body.extra_data)) Object.assign(extra, body.extra_data);
    if (given(body.notes)) {
      extra.notes = body.notes;
      extra.rich_notes = body.notes;
    }
    if (given(body.intent_hint) || given(body.quick_mark)) {
      extra.intent_hint = intentOf(given(body.intent_hint) ? body.intent_hint : body.quick_mark || "");
      extra.quick_mark = extra.intent_hint || "none";
    }
    if (given(body.is_highlighted)) extra.is_highlighted = Boolean(body.is_highlighted);
    if (given(body.photo_url)) extra.photo_url = text(body.photo_url) || null;
    const link = given(body.link_url) ? body.link_url : body.source_url;
    if (given(link)) extra.link_url = text(link) || null;
    let tags = null;
    if (given(body.tags)) {
      tags = normalizeTagList(Array.isArray(body.tags) ? body.tags : []);
      extra.tags = tags;
    }
    if (given(body.entities)) extra.entities = cleanEntities(body.entities, isPersonOrPlace);
    if (given(body.blocks)) {
      const blocks = cleanBlocks(body.blocks);
      extra.blocks = blocks;
      const firstPhoto = blocks.find((block) => block.type === "photo");
      const firstLink = blocks.find((block) => block.type === "link");
      extra.photo_url = firstPhoto ? firstPhoto.url : null;
      if (firstLink) extra.link_url = firstLink.url;
    }
    let topic = normalizeTopicTag(body.topic_tag);
    if (tags !== null) {
      topic = tags[0] || null;
      await ensureTagsForNames(tags);
    }
    const row = await run(client.from("sparks").update({
      title,
      raw_content: text(body.raw_content) || null,
      source_url: given(link) ? extra.link_url : current.source_url,
      topic_tag: topic,
      notes: given(body.notes) ? body.notes : current.notes,
      extra_data: extra,
    }).eq("id", id).select("*").single());
    return serializeSpark(row);
  }

  async function positionFig(id, body) {
    const spark = await requireSpark(id);
    if ((spark.item_type || "spark") !== "spark") throw new ApiError(400, "Only inbox sparks can be positioned on the desk");
    const x = Number(body.pos_x);
    const y = Number(body.pos_y);
    if (!Number.isInteger(x) || !Number.isInteger(y)) throw new ApiError(422, "pos_x and pos_y must be integers");
    const row = await run(client.from("sparks").update({
      pos_x: Math.max(0, Math.min(x, 20000)),
      pos_y: Math.max(0, Math.min(y, 20000)),
    }).eq("id", id).eq("item_type", "spark").select("*").single());
    return { ...serializeSpark(row), success: true };
  }

  async function deleteFig(id) {
    await requireSpark(id);
    await run(client.from("sparks").delete().eq("id", id));
    return { ok: true, id };
  }

  /* ---------- Link previews (for links shared or pasted into a fig) ---------- */

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

  /* ---------- Tags ---------- */

  async function inCloudTagRows() {
    return run(client.from("sparks").select("id, topic_tag, extra_data").eq("status", "in_cloud"));
  }

  async function ensureTagRecord(name, color = "slate") {
    const tag = normalizeTopicTag(given(name) ? String(name) : null);
    if (!tag) throw new ApiError(400, "Tag name is required");
    const tone = normalizeTagColor(color);
    const existing = await run(client.from("tags").select("name, color").eq("name", tag).maybeSingle());
    if (existing) return { name: existing.name, color: normalizeTagColor(existing.color) };
    await run(client.from("tags").insert({ name: tag, color: tone }));
    return { name: tag, color: tone };
  }

  async function listTags() {
    const rows = await inCloudTagRows();
    const discovered = new Set();
    const usage = new Map();
    for (const row of rows) {
      const sparkTags = new Set();
      const topic = normalizeTopicTag(row.topic_tag);
      if (topic) sparkTags.add(topic);
      const extra = isPlainObject(row.extra_data) ? row.extra_data : {};
      normalizeTagList(extra.tags).forEach((tag) => sparkTags.add(tag));
      sparkTags.forEach((tag) => {
        discovered.add(tag);
        usage.set(tag, (usage.get(tag) || 0) + 1);
      });
    }
    await ensureTagsForNames([...discovered]);
    const catalog = await run(client.from("tags").select("name, color"));
    return catalog
      .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()))
      .map((row) => {
        const clean = normalizeTopicTag(row.name) || row.name;
        return { name: clean, color: normalizeTagColor(row.color), usage_count: usage.get(clean) || 0 };
      });
  }

  async function createTag(body) {
    if (!body.name) throw new ApiError(400, "Tag name is required");
    return ensureTagRecord(body.name, body.color || "slate");
  }

  async function setTagColor(name, body) {
    if (typeof body.color !== "string") throw new ApiError(422, "color is required");
    const tag = normalizeTopicTag(name);
    if (!tag) throw new ApiError(400, "Tag name is required");
    const tone = normalizeTagColor(body.color);
    await run(client.from("tags").upsert({ name: tag, color: tone }, { onConflict: "user_id,name" }));
    return { status: "success", tag, name: tag, color: tone };
  }

  async function rewriteTagAcrossFigs(oldTag, newTag) {
    for (const row of await inCloudTagRows()) {
      let topic = normalizeTopicTag(row.topic_tag);
      const extra = isPlainObject(row.extra_data) ? { ...row.extra_data } : {};
      let tags = normalizeTagList(extra.tags);
      let changed = false;
      if (topic === oldTag) {
        topic = newTag;
        changed = true;
      }
      if (tags.includes(oldTag)) {
        tags = normalizeTagList(tags.map((tag) => (tag === oldTag ? newTag : tag)));
        changed = true;
      }
      if (!changed) continue;
      if (tags.length) {
        extra.tags = tags;
        if (!topic) topic = tags[0];
      } else if (topic === newTag) {
        extra.tags = [newTag];
      }
      await run(client.from("sparks").update({ topic_tag: topic, extra_data: extra }).eq("id", row.id));
    }
  }

  async function updateTag(name, body) {
    const currentName = normalizeTopicTag(name);
    if (!currentName) throw new ApiError(400, "Tag name is required");
    let row = await run(client.from("tags").select("name, color").eq("name", currentName).maybeSingle());
    if (!row) row = await ensureTagRecord(currentName);
    let nextName = currentName;
    if (given(body.name)) {
      const renamed = normalizeTopicTag(String(body.name));
      if (!renamed) throw new ApiError(400, "Tag name is required");
      nextName = renamed;
    }
    const nextColor = given(body.color) ? normalizeTagColor(body.color) : normalizeTagColor(row.color);
    if (nextName !== currentName) {
      const clash = await run(client.from("tags").select("name").eq("name", nextName).maybeSingle());
      if (clash) throw new ApiError(400, "A tag with that name already exists");
      await run(client.from("tags").update({ name: nextName, color: nextColor }).eq("name", currentName));
      await rewriteTagAcrossFigs(currentName, nextName);
    } else {
      await run(client.from("tags").update({ color: nextColor }).eq("name", currentName));
    }
    return { name: nextName, color: nextColor };
  }

  async function deleteTag(name) {
    const tag = normalizeTopicTag(name);
    if (!tag) throw new ApiError(400, "Tag name is required");
    await run(client.from("tags").delete().in("name", [tag, `#${tag}`]));
    for (const row of await inCloudTagRows()) {
      let topic = normalizeTopicTag(row.topic_tag);
      const extra = isPlainObject(row.extra_data) ? { ...row.extra_data } : {};
      let tags = normalizeTagList(extra.tags);
      let changed = false;
      if (tags.includes(tag)) {
        tags = tags.filter((value) => value !== tag);
        changed = true;
      }
      if (topic === tag) {
        topic = tags[0] || null;
        changed = true;
      }
      if (!changed) continue;
      extra.tags = tags;
      await run(client.from("sparks").update({ topic_tag: topic, extra_data: extra }).eq("id", row.id));
    }
    return { status: "success", deleted: tag };
  }

  /* ---------- Trackers (habits) ---------- */
  // Habit rows are item_type = 'habit' in `sparks`; schedule, trackers and day history live in extra_data.
  // Vault journal pages and reward unlocks stay with the local server until those modules move online.

  const HABIT_TIMES = ["Morning", "Afternoon", "Evening", "Any Time"];
  const HABIT_FREQUENCIES = ["weekly", "monthly"];
  const HABIT_TRACKING = ["boolean", "measure"];
  const HABIT_STATUSES = ["active", "graduated", "paused", "archived"];
  const SUBMISSION_TYPES = ["note", "link", "photo", "file"];
  const HABIT_TRACKER_TYPES = ["done", "number", "slider", "photo", "journal"];
  const HABIT_SLOTS = { Morning: "08:00", Afternoon: "13:00", Evening: "18:00", "Any Time": "09:00" };
  const HABIT_MATRIX_RANGES = [7, 30, 90, 180, 365];
  const HABIT_MATRIX_ALIASES = { "7d": 7, "30d": 30, "1m": 30, "3m": 90, "6m": 180, "12m": 365, "1y": 365 };
  const HABIT_EXTRA_KEYS = [
    "frequency_type", "target_days", "time_of_day", "scheduled_time", "tracking_type", "measure_unit",
    "measure_target", "metrics", "enable_submission", "submission_types", "vault_folder", "tracking_config",
    "reward", "icon",
  ];
  // HabitWrite in main.py: unknown keys are dropped, missing ones take these defaults on create.
  const HABIT_WRITE_DEFAULTS = {
    raw_content: null, notes: null, frequency_type: "weekly", target_days: [], time_of_day: "Any Time",
    scheduled_time: null, tracking_type: "boolean", measure_unit: null, measure_target: null, metrics: null,
    tracking_config: null, enable_submission: null, submission_types: null, vault_folder: null,
    linked_vision_id: null, reward: null, icon: null,
  };
  const HABIT_LOG_KEYS = [
    "date", "completed", "value", "values", "note", "reflection_html", "measured_value", "measured_unit",
    "target_value", "link", "attachment_url", "photos", "links", "files", "logged_at",
  ];
  const TRACKER_SNAPSHOT_KEYS = ["id", "type", "label", "unit", "target", "stamp", "left_label", "right_label", "left_emoji", "right_emoji"];
  const AUTO_HABIT_NOTE = /^\s*<p><strong>[^<]*<\/strong><\/p>\s*<ul>(?:\s*<li>[^<]*<\/li>)*\s*<\/ul>\s*$/;

  // Python's float(value or 0) with unparseable input treated as 0.
  function toNumber(value) {
    const number = Number(value || 0);
    return Number.isFinite(number) ? number : 0;
  }

  function optionalNumber(value) {
    if (!given(value) || value === "") return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function strictInt(value) {
    if (typeof value === "number") return Number.isFinite(value) ? Math.trunc(value) : null;
    if (typeof value === "string" && /^\s*[-+]?\d+\s*$/.test(value)) return Number.parseInt(value, 10);
    return null;
  }

  function clip(value, length) {
    return Array.from(value).slice(0, length).join("");
  }

  function basename(url) {
    return url.replace(/\/+$/, "").split("/").pop();
  }

  function stripTags(html) {
    return String(html || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#x27;");
  }

  function decodeEntities(value) {
    const box = document.createElement("textarea");
    box.innerHTML = value;
    return box.value;
  }

  // Habit days are local calendar days; noon keeps date math clear of DST shifts.
  function shiftDays(date, days) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days, 12);
  }

  function localToday() {
    return shiftDays(new Date(), 0);
  }

  function dayKey(date) {
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
  }

  function parseDayKey(key) {
    const match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(String(key ?? "").trim());
    if (!match) return null;
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12);
    return date.getMonth() === Number(match[2]) - 1 && date.getDate() === Number(match[3]) ? date : null;
  }

  function cleanDueDate(value) {
    if (!given(value) || !String(value).trim()) return null;
    const day = String(value).trim();
    if (!parseDayKey(day)) throw new ApiError(400, "due_date must be YYYY-MM-DD");
    return day;
  }

  function cleanDueTime(value) {
    if (!given(value) || !String(value).trim()) return null;
    const clock = String(value).trim();
    const match = /^(\d{1,2}):(\d{1,2})$/.exec(clock);
    if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) throw new ApiError(400, "due_time must be HH:MM");
    return clock;
  }

  function habitDays(raw, frequency) {
    if (!Array.isArray(raw)) return frequency === "weekly" ? [0, 1, 2, 3, 4, 5, 6] : [1];
    const clean = new Set();
    for (const day of raw) {
      const number = strictInt(day);
      if (number === null) continue;
      if (frequency === "monthly" ? number >= 1 && number <= 31 : number >= 0 && number <= 6) clean.add(number);
    }
    return [...clean].sort((a, b) => a - b);
  }

  function habitMetrics(data) {
    const metrics = [];
    const seen = new Set();
    for (const item of Array.isArray(data.metrics) ? data.metrics : []) {
      if (!isPlainObject(item)) continue;
      const name = text(item.name);
      if (!name || seen.has(name)) continue;
      metrics.push({ name, unit: text(item.unit), target: Math.max(0, toNumber(item.target)) });
      seen.add(name);
    }
    if (metrics.length) return metrics;
    if (data.tracking_type === "measure" || data.measure_unit || data.measure_target) {
      const unit = text(data.measure_unit);
      const target = toNumber(data.measure_target);
      if (unit || target) {
        metrics.push({ name: unit.toLowerCase() === "km" ? "Distance" : unit || "Amount", unit, target: Math.max(0, target) });
      }
    }
    return metrics;
  }

  function metricValues(raw) {
    const values = {};
    if (!isPlainObject(raw)) return values;
    for (const [key, value] of Object.entries(raw)) {
      const name = String(key).trim();
      const number = Number(value || 0);
      if (name && Number.isFinite(number)) values[name] = Math.max(0, number);
    }
    return values;
  }

  function entryPhotos(entry) {
    let photos = [];
    const seen = new Set();
    for (const item of Array.isArray(entry.photos) ? entry.photos : []) {
      const url = text(isPlainObject(item) ? item.url : item);
      if (url && !url.startsWith("blob:") && !seen.has(url)) {
        seen.add(url);
        photos.push(url);
      }
    }
    const attachment = text(entry.attachment_url);
    if (attachment && !attachment.startsWith("blob:")) {
      if (!seen.has(attachment)) photos.unshift(attachment);
      else if (photos[0] !== attachment) photos = [attachment, ...photos.filter((url) => url !== attachment)];
    }
    return photos;
  }

  function entryLinks(entry) {
    const links = [];
    const seen = new Set();
    for (const item of Array.isArray(entry.links) ? entry.links : []) {
      const url = text(isPlainObject(item) ? item.url : item);
      const title = isPlainObject(item) ? text(item.title || url) || url : url;
      if (url && !seen.has(url)) {
        seen.add(url);
        links.push({ url, title });
      }
    }
    const legacy = text(entry.link);
    if (legacy && !seen.has(legacy)) links.unshift({ url: legacy, title: legacy });
    return links;
  }

  function entryFiles(entry) {
    const files = [];
    const seen = new Set();
    for (const item of Array.isArray(entry.files) ? entry.files : []) {
      const url = text(isPlainObject(item) ? item.url : item);
      const name = isPlainObject(item) ? text(item.name || basename(url) || "File") || "File" : basename(url) || "File";
      const size = isPlainObject(item) ? Math.max(0, Number.parseInt(item.size || 0, 10) || 0) : 0;
      if (url && !seen.has(url) && !url.startsWith("blob:")) {
        seen.add(url);
        files.push({ url, name, size });
      }
    }
    return files;
  }

  function entryReferenceIds(entry) {
    const vaultId = entry.vault_page_id || entry.reference_id;
    return {
      reference_id: entry.reference_id ? intOr(entry.reference_id, null) : null,
      vault_page_id: vaultId ? intOr(vaultId, null) : null,
    };
  }

  function habitHistory(raw) {
    const history = {};
    if (!isPlainObject(raw)) return history;
    for (const [key, entry] of Object.entries(raw)) {
      if (!parseDayKey(key) || !isPlainObject(entry)) continue;
      const photos = entryPhotos(entry);
      const links = entryLinks(entry);
      history[key] = {
        completed: Boolean(entry.completed),
        value: Math.max(0, toNumber(entry.value)),
        values: metricValues(entry.values),
        note: text(entry.note),
        link: links.length ? links[0].url : text(entry.link),
        links,
        files: entryFiles(entry),
        attachment_url: photos.length ? photos[0] : text(entry.attachment_url),
        photos,
        measured_value: optionalNumber(entry.measured_value),
        measured_unit: text(entry.measured_unit) || null,
        target_value: optionalNumber(entry.target_value),
        ...entryReferenceIds(entry),
      };
    }
    return history;
  }

  function habitScheduled(extra, day) {
    const days = extra.target_days || [];
    return days.includes(extra.frequency_type === "monthly" ? day.getDate() : day.getDay());
  }

  function metricsMet(metrics, values) {
    const tracked = metrics.filter((metric) => toNumber(metric.target) > 0);
    return tracked.length > 0 && tracked.every((metric) => toNumber(values[metric.name]) >= toNumber(metric.target));
  }

  function habitMet(extra, entry) {
    return Boolean(entry && entry.completed);
  }

  function habitClock(extra) {
    return text(extra.scheduled_time) || HABIT_SLOTS[extra.time_of_day || ""] || "09:00";
  }

  function computeHabitStreak(extra, today = localToday()) {
    const history = extra.history || {};
    let cursor = today;
    if (habitScheduled(extra, cursor) && !habitMet(extra, history[dayKey(cursor)])) cursor = shiftDays(cursor, -1);
    let streak = 0;
    for (let step = 0; step < 366; step += 1) {
      if (habitScheduled(extra, cursor)) {
        if (!habitMet(extra, history[dayKey(cursor)])) break;
        streak += 1;
      }
      cursor = shiftDays(cursor, -1);
    }
    return streak;
  }

  function submissionTypes(data) {
    if (Array.isArray(data.submission_types)) {
      const chosen = [];
      for (const item of data.submission_types) {
        const key = String(item).trim().toLowerCase();
        if (SUBMISSION_TYPES.includes(key) && !chosen.includes(key)) chosen.push(key);
      }
      return chosen;
    }
    return data.enable_submission ? [...SUBMISSION_TYPES] : [];
  }

  function peelLeadingEmoji(value) {
    const raw = text(value);
    if (!raw) return ["", ""];
    const head = raw.split(/\s+/)[0];
    if (/[A-Za-z]/.test(head)) return ["", raw];
    return [clip(head, 32), raw.slice(head.length).trim()];
  }

  function habitTrackers(raw) {
    if (!Array.isArray(raw)) return [];
    const trackers = [];
    raw.forEach((item, index) => {
      if (!isPlainObject(item)) return;
      const kind = text(item.type).toLowerCase();
      if (!HABIT_TRACKER_TYPES.includes(kind)) return;
      const tracker = { id: clip(text(item.id || `t${index + 1}`), 40), type: kind, label: clip(text(item.label), 80) };
      for (const key of ["unit", "left_label", "right_label", "stamp", "left_emoji", "right_emoji"]) {
        if (given(item[key]) && item[key] !== "") tracker[key] = clip(text(item[key]), 80);
      }
      if (kind === "slider") {
        for (const side of ["left", "right"]) {
          const emojiKey = `${side}_emoji`;
          const labelKey = `${side}_label`;
          if (tracker[emojiKey] || !tracker[labelKey]) continue;
          const [emoji, label] = peelLeadingEmoji(tracker[labelKey]);
          if (!emoji) continue;
          tracker[emojiKey] = emoji;
          if (label) tracker[labelKey] = clip(label, 80);
          else delete tracker[labelKey];
        }
      }
      if (given(item.target) && item.target !== "") {
        const target = Number(item.target);
        if (Number.isFinite(target)) tracker.target = Math.max(0, target);
      }
      trackers.push(tracker);
    });
    return trackers;
  }

  function normalizeTrackingConfig(raw, fallback) {
    const data = isPlainObject(raw) ? raw : {};
    const base = isPlainObject(fallback) ? fallback : {};
    const source = Array.isArray(data.metrics) ? data.metrics : base.metrics;
    const metrics = [];
    for (const item of Array.isArray(source) ? source : []) {
      if (!isPlainObject(item)) continue;
      const name = text(item.name);
      const unit = text(item.unit);
      const target = toNumber(item.target);
      if (!name && !unit && !target) continue;
      metrics.push({ name: name || "Goal", unit, target: Math.max(0, target) });
    }
    let checkmark = data.checkmark;
    if (!given(checkmark)) checkmark = base.checkmark;
    if (!given(checkmark)) checkmark = metrics.length ? base.tracking_type !== "measure" : true;
    const config = {
      checkmark: metrics.length ? Boolean(checkmark) : true,
      metrics,
      submission_types: submissionTypes({
        submission_types: "submission_types" in data ? data.submission_types : base.submission_types,
        enable_submission: "enable_submission" in data ? data.enable_submission : base.enable_submission,
      }),
    };
    const trackers = habitTrackers("trackers" in data ? data.trackers : base.trackers);
    if (trackers.length) config.trackers = trackers;
    return config;
  }

  function normalizeHabitIcon(raw) {
    const icon = text(raw);
    return icon ? clip(icon, 8) : "↻";
  }

  function normalizeEntityReward(raw) {
    let parsed = raw;
    if (typeof raw === "string") {
      try {
        parsed = JSON.parse(raw);
      } catch (_) {
        parsed = null;
      }
    }
    if (!isPlainObject(parsed)) return null;
    const title = text(parsed.title);
    if (!title) return null;
    const elements = [];
    for (const item of Array.isArray(parsed.elements) ? parsed.elements : []) {
      if (!isPlainObject(item)) continue;
      const kind = text(item.type).toLowerCase();
      const url = text(item.url);
      if (kind === "link" && url) elements.push({ type: "link", title: text(item.title) || url, url });
      else if (kind === "photo" && url) elements.push({ type: "photo", url, title: text(item.title) });
      else if (kind === "note") {
        const content = text(item.content || item.title);
        if (content) elements.push({ type: "note", content });
      } else if (["file", "document", "pdf"].includes(kind) && url) {
        elements.push({ type: "file", url, title: text(item.title) || basename(url) || "File" });
      }
    }
    const reward = { title, elements };
    const streak = strictInt(parsed.target_streak);
    if (streak !== null) reward.target_streak = Math.max(1, streak);
    const rewardId = strictInt(parsed.reward_id);
    if (rewardId !== null) reward.reward_id = rewardId;
    return reward;
  }

  function normalizeHabitExtra(raw, today) {
    const data = isPlainObject(raw) ? raw : {};
    const frequency = HABIT_FREQUENCIES.includes(data.frequency_type) ? data.frequency_type : "weekly";
    let trackingConfig = normalizeTrackingConfig(data.tracking_config, data);
    if (!("tracking_config" in data) && !Array.isArray(data.metrics)) {
      // Legacy rows: derive trackers from tracking_type / measure_* / submission_types.
      const tracking = HABIT_TRACKING.includes(data.tracking_type) ? data.tracking_type : "boolean";
      const legacyMetrics = habitMetrics({
        ...data,
        tracking_type: tracking,
        measure_unit: text(data.measure_unit),
        measure_target: toNumber(data.measure_target),
      });
      trackingConfig = normalizeTrackingConfig({
        checkmark: tracking !== "measure" || !legacyMetrics.length,
        metrics: tracking === "measure" ? legacyMetrics : [],
        submission_types: data.submission_types,
        enable_submission: data.enable_submission,
      }, data);
    }
    const metrics = trackingConfig.metrics;
    const history = habitHistory(data.history);
    for (const entry of Object.values(history)) {
      if (metrics.length && !Object.keys(entry.values).length && entry.value) entry.values = { [metrics[0].name]: entry.value };
      if (metrics.length) entry.value = toNumber(entry.values[metrics[0].name] || entry.value);
    }
    const extra = {
      icon: normalizeHabitIcon(data.icon),
      frequency_type: frequency,
      target_days: habitDays(data.target_days, frequency),
      time_of_day: HABIT_TIMES.includes(data.time_of_day) ? data.time_of_day : "Any Time",
      scheduled_time: data.scheduled_time ? cleanDueTime(String(data.scheduled_time)) : null,
      tracking_type: metrics.length ? "measure" : "boolean",
      measure_unit: metrics.length ? metrics[0].unit : text(data.measure_unit),
      measure_target: metrics.length ? toNumber(metrics[0].target) : 0,
      metrics,
      tracking_config: trackingConfig,
      history,
      current_streak: 0,
      submission_types: trackingConfig.submission_types,
      enable_submission: trackingConfig.submission_types.length > 0,
      vault_folder: text(data.vault_folder) || null,
      reward: normalizeEntityReward(data.reward),
    };
    if (Array.isArray(data.blocks) && data.blocks.length) extra.blocks = data.blocks.filter(isPlainObject);
    extra.current_streak = computeHabitStreak(extra, today);
    return extra;
  }

  function habitTodayStatus(extra, today = localToday()) {
    const key = dayKey(today);
    const entry = (extra.history || {})[key] || { completed: false, value: 0, values: {} };
    return {
      date: key,
      scheduled: habitScheduled(extra, today),
      completed: Boolean(entry.completed),
      value: toNumber(entry.value),
      values: entry.values || {},
      met: habitMet(extra, entry),
      time: habitClock(extra),
    };
  }

  function isImageUrl(url) {
    return /\.(png|jpe?g|gif|webp)$/.test(String(url || "").split("?")[0].toLowerCase());
  }

  function habitPhotoPair(extra) {
    const shots = [];
    for (const [day, entry] of Object.entries(extra.history || {})) {
      if (!isPlainObject(entry)) continue;
      let url = entryPhotos(entry).find(isImageUrl) || "";
      if (!url) {
        url = text(entry.attachment_url);
        if (url && !isImageUrl(url)) url = "";
      }
      if (url) shots.push([day, url]);
    }
    if (!shots.length) return null;
    shots.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    const [firstDay, firstUrl] = shots[0];
    const [lastDay, lastUrl] = shots[shots.length - 1];
    const first = parseDayKey(firstDay);
    const last = parseDayKey(lastDay);
    return {
      first: { date: firstDay, url: firstUrl },
      latest: { date: lastDay, url: lastUrl },
      days_elapsed: first && last ? Math.round((last - first) / 86400000) : 0,
      ready: shots.length >= 2 && firstUrl !== lastUrl,
    };
  }

  function habitLifecycle(raw) {
    const value = String(raw || "active").trim().toLowerCase();
    return HABIT_STATUSES.includes(value) ? value : "active";
  }

  function serializeHabitFields(data, row) {
    const extra = normalizeHabitExtra(isPlainObject(row.extra_data) ? row.extra_data : {});
    data.migration_history = [{ action: "created", type: "habit", timestamp: hhmmOf(row.created_at) }];
    extra.migration_history = data.migration_history;
    data.extra_data = extra;
    data.today = habitTodayStatus(extra);
    data.current_streak = extra.current_streak || 0;
    data.habit_status = habitLifecycle(row.habit_status);
    data.graduated_at = row.graduated_at || null;
    data.photo_pair = habitPhotoPair(extra);
    data.reward = extra.reward;
    data.tracking_config = extra.tracking_config;
    data.icon = extra.icon;
    return data;
  }

  async function requireHabit(id) {
    const row = await requireSpark(id);
    if (row.item_type !== "habit") throw new ApiError(400, "Only habits can be logged here");
    return serializeSpark(row);
  }

  async function saveHabitExtra(id, extra, changes = {}) {
    const stored = { ...extra, current_streak: computeHabitStreak(extra) };
    delete stored.migration_history;
    const row = await run(client.from("sparks").update({
      ...changes,
      extra_data: stored,
      is_done: habitTodayStatus(stored).met ? 1 : 0,
    }).eq("id", id).select("*").single());
    return serializeSpark(row);
  }

  function habitWriteFields(body, withDefaults) {
    const fields = withDefaults ? { ...HABIT_WRITE_DEFAULTS } : {};
    for (const key of Object.keys(HABIT_WRITE_DEFAULTS)) {
      if (key in body) fields[key] = body[key];
    }
    fields.title = body.title;
    return fields;
  }

  async function listHabits(status, includeArchived) {
    const rows = await run(client.from("sparks").select("*")
      .eq("status", "in_cloud").eq("item_type", "habit")
      .order("updated_at", { ascending: false }));
    const habits = rows.map(serializeSpark);
    const wanted = text(status).toLowerCase();
    if (HABIT_STATUSES.includes(wanted)) return habits.filter((habit) => habit.habit_status === wanted);
    if (wanted === "all" || includeArchived) return habits;
    return habits.filter((habit) => habit.habit_status === "active");
  }

  function clampHabitRange(range) {
    const value = text(range).toLowerCase();
    if (Object.prototype.hasOwnProperty.call(HABIT_MATRIX_ALIASES, value)) return HABIT_MATRIX_ALIASES[value];
    const number = Number(value);
    if (!value || !Number.isFinite(number)) return 30;
    const days = Math.trunc(number);
    return HABIT_MATRIX_RANGES.reduce((best, option) => (Math.abs(option - days) < Math.abs(best - days) ? option : best));
  }

  function entryHasSubmission(entry) {
    if (!entry) return false;
    return Boolean(text(entry.note) || entry.photos?.length || entry.attachment_url || entry.links?.length || entry.link || entry.files?.length);
  }

  async function habitMatrix(range, status) {
    const days = clampHabitRange(range);
    const today = localToday();
    const dates = Array.from({ length: days }, (_, index) => shiftDays(today, index - (days - 1)));
    const keys = dates.map(dayKey);
    const habits = await listHabits(status, false);
    for (const habit of habits) {
      const extra = habit.extra_data;
      const history = extra.history || {};
      const config = habit.tracking_config || extra.tracking_config || {};
      habit.matrix_range = days;
      habit.matrix_dates = keys;
      habit.matrix_cells = dates.map((day, index) => ({
        date: keys[index],
        scheduled: habitScheduled(extra, day),
        completed: habitMet(extra, history[keys[index]]),
        has_submission: entryHasSubmission(history[keys[index]]),
      }));
      habit.tracker_count = (config.metrics || []).length + (config.checkmark ? 1 : 0);
    }
    return habits;
  }

  function listHabitsRoute(query) {
    const status = query.get("status");
    const includeArchived = ["1", "true", "yes", "on"].includes(text(query.get("include_archived")).toLowerCase());
    const range = query.get("range");
    if (range) return habitMatrix(range, includeArchived && !status ? "all" : status);
    return listHabits(status, includeArchived);
  }

  async function createHabit(body) {
    const title = requireTitle(body);
    const fields = habitWriteFields(body, true);
    const notes = given(fields.notes) ? fields.notes : fields.raw_content;
    const extra = normalizeHabitExtra(fields);
    if (!extra.target_days.length) throw new ApiError(400, "Choose at least one day");
    const row = await run(client.from("sparks").insert({
      title,
      raw_content: text(notes) || null,
      status: "in_cloud",
      item_type: "habit",
      is_done: habitTodayStatus(extra).met ? 1 : 0,
      assignee: "Me",
      extra_data: extra,
      habit_status: "active",
    }).select("*").single());
    return serializeSpark(row);
  }

  async function updateHabit(id, body) {
    const title = requireTitle(body);
    const fields = habitWriteFields(body, false);
    if ("notes" in fields && !("raw_content" in fields)) fields.raw_content = fields.notes;
    const current = await requireHabit(id);
    const merged = { ...current.extra_data };
    for (const key of HABIT_EXTRA_KEYS) {
      if (given(fields[key])) merged[key] = fields[key];
    }
    const extra = normalizeHabitExtra(merged);
    if (!extra.target_days.length) throw new ApiError(400, "Choose at least one day");
    const notes = "raw_content" in fields ? text(fields.raw_content) || null : current.raw_content;
    return saveHabitExtra(id, extra, { title, raw_content: notes });
  }

  async function setHabitStatus(id, status) {
    const current = await requireHabit(id);
    const wanted = text(status).toLowerCase();
    if (!HABIT_STATUSES.includes(wanted)) throw new ApiError(400, "status must be active, graduated, paused, or archived");
    const graduatedAt = current.graduated_at || (wanted === "graduated" ? new Date().toISOString() : null);
    const row = await run(client.from("sparks").update({ habit_status: wanted, graduated_at: graduatedAt })
      .eq("id", id).select("*").single());
    return { ...serializeSpark(row), unlocked_rewards: [] };
  }

  async function deleteHabit(id) {
    await requireHabit(id);
    await run(client.from("sparks").delete().eq("id", id).eq("item_type", "habit"));
    return { ok: true, id };
  }

  function habitLogFields(body) {
    if (typeof body.date !== "string") throw new ApiError(422, "date is required");
    const fields = {};
    for (const key of HABIT_LOG_KEYS) {
      if (key in body) fields[key] = body[key];
    }
    if (fields.reflection_html && !fields.note) fields.note = fields.reflection_html;
    if (given(fields.measured_value) && !given(fields.value)) fields.value = fields.measured_value;
    return fields;
  }

  async function logHabit(id, logDate, completed, value, values, extras) {
    const current = await requireHabit(id);
    if (current.habit_status !== "active") throw new ApiError(400, "Only active habits can be logged");
    const extra = normalizeHabitExtra(current.extra_data);
    const key = cleanDueDate(logDate);
    if (!key) throw new ApiError(400, "date is required");
    const history = { ...extra.history };
    const entry = { ...(history[key] || { completed: false, value: 0, values: {} }) };
    const metricVals = { ...(entry.values || {}) };
    const metrics = extra.metrics || [];
    if (given(value)) {
      const amount = Number(value);
      if (!Number.isFinite(amount)) throw new ApiError(400, "value must be a number");
      entry.value = Math.max(0, amount);
      if (metrics.length) metricVals[metrics[0].name] = entry.value;
    }
    if (given(values)) {
      if (!isPlainObject(values)) throw new ApiError(400, "values must be an object");
      for (const [name, raw] of Object.entries(values)) {
        const amount = Number(raw || 0);
        if (!Number.isFinite(amount)) throw new ApiError(400, "metric values must be numbers");
        metricVals[String(name)] = Math.max(0, amount);
      }
    }
    entry.values = metricVals;
    if (metrics.length) entry.value = toNumber(metricVals[metrics[0].name] || entry.value);
    if (extra.tracking_type === "measure" && metrics.length) {
      entry.completed = given(completed) ? Boolean(completed) : metricsMet(metrics, metricVals);
    } else {
      entry.completed = given(completed) ? Boolean(completed) : !entry.completed;
      entry.value = entry.completed ? 1 : 0;
    }

    const saved = {
      completed: Boolean(entry.completed),
      value: toNumber(entry.value),
      values: metricVals,
      note: text(entry.note),
      link: text(entry.link),
      links: entryLinks(entry),
      files: entryFiles(entry),
      attachment_url: text(entry.attachment_url),
      photos: entryPhotos(entry),
      measured_value: entry.measured_value ?? null,
      measured_unit: entry.measured_unit ?? null,
      target_value: entry.target_value ?? null,
      ...entryReferenceIds(entry),
      logged_at: text(entry.logged_at) || null,
    };
    for (const field of ["note", "link", "attachment_url"]) {
      if (field in extras) saved[field] = text(extras[field]);
    }
    if (given(extras.measured_unit)) saved.measured_unit = text(extras.measured_unit) || null;
    for (const field of ["measured_value", "target_value"]) {
      const number = optionalNumber(extras[field]);
      if (number !== null) saved[field] = number;
    }
    if (extras.logged_at) saved.logged_at = text(extras.logged_at);
    if (given(saved.measured_value) && !Object.keys(metricVals).length && !metrics.length) saved.value = toNumber(saved.measured_value);
    if ("photos" in extras) {
      if (Array.isArray(extras.photos)) {
        saved.photos = extras.photos
          .map((item) => text(isPlainObject(item) ? item.url : item))
          .filter((url) => url && !url.startsWith("blob:"));
      }
      if (saved.photos.length && !saved.attachment_url) saved.attachment_url = saved.photos[0];
      else if (saved.attachment_url && !saved.photos.includes(saved.attachment_url)) saved.photos = [saved.attachment_url, ...saved.photos];
    } else {
      saved.photos = entryPhotos(saved);
      if (saved.photos.length && !saved.attachment_url) saved.attachment_url = saved.photos[0];
    }
    if ("links" in extras) {
      saved.links = entryLinks({ links: extras.links, link: extras.link || saved.link });
      if (saved.links.length && !saved.link) saved.link = saved.links[0].url;
    } else {
      saved.links = entryLinks(saved);
    }
    saved.files = "files" in extras ? entryFiles({ files: extras.files }) : entryFiles(saved);
    history[key] = saved;

    extra.history = history;
    const habit = await saveHabitExtra(id, normalizeHabitExtra(extra));
    habit.unlocked_rewards = [];
    return habit;
  }

  function logHabitRoute(id, body) {
    const fields = habitLogFields(body);
    return logHabit(id, fields.date, fields.completed, fields.value, fields.values, fields);
  }

  function habitValueText(value) {
    const number = Number(value || 0);
    return Number.isFinite(number) ? String(number) : String(value);
  }

  function habitCheckInSummary(habit, entry) {
    const config = habit.tracking_config || habit.extra_data.tracking_config || {};
    const parts = [];
    if ("checkmark" in config ? config.checkmark : true) parts.push(entry.completed ? "✓ Done" : "✗ Not done");
    const values = entry.values || {};
    for (const metric of config.metrics || []) {
      const name = text(metric.name);
      if (!name || !(name in values)) continue;
      let unit = text(metric.unit);
      if (unit.includes("|")) unit = "";
      parts.push(`${name} ${habitValueText(values[name])}${unit ? ` ${unit}` : ""}`);
    }
    const notePlain = stripTags(entry.note);
    const excerpt = notePlain.slice(0, 80) + (notePlain.length > 80 ? "…" : "");
    if (excerpt) parts.push(`“${excerpt}”`);
    const summary = parts.join(" · ") || (entry.completed ? "Done" : "Logged");
    let items = parts.map((part) => `<li>${escapeHtml(part)}</li>`).join("");
    const photoCount = (entry.photos || []).length;
    if (photoCount) items += `<li>${photoCount} photo${photoCount !== 1 ? "s" : ""}</li>`;
    return [summary, `<p><strong>${escapeHtml(habit.title || "Habit")}</strong></p><ul>${items}</ul>`];
  }

  function habitTrackerBlock(habitId, day, habit, entry) {
    const extra = habit.extra_data || {};
    const config = habit.tracking_config || extra.tracking_config || {};
    const trackers = (config.trackers || []).filter(isPlainObject).map((tracker) => {
      const picked = {};
      for (const key of TRACKER_SNAPSHOT_KEYS) {
        if (given(tracker[key]) && tracker[key] !== "") picked[key] = tracker[key];
      }
      return picked;
    });
    const photos = (entry.photos || []).map((item) => text(typeof item === "string" ? item : item?.url)).filter(Boolean);
    const notePlain = decodeEntities(String(entry.note || "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ")).trim();
    return {
      id: `tracker-${habitId}-${day}`,
      type: "tracker_report",
      habit_id: habitId,
      date: day,
      snapshot: {
        title: String(habit.title || "Habit"),
        icon: String(habit.icon || extra.icon || ""),
        trackers,
        metrics: extra.metrics?.length ? extra.metrics : config.metrics || [],
        submission_types: config.submission_types || [],
        entry: {
          completed: Boolean(entry.completed),
          value: entry.value ?? null,
          values: isPlainObject(entry.values) ? entry.values : {},
          photos,
          attachment_url: String(entry.attachment_url || ""),
          note: notePlain.slice(0, 280),
        },
      },
    };
  }

  function isAutoHabitNote(value) {
    return AUTO_HABIT_NOTE.test(String(value ?? ""));
  }

  // Tracker Report goes first; the auto-generated summary note it replaces is dropped, user blocks stay.
  function withTrackerReport(extra, block) {
    const kept = (extra.blocks || []).filter((row) => isPlainObject(row)
      && !["tracker_report", "tracker-report"].includes(String(row.type || ""))
      && !(["note", "rich_note", "rich-note"].includes(String(row.type || "")) && isAutoHabitNote(row.html)));
    const out = { ...extra, blocks: [block, ...kept] };
    if (isAutoHabitNote(extra.notes) || isAutoHabitNote(extra.rich_notes)) {
      out.notes = "";
      out.rich_notes = "";
    }
    return out;
  }

  // Check-ins also write (or refresh) that day's Log entry and hand it back to the page.
  async function recordHabitLogEntry(habitId, key, habit, entry) {
    const [summary, notesHtml] = habitCheckInSummary(habit, entry);
    const title = clip(`:: Habit — ${habit.title || "Habit"}: ${summary}`, 240);
    const plain = stripTags(notesHtml);
    const report = habitTrackerBlock(habitId, key, habit, entry);
    const candidates = await run(client.from("sparks").select("*")
      .eq("item_type", "task").eq("entry_type", "log").eq("due_date", key)
      .eq("extra_data->>habit_id", String(habitId)).order("id"));
    const existing = candidates.find((row) => String(row.extra_data?.habit_log_date || key) === key);
    let row;
    if (existing) {
      const taskExtra = normalizeTaskExtra(withTrackerReport(parseExtra(existing.extra_data), report));
      row = await run(client.from("sparks").update({
        title, raw_content: plain, notes: taskExtra.notes || null, extra_data: taskExtra,
      }).eq("id", existing.id).select("*").single());
    } else {
      const taskExtra = normalizeTaskExtra({
        blocks: [report],
        migration_history: birthHistory("log"),
        habit_id: habitId,
        habit_log_date: key,
      });
      row = await run(client.from("sparks").insert({
        title,
        raw_content: plain,
        status: "in_cloud",
        item_type: "task",
        is_done: 0,
        assignee: "Me",
        extra_data: taskExtra,
        due_date: key,
        end_date: key,
        notes: taskExtra.notes || null,
        is_routine: 0,
        recurrence_days: "[]",
        task_status: "pending",
        postponed_count: 0,
        is_parked: 0,
        entry_type: "log",
        is_theme_of_day: 0,
        is_all_day: 0,
        is_multiday: 0,
      }).select("*").single());
    }
    const logEntry = serializeSpark(row);
    logEntry.start_date = logEntry.start_date || key;
    return logEntry;
  }

  async function checkInHabit(id, body) {
    const submission = habitLogFields(body);
    const key = cleanDueDate(submission.date);
    if (!key) throw new ApiError(400, "date is required");
    const completed = given(submission.completed) ? Boolean(submission.completed) : true;
    const habit = await logHabit(id, key, completed, submission.value, submission.values, submission);
    const entry = (habit.extra_data.history || {})[key] || {};
    let logEntry = null;
    try {
      logEntry = await recordHabitLogEntry(id, key, habit, entry);
    } catch (err) {
      console.warn("Tracker check-in saved, but its Log entry was not:", err?.message || err);
    }
    return { habit, log_entry: logEntry };
  }

  /* ---------- Log and Time (tasks, events, log entries) ---------- */

  const ENTRY_TYPES = ["task", "event", "log"];
  const EVENT_ACCENT_COLORS = ["sage", "cloud", "plum", "coral", "gold"];
  const EVENT_DEFAULT_ACCENT = "plum";
  const EVENT_ACCENT_ALIASES = {
    lavender: "plum", violet: "plum", purple: "plum", sky: "cloud", blue: "cloud",
    amber: "gold", yellow: "gold", rose: "coral", pink: "coral", mint: "sage", emerald: "sage",
  };
  const TASK_STATUSES = ["pending", "completed", "cannot_done", "postponed", "dropped"];
  const DROP_REASON_LABELS = {
    blocked: "Blocked by dependency",
    materials: "Out of materials",
    energy: "Energy / Time constraint",
    deprioritized: "Deprioritized / No longer relevant",
    custom: "Custom",
  };
  const DROP_REASON_ALIASES = {
    "blocked by dependency": "blocked",
    "out of materials": "materials",
    "energy / time constraint": "energy",
    "energy/time constraint": "energy",
    "deprioritized / no longer relevant": "deprioritized",
    "no longer relevant": "deprioritized",
  };
  const LOG_STATUSES = ["open", "scheduled", "migrated", "parked", "completed", "completed_early", "dropped", "attended", "canceled"];
  const ACTIVE_SCHEDULE_LOG_STATUSES = ["scheduled", "open"];
  const MEDIA_BLOCK_TYPES = ["file", "album", "audio", "video", "scrapboard"];
  const NOTE_BLOCK_TYPES = ["note", "rich_note", "rich-note"];
  const TRUE_FLAGS = [1, true, "1", "true"];
  const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

  // Python truthiness: empty lists and objects are false.
  function truthy(value) {
    if (Array.isArray(value)) return value.length > 0;
    if (isPlainObject(value)) return Object.keys(value).length > 0;
    return Boolean(value);
  }

  function has(object, key) {
    return Object.prototype.hasOwnProperty.call(object, key);
  }

  function present(value) {
    return given(value) && value !== "";
  }

  // Python int(): whole numbers and integer strings; anything else is null.
  function pyInt(value) {
    if (typeof value === "boolean") return Number(value);
    return strictInt(value);
  }

  function parseExtra(raw) {
    if (isPlainObject(raw)) return raw;
    if (typeof raw !== "string" || !raw) return {};
    try {
      const parsed = JSON.parse(raw);
      return isPlainObject(parsed) ? parsed : {};
    } catch (_) {
      return {};
    }
  }

  function compareText(a, b) {
    return a < b ? -1 : a > b ? 1 : 0;
  }

  function parseStamp(value) {
    const stamp = String(value ?? "").trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(stamp)) return new Date(`${stamp}T00:00:00`);
    if (!/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(stamp)) return null;
    const date = new Date(stamp.replace(" ", "T"));
    return Number.isNaN(date.getTime()) ? null : date;
  }

  // Port of local_hhmm(): "HH:MM" passes through, timestamps become local wall-clock time.
  function localHhmmOf(value) {
    if (!given(value)) return localHhmm();
    const stamp = String(value).trim();
    if (/^\d{2}:\d{2}$/.test(stamp)) return stamp;
    const parsed = parseStamp(stamp);
    if (parsed) return hhmmOf(parsed);
    const match = /(?<!\d)(\d{2}:\d{2})(?!\d)/.exec(stamp);
    return match ? match[1] : localHhmm();
  }

  // The app reads created_at[:10] as the local calendar day, so task stamps are
  // handed out in local time with their offset rather than as UTC.
  function localIso(value) {
    const date = parseStamp(value);
    if (!date) return value ?? null;
    const offset = -date.getTimezoneOffset();
    const sign = offset >= 0 ? "+" : "-";
    const abs = Math.abs(offset);
    return `${dayKey(date)}T${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`
      + `${sign}${pad2(Math.floor(abs / 60))}:${pad2(abs % 60)}`;
  }

  // Client stamps such as "2026-10-04T09:00:00" are local wall-clock times.
  function storedStamp(value) {
    const date = parseStamp(value);
    return (date || new Date()).toISOString();
  }

  function normalizeEntryType(value, fallback = "task") {
    const raw = text(value).toLowerCase();
    if (ENTRY_TYPES.includes(raw)) return raw;
    return ENTRY_TYPES.includes(fallback) ? fallback : "task";
  }

  function normalizeAccentColor(value) {
    const raw = text(value).toLowerCase();
    if (EVENT_ACCENT_COLORS.includes(raw)) return raw;
    return EVENT_ACCENT_ALIASES[raw] || null;
  }

  function inferEntryTypeFromNotes(notes, rawContent) {
    const body = `${notes || ""}\n${rawContent || ""}`.toLowerCase();
    if (body.includes("bujo:event")) return "event";
    if (body.includes("bujo:log")) return "log";
    if (body.includes("bujo:task") || body.includes("bujo:spark")) return "task";
    return null;
  }

  function normalizeTaskStatus(raw, isDone) {
    const value = text(raw).toLowerCase();
    if (TASK_STATUSES.includes(value)) return value;
    return TRUE_FLAGS.includes(isDone) ? "completed" : "pending";
  }

  function normalizeDropReason(raw) {
    let value = text(raw).toLowerCase();
    if (!value) return null;
    value = DROP_REASON_ALIASES[value] || value;
    return has(DROP_REASON_LABELS, value) ? value : "custom";
  }

  function normalizeRecurrenceDays(raw) {
    let list = raw;
    if (typeof list === "string") {
      try {
        list = JSON.parse(list);
      } catch (_) {
        list = null;
      }
    }
    if (!Array.isArray(list)) return [];
    const days = [];
    for (const item of list) {
      const day = pyInt(item);
      if (day !== null && day >= 0 && day <= 6 && !days.includes(day)) days.push(day);
    }
    return days.sort((a, b) => a - b);
  }

  function clockMinutes(value) {
    const match = /^(\d{1,2}):(\d{1,2})$/.exec(String(value));
    if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) return null;
    return Number(match[1]) * 60 + Number(match[2]);
  }

  function taskTimeWindow(start, end, fallback) {
    const startTime = start || fallback || null;
    const endTime = end || null;
    let label = null;
    let minutes = null;
    if (startTime && endTime) {
      const from = clockMinutes(startTime);
      const to = clockMinutes(endTime);
      if (from === null || to === null) {
        label = `${startTime} → ${endTime}`;
      } else {
        minutes = to - from < 0 ? to - from + 24 * 60 : to - from;
        const hours = Math.floor(minutes / 60);
        const rem = minutes % 60;
        let duration = `${rem} min`;
        if (hours && rem) duration = `${hours}h ${rem}m`;
        else if (hours) duration = hours === 1 ? `${hours} hr` : `${hours} hrs`;
        label = `${startTime} → ${endTime} · ${duration}`;
      }
    } else if (startTime) {
      label = startTime;
    }
    return { start_time: startTime, end_time: endTime, time_label: label, duration_minutes: minutes };
  }

  function sanitizeNoteHtml(raw) {
    return String(raw || "")
      .replace(/<(script|style|iframe|object|embed|link|meta)[^>]*>[\s\S]*?<\/\1>/gi, "")
      .replace(/<(script|style|iframe|object|embed|link|meta)[^>]*\/?>/gi, "")
      .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
      .replace(/javascript:/gi, "")
      .replace(/data:text\/html/gi, "data:blocked")
      .trim();
  }

  function normalizeMigrationHistory(raw, entryType = "task", createdAt = null, ensureBirth = true) {
    const history = [];
    for (const item of Array.isArray(raw) ? raw : []) {
      if (!isPlainObject(item)) continue;
      history.push({
        action: text(item.action) || "created",
        type: text(item.type || entryType || "task").toLowerCase() || "task",
        timestamp: text(item.timestamp) || localHhmmOf(createdAt),
      });
    }
    if (!history.length && ensureBirth) {
      history.push({ action: "created", type: text(entryType || "task").toLowerCase() || "task", timestamp: localHhmmOf(createdAt) });
    }
    return history;
  }

  function birthHistory(entryType, timestamp) {
    return [{ action: "created", type: text(entryType || "task").toLowerCase() || "task", timestamp: timestamp || localHhmm() }];
  }

  function positiveNumber(value) {
    const number = typeof value === "number" || typeof value === "boolean" ? Number(value)
      : typeof value === "string" && value.trim() ? Number(value) : NaN;
    if (!Number.isFinite(number) || number <= 0) return 0;
    return Number.isInteger(number) ? number : Math.round(number * 100) / 100;
  }

  function mediaBlock(row, kind) {
    if (!isPlainObject(row)) return null;
    const type = text(kind || row.type || row.kind).toLowerCase();
    if (!MEDIA_BLOCK_TYPES.includes(type)) return null;
    const id = String(row.id || "");
    const title = text(row.title);
    if (type === "album") {
      const raw = Array.isArray(row.photos) ? row.photos : Array.isArray(row.items) ? row.items : [];
      const photos = [];
      raw.forEach((item, idx) => {
        const photo = typeof item === "string" ? { url: item } : item;
        if (!isPlainObject(photo)) return;
        const url = text(photo.url || photo.src);
        if (!url) return;
        photos.push({ id: String(photo.id || `p${idx}`), url, caption: text(photo.caption), filename: text(photo.filename) });
      });
      if (!photos.length) return null;
      const layout = text(row.layout || "grid").toLowerCase();
      return { id, type: "album", title, layout: ["grid", "carousel"].includes(layout) ? layout : "grid", photos };
    }
    if (type === "scrapboard") {
      const boards = [];
      (Array.isArray(row.boards) ? row.boards : []).forEach((board, idx) => {
        if (!isPlainObject(board)) return;
        const canvas = isPlainObject(board.canvas) ? board.canvas : {};
        const state = { objects: Array.isArray(canvas.objects) ? canvas.objects : [] };
        if (isPlainObject(canvas.background)) state.background = canvas.background;
        boards.push({ id: String(board.id || `sb${idx}`), title: text(board.title), canvas: state });
      });
      if (!boards.length) return null;
      const layout = text(row.layout || "book").toLowerCase();
      return { id, type: "scrapboard", title, layout: ["book", "carousel"].includes(layout) ? layout : "book", boards };
    }
    const url = text(row.url || row.src || row.content);
    if (!url) return null;
    const block = {
      id,
      type,
      url,
      title,
      filename: text(row.filename || row.name),
      bytes: positiveNumber(row.bytes),
      mime: text(row.mime),
    };
    if (type === "audio") {
      block.duration = positiveNumber(row.duration);
      block.recorded = truthy(row.recorded);
    }
    return block;
  }

  function checklistBlock(row) {
    const items = [];
    (Array.isArray(row.items) ? row.items : []).forEach((item, idx) => {
      if (!isPlainObject(item)) return;
      const itemText = text(item.text);
      if (!itemText) return;
      const entry = { id: String(item.id || `i${idx}`), text: itemText, done: truthy(item.done) };
      if (item.html) entry.html = String(item.html);
      items.push(entry);
    });
    return {
      id: String(row.id || ""),
      type: "checklist",
      title: text(row.title || row.label || "Checklist") || "Checklist",
      items,
      expanded: has(row, "expanded") ? truthy(row.expanded) : true,
    };
  }

  function taskPhotoBlock(row, loose) {
    const url = text(row.url || row.src || (loose ? row.photo_url : ""));
    if (!url) return null;
    return {
      id: String(row.id || ""),
      type: "photo",
      url,
      caption: text(row.caption),
      filename: text(row.filename || (loose ? row.name : "")),
      size: text(row.size).toLowerCase() === "expanded" ? "expanded" : "compact",
    };
  }

  function taskLinkBlock(row) {
    const url = text(row.url || row.href);
    if (!url) return null;
    const preview = isPlainObject(row.preview) ? row.preview : null;
    let mode = text(row.display_mode || row.layout || "compact").toLowerCase();
    if (mode !== "compact" && mode !== "card") mode = "compact";
    return {
      id: String(row.id || ""),
      type: "link",
      url,
      title: text(row.title || row.label),
      display_mode: mode,
      preview_image: text(row.preview_image || preview?.image || preview?.thumbnail),
      description: text(row.description || preview?.description),
      preview,
    };
  }

  // `stored` is the write-time cleanup (normalize_task_extra); without it, the
  // lighter read-time pass serialize_spark applies to blocks.
  function taskBlocks(raw, stored) {
    const blocks = [];
    for (const row of Array.isArray(raw) ? raw : []) {
      if (!isPlainObject(row)) continue;
      const type = text(row.type || row.kind).toLowerCase();
      let block = null;
      if (type === "photo") block = taskPhotoBlock(row, stored);
      else if (type === "link") block = taskLinkBlock(row);
      else if (NOTE_BLOCK_TYPES.includes(type)) {
        block = {
          id: String(row.id || ""),
          type: "note",
          title: text(row.title || row.label || "Rich Note") || "Rich Note",
          html: stored ? sanitizeNoteHtml(row.html || row.content || row.notes || "") : String(row.html || row.content || ""),
          expanded: has(row, "expanded") ? truthy(row.expanded) : true,
        };
      } else if (stored && (type === "tracker_report" || type === "tracker-report")) {
        const habitId = pyInt(row.habit_id);
        if (habitId === null) continue;
        const date = cleanDueDate(String(row.date || ""));
        if (!date) continue;
        block = {
          id: String(row.id || `tracker-${habitId}-${date}`),
          type: "tracker_report",
          habit_id: habitId,
          date,
          snapshot: isPlainObject(row.snapshot) ? row.snapshot : {},
        };
      } else if (!stored && type === "tracker_report" && given(row.habit_id) && row.date) {
        block = {
          id: String(row.id || ""),
          type: "tracker_report",
          habit_id: row.habit_id,
          date: String(row.date),
          snapshot: isPlainObject(row.snapshot) ? row.snapshot : {},
        };
      } else if (type === "checklist") block = checklistBlock(row);
      else if (MEDIA_BLOCK_TYPES.includes(type)) block = mediaBlock(row, type);
      if (block) blocks.push(block);
    }
    return blocks;
  }

  function taskTags(raw) {
    const tags = [];
    for (const tag of Array.isArray(raw) ? raw : []) {
      const cleaned = String(tag || "").trim().replace(/^#+/, "");
      if (cleaned && !tags.includes(cleaned)) tags.push(cleaned);
    }
    return tags;
  }

  function normalizeTaskExtra(raw) {
    const data = parseExtra(raw);
    const checklist = [];
    for (const item of Array.isArray(data.checklist) ? data.checklist : []) {
      if (isPlainObject(item)) {
        const itemText = text(item.text);
        if (!itemText) continue;
        checklist.push({ text: itemText, qty: Math.max(1, pyInt(item.qty || 1) ?? 1), done: truthy(item.done) });
      } else {
        const itemText = text(item);
        if (itemText) checklist.push({ text: itemText, qty: 1, done: false });
      }
    }
    const completions = {};
    if (isPlainObject(data.routine_completions)) {
      for (const [key, value] of Object.entries(data.routine_completions)) {
        const day = key ? cleanDueDate(key) : null;
        if (day) completions[day] = truthy(value);
      }
    }
    const notesHtml = sanitizeNoteHtml(present(data.notes) ? data.notes : data.rich_notes || "");
    const out = {
      location: text(data.location),
      with_person: text(data.with_person),
      checklist_mode: ["todo", "shopping"].includes(data.checklist_mode) ? data.checklist_mode : "todo",
      checklist,
      notes: notesHtml,
      rich_notes: notesHtml,
      routine_completions: completions,
      migration_history: normalizeMigrationHistory(data.migration_history, String(data.entry_type_hint || "task"), null, false),
      entities: cleanEntities(data.entities, isPersonOrPlace),
      tags: taskTags(data.tags),
      blocks: taskBlocks(data.blocks, true),
    };
    // Task/Event Log ↔ schedule link flags must survive create/update/serialize.
    const flag = (key) => {
      if (has(data, key)) out[key] = truthy(data[key]);
    };
    const passthrough = (key) => {
      if (present(data[key])) out[key] = data[key];
    };
    const stamp = (key) => {
      const value = text(data[key]);
      if (value) out[key] = value;
    };
    const day = (key) => {
      const value = present(data[key]) ? cleanDueDate(String(data[key])) : null;
      if (value) out[key] = value;
    };
    flag("management_linked");
    const linkedTaskId = data.linked_task_id || data.task_id;
    if (present(linkedTaskId)) {
      out.linked_task_id = linkedTaskId;
      if (present(data.task_id)) out.task_id = data.task_id;
    }
    if (present(data.habit_id)) {
      const habitId = pyInt(data.habit_id);
      if (habitId !== null) out.habit_id = habitId;
      const logDate = text(data.habit_log_date).slice(0, 10);
      if (/^\d{4}-\d{2}-\d{2}$/.test(logDate)) out.habit_log_date = logDate;
      out.is_habit_log = true;
    }
    flag("is_task_log");
    flag("schedule_linked");
    flag("is_event_log");
    if (isPlainObject(data.stream_log_bridge) && Object.keys(data.stream_log_bridge).length) {
      const bridge = data.stream_log_bridge;
      out.stream_log_bridge = { origin: text(bridge.origin) || "stream_log", log_id: present(bridge.log_id) ? bridge.log_id : null };
    }
    stamp("priority");
    const timingMode = text(data.timing_mode).toLowerCase();
    if (["point", "range", "multiday"].includes(timingMode)) out.timing_mode = timingMode;
    stamp("task_title");
    const logStatus = text(data.log_status).toLowerCase();
    if (LOG_STATUSES.includes(logStatus)) out.log_status = logStatus;
    stamp("signifier");
    day("stream_date");
    const streamTime = text(data.stream_time);
    if (streamTime && Array.from(streamTime).length >= 4) out.stream_time = streamTime.slice(0, 5);
    flag("is_active_schedule_log");
    ["active_schedule_log_id", "migrated_from_log_id", "migrated_to_log_id", "parked_task_id", "linked_event_id", "event_id"]
      .forEach(passthrough);
    stamp("event_title");
    const eventStatus = text(data.event_status).toLowerCase();
    if (["pending", "attended", "canceled"].includes(eventStatus)) out.event_status = eventStatus;
    const eventNature = text(data.event_nature || data.nature).toLowerCase();
    if (["commitment", "ambient", "milestone"].includes(eventNature)) out.event_nature = eventNature;
    flag("is_actionable");
    stamp("completed_at");
    flag("completed_early");
    day("completed_on_date");
    passthrough("early_completion_log_id");
    passthrough("retired_schedule_log_id");
    stamp("dropped_at");
    stamp("attended_at");
    stamp("canceled_at");
    const ship = data.ship_link;
    if (isPlainObject(ship) && ["project", "section"].includes(ship.kind) && ship.id) {
      out.ship_link = { kind: ship.kind, id: ship.id, project_id: ship.project_id ?? null, event_id: ship.event_id ?? null };
    }
    return out;
  }

  function serializeTaskFields(data, row) {
    const extra = normalizeTaskExtra(row.extra_data);
    data.extra_data = extra;
    data.tags = taskTags(extra.tags);
    data.entities = cleanEntities(extra.entities, isPersonOrPlace);
    data.blocks = taskBlocks(extra.blocks, false);
    const window = taskTimeWindow(row.start_time, row.end_time, data.due_time);
    data.start_time = window.start_time;
    data.end_time = window.end_time;
    if (!data.due_time && window.start_time) data.due_time = window.start_time;
    data.start_date = data.due_date || null;
    data.end_date = row.end_date || data.due_date || null;
    data.notes = String(extra.notes || extra.rich_notes || "") || String(row.notes || "");
    data.time_label = window.time_label;
    data.duration_minutes = window.duration_minutes;
    data.is_routine = row.is_routine ? 1 : 0;
    data.recurrence_days = normalizeRecurrenceDays(row.recurrence_days);
    const status = normalizeTaskStatus(row.task_status, data.is_done);
    data.task_status = status;
    data.drop_reason = status === "cannot_done" ? normalizeDropReason(row.drop_reason) : null;
    data.drop_reason_label = data.drop_reason ? DROP_REASON_LABELS[data.drop_reason] || "" : "";
    data.drop_note = text(row.drop_note) || null;
    data.postponed_count = Math.max(0, pyInt(row.postponed_count || 0) ?? 0);
    if (status === "completed") data.is_done = 1;
    else if (status === "cannot_done" || status === "dropped") data.is_done = 0;
    data.is_parked = [1, true, "1"].includes(row.is_parked) ? 1 : 0;
    if (data.is_parked) {
      data.due_date = null;
      data.start_date = null;
      data.end_date = null;
    }
    const entryType = normalizeEntryType(row.entry_type || inferEntryTypeFromNotes(data.notes, row.raw_content) || "task");
    data.entry_type = entryType;
    data.is_theme_of_day = [1, true, "1"].includes(row.is_theme_of_day) ? 1 : 0;
    data.accent_color = normalizeAccentColor(row.accent_color);
    data.emoji = text(row.emoji) || null;
    if (entryType === "event" || entryType === "log") {
      data.is_done = 0;
      data.task_status = "pending";
      data.is_parked = 0;
      data.is_routine = 0;
      data.recurrence_days = [];
      if (entryType === "log") {
        data.is_theme_of_day = 0;
        data.end_time = null;
        data.due_time = null;
        data.time_label = "";
        data.duration_minutes = null;
      }
      if (entryType === "event" && !data.accent_color) data.accent_color = EVENT_DEFAULT_ACCENT;
      data.is_all_day = [1, true, "1"].includes(row.is_all_day) ? 1 : 0;
      data.is_multiday = [1, true, "1"].includes(row.is_multiday) ? 1 : 0;
      if (entryType === "event") {
        const startDay = data.due_date || data.start_date;
        const endDay = data.end_date || startDay;
        if (startDay && endDay && endDay > startDay) {
          data.is_multiday = 1;
          data.is_all_day = 1;
        }
        if (data.is_multiday || data.is_all_day) {
          data.start_time = null;
          data.end_time = null;
          data.due_time = null;
          data.duration_minutes = null;
          data.time_label = "";
          if (startDay && endDay && endDay !== startDay) data.time_label = `${startDay} → ${endDay}`;
          else if (data.is_all_day) data.time_label = "All day";
        }
      }
    } else {
      data.is_all_day = 0;
      data.is_multiday = 0;
    }
    data.migration_history = normalizeMigrationHistory(extra.migration_history, normalizeEntryType(data.entry_type), row.created_at, true);
    extra.migration_history = data.migration_history;
    data.created_at = localIso(row.created_at);
    data.updated_at = localIso(row.updated_at);
    return data;
  }

  // A task's project_id / phase_id point at the retired phase workbench, which isn't online;
  // tasks join binder projects through Task / Event blocks instead.
  function annotateTask(task) {
    task.project_title = null;
    task.phase_title = null;
    return task;
  }

  // Request bodies are validated like the FastAPI models (TaskWrite / TaskPatch / TaskSchedule).
  const TASK_FIELD_KINDS = {};
  [
    "title", "due_date", "start_date", "end_date", "due_time", "start_time", "end_time", "routine_date",
    "assignee", "raw_content", "notes", "task_status", "status", "drop_reason", "drop_note", "cannot_reason",
    "cannot_note", "postpone_date", "postpone_time", "phase_id", "location", "with_person", "checklist_mode",
    "rich_notes", "entry_type", "accent_color", "emoji", "timing_mode", "created_at",
  ].forEach((key) => { TASK_FIELD_KINDS[key] = "text"; });
  ["is_routine", "is_done", "is_parked", "is_theme_of_day", "is_all_day", "is_multiday"].forEach((key) => { TASK_FIELD_KINDS[key] = "flag"; });
  ["project_id", "linked_vision_id"].forEach((key) => { TASK_FIELD_KINDS[key] = "int"; });
  ["checklist", "migration_history", "blocks", "entities"].forEach((key) => { TASK_FIELD_KINDS[key] = "list"; });
  TASK_FIELD_KINDS.recurrence_days = "int_list";
  TASK_FIELD_KINDS.tags = "text_list";
  TASK_FIELD_KINDS.extra_data = "object";
  const SCHEDULE_FIELDS = ["date", "due_date", "start_date", "end_date", "start_time", "end_time", "due_time"];
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

  function taskFields(body, partial) {
    const fields = {};
    for (const [key, value] of Object.entries(body)) {
      if (has(TASK_FIELD_KINDS, key)) fields[key] = coerceField(key, TASK_FIELD_KINDS[key], value);
    }
    if (!partial) fields.title = requireTitle(body);
    else if (typeof fields.title === "string" && !fields.title) throw new ApiError(422, "Title is required");
    return fields;
  }

  // One Theme of the Day per date, shared between events and notepads.
  async function clearThemeOfDay(dateKey, exceptId, exceptPadId = null) {
    const key = text(dateKey);
    if (!key) return;
    let query = client.from("sparks").update({ is_theme_of_day: 0 })
      .eq("item_type", "task").eq("entry_type", "event").eq("is_theme_of_day", 1).eq("due_date", key);
    if (given(exceptId)) query = query.neq("id", exceptId);
    await run(query);
    await clearNotepadThemes(key, exceptPadId);
  }

  function safeDay(value) {
    if (!present(value)) return null;
    try {
      return cleanDueDate(String(value).slice(0, 10));
    } catch (_) {
      const day = String(value).trim().slice(0, 10);
      return day.length === 10 && day[4] === "-" && day[7] === "-" ? day : null;
    }
  }

  function scheduleLogLinkId(extra, kind) {
    if (!isPlainObject(extra)) return null;
    const raw = kind === "event" ? extra.linked_event_id || extra.event_id : extra.linked_task_id || extra.task_id;
    return present(raw) ? String(raw) : null;
  }

  function isActiveScheduleLogExtra(extra) {
    if (!isPlainObject(extra) || !extra.is_active_schedule_log) return false;
    const status = text(extra.log_status || "open").toLowerCase();
    return ACTIVE_SCHEDULE_LOG_STATUSES.includes(status) || !status;
  }

  // One active schedule log per linked calendar item and day.
  async function findActiveScheduleLog(linkedId, streamDate, kind) {
    const link = present(linkedId) ? String(linkedId).trim() : "";
    const day = safeDay(streamDate);
    if (!link || !day) return null;
    const rows = await selectAll(() => client.from("sparks").select("*")
      .eq("item_type", "task").eq("extra_data->>is_active_schedule_log", "true").order("id"));
    return rows.find((row) => {
      const extra = parseExtra(row.extra_data);
      return isActiveScheduleLogExtra(extra)
        && scheduleLogLinkId(extra, kind) === link
        && safeDay(extra.stream_date || row.due_date) === day;
    }) || null;
  }

  async function refreshActiveScheduleLog(row, { title, streamDate, streamTime, extraPatch, createdAt }) {
    let extra = normalizeTaskExtra(parseExtra(row.extra_data));
    if (isPlainObject(extraPatch)) extra = normalizeTaskExtra({ ...extra, ...extraPatch });
    const day = safeDay(streamDate) || safeDay(extra.stream_date || row.due_date);
    const clock = String(streamTime || extra.stream_time || "00:00").trim().slice(0, 5) || "00:00";
    if (day) extra.stream_date = day;
    extra.stream_time = clock;
    extra.is_active_schedule_log = true;
    if (!ACTIVE_SCHEDULE_LOG_STATUSES.includes(text(extra.log_status).toLowerCase())) extra.log_status = "scheduled";
    return run(client.from("sparks").update({
      title,
      due_date: day,
      start_time: null,
      end_time: null,
      due_time: null,
      end_date: day,
      extra_data: extra,
      created_at: createdAt || (day ? storedStamp(`${day}T${clock}:00`) : row.created_at),
    }).eq("id", row.id).select("*").single());
  }

  async function createTask(body) {
    const f = taskFields(body, false);
    const title = f.title;
    const entryType = normalizeEntryType(f.entry_type || "task");
    let dueDate = cleanDueDate(given(f.due_date) ? f.due_date : f.start_date);
    let endDate = cleanDueDate(f.end_date);
    let startTime = cleanDueTime(given(f.start_time) ? f.start_time : f.due_time);
    let endTime = cleanDueTime(f.end_time);
    let dueTime = startTime;
    let isRoutine = f.is_routine ? 1 : 0;
    let recurrenceDays = normalizeRecurrenceDays(f.recurrence_days || []);
    let isParked = f.is_parked ? 1 : 0;
    if (entryType !== "task") {
      isRoutine = 0;
      recurrenceDays = [];
      isParked = 0;
    }
    if (isRoutine && !recurrenceDays.length) throw new ApiError(400, "Pick at least one weekday for a routine");
    if (!isRoutine) {
      recurrenceDays = [];
      if (!given(endDate) && dueDate) endDate = dueDate;
      if (endDate && dueDate && endDate < dueDate) throw new ApiError(400, "end_date must be on or after start_date");
    } else {
      dueDate = null;
      endDate = null;
    }
    if (isParked) {
      dueDate = endDate = startTime = endTime = dueTime = null;
      isRoutine = 0;
      recurrenceDays = [];
    }
    if (entryType === "log") startTime = endTime = dueTime = null;
    const timingMode = text(f.timing_mode).toLowerCase();
    let isAllDay = f.is_all_day ? 1 : 0;
    let isMultiday = f.is_multiday ? 1 : 0;
    if (entryType === "event") {
      if (timingMode === "point") {
        endTime = null;
        isAllDay = isMultiday = 0;
        if (!given(endDate)) endDate = dueDate;
      } else if (timingMode === "range") {
        isAllDay = isMultiday = 0;
        if (!given(endDate)) endDate = dueDate;
      } else if (["multiday", "multi-day", "multi_day"].includes(timingMode)) {
        isAllDay = isMultiday = 1;
        startTime = endTime = dueTime = null;
      }
      if (dueDate && endDate && endDate > dueDate) {
        isAllDay = isMultiday = 1;
        startTime = endTime = dueTime = null;
      }
      if (isAllDay || isMultiday) startTime = endTime = dueTime = null;
    } else {
      isAllDay = isMultiday = 0;
    }
    let taskStatus = normalizeTaskStatus(f.task_status || f.status, f.is_done);
    let dropReason = null;
    let dropNote = null;
    let postponedCount = 0;
    let isDone = 0;
    if (entryType !== "task") {
      taskStatus = "pending";
    } else {
      if (taskStatus === "cannot_done") {
        dropReason = normalizeDropReason(f.drop_reason || f.cannot_reason) || "custom";
        dropNote = text(f.drop_note || f.cannot_note) || null;
      } else if (taskStatus === "postponed") {
        postponedCount = 1;
        taskStatus = "pending";
        if (f.postpone_date) dueDate = cleanDueDate(f.postpone_date);
        if (given(f.postpone_time)) startTime = dueTime = cleanDueTime(f.postpone_time);
      }
      isDone = taskStatus === "completed" ? 1 : 0;
    }
    const accentColor = entryType === "event" ? normalizeAccentColor(f.accent_color) || EVENT_DEFAULT_ACCENT : null;
    const emoji = entryType === "event" ? text(f.emoji) || null : null;
    const isTheme = entryType === "event" && f.is_theme_of_day ? 1 : 0;
    const phaseId = text(f.phase_id) || null;
    const notesHtml = given(f.notes) ? f.notes : f.rich_notes;
    let incomingHistory = f.migration_history;
    if (!given(incomingHistory) && isPlainObject(f.extra_data)) incomingHistory = f.extra_data.migration_history;
    const history = Array.isArray(incomingHistory) && incomingHistory.length ? incomingHistory : birthHistory(entryType, localHhmm());
    const merged = { ...(f.extra_data || {}) };
    const overrides = {
      location: f.location,
      with_person: f.with_person,
      checklist_mode: f.checklist_mode,
      checklist: f.checklist,
      notes: notesHtml,
      rich_notes: notesHtml,
      migration_history: history,
      blocks: f.blocks,
      entities: f.entities,
      tags: f.tags,
    };
    for (const [key, value] of Object.entries(overrides)) {
      if (given(value)) merged[key] = value;
    }
    const extra = normalizeTaskExtra(merged);
    extra.migration_history = history;
    let createdAt = new Date().toISOString();
    if (text(f.created_at)) createdAt = storedStamp(text(f.created_at));
    else if (extra.is_active_schedule_log && extra.stream_date && extra.stream_time) {
      createdAt = storedStamp(`${extra.stream_date}T${String(extra.stream_time).slice(0, 5)}:00`);
    }
    if (present(f.project_id)) throw new ApiError(404, "Project not found");
    if (phaseId) throw new ApiError(400, "phase_id requires project_id");
    if (isTheme && dueDate) await clearThemeOfDay(dueDate, null);
    if (extra.is_active_schedule_log) {
      const streamDay = cleanDueDate(String(extra.stream_date || dueDate || ""));
      const kind = entryType === "event" ? "event" : "task";
      const linkedId = kind === "event" ? extra.linked_event_id || extra.event_id : extra.linked_task_id || extra.task_id;
      if (present(linkedId) && streamDay) {
        const existing = await findActiveScheduleLog(linkedId, streamDay, kind);
        if (existing) {
          const refreshed = await refreshActiveScheduleLog(existing, {
            title,
            streamDate: streamDay,
            streamTime: String(extra.stream_time || dueTime || "00:00").slice(0, 5),
            extraPatch: extra,
            createdAt,
          });
          return annotateTask(serializeSpark(refreshed));
        }
      }
    }
    const row = await run(client.from("sparks").insert({
      title,
      raw_content: text(f.raw_content) || null,
      status: "in_cloud",
      created_at: createdAt,
      item_type: "task",
      is_done: isDone,
      assignee: given(f.assignee) ? f.assignee.trim() : "Me",
      extra_data: extra,
      due_date: isRoutine || isParked ? null : dueDate,
      due_time: dueTime,
      start_time: startTime,
      end_time: endTime,
      end_date: isRoutine || isParked ? null : endDate,
      notes: extra.notes || null,
      is_routine: isRoutine,
      recurrence_days: JSON.stringify(recurrenceDays),
      project_id: null,
      phase_id: null,
      linked_vision_id: f.linked_vision_id ?? null,
      task_status: taskStatus,
      drop_reason: dropReason,
      drop_note: dropNote,
      postponed_count: postponedCount,
      is_parked: isParked,
      entry_type: entryType,
      is_theme_of_day: isTheme,
      accent_color: accentColor,
      emoji,
      is_all_day: isAllDay,
      is_multiday: isMultiday,
    }).select("*").single());
    return annotateTask(serializeSpark(row));
  }

  async function updateTask(id, input) {
    let fields = { ...input };
    const row = await requireSpark(id);
    const current = serializeSpark(row);
    if (current.item_type !== "task") throw new ApiError(400, "Only tasks can be updated here");
    const entryType = normalizeEntryType(has(fields, "entry_type") ? fields.entry_type : current.entry_type, "task");
    let title = current.title;
    if (given(fields.title)) {
      title = text(fields.title);
      if (!title) throw new ApiError(400, "Title is required");
    }
    let isDone = current.is_done;
    if (given(fields.is_done) && entryType === "task") isDone = fields.is_done ? 1 : 0;
    let taskStatus = normalizeTaskStatus(current.task_status, isDone);
    if (entryType === "task" && (has(fields, "task_status") || has(fields, "status"))) {
      const rawStatus = has(fields, "task_status") ? fields.task_status : fields.status;
      taskStatus = normalizeTaskStatus(rawStatus, has(fields, "is_done") ? isDone : null);
    }
    let dropReason = current.drop_reason;
    let dropNote = current.drop_note;
    let postponedCount = Math.max(0, pyInt(current.postponed_count || 0) ?? 0);
    if (entryType !== "task") {
      isDone = 0;
      taskStatus = "pending";
      dropReason = dropNote = null;
    } else if (taskStatus === "completed") {
      isDone = 1;
      dropReason = dropNote = null;
    } else if (taskStatus === "cannot_done") {
      isDone = 0;
      if (has(fields, "drop_reason") || has(fields, "cannot_reason")) {
        dropReason = normalizeDropReason(has(fields, "drop_reason") ? fields.drop_reason : fields.cannot_reason);
      }
      if (!dropReason) dropReason = "custom";
      if (has(fields, "drop_note") || has(fields, "cannot_note")) {
        dropNote = text(has(fields, "drop_note") ? fields.drop_note : fields.cannot_note) || null;
      }
    } else if (taskStatus === "dropped") {
      isDone = 0;
      dropReason = dropNote = null;
    } else if (taskStatus === "postponed") {
      isDone = 0;
      dropReason = dropNote = null;
      postponedCount += 1;
      if (!has(fields, "due_date") && fields.postpone_date) fields = { ...fields, due_date: fields.postpone_date };
      if (!has(fields, "due_time") && has(fields, "postpone_time")) fields = { ...fields, due_time: fields.postpone_time };
      // A postponed task goes back to pending on its new date; only the count records the delay.
      taskStatus = "pending";
    } else {
      if (given(fields.is_done)) taskStatus = isDone ? "completed" : "pending";
      if (taskStatus === "pending") {
        isDone = 0;
        dropReason = dropNote = null;
      }
    }
    let assignee = current.assignee;
    if (given(fields.assignee)) assignee = text(fields.assignee);
    let dueDate = has(fields, "due_date") ? cleanDueDate(fields.due_date) : current.due_date;
    if (has(fields, "start_date") && !has(fields, "due_date")) dueDate = cleanDueDate(fields.start_date);
    let dueTime = has(fields, "due_time") ? cleanDueTime(fields.due_time) : current.due_time;
    if (has(fields, "postpone_date") && !has(fields, "due_date") && !has(fields, "start_date")) dueDate = cleanDueDate(fields.postpone_date);
    if (has(fields, "postpone_time") && !has(fields, "due_time")) dueTime = cleanDueTime(fields.postpone_time);
    let startTime = current.start_time;
    let endTime = current.end_time;
    let endDate = current.end_date;
    if (has(fields, "start_time")) startTime = cleanDueTime(fields.start_time);
    if (has(fields, "end_time")) endTime = cleanDueTime(fields.end_time);
    if (has(fields, "end_date")) endDate = cleanDueDate(fields.end_date);
    if (has(fields, "start_time") || has(fields, "end_time")) dueTime = startTime || dueTime;
    let isRoutine = current.is_routine || 0;
    if (has(fields, "is_routine")) isRoutine = fields.is_routine ? 1 : 0;
    let recurrenceDays = current.recurrence_days || [];
    if (has(fields, "recurrence_days")) recurrenceDays = normalizeRecurrenceDays(fields.recurrence_days);
    if (entryType !== "task") {
      isRoutine = 0;
      recurrenceDays = [];
    }
    if (isRoutine && !recurrenceDays.length) throw new ApiError(400, "Pick at least one weekday for a routine");
    if (isRoutine) {
      dueDate = null;
      endDate = null;
    } else {
      recurrenceDays = [];
      if (!given(endDate) && dueDate) endDate = dueDate;
      if (endDate && dueDate && endDate < dueDate) throw new ApiError(400, "end_date must be on or after start_date");
    }
    let isParked = current.is_parked ? 1 : 0;
    if (has(fields, "is_parked")) isParked = TRUE_FLAGS.includes(fields.is_parked) ? 1 : 0;
    if (entryType !== "task") isParked = 0;
    if (isParked) {
      dueDate = endDate = startTime = endTime = dueTime = null;
      isRoutine = 0;
      recurrenceDays = [];
    } else if ((dueDate || given(fields.due_date) || given(fields.start_date)) && !has(fields, "is_parked")) {
      // Scheduling a parked task takes it out of the parking lot.
      isParked = 0;
    }
    if (entryType === "log") startTime = endTime = dueTime = null;
    let isAllDay = current.is_all_day ? 1 : 0;
    let isMultiday = current.is_multiday ? 1 : 0;
    if (has(fields, "is_all_day")) isAllDay = TRUE_FLAGS.includes(fields.is_all_day) ? 1 : 0;
    if (has(fields, "is_multiday")) isMultiday = TRUE_FLAGS.includes(fields.is_multiday) ? 1 : 0;
    if (entryType === "event" && has(fields, "timing_mode")) {
      const mode = text(fields.timing_mode).toLowerCase();
      if (mode === "point") {
        endTime = null;
        isAllDay = isMultiday = 0;
        if (!given(endDate) || (dueDate && endDate)) endDate = dueDate;
      } else if (mode === "range") {
        isAllDay = isMultiday = 0;
        if (!given(endDate)) endDate = dueDate;
      } else if (["multiday", "multi-day", "multi_day"].includes(mode)) {
        isAllDay = isMultiday = 1;
        startTime = endTime = dueTime = null;
      }
    }
    if (entryType === "event") {
      if (dueDate && endDate && endDate > dueDate) {
        isAllDay = isMultiday = 1;
        startTime = endTime = dueTime = null;
      }
      if (isMultiday || isAllDay) startTime = endTime = dueTime = null;
      if (!endDate && dueDate) endDate = dueDate;
    } else {
      isAllDay = isMultiday = 0;
    }
    let accentColor = normalizeAccentColor(has(fields, "accent_color") ? fields.accent_color : current.accent_color);
    if (entryType === "event" && !accentColor) accentColor = EVENT_DEFAULT_ACCENT;
    if (entryType !== "event") accentColor = null;
    let emoji = has(fields, "emoji") ? text(fields.emoji) || null : current.emoji;
    if (entryType !== "event") emoji = null;
    let isTheme = current.is_theme_of_day ? 1 : 0;
    if (has(fields, "is_theme_of_day")) isTheme = TRUE_FLAGS.includes(fields.is_theme_of_day) ? 1 : 0;
    if (entryType !== "event") isTheme = 0;
    let plainNotes = has(fields, "raw_content") ? text(fields.raw_content) || null : current.raw_content;
    let columnNotes = current.notes;
    const notesGiven = has(fields, "notes") || has(fields, "rich_notes");
    const noteSource = has(fields, "notes") ? fields.notes : fields.rich_notes;
    if (notesGiven) {
      columnNotes = sanitizeNoteHtml(noteSource || "") || null;
      if (!has(fields, "raw_content")) plainNotes = stripTags(columnNotes || "") || null;
    }
    let projectId = current.project_id;
    let phaseId = current.phase_id;
    if (has(fields, "project_id")) projectId = present(fields.project_id) ? fields.project_id : null;
    if (has(fields, "phase_id")) phaseId = text(fields.phase_id) || null;
    if (projectId && phaseId) throw new ApiError(404, "Project not found");
    let linkedVisionId = current.linked_vision_id;
    if (has(fields, "linked_vision_id")) linkedVisionId = present(fields.linked_vision_id) ? fields.linked_vision_id : null;
    let extra = normalizeTaskExtra(current.extra_data);
    if (isPlainObject(fields.extra_data)) extra = normalizeTaskExtra({ ...extra, ...fields.extra_data });
    for (const key of ["location", "with_person", "checklist_mode", "checklist"]) {
      if (has(fields, key)) extra[key] = fields[key];
    }
    for (const key of ["blocks", "entities", "tags"]) {
      if (given(fields[key])) extra[key] = fields[key];
    }
    if (notesGiven) {
      const cleaned = sanitizeNoteHtml(noteSource || "");
      extra.notes = cleaned;
      extra.rich_notes = cleaned;
      columnNotes = cleaned || null;
    }
    if (fields.routine_date) {
      const day = cleanDueDate(fields.routine_date);
      if (!day) throw new ApiError(400, "routine_date must be YYYY-MM-DD");
      const completions = { ...(extra.routine_completions || {}) };
      completions[day] = has(fields, "is_done") ? truthy(fields.is_done) : !completions[day];
      extra.routine_completions = completions;
      isDone = current.is_done;
      taskStatus = normalizeTaskStatus(current.task_status, isDone);
    }
    extra = normalizeTaskExtra(extra);
    if (entryType !== "task") {
      isDone = 0;
      taskStatus = "pending";
      dropReason = dropNote = null;
      isParked = 0;
      isRoutine = 0;
      recurrenceDays = [];
    }
    if (isTheme && dueDate) await clearThemeOfDay(dueDate, id);
    const updated = await run(client.from("sparks").update({
      title,
      is_done: isDone,
      assignee,
      due_date: dueDate,
      due_time: dueTime || startTime,
      start_time: startTime,
      end_time: endTime,
      end_date: endDate,
      notes: given(columnNotes) ? columnNotes : extra.notes || null,
      is_routine: isRoutine,
      recurrence_days: JSON.stringify(recurrenceDays),
      raw_content: plainNotes,
      project_id: projectId,
      phase_id: phaseId,
      linked_vision_id: linkedVisionId,
      task_status: taskStatus,
      drop_reason: dropReason,
      drop_note: dropNote,
      postponed_count: postponedCount,
      is_parked: isParked,
      entry_type: entryType,
      is_theme_of_day: isTheme,
      accent_color: accentColor,
      emoji,
      is_all_day: isAllDay,
      is_multiday: isMultiday,
      extra_data: extra,
    }).eq("id", id).select("*").single());
    if (await shipAfterTaskUpdate(row, updated)) return serializeSpark(await requireSpark(id));
    return serializeSpark(updated);
  }

  function scheduleTask(id, body) {
    const f = {};
    for (const key of SCHEDULE_FIELDS) {
      if (has(body, key)) f[key] = coerceField(key, "text", body[key]);
    }
    const due = f.date || f.due_date || f.start_date;
    if (!due) throw new ApiError(400, "date is required to schedule a parked task");
    const payload = { is_parked: false, due_date: due, start_date: f.start_date || due, end_date: f.end_date || due };
    if (has(f, "start_time")) payload.start_time = f.start_time;
    if (has(f, "end_time")) payload.end_time = f.end_time;
    if (has(f, "due_time")) payload.due_time = f.due_time;
    else if (payload.start_time) payload.due_time = payload.start_time;
    return updateTask(id, payload);
  }

  async function deleteTask(id) {
    const row = await requireSpark(id);
    if (row.item_type !== "task") throw new ApiError(400, "Only tasks can be deleted here");
    await shipBeforeTaskDelete(row);
    await run(client.from("sparks").delete().eq("id", id).eq("item_type", "task"));
    return { status: "success", deleted_id: id, ok: true, id };
  }

  function taskRows() {
    return selectAll(() => client.from("sparks").select("*").eq("status", "in_cloud").eq("item_type", "task").order("id"));
  }

  // Sort key for the Daily Stream: local HH:MM of the item's moment.
  function itemStreamClock(item) {
    const extra = isPlainObject(item.extra_data) ? item.extra_data : parseExtra(item.extra_data);
    for (const candidate of [extra.stream_time, item.start_time, item.due_time, item.created_at, item.updated_at]) {
      const value = text(candidate);
      if (!value) continue;
      if (/^\d{2}:\d{2}$/.test(value.slice(0, 5))) return value.slice(0, 5);
      return localHhmmOf(value);
    }
    return "00:00";
  }

  function sortStream(items) {
    const keyed = items.map((item) => [itemStreamClock(item), Number(item.id) || 0, item]);
    keyed.sort((a, b) => compareText(a[0], b[0]) || a[1] - b[1]);
    return keyed.map((entry) => entry[2]);
  }

  function streamDateOf(item) {
    const extra = isPlainObject(item.extra_data) ? item.extra_data : {};
    return text(extra.stream_date).slice(0, 10);
  }

  // FastAPI's bool query parsing; anything unrecognised is a 422.
  function boolParam(query, name) {
    if (!query.has(name)) return null;
    const word = text(query.get(name)).toLowerCase();
    if (has(FLAG_WORDS, word)) return FLAG_WORDS[word];
    throw new ApiError(422, `${name} must be true or false`);
  }

  const emptyLast = (a, b) => (present(a) ? 0 : 1) - (present(b) ? 0 : 1);

  async function listTasks(query) {
    const parked = boolParam(query, "parked");
    const rows = await taskRows();
    rows.sort((a, b) => emptyLast(a.due_date, b.due_date)
      || compareText(a.due_date || "", b.due_date || "")
      || emptyLast(a.due_time, b.due_time)
      || compareText(a.due_time || "", b.due_time || "")
      || a.id - b.id);
    let tasks = rows.map(serializeSpark);
    if (parked === true) tasks = tasks.filter((task) => task.is_parked);
    else if (parked === false) tasks = tasks.filter((task) => !task.is_parked);
    const date = query.get("date");
    if (date) {
      const day = text(date).slice(0, 10);
      tasks = sortStream(tasks.filter((task) => {
        const streamDate = streamDateOf(task);
        if (streamDate) return streamDate === day;
        return text(task.due_date || task.start_date).slice(0, 10) === day;
      }));
    }
    return tasks.map(annotateTask);
  }

  async function listLogs(query) {
    const day = text(query.get("date")).slice(0, 10);
    let tasks = (await taskRows()).map(serializeSpark);
    let sparks = (await selectAll(() => client.from("sparks").select("*")
      .eq("status", "in_cloud").eq("item_type", "spark").order("id"))).map(serializeSpark);
    if (day) {
      tasks = tasks.filter((row) => {
        const streamDate = streamDateOf(row);
        if (streamDate) return streamDate === day;
        if (["due_date", "start_date"].some((key) => text(row[key]).slice(0, 10) === day)) return true;
        return text(row.created_at).slice(0, 10) === day;
      });
      sparks = sparks.filter((row) => text(row.created_at).slice(0, 10) === day);
    }
    return sortStream([...sparks, ...tasks]);
  }

  async function sparkAction(id, body) {
    if (typeof body.action !== "string") throw new ApiError(422, "action is required");
    const spark = serializeSpark(await requireSpark(id));
    const action = body.action;
    let isDone = spark.is_done;
    let assignee = spark.assignee;
    if (action === "toggle_done") {
      isDone = isDone ? 0 : 1;
    } else if (action === "set_assignee") {
      assignee = given(body.assignee) ? text(body.assignee) : "";
    } else if (action === "toggle_habit_day") {
      return logHabit(id, dayKey(localToday()), undefined, undefined, undefined, {});
    } else if (action === "toggle_node" || action === "add_node") {
      if (spark.item_type === "project") throw new ApiError(503, OFFLINE_DETAIL);
      throw new ApiError(400, action === "toggle_node" ? "Only projects have nested items" : "Only projects can add nested items");
    } else {
      throw new ApiError(400, "Unknown action");
    }
    const extra = { ...spark.extra_data };
    if (spark.item_type === "habit") delete extra.migration_history;
    const row = await run(client.from("sparks").update({ is_done: isDone, assignee, extra_data: extra })
      .eq("id", id).select("*").single());
    return serializeSpark(row);
  }

  function localDayOf(stamp) {
    const date = parseStamp(stamp);
    return date ? dayKey(date) : null;
  }

  function habitRate(habits, start, today) {
    let scheduled = 0;
    let met = 0;
    for (let day = start; dayKey(day) <= dayKey(today); day = shiftDays(day, 1)) {
      for (const habit of habits) {
        const extra = habit.extra_data || {};
        if (!habitScheduled(extra, day)) continue;
        scheduled += 1;
        if (habitMet(extra, (extra.history || {})[dayKey(day)])) met += 1;
      }
    }
    return scheduled ? Math.round((met / scheduled) * 100) : 0;
  }

  // Projects aren't online yet, so the "shipped" counts stay at zero.
  async function momentumStats(today) {
    const habits = (await listHabits("active", false));
    const rate7 = habitRate(habits, shiftDays(today, -6), today);
    const top = Math.max(0, ...habits.map((habit) => Number(habit.current_streak) || 0));
    const doneTasks = (await taskRows()).filter((row) => row.is_done).map(serializeSpark);
    const spans = [
      ["30d", "30 days", shiftDays(today, -29)],
      ["3m", "3 months", shiftDays(today, -89)],
      ["6m", "6 months", shiftDays(today, -179)],
      ["year", "This year", new Date(today.getFullYear(), 0, 1, 12)],
    ];
    const windows = spans.map(([key, label, start]) => ({
      id: key,
      label,
      tasks_done: doneTasks.filter((task) => (localDayOf(task.updated_at) || "") >= dayKey(start)).length,
      projects_shipped: 0,
      project_titles: [],
      habit_rate: habitRate(habits, start, today),
    }));
    return {
      top_streak: top,
      habit_rate_7d: rate7,
      badges: [
        { id: "streak", label: `🔥 ${top}-Day Top Streak` },
        { id: "rate", label: `✨ ${rate7}% habit rate (7d)` },
        { id: "tasks", label: `✅ ${windows[0].tasks_done} Tasks Done (30d)` },
        { id: "projects", label: "⬟ 0 Projects Shipped" },
      ],
      windows,
    };
  }

  async function dashboardToday() {
    const today = localToday();
    const key = dayKey(today);
    const rows = await selectAll(() => client.from("sparks").select("*")
      .eq("status", "in_cloud").eq("item_type", "task").eq("due_date", key).order("id"));
    // SQLite order: is_done, then due_time with blanks first, then title ignoring case.
    rows.sort((a, b) => (a.is_done || 0) - (b.is_done || 0)
      || compareText(a.due_time ?? "", b.due_time ?? "")
      || compareText(String(a.title || "").toLowerCase(), String(b.title || "").toLowerCase()));
    const habits = (await listHabits("active", false))
      .sort((a, b) => compareText(String(a.title || "").toLowerCase(), String(b.title || "").toLowerCase()))
      .filter((habit) => habitScheduled(habit.extra_data, today));
    habits.sort((a, b) => compareText(habitClock(a.extra_data), habitClock(b.extra_data)));
    return {
      date_str: `${WEEKDAYS[today.getDay()]}, ${today.getDate()} ${MONTHS[today.getMonth()]} ${today.getFullYear()}`,
      today_tasks: rows.map(serializeSpark),
      today_routines: habits,
      active_project: null,
      momentum: await momentumStats(today),
      vision_checkpoints: [],
      daily_echo: null,
      weather: null,
    };
  }

  async function calendarMonth(query) {
    const year = strictInt(query.get("year"));
    const month = strictInt(query.get("month"));
    if (year === null || month === null) throw new ApiError(422, "year and month are required");
    if (month < 1 || month > 12) throw new ApiError(400, "month must be 1-12");
    const first = new Date(year, month - 1, 1, 12);
    const last = new Date(year, month, 0, 12);
    const rows = await selectAll(() => client.from("sparks").select("*")
      .eq("item_type", "task").eq("is_routine", 0)
      .gte("due_date", dayKey(first)).lte("due_date", dayKey(last)).order("id"));
    rows.sort((a, b) => compareText(a.due_date || "", b.due_date || "")
      || compareText(a.due_time ?? "", b.due_time ?? "")
      || a.id - b.id);
    const tasks = rows.map(serializeSpark);
    const keys = [];
    for (let day = first; day <= last; day = shiftDays(day, 1)) keys.push(dayKey(day));
    const pads = (await notepadRows()).map(serializeNotepad)
      .filter((pad) => keys.some((key) => notepadActiveOn(pad, key)));
    const days = keys.map((key) => ({
      date: key,
      tasks: tasks.filter((task) => task.due_date === key),
      notepads: pads.filter((pad) => notepadActiveOn(pad, key)).sort(byNotepadDayOrder),
    }));
    return { year, month, start_date: dayKey(first), end_date: dayKey(last), days, notepads: pads };
  }

  /* ---------- Notepads ---------- */

  const NOTEPAD_PAD_TYPES = ["text", "checklist", "contacts"];
  const NOTEPAD_SCOPES = ["day", "week", "month", "phase", "project"];
  const NOTEPAD_THEMES = ["sage", "cloud", "plum", "coral", "gold", "taupe"];
  const NOTEPAD_DEFAULT_THEME = "gold";
  const NOTEPAD_COLOR_ALIASES = {
    "sage-green": "sage", mint: "sage", emerald: "sage", "pastel-mint": "sage",
    "cloud-blue": "cloud", "pastel-cloud-blue": "cloud", sky: "cloud", blue: "cloud",
    "faded-plum": "plum", "pastel-plum": "plum", lavender: "plum", purple: "plum", violet: "plum", iris: "plum", "pastel-iris": "plum",
    "coral-pink": "coral", rose: "coral", pink: "coral", "pastel-rose": "coral",
    "pale-gold": "gold", yellow: "gold", "classic-yellow": "gold", amber: "gold", "pastel-amber": "gold",
    "warm-taupe": "taupe", kraft: "taupe", "warm-kraft": "taupe", stone: "taupe",
  };
  const NOTEPAD_FIELD_KINDS = {
    title: "text", content: "text", items: "list", blocks: "list", pad_type: "text", scope: "text",
    target_date: "text", start_date: "text", end_date: "text", linked_phase_id: "text", phase_id: "text",
    linked_project_id: "int", project_id: "int", color_theme: "text", color: "text",
    is_pinned: "flag", is_theme_of_day: "flag",
  };

  function normalizeNotepadColor(raw) {
    const key = pyText(raw).toLowerCase().replace(/_/g, "-");
    if (NOTEPAD_THEMES.includes(key)) return key;
    return has(NOTEPAD_COLOR_ALIASES, key) ? NOTEPAD_COLOR_ALIASES[key] : NOTEPAD_DEFAULT_THEME;
  }

  function notepadChoice(choices, raw, fallback) {
    const value = pyText(raw).toLowerCase();
    return choices.includes(value) ? value : fallback;
  }

  function isoWeekKey(day) {
    const thursday = shiftDays(day, 3 - ((day.getDay() + 6) % 7));
    const yearStart = new Date(thursday.getFullYear(), 0, 1, 12);
    const week = Math.floor(Math.round((thursday - yearStart) / 86400000) / 7) + 1;
    return `${thursday.getFullYear()}-W${pad2(week)}`;
  }

  function notepadTargetForScope(scope, day = localToday()) {
    if (scope === "day") return dayKey(day);
    if (scope === "week") return isoWeekKey(day);
    if (scope === "month") return `${day.getFullYear()}-${pad2(day.getMonth() + 1)}`;
    return null;
  }

  // [target_date, start_date, end_date] for a pad created today without dates.
  function notepadRangeForScope(scope, day = localToday()) {
    const target = notepadTargetForScope(scope, day);
    if (scope === "day") return [target, target, target];
    if (scope === "week") {
      const monday = shiftDays(day, -((day.getDay() + 6) % 7));
      return [target, dayKey(monday), dayKey(shiftDays(monday, 6))];
    }
    if (scope === "month") {
      const first = new Date(day.getFullYear(), day.getMonth(), 1, 12);
      return [target, dayKey(first), dayKey(new Date(day.getFullYear(), day.getMonth() + 1, 0, 12))];
    }
    return [null, null, null];
  }

  function notepadDay(value, key) {
    if (!present(value)) return null;
    const day = parseDayKey(value);
    if (!day) throw new ApiError(400, `${key} must be YYYY-MM-DD`);
    return dayKey(day);
  }

  function normalizeNotepadItems(raw) {
    let rows = raw;
    if (!Array.isArray(raw)) {
      const source = pyText(raw);
      if (!source) return [];
      try {
        const parsed = JSON.parse(source);
        rows = Array.isArray(parsed) ? parsed : [];
      } catch (_) {
        rows = source.split(/\r\n|\r|\n/).map((line) => line.trim()).filter(Boolean).map((line) => ({ text: line, done: false }));
      }
    }
    const clean = [];
    rows.forEach((item, index) => {
      if (typeof item === "string") {
        if (item.trim()) clean.push({ id: `i_${index + 1}`, text: item.trim(), done: false });
        return;
      }
      if (!isPlainObject(item)) return;
      const label = pyText(pyFalsy(item.text) ? item.title : item.text);
      if (!label) return;
      clean.push({ id: pyFalsy(item.id) ? `i_${index + 1}` : pyStr(item.id), text: label, done: !pyFalsy(item.done) });
    });
    return clean;
  }

  // index.html sends a text pad's blocks packed into content as {"__np_blocks": 1, "blocks": [...]}.
  function notepadBlocksPayload(content) {
    if (typeof content !== "string" || !content.trim()) return null;
    try {
      const parsed = JSON.parse(content);
      if (isPlainObject(parsed) && parsed.__np_blocks === 1) return Array.isArray(parsed.blocks) ? parsed.blocks : [];
    } catch (_) {}
    return null;
  }

  function notepadBodyColumns(padType, f, items) {
    if (padType === "checklist" || padType === "contacts") {
      return { content: JSON.stringify(normalizeNotepadItems(items)), blocks: [] };
    }
    if (Array.isArray(f.blocks)) return { content: "", blocks: f.blocks };
    const content = f.content || "";
    const blocks = notepadBlocksPayload(content);
    return blocks ? { content: "", blocks } : { content, blocks: [] };
  }

  function serializeNotepad(row) {
    const padType = notepadChoice(NOTEPAD_PAD_TYPES, row.pad_type, "text");
    const theme = normalizeNotepadColor(row.color);
    const blocks = Array.isArray(row.blocks) ? row.blocks : [];
    let content = row.content ?? "";
    let items = [];
    if (padType === "checklist" || padType === "contacts") {
      items = normalizeNotepadItems(content);
      content = JSON.stringify(items);
    } else if (blocks.length) {
      content = JSON.stringify({ __np_blocks: 1, blocks });
    }
    return {
      id: row.id,
      title: row.title || "Notepad",
      content,
      items,
      blocks,
      pad_type: padType,
      scope: notepadChoice(NOTEPAD_SCOPES, row.scope, "day"),
      target_date: row.target_date ?? null,
      start_date: row.start_date || null,
      end_date: row.end_date || null,
      linked_phase_id: present(row.linked_phase_id) ? String(row.linked_phase_id) : null,
      linked_project_id: present(row.linked_project_id) ? Number(row.linked_project_id) : null,
      project_title: null,
      phase_title: null,
      color_theme: theme,
      color: theme,
      is_pinned: TRUE_FLAGS.includes(row.is_pinned) ? 1 : 0,
      is_theme_of_day: TRUE_FLAGS.includes(row.is_theme_of_day) ? 1 : 0,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }

  function notepadActiveOn(pad, key) {
    if (pad.start_date) return pad.start_date <= key && (!pad.end_date || key <= pad.end_date);
    if (pad.scope === "phase") return false;
    const target = text(pad.target_date);
    if (pad.scope === "day") return target === key;
    if (pad.scope === "week") return target === isoWeekKey(parseDayKey(key));
    if (pad.scope === "month") return target === key.slice(0, 7);
    return false;
  }

  function notepadDateKey(pad) {
    return text(pad.start_date) || text(pad.target_date) || null;
  }

  const byNotepadFlags = (a, b) => b.is_theme_of_day - a.is_theme_of_day || b.is_pinned - a.is_pinned;
  const byNotepadListOrder = (a, b) => byNotepadFlags(a, b)
    || compareText(b.updated_at || "", a.updated_at || "") || b.id - a.id;
  const byNotepadActiveOrder = (a, b) => byNotepadFlags(a, b)
    || compareText(a.start_date || "", b.start_date || "") || b.id - a.id;
  const byNotepadDayOrder = (a, b) => byNotepadFlags(a, b) || b.id - a.id;

  // Until supabase/09_notepads.sql has been run, reads come back empty so Home and the calendar still load.
  async function notepadRows() {
    try {
      return await selectAll(() => client.from("notepads").select("*").order("id"));
    } catch (err) {
      if (err instanceof ApiError && err.message === NOTEPADS_SQL_HINT) return [];
      throw err;
    }
  }

  const requireNotepad = (id) => requireRow("notepads", id, "Notepad not found");

  async function getNotepad(id) {
    return serializeNotepad(await requireNotepad(id));
  }

  function optionalInt(query, key, detail) {
    const raw = query.get(key);
    if (!present(raw)) return null;
    const number = strictInt(raw);
    if (number === null) throw new ApiError(422, detail);
    return number;
  }

  async function listNotepads(query) {
    const scope = text(query.get("scope")).toLowerCase();
    const target = text(query.get("date"));
    const phaseId = text(query.get("phase_id"));
    const projectId = optionalInt(query, "project_id", "project_id has an invalid value");
    const year = optionalInt(query, "year", "year must be a number");
    const themeOnly = present(query.get("theme_only")) && flagField("theme_only", query.get("theme_only"));
    const pads = (await notepadRows()).map(serializeNotepad).filter((pad) => {
      if (scope && pad.scope !== scope) return false;
      if (target && pad.target_date !== target) return false;
      if (phaseId && pad.linked_phase_id !== phaseId) return false;
      if (projectId !== null && pad.linked_project_id !== projectId) return false;
      if (year !== null && !String(pad.start_date || pad.target_date || "").startsWith(`${year}-`)) return false;
      return !themeOnly || pad.is_theme_of_day === 1;
    });
    return pads.sort(byNotepadListOrder);
  }

  async function listActiveNotepads(dateValue) {
    const key = dayKey(parseDayKey(dateValue) || localToday());
    return (await notepadRows()).map(serializeNotepad)
      .filter((pad) => notepadActiveOn(pad, key)).sort(byNotepadActiveOrder);
  }

  async function themeOfDayNotepad(dateValue) {
    const key = dayKey(parseDayKey(dateValue) || localToday());
    const exact = (pad) => pad.start_date === key || pad.target_date === key;
    const [pad] = (await notepadRows()).map(serializeNotepad)
      .filter((row) => row.is_theme_of_day && (notepadDateKey(row) === key
        || (row.start_date && row.start_date <= key && (!row.end_date || row.end_date >= key))))
      .sort((a, b) => Number(exact(b)) - Number(exact(a)) || b.id - a.id);
    return pad && notepadActiveOn(pad, key) ? pad : null;
  }

  async function clearNotepadThemes(key, exceptId) {
    const { data, error } = await client.from("notepads").select("id, start_date, target_date").eq("is_theme_of_day", 1);
    if (error) {
      if (isMissingTable(error, "notepads")) return;
      throw new ApiError(500, error.message || "Cloud request failed");
    }
    const ids = (data || []).filter((row) => row.id !== exceptId && notepadDateKey(row) === key).map((row) => row.id);
    if (ids.length) await run(client.from("notepads").update({ is_theme_of_day: 0 }).in("id", ids));
  }

  async function applyNotepadTheme(id, enabled, dateKey) {
    if (enabled) await clearThemeOfDay(dateKey, null, id);
    await run(client.from("notepads").update({ is_theme_of_day: enabled ? 1 : 0 }).eq("id", id));
  }

  function notepadThemeDate(startDate, targetDate) {
    return startDate || text(targetDate) || null;
  }

  async function createNotepad(body) {
    const f = modelFields(body, NOTEPAD_FIELD_KINDS);
    const padType = notepadChoice(NOTEPAD_PAD_TYPES, f.pad_type, "text");
    const scope = notepadChoice(NOTEPAD_SCOPES, f.scope, "day");
    let targetDate = f.target_date ?? null;
    let startDate = notepadDay(f.start_date, "start_date");
    let endDate = notepadDay(f.end_date, "end_date");
    if (!startDate && !endDate && scope !== "phase") {
      [targetDate, startDate, endDate] = notepadRangeForScope(scope);
    } else if (!present(targetDate) && scope !== "phase") {
      targetDate = notepadTargetForScope(scope, startDate ? parseDayKey(startDate) : localToday());
    } else {
      targetDate = text(targetDate) || null;
    }
    if (startDate && endDate && endDate < startDate) throw new ApiError(400, "end_date must be on or after start_date");
    const phaseId = pyText(pyFalsy(f.linked_phase_id) ? f.phase_id : f.linked_phase_id) || null;
    if (scope === "phase" && !phaseId) throw new ApiError(400, "Phase notepads need a phase");
    const isTheme = f.is_theme_of_day === true;
    const themeDate = notepadThemeDate(startDate, targetDate);
    if (isTheme && !themeDate) throw new ApiError(400, "Theme of the Day needs a calendar date");
    const row = await run(client.from("notepads").insert({
      title: pyText(f.title) || "Notepad",
      ...notepadBodyColumns(padType, f, given(f.items) ? f.items : f.content),
      pad_type: padType,
      scope,
      target_date: targetDate,
      start_date: startDate,
      end_date: endDate,
      linked_phase_id: phaseId,
      linked_project_id: f.linked_project_id || f.project_id || null,
      color: normalizeNotepadColor(present(f.color_theme) ? f.color_theme : f.color),
      is_pinned: has(f, "is_pinned") && !f.is_pinned ? 0 : 1,
      is_theme_of_day: 0,
    }).select("id").single());
    if (isTheme) await applyNotepadTheme(row.id, true, themeDate);
    return getNotepad(row.id);
  }

  async function updateNotepad(id, body) {
    const f = modelFields(body, NOTEPAD_FIELD_KINDS);
    const current = await getNotepad(id);
    const padType = has(f, "pad_type") ? notepadChoice(NOTEPAD_PAD_TYPES, f.pad_type, current.pad_type) : current.pad_type;
    const targetDate = has(f, "target_date") ? text(f.target_date) || null : current.target_date;
    const startDate = has(f, "start_date") ? notepadDay(f.start_date, "start_date") : current.start_date;
    const endDate = has(f, "end_date") ? notepadDay(f.end_date, "end_date") : current.end_date;
    if (startDate && endDate && endDate < startDate) throw new ApiError(400, "end_date must be on or after start_date");
    const themeTouched = has(f, "is_theme_of_day");
    const isTheme = themeTouched ? f.is_theme_of_day === true : current.is_theme_of_day === 1;
    const themeDate = notepadThemeDate(startDate, targetDate);
    if (themeTouched && isTheme && !themeDate) throw new ApiError(400, "Theme of the Day needs a calendar date");
    const changes = {
      title: has(f, "title") ? pyText(f.title) || current.title : current.title,
      pad_type: padType,
      scope: has(f, "scope") ? notepadChoice(NOTEPAD_SCOPES, f.scope, current.scope) : current.scope,
      target_date: targetDate,
      start_date: startDate,
      end_date: endDate,
      linked_phase_id: has(f, "linked_phase_id") || has(f, "phase_id")
        ? pyText(has(f, "linked_phase_id") ? f.linked_phase_id : f.phase_id) || null
        : current.linked_phase_id,
      linked_project_id: has(f, "linked_project_id") || has(f, "project_id")
        ? (has(f, "linked_project_id") ? f.linked_project_id : f.project_id) ?? null
        : current.linked_project_id,
      color: has(f, "color_theme") || has(f, "color")
        ? normalizeNotepadColor(has(f, "color_theme") ? f.color_theme : f.color)
        : current.color,
      is_pinned: has(f, "is_pinned") ? (f.is_pinned ? 1 : 0) : current.is_pinned,
      is_theme_of_day: !themeTouched && isTheme ? 1 : 0,
    };
    if (padType === "checklist" || padType === "contacts") {
      if (has(f, "items") || has(f, "content")) {
        Object.assign(changes, notepadBodyColumns(padType, f, has(f, "items") ? f.items : f.content));
      }
    } else if (has(f, "content") || has(f, "blocks")) {
      Object.assign(changes, notepadBodyColumns(padType, f));
    }
    await run(client.from("notepads").update(changes).eq("id", id));
    if (themeTouched) await applyNotepadTheme(id, isTheme, themeDate);
    else if (isTheme && themeDate) await clearThemeOfDay(themeDate, null, id);
    return getNotepad(id);
  }

  async function deleteNotepad(id) {
    await requireNotepad(id);
    await run(client.from("notepads").delete().eq("id", id));
    return { ok: true, id };
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

  /* ---------- Projects (binders: projects, sections, lines) ---------- */

  const BINDER_STYLE_FIELDS = ["cover_color", "cover_image", "spine_color"];
  const BINDER_STYLE_SHIP_KEYS = [...BINDER_STYLE_FIELDS, "ship_date"];
  const BINDER_PROJECT_STATUSES = ["active", "graduated"];
  const BINDER_RECORD_BLOCK_TYPE = "project_record";
  const BINDER_SECTION_MAX_BLOCKS = 4;
  const BINDER_SECTION_MAX_COLUMNS = 6;
  const BINDER_COLUMN_MIN_WIDTH = 256;
  const BINDER_COLUMN_MAX_WIDTH = 448;
  const BINDER_TRAY_MAX_COMPARTMENTS = 4;
  const BINDER_TRAY_MAX_PER_COMPARTMENT = 4;
  const BINDER_MAX_SUBSECTIONS = 8;
  const BINDER_HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
  const BINDER_IMAGE_URL = /^(\/uploads\/[A-Za-z0-9._-]+|https?:\/\/[^\s"'()<>\\]+)$/;
  const SHIP_TITLE_PREFIX = "Ship: ";
  const SHIP_TITLE_JOINER = " \u00b7 ";

  // Python truthiness and str(), for fields copied the way database.py copies them.
  function pyFalsy(value) {
    if (Array.isArray(value)) return !value.length;
    if (isPlainObject(value)) return !Object.keys(value).length;
    return value === undefined || value === null || value === false || value === 0 || value === "";
  }

  function pyStr(value) {
    if (value === undefined || value === null) return "None";
    if (typeof value === "boolean") return value ? "True" : "False";
    return String(value);
  }

  // str(value or "").strip()
  function pyText(value) {
    return pyFalsy(value) ? "" : pyStr(value).trim();
  }

  // Python float(): numbers, bools and numeric strings; anything else is null.
  function pyFloat(value) {
    if (typeof value === "boolean") return value ? 1 : 0;
    if (typeof value === "number") return value;
    if (typeof value !== "string") return null;
    const word = value.trim().toLowerCase();
    if (/^[-+]?(inf|infinity)$/.test(word)) return word.startsWith("-") ? -Infinity : Infinity;
    if (/^[-+]?nan$/.test(word)) return NaN;
    return /^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/.test(word) ? Number(word) : null;
  }

  // Python round(): halves go to the even neighbour.
  function roundHalfEven(value) {
    const floor = Math.floor(value);
    const diff = value - floor;
    if (diff !== 0.5) return Math.round(value);
    return floor % 2 === 0 ? floor : floor + 1;
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

  const BINDER_STYLE_SHIP_KINDS = { cover_color: "text", cover_image: "text", spine_color: "text", ship_date: "text" };

  function parseBinderBlocks(raw) {
    if (raw === undefined || raw === null) return [];
    if (Array.isArray(raw)) return raw;
    let parsed = raw;
    if (typeof raw === "string") {
      const source = raw.trim();
      if (!source) return [];
      try {
        parsed = JSON.parse(source);
      } catch (_) {
        return [];
      }
    }
    if (isPlainObject(parsed) && (parsed.__np_blocks === 1 || parsed.__np_blocks === true)) {
      return Array.isArray(parsed.blocks) ? parsed.blocks : [];
    }
    return Array.isArray(parsed) ? parsed : [];
  }

  function dumpBinderBlocks(blocks) {
    if (blocks === undefined || blocks === null) return [];
    if (typeof blocks === "string") {
      const source = blocks.trim();
      if (!source) return [];
      try {
        return JSON.parse(source);
      } catch (_) {
        return [];
      }
    }
    return Array.isArray(blocks) || isPlainObject(blocks) ? blocks : [];
  }

  function cleanBinderStyle(field, value) {
    const style = pyText(value);
    if (!style) return null;
    if (field.endsWith("_image")) {
      if (!BINDER_IMAGE_URL.test(style)) throw new ApiError(400, "Background image must be an uploaded file or an http(s) URL");
      return style;
    }
    if (!BINDER_HEX_COLOR.test(style)) throw new ApiError(400, "Colors must be hex values like #A3B18A");
    return style.toUpperCase();
  }

  function binderStyleChanges(fields) {
    const changes = {};
    for (const key of BINDER_STYLE_FIELDS) {
      if (has(fields, key)) changes[key] = cleanBinderStyle(key, fields[key]);
    }
    return changes;
  }

  function parseBinderTracker(raw) {
    let data = raw;
    if (typeof raw === "string") {
      try {
        data = JSON.parse(raw || "null");
      } catch (_) {
        return null;
      }
    }
    if (!isPlainObject(data)) return null;
    const label = clip(pyText(data.label), 40);
    if (!label) return null;
    let target = data.target === undefined || data.target === null || data.target === "" ? null : pyFloat(data.target);
    if (target !== null && (Number.isNaN(target) || target <= 0 || !Number.isFinite(target))) target = null;
    return { label, unit: clip(pyText(data.unit), 16), target };
  }

  function binderRecordSum(blocks) {
    let total = 0;
    for (const block of parseBinderBlocks(blocks)) {
      if (!isPlainObject(block) || block.type !== BINDER_RECORD_BLOCK_TYPE) continue;
      for (const entry of Array.isArray(block.entries) ? block.entries : []) {
        if (!isPlainObject(entry)) continue;
        const value = pyFloat(entry.value);
        if (value !== null && Number.isFinite(value)) total += value;
      }
    }
    return total;
  }

  // Sum of every Tracker Log entry across a project's sections and columns.
  function binderTrackerTotal(sectionRows) {
    let total = 0;
    for (const row of sectionRows) {
      total += binderRecordSum(row.blocks);
      for (const column of parseBinderBlocks(row.extra_columns)) {
        if (isPlainObject(column)) total += binderRecordSum(column.blocks);
      }
    }
    return Math.round(total * 1e4) / 1e4;
  }

  function clampColumnWidth(value) {
    const number = pyFloat(value);
    if (number === null || !Number.isFinite(number)) return null;
    return Math.max(BINDER_COLUMN_MIN_WIDTH, Math.min(BINDER_COLUMN_MAX_WIDTH, roundHalfEven(number)));
  }

  function iterItems(value) {
    if (Array.isArray(value)) return value;
    if (typeof value === "string") return Array.from(value);
    if (isPlainObject(value)) return Object.keys(value);
    return [];
  }

  function parseTrayCompartments(raw) {
    if (!Array.isArray(raw)) return [];
    const compartments = [];
    const seen = new Set();
    raw.slice(0, BINDER_TRAY_MAX_COMPARTMENTS).forEach((comp, index) => {
      if (!isPlainObject(comp)) return;
      let compId = clip(pyText(comp.id), 40) || `cmp_${index + 1}`;
      if (seen.has(compId)) compId = `${compId}_${index + 1}`;
      seen.add(compId);
      const blockIds = iterItems(pyFalsy(comp.block_ids) ? [] : comp.block_ids)
        .map((id) => pyStr(id).trim())
        .filter(Boolean);
      compartments.push({
        id: compId,
        title: clip(pyText(comp.title), 40),
        block_ids: blockIds.slice(0, BINDER_TRAY_MAX_PER_COMPARTMENT),
      });
    });
    return compartments;
  }

  function parseColumnLayout(raw) {
    let parsed = raw;
    if (typeof raw === "string") {
      try {
        parsed = JSON.parse(raw || "{}");
      } catch (_) {
        parsed = {};
      }
    }
    if (!isPlainObject(parsed) || parsed.mode !== "tray") return {};
    const compartments = parseTrayCompartments(parsed.compartments);
    return compartments.length ? { mode: "tray", compartments } : {};
  }

  function columnBlockCap(layout) {
    const compartments = layout.compartments || [];
    return compartments.length ? BINDER_TRAY_MAX_PER_COMPARTMENT * compartments.length : BINDER_SECTION_MAX_BLOCKS;
  }

  function binderColumnPayload(colId, blocks, width, layout) {
    const parsedLayout = parseColumnLayout(layout);
    const payload = { id: colId, blocks: blocks.slice(0, columnBlockCap(parsedLayout)), ...parsedLayout };
    const clamped = clampColumnWidth(width);
    if (clamped !== null) payload.width = clamped;
    return payload;
  }

  // Columns after the first; the first column lives in the section's `blocks`.
  function parseSectionExtraColumns(raw) {
    let parsed = raw;
    if (typeof raw === "string") {
      try {
        parsed = JSON.parse(raw || "[]");
      } catch (_) {
        parsed = [];
      }
    }
    if (!Array.isArray(parsed)) return [];
    const columns = [];
    parsed.slice(0, BINDER_SECTION_MAX_COLUMNS - 1).forEach((col, index) => {
      if (!isPlainObject(col)) return;
      let colId = pyText(col.id) || `col_${index + 1}`;
      if (colId === "main") colId = `col_${index + 1}`;
      columns.push(binderColumnPayload(colId, parseBinderBlocks(col.blocks), col.width, col));
    });
    return columns;
  }

  function migrateSectionBlocksFromLines(lines) {
    const migrated = [];
    for (const line of lines) {
      if (Array.isArray(line.blocks) && line.blocks.length) {
        for (const block of line.blocks) {
          migrated.push(block);
          if (migrated.length >= 4) return migrated.slice(0, 4);
        }
        continue;
      }
      const content = text(line.content);
      if (content) {
        migrated.push({ id: `migrated_${line.id}`, type: "note", title: "Note", html: `<p>${content}</p>`, content: `<p>${content}</p>` });
        if (migrated.length >= 4) return migrated.slice(0, 4);
      }
    }
    return migrated.slice(0, 4);
  }

  function binderStyleShipPayload(row) {
    const payload = {};
    for (const field of BINDER_STYLE_FIELDS) payload[field] = row[field] || null;
    payload.ship_date = row.ship_date || null;
    payload.ship_event_id = row.ship_event_id ? Number(row.ship_event_id) : null;
    return payload;
  }

  function serializeBinderLine(row) {
    return {
      id: Number(row.id),
      section_id: Number(row.section_id),
      content: text(row.content),
      is_completed: Boolean(row.is_completed),
      blocks: parseBinderBlocks(row.blocks),
      created_at: row.created_at,
    };
  }

  function serializeBinderSection(row, lines = []) {
    let blocks = parseBinderBlocks(row.blocks);
    if (!blocks.length && lines.length) blocks = migrateSectionBlocksFromLines(lines);
    const mainColumn = binderColumnPayload("main", blocks, row.main_width, row.main_layout);
    const columns = [mainColumn, ...parseSectionExtraColumns(row.extra_columns)];
    return {
      id: Number(row.id),
      project_id: Number(row.project_id),
      parent_id: row.parent_id ? Number(row.parent_id) : null,
      section_index: Number(row.section_index),
      title: text(row.title) || `Section ${row.section_index}`,
      created_at: row.created_at,
      blocks: mainColumn.blocks,
      columns,
      lines,
      line_count: lines.length,
      completed_count: lines.filter((line) => line.is_completed).length,
      block_count: columns.reduce((sum, col) => sum + col.blocks.length, 0),
      ...binderStyleShipPayload(row),
    };
  }

  function serializeBinderProject(row, sections = null, stats = null) {
    const payload = {
      id: Number(row.id),
      title: text(row.title) || "Untitled Project",
      description: text(row.description),
      created_at: row.created_at,
      sections: sections || [],
      ...binderStyleShipPayload(row),
      tracker: parseBinderTracker(row.tracker),
      status: BINDER_PROJECT_STATUSES.includes(row.status) ? row.status : "active",
      graduated_at: row.graduated_at || null,
    };
    if (stats) {
      Object.assign(payload, stats);
    } else if (sections) {
      payload.section_count = sections.length;
      payload.lines_total = sections.reduce((sum, s) => sum + Number(s.line_count || s.lines.length), 0);
      payload.lines_completed = sections.reduce((sum, s) => sum + Number(s.completed_count || 0), 0);
    }
    return payload;
  }

  async function requireRow(table, id, detail, columns = "*") {
    const row = await run(client.from(table).select(columns).eq("id", id).maybeSingle());
    if (!row) throw new ApiError(404, detail);
    return row;
  }

  const requireBinderProject = (id, columns) => requireRow("projects", id, "Project not found", columns);
  const requireBinderSection = (id, columns) => requireRow("project_sections", id, "Section not found", columns);
  const requireBinderLine = (id) => requireRow("project_lines", id, "Line not found");

  function projectSectionRows(projectId, columns = "*") {
    return selectAll(() => client.from("project_sections").select(columns).eq("project_id", projectId).order("id"));
  }

  async function linesForSections(sectionIds) {
    if (!sectionIds.length) return [];
    return selectAll(() => client.from("project_lines").select("*").in("section_id", sectionIds)
      .order("created_at").order("id"));
  }

  const bySectionOrder = (a, b) => a.section_index - b.section_index || a.id - b.id;

  async function listBinderProjects() {
    const today = dayKey(localToday());
    const [projects, sections, lines] = await Promise.all([
      selectAll(() => client.from("projects").select("*").order("id")),
      selectAll(() => client.from("project_sections").select("*").order("id")),
      selectAll(() => client.from("project_lines").select("id, section_id, is_completed").order("id")),
    ]);
    projects.sort((a, b) => (Date.parse(b.created_at) || 0) - (Date.parse(a.created_at) || 0) || b.id - a.id);
    return projects.map((row) => {
      const own = sections.filter((section) => section.project_id === row.id);
      const top = own.filter((section) => !section.parent_id).sort(bySectionOrder);
      const ownIds = new Set(own.map((section) => section.id));
      const ownLines = lines.filter((line) => ownIds.has(line.section_id));
      const upcoming = own.map((section) => section.ship_date).filter((day) => day && day >= today).sort();
      return serializeBinderProject(row, null, {
        section_count: top.length,
        lines_total: ownLines.length,
        lines_completed: ownLines.filter((line) => line.is_completed).length,
        section_tabs: top.map((section) => ({
          id: Number(section.id),
          title: text(section.title) || `Section ${section.section_index}`,
          spine_color: section.spine_color || null,
          ship_date: section.ship_date || null,
        })),
        next_section_ship_date: upcoming[0] || null,
        tracker_total: binderTrackerTotal(own),
      });
    });
  }

  async function getBinderProject(id) {
    const row = await requireBinderProject(id);
    const sections = (await projectSectionRows(id)).sort(bySectionOrder);
    const lines = await linesForSections(sections.map((section) => section.id));
    const serialized = sections.map((section) => serializeBinderSection(
      section,
      lines.filter((line) => line.section_id === section.id).map(serializeBinderLine),
    ));
    const payload = serializeBinderProject(row, serialized);
    payload.tracker_total = binderTrackerTotal(sections);
    return payload;
  }

  async function createBinderProject(title, description) {
    const name = text(title);
    if (!name) throw new ApiError(400, "Project title is required");
    const row = await run(client.from("projects").insert({ title: name, description: text(description) })
      .select("id").single());
    // database.py adds the project and its first section in one transaction; undo the project if the section fails.
    try {
      await run(client.from("project_sections").insert({ project_id: row.id, section_index: 1, title: "Section 1" }));
    } catch (err) {
      await client.from("projects").delete().eq("id", row.id);
      throw err;
    }
    return getBinderProject(row.id);
  }

  function binderShipDateChange(row, fields) {
    if (!has(fields, "ship_date")) return null;
    const shipDate = cleanDueDate(fields.ship_date);
    return (row.ship_date || null) === shipDate ? null : { ship_date: shipDate };
  }

  async function updateBinderProject(id, fields) {
    const row = await requireBinderProject(id);
    let title = row.title;
    let description = row.description;
    if (has(fields, "title")) {
      title = text(fields.title);
      if (!title) throw new ApiError(400, "Project title is required");
    }
    if (has(fields, "description")) description = text(fields.description);
    const changes = { title, description, ...binderStyleChanges(fields) };
    if (has(fields, "tracker")) {
      const raw = fields.tracker;
      const tracker = parseBinderTracker(raw);
      if (!pyFalsy(raw) && !tracker) throw new ApiError(400, "A tracker needs a label");
      changes.tracker = tracker;
    }
    if (has(fields, "status")) {
      const status = text(fields.status).toLowerCase();
      if (!BINDER_PROJECT_STATUSES.includes(status)) throw new ApiError(400, "status must be active or graduated");
      if (status !== (row.status || "active")) {
        changes.status = status;
        changes.graduated_at = status === "graduated" ? new Date().toISOString() : null;
      }
    }
    const shipChange = binderShipDateChange(row, fields);
    await run(client.from("projects").update({ ...changes, ...shipChange }).eq("id", id));
    const renamed = title !== row.title;
    if (renamed || shipChange) await syncShipCommitment("project", id);
    if (renamed) {
      const shipping = (await projectSectionRows(id, "id, ship_date")).filter((section) => section.ship_date);
      for (const section of shipping) await syncShipCommitment("section", section.id);
    }
    return getBinderProject(id);
  }

  async function deleteBinderProject(id) {
    const row = await requireBinderProject(id, "id, ship_event_id");
    const sections = await projectSectionRows(id, "id, ship_event_id");
    for (const owner of [row, ...sections]) await deleteShipEvent(owner.ship_event_id);
    const sectionIds = sections.map((section) => section.id);
    if (sectionIds.length) {
      await run(client.from("project_lines").delete().in("section_id", sectionIds));
      await run(client.from("project_sections").delete().in("id", sectionIds));
    }
    await run(client.from("projects").delete().eq("id", id));
    return { ok: true, id };
  }

  async function createBinderSection(projectId, title, parentId) {
    await requireBinderProject(projectId, "id");
    const sections = await projectSectionRows(projectId, "id, parent_id, section_index");
    let siblings;
    if (parentId !== null) {
      const parent = sections.find((section) => section.id === parentId);
      if (!parent) throw new ApiError(404, "Parent section not found");
      if (parent.parent_id) throw new ApiError(400, "Sub-sections cannot contain further sub-sections");
      siblings = sections.filter((section) => section.parent_id === parentId);
      if (siblings.length >= BINDER_MAX_SUBSECTIONS) {
        throw new ApiError(400, `A section can hold up to ${BINDER_MAX_SUBSECTIONS} sub-sections`);
      }
    } else {
      siblings = sections.filter((section) => !section.parent_id);
    }
    const nextIndex = Math.max(0, ...siblings.map((section) => Number(section.section_index) || 0)) + 1;
    const fallback = parentId !== null ? `Sub-section ${nextIndex}` : `Section ${nextIndex}`;
    const row = await run(client.from("project_sections").insert({
      project_id: projectId,
      parent_id: parentId,
      section_index: nextIndex,
      title: pyText(title) || fallback,
    }).select("*").single());
    return serializeBinderSection(row, []);
  }

  async function updateBinderSection(id, title, blocks, columns, fields) {
    const row = await requireBinderSection(id);
    const changes = {};
    let renamed = false;
    if (title !== null) {
      const name = text(title);
      if (!name) throw new ApiError(400, "Section title is required");
      changes.title = name;
      renamed = name !== row.title;
    }
    Object.assign(changes, binderStyleChanges(fields));
    const shipChange = binderShipDateChange(row, fields);
    Object.assign(changes, shipChange);
    if (columns !== null) {
      if (!Array.isArray(columns) || !columns.length) throw new ApiError(400, "Columns must be a non-empty list");
      const first = isPlainObject(columns[0]) ? columns[0] : {};
      const mainColumn = binderColumnPayload("main", parseBinderBlocks(pyFalsy(first.blocks) ? [] : first.blocks), first.width, first);
      const mainLayout = {};
      for (const key of ["mode", "compartments"]) {
        if (has(mainColumn, key)) mainLayout[key] = mainColumn[key];
      }
      changes.extra_columns = parseSectionExtraColumns(columns.slice(1));
      changes.main_width = mainColumn.width ?? null;
      changes.main_layout = mainLayout;
      changes.blocks = mainColumn.blocks;
    } else if (blocks !== null) {
      changes.blocks = parseBinderBlocks(blocks).slice(0, columnBlockCap(parseColumnLayout(row.main_layout)));
    }
    let updated = row;
    if (Object.keys(changes).length) {
      updated = await run(client.from("project_sections").update(changes).eq("id", id).select("*").single());
    }
    if (shipChange || (renamed && row.ship_date)) {
      await syncShipCommitment("section", id);
      updated = await requireBinderSection(id);
    }
    const lines = (await linesForSections([id])).map(serializeBinderLine);
    return serializeBinderSection(updated, lines);
  }

  async function reorderBinderSections(projectId, sectionIds) {
    await requireBinderProject(projectId, "id");
    if (!sectionIds.length) throw new ApiError(400, "Section order payload is empty");
    const sections = await projectSectionRows(projectId, "id, parent_id");
    const first = sections.find((section) => section.id === sectionIds[0]);
    if (!first) throw new ApiError(404, "Section not found");
    const siblings = sections
      .filter((section) => (first.parent_id ? section.parent_id === first.parent_id : !section.parent_id))
      .map((section) => section.id);
    const incoming = [...sectionIds].sort((a, b) => a - b);
    siblings.sort((a, b) => a - b);
    if (incoming.length !== siblings.length || incoming.some((sectionId, i) => sectionId !== siblings[i])) {
      throw new ApiError(400, "Section order payload must include every sibling section exactly once");
    }
    for (const [index, sectionId] of sectionIds.entries()) {
      await run(client.from("project_sections").update({ section_index: index + 1 })
        .eq("id", sectionId).eq("project_id", projectId));
    }
    return getBinderProject(projectId);
  }

  async function deleteBinderSection(id) {
    const row = await requireBinderSection(id, "id, project_id, parent_id");
    const projectId = Number(row.project_id);
    const sections = await projectSectionRows(projectId, "id, parent_id, ship_event_id");
    if (!row.parent_id && sections.filter((section) => !section.parent_id).length <= 1) {
      throw new ApiError(400, "Cannot delete the only section in a project");
    }
    const doomed = [id, ...sections.filter((section) => section.parent_id === id).map((section) => section.id)];
    for (const section of sections.filter((s) => doomed.includes(s.id))) await deleteShipEvent(section.ship_event_id);
    await run(client.from("project_lines").delete().in("section_id", doomed));
    await run(client.from("project_sections").delete().in("id", doomed));
    return { ok: true, id, project_id: projectId, deleted_ids: doomed };
  }

  async function createBinderLine(sectionId, content, blocks, isCompleted) {
    await requireBinderSection(sectionId, "id");
    const row = await run(client.from("project_lines").insert({
      section_id: sectionId,
      content: pyText(content),
      is_completed: Boolean(isCompleted),
      blocks: dumpBinderBlocks(blocks),
    }).select("*").single());
    return serializeBinderLine(row);
  }

  async function updateBinderLine(id, content, blocks, isCompleted) {
    const row = await requireBinderLine(id);
    const updated = await run(client.from("project_lines").update({
      content: content === null ? row.content : pyText(content),
      blocks: blocks === null ? row.blocks : dumpBinderBlocks(blocks),
      is_completed: isCompleted === null ? row.is_completed : Boolean(isCompleted),
    }).eq("id", id).select("*").single());
    return serializeBinderLine(updated);
  }

  async function toggleBinderLine(id) {
    const row = await requireBinderLine(id);
    const updated = await run(client.from("project_lines").update({ is_completed: !row.is_completed })
      .eq("id", id).select("*").single());
    return serializeBinderLine(updated);
  }

  async function deleteBinderLine(id) {
    await requireBinderLine(id);
    await run(client.from("project_lines").delete().eq("id", id));
    return { ok: true, id };
  }

  /* Ship dates: project/section <-> commitment event <-> active Daily Log entry. */

  async function sparkById(id) {
    if (!present(id)) return null;
    return run(client.from("sparks").select("*").eq("id", id).maybeSingle());
  }

  async function shipSource(kind, sourceId) {
    if (kind === "project") {
      const row = await run(client.from("projects").select("*").eq("id", sourceId).maybeSingle());
      if (!row) return { row: null, table: "projects", title: "", projectId: null };
      return { row, table: "projects", title: `${SHIP_TITLE_PREFIX}${row.title}`, projectId: Number(row.id) };
    }
    const row = await run(client.from("project_sections").select("*").eq("id", sourceId).maybeSingle());
    if (!row) return { row: null, table: "project_sections", title: "", projectId: null };
    const project = await run(client.from("projects").select("title").eq("id", row.project_id).maybeSingle());
    const projectTitle = project ? project.title : "Project";
    return {
      row,
      table: "project_sections",
      title: `${SHIP_TITLE_PREFIX}${row.title}${SHIP_TITLE_JOINER}${projectTitle}`,
      projectId: Number(row.project_id),
    };
  }

  function shipNameFromTitle(title, kind, projectTitle) {
    let name = text(title);
    const prefix = SHIP_TITLE_PREFIX.trim();
    if (name.toLowerCase().startsWith(prefix.toLowerCase())) name = name.slice(prefix.length).trim();
    if (kind === "section") {
      const suffix = `${SHIP_TITLE_JOINER}${projectTitle}`;
      if (name.endsWith(suffix)) name = name.slice(0, -suffix.length).trim();
    }
    return name;
  }

  async function shipEventActiveLogs(eventId) {
    const rows = await selectAll(() => client.from("sparks").select("*")
      .eq("item_type", "task").eq("extra_data->>is_active_schedule_log", "true").order("id"));
    return rows.filter((row) => {
      if (Number(row.id) === Number(eventId)) return false;
      const extra = parseExtra(row.extra_data);
      return isActiveScheduleLogExtra(extra) && scheduleLogLinkId(extra, "event") === String(eventId);
    });
  }

  async function deleteShipEvent(eventId) {
    if (!eventId) return;
    for (const log of await shipEventActiveLogs(eventId)) {
      await run(client.from("sparks").delete().eq("id", log.id));
    }
    await run(client.from("sparks").delete().eq("id", eventId).eq("item_type", "task"));
  }

  async function insertShipRow({ title, day, extra, notes, createdAt }) {
    const allDay = extra.is_event_log ? 0 : 1;
    const row = await run(client.from("sparks").insert({
      title,
      status: "in_cloud",
      created_at: createdAt,
      item_type: "task",
      is_done: 0,
      assignee: "Me",
      extra_data: normalizeTaskExtra(extra),
      due_date: day,
      end_date: day,
      notes,
      is_routine: 0,
      recurrence_days: "[]",
      task_status: "pending",
      postponed_count: 0,
      is_parked: 0,
      entry_type: "event",
      is_theme_of_day: 0,
      accent_color: EVENT_DEFAULT_ACCENT,
      emoji: null,
      is_all_day: allDay,
      is_multiday: allDay,
    }).select("id").single());
    return Number(row.id);
  }

  function createShipLog(eventId, title, day, shipLink) {
    return insertShipRow({
      title,
      day,
      extra: {
        is_event_log: true,
        is_active_schedule_log: true,
        log_status: "scheduled",
        stream_date: day,
        stream_time: "00:00",
        linked_event_id: eventId,
        event_id: eventId,
        schedule_linked: false,
        event_title: title,
        event_status: "pending",
        timing_mode: "multiday",
        accent_color: EVENT_DEFAULT_ACCENT,
        emoji: null,
        event_nature: "commitment",
        signifier: "\u25a1",
        is_actionable: true,
        ship_link: shipLink,
        migration_history: birthHistory("event", "00:00"),
      },
      notes: `<!--bujo:event--><p>${escapeHtml(title)}</p>`,
      createdAt: storedStamp(`${day}T00:00:00`),
    });
  }

  // Create / move / retitle / remove the commitment event + active log backing a ship date.
  async function syncShipCommitment(kind, sourceId) {
    const { row, table, title, projectId } = await shipSource(kind, sourceId);
    if (!row) return;
    const shipDate = row.ship_date || null;
    let eventId = row.ship_event_id ? Number(row.ship_event_id) : null;
    let event = eventId
      ? await run(client.from("sparks").select("*").eq("id", eventId).eq("item_type", "task").maybeSingle())
      : null;
    if (!shipDate) {
      await deleteShipEvent(eventId);
      await run(client.from(table).update({ ship_event_id: null }).eq("id", sourceId));
      return;
    }
    if (!event) {
      eventId = await insertShipRow({
        title,
        day: shipDate,
        extra: {
          schedule_linked: true,
          is_event_log: false,
          is_active_schedule_log: false,
          event_title: title,
          timing_mode: "multiday",
          event_nature: "commitment",
          signifier: "\u25a1",
          is_actionable: true,
          event_status: "pending",
          migration_history: birthHistory("event", localHhmm()),
        },
        notes: null,
        createdAt: new Date().toISOString(),
      });
      await run(client.from(table).update({ ship_event_id: eventId }).eq("id", sourceId));
      event = await sparkById(eventId);
    }
    const shipLink = { kind, id: Number(sourceId), project_id: projectId, event_id: eventId };
    const extra = normalizeTaskExtra(parseExtra(event.extra_data));
    Object.assign(extra, { ship_link: shipLink, event_title: title, linked_event_id: eventId, event_id: eventId });
    const eventStatus = text(extra.event_status || "pending").toLowerCase();
    const logs = await shipEventActiveLogs(eventId);
    const keep = logs.find((log) => String(log.id) === String(extra.active_schedule_log_id || "")) || logs[0] || null;
    if (keep) {
      await refreshActiveScheduleLog(keep, {
        title,
        streamDate: shipDate,
        streamTime: "00:00",
        extraPatch: { event_title: title, ship_link: shipLink },
      });
      extra.active_schedule_log_id = Number(keep.id);
    } else if (eventStatus === "pending") {
      extra.active_schedule_log_id = await createShipLog(eventId, title, shipDate, shipLink);
    }
    await run(client.from("sparks").update({
      title,
      due_date: shipDate,
      end_date: shipDate,
      due_time: null,
      start_time: null,
      end_time: null,
      is_all_day: 1,
      is_multiday: 1,
      extra_data: normalizeTaskExtra(extra),
    }).eq("id", eventId));
  }

  function shipLinkOf(row) {
    if (!row) return null;
    const link = parseExtra(row.extra_data).ship_link;
    return isPlainObject(link) && ["project", "section"].includes(link.kind) && link.id ? link : null;
  }

  async function shipRenameSource(link, newTitle) {
    const { row: source, table, projectId } = await shipSource(link.kind, Number(link.id));
    if (!source) return;
    let projectTitle = "";
    if (link.kind === "section") {
      const project = await run(client.from("projects").select("title").eq("id", projectId).maybeSingle());
      projectTitle = project ? project.title : "";
    }
    const name = shipNameFromTitle(newTitle, link.kind, projectTitle);
    if (name && name !== source.title) await run(client.from(table).update({ title: name }).eq("id", Number(link.id)));
  }

  // Time-schedule / Daily Log edits flow back to the project or section.
  // Returns true when the edited row itself was rewritten.
  async function shipAfterTaskUpdate(before, after) {
    let link = shipLinkOf(after);
    let event = after;
    if (link && String(link.event_id) !== String(after.id)) {
      event = await sparkById(link.event_id);
      link = shipLinkOf(event);
    }
    if (!link) {
      const afterExtra = parseExtra(after.extra_data);
      const linked = scheduleLogLinkId(afterExtra, "event");
      if (!linked || !afterExtra.is_event_log) return false;
      event = await sparkById(linked);
      link = shipLinkOf(event);
      if (!link) return false;
    }
    const { row: source, table } = await shipSource(link.kind, Number(link.id));
    if (!source || String(source.ship_event_id || "") !== String(event.id)) return false;
    if (Number(after.id) === Number(event.id)) {
      if (before.title !== after.title) await shipRenameSource(link, after.title);
      const newDay = after.due_date || null;
      if (newDay && newDay !== (source.ship_date || null)) {
        await run(client.from(table).update({ ship_date: newDay }).eq("id", Number(link.id)));
      }
      return false;
    }
    const afterExtra = parseExtra(after.extra_data);
    const eventExtra = parseExtra(event.extra_data);
    if (String(eventExtra.active_schedule_log_id || "") !== String(after.id)) return false;
    if (!isActiveScheduleLogExtra(afterExtra)) return false;
    const titleChanged = before.title !== after.title && Boolean(text(after.title));
    const beforeDay = safeDay(parseExtra(before.extra_data).stream_date || before.due_date);
    const afterDay = safeDay(afterExtra.stream_date || after.due_date);
    const dayChanged = Boolean(afterDay) && afterDay !== beforeDay;
    if (!titleChanged && !dayChanged) return false;
    if (titleChanged) await shipRenameSource(link, after.title);
    if (dayChanged) await run(client.from(table).update({ ship_date: afterDay }).eq("id", Number(link.id)));
    await syncShipCommitment(link.kind, Number(link.id));
    return true;
  }

  // Deleting the ship event (or its current Daily Log entry) clears the ship date at the source.
  async function shipBeforeTaskDelete(row) {
    let link = shipLinkOf(row);
    let event = row;
    const extra = parseExtra(row.extra_data);
    if (!link || String(link.event_id) !== String(row.id)) {
      const linked = scheduleLogLinkId(extra, "event");
      if (!linked || !extra.is_event_log) return;
      event = await sparkById(linked);
      link = shipLinkOf(event);
      if (!link) return;
      if (String(parseExtra(event.extra_data).active_schedule_log_id || "") !== String(row.id)) return;
    }
    const { row: source, table } = await shipSource(link.kind, Number(link.id));
    if (source && String(source.ship_event_id || "") === String(event.id)) {
      await run(client.from(table).update({ ship_date: null, ship_event_id: null }).eq("id", Number(link.id)));
    }
    for (const log of await shipEventActiveLogs(event.id)) {
      if (Number(log.id) !== Number(row.id)) await run(client.from("sparks").delete().eq("id", log.id));
    }
    if (Number(event.id) !== Number(row.id)) await run(client.from("sparks").delete().eq("id", event.id));
  }

  function sparkPlainBody(spark) {
    let body = text(spark.raw_content);
    if (!body) body = decodeEntities(String(spark.notes || "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
    return body === text(spark.title) ? "" : body;
  }

  function handoffTitle(spark, body) {
    return text(body.title) || text(spark.title) || "Untitled jot";
  }

  function handoffBlocks(spark, body) {
    return (Array.isArray(body.blocks) ? body.blocks : Array.isArray(spark.blocks) ? spark.blocks : []).filter(isPlainObject);
  }

  function handoffFields(body) {
    return modelFields(body, {
      title: "text", content: "text", blocks: "list", vision_id: "int", chapter_id: "int",
      vision_title: "text", notebook_title: "text",
    });
  }

  // The jot becomes a new binder project (its blocks land in the first section).
  async function handOffToBinderProject(spark, f) {
    const title = handoffTitle(spark, f);
    const content = given(f.content) ? f.content : sparkPlainBody(spark);
    const blocks = handoffBlocks(spark, f);
    let saved = await createBinderProject(title, content);
    if (blocks.length && saved.sections.length) {
      await createBinderLine(Number(saved.sections[0].id), title, blocks, false);
      saved = await getBinderProject(saved.id);
    }
    return saved;
  }

  // The jot becomes a goal on a board (or names the first goal of a new board from vision_title);
  // its blocks join the board, skipping any a board can't hold.
  async function handOffToVisionGoal(spark, f) {
    const title = handoffTitle(spark, f);
    const newBoard = text(f.vision_title);
    let visionId;
    let saved;
    if (newBoard) {
      const board = await createVisionBoard(newBoard);
      visionId = Number(board.id);
      saved = { id: visionId, title: board.title, vision_id: visionId, created_board: true };
      if (f.title) saved.goal = await createVisionGoal(visionId, title);
    } else {
      if (!given(f.vision_id)) throw new ApiError(400, "Choose a vision board");
      visionId = Number(f.vision_id);
      saved = { ...(await createVisionGoal(visionId, title)), vision_id: visionId };
    }
    let attached = 0;
    for (const block of handoffBlocks(spark, f)) {
      try {
        await createVisionBlock(visionId, pyString(block.type), block);
        attached += 1;
      } catch (err) {
        if (!(err instanceof ApiError)) throw err;
      }
    }
    saved.attached_blocks = attached;
    return saved;
  }

  // The jot becomes a line in a notebook chapter (or in a new notebook named by notebook_title).
  async function handOffToNotebookLine(spark, f) {
    const title = handoffTitle(spark, f);
    const newBook = text(f.notebook_title);
    let chapterId = f.chapter_id ?? null;
    let book = null;
    if (newBook) {
      book = await createVaultNotebook(newBook, null);
      if (!book.chapters.length) throw new ApiError(400, "Could not create the notebook chapter");
      chapterId = Number(book.chapters[0].id);
    }
    if (!given(chapterId)) throw new ApiError(400, "Choose a notebook chapter");
    const body = sparkPlainBody(spark);
    const content = given(f.content) ? text(f.content) : body ? `${title} — ${body}` : title;
    const saved = await createVaultLine(Number(chapterId), content || title, handoffBlocks(spark, f));
    if (book) saved.created_notebook = { id: Number(book.id), title: book.title };
    return saved;
  }

  // Targets outside the sparks table: the jot is copied there, then leaves the inbox.
  const SPARK_HANDOFFS = {
    binder_project: handOffToBinderProject,
    vision_goal: handOffToVisionGoal,
    notebook_line: handOffToNotebookLine,
  };

  async function convertFig(id, body) {
    const target = text(body.target_type || body.item_type).toLowerCase();
    if (!target) throw new ApiError(400, "target_type or item_type is required");
    const spark = await requireSpark(id);
    if ((spark.item_type || "spark") !== "spark") throw new ApiError(400, "Only inbox sparks can be converted");
    const assignee = given(body.assignee) ? text(body.assignee) || "Me" : "Me";
    if ((target === "task" || target === "task_in_phase") && !present(body.project_id)) {
      const row = await run(client.from("sparks").update({
        item_type: "task",
        assignee,
        extra_data: normalizeTaskExtra(isPlainObject(body.extra_data) ? body.extra_data : {}),
        is_done: 0,
        task_status: "pending",
        due_date: cleanDueDate(body.due_date),
        due_time: cleanDueTime(body.due_time),
      }).eq("id", id).select("*").single());
      return serializeSpark(row);
    }
    if (has(SPARK_HANDOFFS, target)) {
      const saved = await SPARK_HANDOFFS[target](serializeSpark(spark), handoffFields(body));
      await run(client.from("sparks").delete().eq("id", id).eq("item_type", "spark"));
      saved.converted_from_spark_id = Number(id);
      saved.convert_target = target;
      return saved;
    }
    if (target !== "habit" && target !== "reference") throw new ApiError(503, OFFLINE_DETAIL);
    const normalizeExtra = target === "habit" ? normalizeHabitExtra : normalizeReferenceExtra;
    const row = await run(client.from("sparks").update({
      item_type: target,
      assignee,
      extra_data: normalizeExtra(isPlainObject(body.extra_data) ? body.extra_data : {}),
      is_done: 0,
      task_status: null,
      due_date: null,
      due_time: null,
    }).eq("id", id).select("*").single());
    return serializeSpark(row);
  }

  /* ---------- Vision boards (goals, linked commitments, blocks, canvas) ---------- */

  const VISION_LINKABLE_KINDS = ["project", "habit", "notebook"];
  // Task/event links can no longer be created, but older ones still show in the Linked hub.
  const VISION_LINKED_KINDS = [...VISION_LINKABLE_KINDS, "task", "event"];
  const VISION_NOTE_ALIASES = ["rich_text", "rich-note", "rich_note", "text"];
  const VISION_BLOCK_KINDS = ["note", "photo", "link", "checklist", ...MEDIA_BLOCK_TYPES];
  const VISION_LINK_SOURCES = {
    project: (id) => run(client.from("projects").select("id").eq("id", id).maybeSingle()),
    habit: (id) => run(client.from("sparks").select("id").eq("id", id).eq("item_type", "habit").maybeSingle()),
    notebook: (id) => run(client.from("vault_notebooks").select("id").eq("id", id).maybeSingle()),
  };

  // Python `a or b or ...`: the first truthy value, else the last one.
  function pyOr(...values) {
    for (const value of values) {
      if (!pyFalsy(value)) return value;
    }
    return values[values.length - 1];
  }

  function titleCase(word) {
    return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
  }

  const byNewest = (a, b) => (Date.parse(b.created_at) || 0) - (Date.parse(a.created_at) || 0) || b.id - a.id;

  function visionCanvas(raw) {
    if (isPlainObject(raw)) return Array.isArray(raw.objects) ? raw : { ...raw, objects: [] };
    if (Array.isArray(raw)) return { objects: raw };
    return { objects: [] };
  }

  // Canvas payloads may arrive as a JSON string; anything unreadable saves as an empty board.
  function storedVisionCanvas(value) {
    let parsed = value;
    if (typeof value === "string") {
      try {
        parsed = JSON.parse(value);
      } catch (_) {
        parsed = null;
      }
    }
    return isPlainObject(parsed) || Array.isArray(parsed) ? parsed : { objects: [] };
  }

  function serializeVisionGoal(row) {
    return {
      id: Number(row.id),
      vision_id: Number(row.vision_id),
      content: text(row.content),
      is_completed: Boolean(row.is_completed),
      realized_at: row.is_completed ? row.realized_at || null : null,
      created_at: row.created_at,
    };
  }

  function serializeVisionLink(row) {
    return {
      id: Number(row.id),
      vision_id: Number(row.vision_id),
      entity_type: text(row.entity_type).toLowerCase(),
      entity_id: Number(row.entity_id),
      created_at: row.created_at,
    };
  }

  function serializeVisionBlock(row) {
    const content = isPlainObject(row.content) ? row.content : {};
    return {
      id: Number(row.id),
      vision_id: Number(row.vision_id),
      block_type: text(row.block_type).toLowerCase(),
      content,
      content_json: JSON.stringify(content),
      created_at: row.created_at,
    };
  }

  function serializeVisionBoard(row, { canvas = false, goals = null, attached = null, blocks = null, stats = null } = {}) {
    const payload = {
      id: Number(row.id),
      title: text(row.title) || "Untitled Vision",
      thumbnail_data: row.thumbnail_data ?? null,
      created_at: row.created_at,
      status: row.status || "active",
      fulfilled_at: row.fulfilled_at || null,
    };
    if (canvas) {
      payload.canvas = visionCanvas(row.canvas);
      payload.canvas_json = JSON.stringify(row.canvas ?? { objects: [] });
    }
    if (goals) payload.goals = goals;
    if (attached) {
      payload.attached_elements = attached;
      payload.linked = attached.filter((item) => VISION_LINKED_KINDS.includes(item.entity_type));
      payload.attached = attached.filter((item) => !VISION_LINKED_KINDS.includes(item.entity_type));
    }
    if (blocks) payload.blocks = blocks;
    if (stats) {
      Object.assign(payload, stats);
    } else if (goals) {
      payload.goal_count = goals.length;
      payload.goals_completed = goals.filter((goal) => goal.is_completed).length;
    }
    return payload;
  }

  const requireVisionBoard = (id, columns = "id") => requireRow("vision_boards", id, "Vision board not found", columns);

  async function listVisionBoards(query) {
    const status = query.has("status") ? query.get("status") : "active";
    const [boards, goals, links, blocks] = await Promise.all([
      selectAll(() => {
        const rows = client.from("vision_boards").select("*");
        return (status === "" || status === "all" ? rows : rows.eq("status", status)).order("id");
      }),
      selectAll(() => client.from("vision_goals").select("*").order("created_at").order("id")),
      selectAll(() => client.from("vision_linked_elements").select("id, vision_id, entity_type").order("id")),
      selectAll(() => client.from("vision_blocks").select("id, vision_id").order("id")),
    ]);
    return boards.sort(byNewest).map((row) => {
      const own = goals.filter((goal) => goal.vision_id === row.id).map(serializeVisionGoal);
      return serializeVisionBoard(row, {
        goals: own,
        stats: {
          goal_count: own.length,
          goals_completed: own.filter((goal) => goal.is_completed).length,
          linked_count: links.filter((link) => link.vision_id === row.id && VISION_LINKED_KINDS.includes(link.entity_type)).length,
          block_count: blocks.filter((block) => block.vision_id === row.id).length,
          object_count: visionCanvas(row.canvas).objects.length,
        },
      });
    });
  }

  async function visionLinkLabel(kind, id) {
    if (kind === "project" || kind === "notebook") {
      const table = kind === "project" ? "projects" : "vault_notebooks";
      const row = await run(client.from(table).select("title").eq("id", id).maybeSingle());
      if (row) return text(row.title) || `${titleCase(kind)} #${id}`;
    } else if (["habit", "task", "event", "spark"].includes(kind)) {
      let lookup = client.from("sparks").select("title, raw_content").eq("id", id);
      if (kind !== "spark") lookup = lookup.eq("item_type", kind);
      const row = await run(lookup.maybeSingle());
      if (row) return clip(pyText(pyOr(row.title, row.raw_content, "")), 80) || `${titleCase(kind)} #${id}`;
    }
    return `${kind ? titleCase(kind) : "Item"} #${id}`;
  }

  async function labeledVisionLink(row) {
    const item = serializeVisionLink(row);
    item.label = await visionLinkLabel(item.entity_type, item.entity_id);
    return item;
  }

  async function getVisionBoard(id) {
    const row = await requireVisionBoard(id, "*");
    const [goals, links, blocks] = await Promise.all(["vision_goals", "vision_linked_elements", "vision_blocks"].map((table) =>
      selectAll(() => client.from(table).select("*").eq("vision_id", id).order("created_at").order("id"))));
    const attached = [];
    for (const link of links) attached.push(await labeledVisionLink(link));
    return serializeVisionBoard(row, {
      canvas: true,
      goals: goals.map(serializeVisionGoal),
      attached,
      blocks: blocks.map(serializeVisionBlock),
    });
  }

  async function createVisionBoard(title) {
    const row = await run(client.from("vision_boards").insert({ title: text(title) || "New Vision", canvas: { objects: [] } })
      .select("id").single());
    return getVisionBoard(row.id);
  }

  async function updateVisionBoard(id, fields) {
    await requireVisionBoard(id);
    if (has(fields, "title")) {
      await run(client.from("vision_boards").update({ title: text(fields.title) || "Untitled Vision" }).eq("id", id));
    }
    return getVisionBoard(id);
  }

  async function saveVisionCanvas(id, body) {
    const isCanvas = (value) => value === null || isPlainObject(value) || Array.isArray(value);
    if (has(body, "canvas") && !isCanvas(body.canvas)) throw fieldError("canvas");
    if (has(body, "canvas_json") && !isCanvas(body.canvas_json) && typeof body.canvas_json !== "string") throw fieldError("canvas_json");
    const f = modelFields(body, { thumbnail_data: "text" });
    await requireVisionBoard(id);
    const changes = { canvas: storedVisionCanvas(given(body.canvas) ? body.canvas : body.canvas_json) };
    if (given(f.thumbnail_data)) changes.thumbnail_data = f.thumbnail_data;
    await run(client.from("vision_boards").update(changes).eq("id", id));
    return getVisionBoard(id);
  }

  async function fulfillVisionBoard(id) {
    const row = await requireVisionBoard(id, "id, status");
    if ((row.status || "active") !== "fulfilled") {
      await run(client.from("vision_boards").update({ status: "fulfilled", fulfilled_at: new Date().toISOString() }).eq("id", id));
    }
    return getVisionBoard(id);
  }

  async function deleteVisionBoard(id) {
    await requireVisionBoard(id);
    for (const table of ["vision_goals", "vision_linked_elements", "vision_blocks"]) {
      await run(client.from(table).delete().eq("vision_id", id));
    }
    await run(client.from("vision_boards").delete().eq("id", id));
    return { ok: true, id };
  }

  function goalContent(body) {
    if (typeof body.content !== "string" || !body.content) throw new ApiError(422, "content is required");
    return body.content;
  }

  const requireVisionGoal = (id) => requireRow("vision_goals", id, "Goal not found");

  async function createVisionGoal(visionId, content) {
    await requireVisionBoard(visionId);
    const clean = text(content);
    if (!clean) throw new ApiError(400, "Goal content is required");
    const row = await run(client.from("vision_goals").insert({ vision_id: visionId, content: clean, is_completed: false })
      .select("*").single());
    return serializeVisionGoal(row);
  }

  async function updateVisionGoal(id, content) {
    await requireVisionGoal(id);
    const clean = text(content);
    if (!clean) throw new ApiError(400, "Goal content is required");
    const row = await run(client.from("vision_goals").update({ content: clean }).eq("id", id).select("*").single());
    return serializeVisionGoal(row);
  }

  async function toggleVisionGoal(id) {
    const done = !(await requireVisionGoal(id)).is_completed;
    const row = await run(client.from("vision_goals")
      .update({ is_completed: done, realized_at: done ? new Date().toISOString() : null })
      .eq("id", id).select("*").single());
    return serializeVisionGoal(row);
  }

  async function deleteVisionGoal(id) {
    await requireVisionGoal(id);
    await run(client.from("vision_goals").delete().eq("id", id));
    return { ok: true, id };
  }

  async function linkVisionElement(visionId, body) {
    const f = modelFields(body, { entity_type: "text", entity_id: "int" });
    if (typeof f.entity_type !== "string") throw fieldError("entity_type");
    if (!given(f.entity_id)) throw fieldError("entity_id");
    await requireVisionBoard(visionId);
    const kind = text(f.entity_type).toLowerCase();
    if (![...VISION_LINKABLE_KINDS, "spark", "note"].includes(kind)) {
      throw new ApiError(400, "Commitments can link a project, habit, or notebook");
    }
    const source = VISION_LINK_SOURCES[kind];
    if (source && !(await source(f.entity_id))) throw new ApiError(404, `That ${kind} no longer exists`);
    const existing = await run(client.from("vision_linked_elements").select("*")
      .eq("vision_id", visionId).eq("entity_type", kind).eq("entity_id", f.entity_id).maybeSingle());
    const row = existing || await run(client.from("vision_linked_elements")
      .insert({ vision_id: visionId, entity_type: kind, entity_id: f.entity_id }).select("*").single());
    return labeledVisionLink(row);
  }

  async function unlinkVisionElement(id) {
    await requireRow("vision_linked_elements", id, "Attachment not found", "id");
    await run(client.from("vision_linked_elements").delete().eq("id", id));
    return { ok: true, id };
  }

  function visionBlockKind(raw) {
    const kind = text(raw).toLowerCase();
    return VISION_NOTE_ALIASES.includes(kind) ? "note" : kind;
  }

  // Unified Log-compatible block shape: { type, title, content, meta, ...flat mirrors }.
  function normalizeVisionBlock(kind, content) {
    const payload = isPlainObject(content) ? content : {};
    const meta = isPlainObject(payload.meta) ? payload.meta : {};
    if (MEDIA_BLOCK_TYPES.includes(kind)) {
      const media = mediaBlock(payload, kind);
      if (!media) throw new ApiError(400, "Add a file to this block");
      delete media.id;
      return { ...media, meta };
    }
    if (kind === "note") {
      const html = pyText(pyOr(payload.html, payload.body, payload.content, ""));
      const title = pyText(pyOr(payload.title, "Rich Note")) || "Rich Note";
      return { type: "note", title, content: html, html, meta };
    }
    if (kind === "photo" || kind === "link") {
      const url = pyText(pyOr(payload.url, payload.content, ""));
      if (!url) throw new ApiError(400, kind === "photo" ? "Photo URL is required" : "Link URL is required");
      if (kind === "photo") {
        const caption = pyText(pyOr(payload.caption, meta.caption, ""));
        return {
          type: "photo",
          title: pyText(payload.title),
          content: url,
          url,
          caption,
          filename: pyText(pyOr(payload.filename, meta.filename, "")),
          meta: { ...meta, caption },
        };
      }
      const displayMode = pyStr(pyOr(meta.display_mode, payload.display_mode, "compact"));
      return {
        type: "link",
        title: pyText(payload.title) || url,
        content: url,
        url,
        display_mode: displayMode,
        preview_image: pyText(pyOr(meta.preview_image, payload.preview_image, "")),
        description: pyText(pyOr(meta.description, payload.description, "")),
        meta: { ...meta, display_mode: displayMode },
      };
    }
    if (kind === "checklist") {
      const source = Array.isArray(payload.items) ? payload.items : Array.isArray(payload.content) ? payload.content : [];
      const items = [];
      source.forEach((item, idx) => {
        if (isPlainObject(item)) {
          const label = pyText(pyOr(item.text, item.content, ""));
          if (label) items.push({ id: pyStr(pyOr(item.id, `i${idx}`)), text: label, done: !pyFalsy(item.done) });
        } else {
          const label = pyText(item);
          if (label) items.push({ id: `i${idx}`, text: label, done: false });
        }
      });
      return { type: "checklist", title: pyText(payload.title) || "Checklist", content: items, items, meta };
    }
    throw new ApiError(400, "Invalid block_type");
  }

  function visionBlockBody(body, create) {
    const f = modelFields(body, { block_type: "text", content: "object" });
    if (create && typeof f.block_type !== "string") throw fieldError("block_type");
    return f;
  }

  async function createVisionBlock(visionId, blockType, content) {
    await requireVisionBoard(visionId);
    const kind = visionBlockKind(blockType);
    if (!VISION_BLOCK_KINDS.includes(kind)) throw new ApiError(400, "Invalid block_type");
    const row = await run(client.from("vision_blocks")
      .insert({ vision_id: visionId, block_type: kind, content: normalizeVisionBlock(kind, content) })
      .select("*").single());
    return serializeVisionBlock(row);
  }

  async function updateVisionBlock(id, content, blockType) {
    const row = await requireRow("vision_blocks", id, "Block not found", "id, vision_id, block_type");
    const kind = visionBlockKind(pyOr(blockType, row.block_type, ""));
    await requireVisionBoard(row.vision_id);
    const updated = await run(client.from("vision_blocks")
      .update({ block_type: kind, content: normalizeVisionBlock(kind, content) })
      .eq("id", id).select("*").single());
    return serializeVisionBlock(updated);
  }

  async function deleteVisionBlock(id) {
    await requireRow("vision_blocks", id, "Block not found", "id");
    await run(client.from("vision_blocks").delete().eq("id", id));
    return { ok: true, id };
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

  /* ---------- Vault (shelves, stacks, notebooks, chapters, lines) ---------- */

  // Unset (null) style fields render as the default blank page, neutral spine or ink-black shelf tab.
  const VAULT_NOTEBOOK_STYLE_FIELDS = ["cover_color", "cover_image", "spine_color"];
  const VAULT_CHAPTER_STYLE_FIELDS = ["background_color", "background_image"];
  const VAULT_SHELF_STYLE_FIELDS = ["tab_color"];
  const VAULT_LINE_KINDS = ["line", "foldout", "outline"];
  const VAULT_TITLE_MAX = 80;

  function vaultStyleChanges(fields, keys) {
    const changes = {};
    for (const key of keys) {
      if (has(fields, key)) changes[key] = cleanBinderStyle(key, fields[key]);
    }
    return changes;
  }

  function vaultStyle(row, keys) {
    const style = {};
    for (const key of keys) style[key] = row[key] || null;
    return style;
  }

  // SQL ascending order puts NULL first.
  function nullsFirst(a, b) {
    const left = given(a) ? a : -Infinity;
    const right = given(b) ? b : -Infinity;
    return left === right ? 0 : left < right ? -1 : 1;
  }

  function vaultTitleFields(body, kinds) {
    const f = modelFields(body, kinds);
    if (typeof f.title === "string" && Array.from(f.title).length > VAULT_TITLE_MAX) throw fieldError("title");
    return f;
  }

  function nonEmptyTitle(fields) {
    if (fields.title === "") throw fieldError("title");
    return fields;
  }

  function serializeVaultShelf(row) {
    return {
      id: Number(row.id),
      title: text(row.title) || "Shelf",
      sort_order: Number(row.sort_order) || 0,
      tab_color: row.tab_color || null,
      created_at: row.created_at,
    };
  }

  function serializeVaultStack(row) {
    return {
      id: Number(row.id),
      title: text(row.title) || "Untitled Stack",
      shelf_id: given(row.shelf_id) ? Number(row.shelf_id) : null,
      slot: given(row.slot) ? Number(row.slot) : null,
      created_at: row.created_at,
    };
  }

  const vaultShelfRows = (columns = "*") =>
    selectAll(() => client.from("vault_shelves").select(columns).order("sort_order").order("id"));
  const vaultStackRows = (columns = "*") => selectAll(() => client.from("vault_stacks").select(columns).order("id"));

  async function insertVaultShelf(title) {
    const shelves = await vaultShelfRows("id, title, sort_order");
    let name = clip(pyText(title), VAULT_TITLE_MAX);
    if (!name) {
      const taken = new Set(shelves.map((shelf) => text(shelf.title).toLowerCase()));
      let number = shelves.length + 1;
      while (taken.has(`shelf ${number}`)) number += 1;
      name = `Shelf ${number}`;
    }
    const nextOrder = shelves.length ? Math.max(...shelves.map((shelf) => Number(shelf.sort_order) || 0)) + 1 : 1;
    return run(client.from("vault_shelves").insert({ title: name, sort_order: nextOrder }).select("*").single());
  }

  // The Vault always has at least one shelf; parallel first loads share one check.
  let vaultShelfReady = null;
  function ensureVaultShelf() {
    const owner = session?.user?.id;
    if (!vaultShelfReady || vaultShelfReady.owner !== owner) {
      const check = (async () => {
        const first = await run(client.from("vault_shelves").select("id").order("sort_order").order("id").limit(1));
        if (!first.length) await insertVaultShelf("Shelf 1");
      })();
      check.catch(() => {
        if (vaultShelfReady?.check === check) vaultShelfReady = null;
      });
      vaultShelfReady = { owner, check };
    }
    return vaultShelfReady.check;
  }

  async function vaultSlotTarget(shelfId, slot) {
    if (!given(shelfId) || !given(slot)) throw new ApiError(400, "Invalid shelf slot");
    await requireRow("vault_shelves", shelfId, "Shelf not found", "id");
    if (slot < 0) throw new ApiError(400, "Invalid shelf slot");
    return [Number(shelfId), Number(slot)];
  }

  // Next position at the end of a shelf (default: the first shelf). Shelves have no stack limit.
  async function vaultFreeSlot(shelfId) {
    let sid = shelfId;
    if (!given(sid)) {
      const first = await run(client.from("vault_shelves").select("id").order("sort_order").order("id").limit(1));
      sid = first.length ? Number(first[0].id) : Number((await insertVaultShelf("Shelf 1")).id);
    }
    const slots = (await run(client.from("vault_stacks").select("slot").eq("shelf_id", sid)))
      .map((row) => row.slot).filter(given);
    return [sid, slots.length ? Math.max(...slots) + 1 : 0];
  }

  async function listVaultShelves() {
    await ensureVaultShelf();
    return (await vaultShelfRows()).map(serializeVaultShelf);
  }

  async function createVaultShelf(title) {
    await ensureVaultShelf();
    return serializeVaultShelf(await insertVaultShelf(title));
  }

  async function updateVaultShelf(id, fields) {
    await requireRow("vault_shelves", id, "Shelf not found", "id");
    const changes = {};
    if (given(fields.title)) {
      const name = text(fields.title);
      if (!name) throw new ApiError(400, "Shelf name is required");
      changes.title = clip(name, VAULT_TITLE_MAX);
    }
    Object.assign(changes, vaultStyleChanges(fields, VAULT_SHELF_STYLE_FIELDS));
    if (Object.keys(changes).length) await run(client.from("vault_shelves").update(changes).eq("id", id));
    return serializeVaultShelf(await requireRow("vault_shelves", id, "Shelf not found"));
  }

  // Shelves listed come first in the given order; any left out keep their relative order after them.
  async function reorderVaultShelves(shelfIds) {
    await ensureVaultShelf();
    const existing = (await vaultShelfRows("id")).map((row) => Number(row.id));
    const wanted = [...new Set(shelfIds)];
    if (wanted.some((id) => !existing.includes(id))) throw new ApiError(404, "Shelf not found");
    const order = [...wanted, ...existing.filter((id) => !wanted.includes(id))];
    for (const [index, id] of order.entries()) {
      await run(client.from("vault_shelves").update({ sort_order: index + 1 }).eq("id", id));
    }
    return listVaultShelves();
  }

  // Puts the listed stacks on the shelf in that order (moving them from other shelves if needed).
  async function arrangeVaultShelfStacks(shelfId, stackIds) {
    await vaultSlotTarget(shelfId, 0);
    const stacks = await vaultStackRows("id, shelf_id, slot");
    const known = new Set(stacks.map((row) => Number(row.id)));
    const wanted = [...new Set(stackIds)];
    if (wanted.some((id) => !known.has(id))) throw new ApiError(404, "Stack not found");
    const rest = stacks
      .filter((row) => Number(row.shelf_id) === shelfId && !wanted.includes(Number(row.id)))
      .sort((a, b) => nullsFirst(a.slot, b.slot) || a.id - b.id)
      .map((row) => Number(row.id));
    for (const [slot, id] of [...wanted, ...rest].entries()) {
      await run(client.from("vault_stacks").update({ shelf_id: shelfId, slot }).eq("id", id));
    }
    return listVaultStacks();
  }

  // Removes the shelf and its stacks; their notebooks fall back to Unstacked. The last shelf always stays.
  async function deleteVaultShelf(id) {
    await requireRow("vault_shelves", id, "Shelf not found", "id");
    if ((await vaultShelfRows("id")).length <= 1) throw new ApiError(400, "The Vault needs at least one shelf");
    const stackIds = (await run(client.from("vault_stacks").select("id").eq("shelf_id", id))).map((row) => row.id);
    if (stackIds.length) {
      await run(client.from("vault_notebooks").update({ stack_id: null }).in("stack_id", stackIds));
      await run(client.from("vault_stacks").delete().in("id", stackIds));
    }
    await run(client.from("vault_shelves").delete().eq("id", id));
    return { ok: true, id };
  }

  async function listVaultStacks() {
    await ensureVaultShelf();
    const [shelves, stacks] = await Promise.all([vaultShelfRows("id"), vaultStackRows()]);
    const rank = new Map(shelves.map((shelf, index) => [Number(shelf.id), index]));
    const shelfRank = (row) => (rank.has(Number(row.shelf_id)) ? rank.get(Number(row.shelf_id)) : null);
    return stacks
      .sort((a, b) => nullsFirst(shelfRank(a), shelfRank(b)) || nullsFirst(a.slot, b.slot) || a.id - b.id)
      .map(serializeVaultStack);
  }

  // Without a slot the stack goes to the end of the given shelf (or of the first shelf).
  async function createVaultStack(fields) {
    await ensureVaultShelf();
    let target;
    if (given(fields.slot)) {
      target = await vaultSlotTarget(fields.shelf_id, fields.slot);
      const taken = await run(client.from("vault_stacks").select("id").eq("shelf_id", target[0]).eq("slot", target[1]).limit(1));
      if (taken.length) throw new ApiError(409, "That slot already holds a stack");
    } else {
      const shelf = given(fields.shelf_id) ? (await vaultSlotTarget(fields.shelf_id, 0))[0] : null;
      target = await vaultFreeSlot(shelf);
    }
    const title = clip(pyText(fields.title), VAULT_TITLE_MAX) || `Stack ${target[1] + 1}`;
    return serializeVaultStack(await run(client.from("vault_stacks")
      .insert({ title, sort_order: 0, shelf_id: target[0], slot: target[1] }).select("*").single()));
  }

  // Moving onto a slot that already holds a stack swaps the two.
  async function updateVaultStack(id, fields) {
    const row = await requireRow("vault_stacks", id, "Stack not found");
    let title = null;
    if (given(fields.title)) {
      title = text(fields.title);
      if (!title) throw new ApiError(400, "Stack name is required");
    }
    const target = given(fields.slot)
      ? await vaultSlotTarget(given(fields.shelf_id) ? fields.shelf_id : row.shelf_id, fields.slot)
      : null;
    if (title !== null) await run(client.from("vault_stacks").update({ title: clip(title, VAULT_TITLE_MAX) }).eq("id", id));
    if (target) {
      const occupant = await run(client.from("vault_stacks").select("id")
        .eq("shelf_id", target[0]).eq("slot", target[1]).neq("id", id).limit(1));
      if (occupant.length) {
        await run(client.from("vault_stacks").update({ shelf_id: row.shelf_id, slot: row.slot }).eq("id", occupant[0].id));
      }
      await run(client.from("vault_stacks").update({ shelf_id: target[0], slot: target[1] }).eq("id", id));
    }
    return serializeVaultStack(await requireRow("vault_stacks", id, "Stack not found"));
  }

  // Removes the stack only; its notebooks fall back to the unstacked shelf.
  async function deleteVaultStack(id) {
    await requireRow("vault_stacks", id, "Stack not found", "id");
    await run(client.from("vault_notebooks").update({ stack_id: null }).eq("stack_id", id));
    await run(client.from("vault_stacks").delete().eq("id", id));
    return { ok: true, id };
  }

  function serializeVaultLine(row) {
    const kind = text(row.kind || "line").toLowerCase();
    return {
      id: Number(row.id),
      chapter_id: Number(row.chapter_id),
      parent_id: given(row.parent_id) ? Number(row.parent_id) : null,
      kind: VAULT_LINE_KINDS.includes(kind) ? kind : "line",
      collapsed: Boolean(row.collapsed),
      sort_order: row.sort_order ?? null,
      content: text(row.content),
      blocks: parseBinderBlocks(row.blocks),
      created_at: row.created_at,
    };
  }

  // Lines without a position sort last, then by position, age and id.
  function byVaultLineOrder(a, b) {
    const unset = Number(!given(a.sort_order)) - Number(!given(b.sort_order));
    return unset || (a.sort_order ?? 0) - (b.sort_order ?? 0)
      || (Date.parse(a.created_at) || 0) - (Date.parse(b.created_at) || 0) || a.id - b.id;
  }

  const byChapterOrder = (a, b) => a.chapter_index - b.chapter_index || a.id - b.id;

  function serializeVaultChapter(row, lines = []) {
    return {
      id: Number(row.id),
      notebook_id: Number(row.notebook_id),
      chapter_index: Number(row.chapter_index),
      title: text(row.title) || `Chapter ${row.chapter_index}`,
      created_at: row.created_at,
      ...vaultStyle(row, VAULT_CHAPTER_STYLE_FIELDS),
      lines,
    };
  }

  function serializeVaultNotebook(row, chapters = null, chapterCount = null) {
    const payload = {
      id: Number(row.id),
      title: text(row.title) || "Untitled Notebook",
      created_at: row.created_at,
      stack_id: row.stack_id ? Number(row.stack_id) : null,
      ...vaultStyle(row, VAULT_NOTEBOOK_STYLE_FIELDS),
      chapters: chapters || [],
    };
    const count = chapterCount ?? (chapters ? chapters.length : null);
    if (count !== null) payload.chapter_count = count;
    return payload;
  }

  const requireVaultNotebook = (id, columns = "id") => requireRow("vault_notebooks", id, "Notebook not found", columns);
  const requireVaultChapter = (id, columns = "id") => requireRow("vault_chapters", id, "Chapter not found", columns);

  function chapterLines(chapterId) {
    return selectAll(() => client.from("vault_lines").select("*").eq("chapter_id", chapterId).order("id"))
      .then((rows) => rows.sort(byVaultLineOrder).map(serializeVaultLine));
  }

  async function listVaultNotebooks() {
    const [notebooks, chapters] = await Promise.all([
      selectAll(() => client.from("vault_notebooks").select("*").order("id")),
      selectAll(() => client.from("vault_chapters").select("id, notebook_id").order("id")),
    ]);
    return notebooks.sort(byNewest).map((row) => serializeVaultNotebook(
      row, null, chapters.filter((chapter) => chapter.notebook_id === row.id).length,
    ));
  }

  async function getVaultNotebook(id) {
    const row = await requireVaultNotebook(id, "*");
    const chapters = (await selectAll(() => client.from("vault_chapters").select("*").eq("notebook_id", id).order("id")))
      .sort(byChapterOrder);
    const ids = chapters.map((chapter) => chapter.id);
    const lines = ids.length
      ? await selectAll(() => client.from("vault_lines").select("*").in("chapter_id", ids).order("id"))
      : [];
    return serializeVaultNotebook(row, chapters.map((chapter) => serializeVaultChapter(
      chapter,
      lines.filter((line) => line.chapter_id === chapter.id).sort(byVaultLineOrder).map(serializeVaultLine),
    )));
  }

  async function cleanVaultStackId(stackId) {
    if (!given(stackId) || stackId === "" || stackId === 0) return null;
    await requireRow("vault_stacks", stackId, "Stack not found", "id");
    return Number(stackId);
  }

  async function createVaultNotebook(title, stackId) {
    const name = text(title);
    if (!name) throw new ApiError(400, "Notebook name is required");
    const stack = await cleanVaultStackId(stackId);
    const row = await run(client.from("vault_notebooks").insert({ title: name, stack_id: stack }).select("id").single());
    await run(client.from("vault_chapters").insert({ notebook_id: row.id, chapter_index: 1, title: "Chapter 1" }));
    return getVaultNotebook(row.id);
  }

  // A stack_id in the body (re)assigns the notebook; leaving it out keeps the current stack.
  async function updateVaultNotebook(id, fields) {
    await requireVaultNotebook(id);
    const changes = {};
    if (given(fields.title)) {
      changes.title = text(fields.title);
      if (!changes.title) throw new ApiError(400, "Notebook name is required");
    }
    Object.assign(changes, vaultStyleChanges(fields, VAULT_NOTEBOOK_STYLE_FIELDS));
    if (has(fields, "stack_id")) changes.stack_id = await cleanVaultStackId(fields.stack_id);
    if (Object.keys(changes).length) await run(client.from("vault_notebooks").update(changes).eq("id", id));
    return getVaultNotebook(id);
  }

  async function deleteVaultNotebook(id) {
    await requireVaultNotebook(id);
    const chapterIds = (await run(client.from("vault_chapters").select("id").eq("notebook_id", id))).map((row) => row.id);
    if (chapterIds.length) {
      await run(client.from("vault_lines").delete().in("chapter_id", chapterIds));
      await run(client.from("vault_chapters").delete().in("id", chapterIds));
    }
    await run(client.from("vault_notebooks").delete().eq("id", id));
    return { ok: true, id };
  }

  async function createVaultChapter(notebookId, title) {
    await requireVaultNotebook(notebookId);
    const indexes = (await run(client.from("vault_chapters").select("chapter_index").eq("notebook_id", notebookId)))
      .map((row) => Number(row.chapter_index) || 0);
    const next = (indexes.length ? Math.max(...indexes) : 0) + 1;
    const row = await run(client.from("vault_chapters")
      .insert({ notebook_id: notebookId, chapter_index: next, title: text(title) || `Chapter ${next}` })
      .select("*").single());
    return serializeVaultChapter(row, []);
  }

  async function updateVaultChapter(id, fields) {
    await requireVaultChapter(id);
    const changes = {};
    if (given(fields.title)) {
      changes.title = text(fields.title);
      if (!changes.title) throw new ApiError(400, "Chapter title is required");
    }
    Object.assign(changes, vaultStyleChanges(fields, VAULT_CHAPTER_STYLE_FIELDS));
    if (Object.keys(changes).length) await run(client.from("vault_chapters").update(changes).eq("id", id));
    return serializeVaultChapter(await requireVaultChapter(id, "*"), await chapterLines(id));
  }

  async function reorderVaultChapters(notebookId, chapterIds) {
    await requireVaultNotebook(notebookId);
    const existing = new Set((await run(client.from("vault_chapters").select("id").eq("notebook_id", notebookId)))
      .map((row) => Number(row.id)));
    const ordered = [...new Set(chapterIds)].filter((id) => existing.has(id));
    if (ordered.length !== existing.size) {
      throw new ApiError(400, "chapter_ids must include every chapter in the notebook exactly once");
    }
    for (const [index, id] of ordered.entries()) {
      await run(client.from("vault_chapters").update({ chapter_index: index + 1 }).eq("id", id).eq("notebook_id", notebookId));
    }
    return { success: true, chapter_ids: ordered };
  }

  async function deleteVaultChapter(id) {
    const row = await requireVaultChapter(id, "id, notebook_id");
    const notebookId = Number(row.notebook_id);
    const siblings = await run(client.from("vault_chapters").select("id").eq("notebook_id", notebookId));
    if (siblings.length <= 1) throw new ApiError(400, "Cannot delete the only chapter in a notebook");
    await run(client.from("vault_lines").delete().eq("chapter_id", id));
    await run(client.from("vault_chapters").delete().eq("id", id));
    return { ok: true, id, notebook_id: notebookId };
  }

  async function vaultFoldoutParent(chapterId, parentId) {
    if (!given(parentId) || parentId === "" || parentId === 0) return null;
    const parent = await run(client.from("vault_lines").select("id, chapter_id, kind").eq("id", parentId).maybeSingle());
    if (!parent || Number(parent.chapter_id) !== Number(chapterId)) {
      throw new ApiError(404, "Parent foldout page not found in this chapter");
    }
    if ((parent.kind || "line") !== "foldout") throw new ApiError(400, "Lines can only be nested inside a foldout page");
    return Number(parentId);
  }

  async function createVaultLine(chapterId, content, blocks, kind, parentId) {
    await requireVaultChapter(chapterId);
    const lineKind = text(kind || "line").toLowerCase();
    if (!VAULT_LINE_KINDS.includes(lineKind)) throw new ApiError(400, "Invalid line kind");
    const parent = await vaultFoldoutParent(chapterId, parentId);
    if (lineKind === "outline" && parent !== null) {
      throw new ApiError(400, "Outline sections can only be placed at the top level of a chapter");
    }
    const orders = (await run(client.from("vault_lines").select("sort_order, parent_id").eq("chapter_id", chapterId)))
      .filter((row) => (given(row.parent_id) ? Number(row.parent_id) : null) === parent && given(row.sort_order))
      .map((row) => Number(row.sort_order));
    const row = await run(client.from("vault_lines").insert({
      chapter_id: chapterId,
      content: text(content),
      blocks: dumpBinderBlocks(blocks),
      sort_order: (orders.length ? Math.max(...orders) : 0) + 1,
      parent_id: parent,
      kind: lineKind,
      collapsed: false,
    }).select("*").single());
    return serializeVaultLine(row);
  }

  async function updateVaultLine(id, content, blocks, collapsed) {
    await requireRow("vault_lines", id, "Line not found", "id");
    const changes = {};
    if (content !== null) changes.content = text(content);
    if (blocks !== null) changes.blocks = dumpBinderBlocks(blocks);
    if (collapsed !== null) changes.collapsed = Boolean(collapsed);
    const row = Object.keys(changes).length
      ? await run(client.from("vault_lines").update(changes).eq("id", id).select("*").single())
      : await requireRow("vault_lines", id, "Line not found");
    return serializeVaultLine(row);
  }

  function vaultLineOrderBody(body) {
    const f = modelFields(body, { line_ids: "int_list", items: "list" });
    const items = given(f.items)
      ? f.items.map((item) => {
        if (!isPlainObject(item)) throw fieldError("items");
        const entry = modelFields(item, { id: "int", parent_id: "int" });
        if (!given(entry.id)) throw fieldError("items");
        return { id: entry.id, parent_id: entry.parent_id ?? null };
      })
      : null;
    return { lineIds: f.line_ids || [], items };
  }

  // Saves sibling order and nesting. `items` is the chapter's lines in document order as
  // {id, parent_id}; `lineIds` alone reorders while keeping each line's current parent.
  async function reorderVaultLines(chapterId, { lineIds, items }) {
    await requireVaultChapter(chapterId);
    const rows = await run(client.from("vault_lines").select("id, parent_id, kind").eq("chapter_id", chapterId));
    const kinds = new Map(rows.map((row) => [Number(row.id), String(row.kind || "line")]));
    const currentParent = new Map(rows.map((row) => [Number(row.id), given(row.parent_id) ? Number(row.parent_id) : null]));
    const entries = items !== null ? items : lineIds.map((id) => ({ id, parent_id: null }));
    const ordered = [];
    const parents = new Map();
    for (const entry of entries) {
      const lineId = entry.id;
      if (!kinds.has(lineId) || parents.has(lineId)) continue;
      const parent = items === null ? currentParent.get(lineId) : entry.parent_id || null;
      if (parent !== null && (kinds.get(parent) !== "foldout" || parent === lineId)) {
        throw new ApiError(400, "Lines can only be nested inside a foldout page in the same chapter");
      }
      if (parent !== null && kinds.get(lineId) === "outline") {
        throw new ApiError(400, "Outline sections can only be placed at the top level of a chapter");
      }
      parents.set(lineId, parent);
      ordered.push(lineId);
    }
    if (ordered.length !== kinds.size) {
      throw new ApiError(400, "The new order must include every line in the chapter exactly once");
    }
    for (const lineId of ordered) {
      const seen = new Set();
      for (let cursor = parents.get(lineId); cursor !== null && cursor !== undefined; cursor = parents.get(cursor)) {
        if (cursor === lineId || seen.has(cursor)) throw new ApiError(400, "A foldout page cannot be nested inside itself");
        seen.add(cursor);
      }
    }
    const positions = new Map();
    for (const lineId of ordered) {
      const parent = parents.get(lineId);
      positions.set(parent, (positions.get(parent) || 0) + 1);
      await run(client.from("vault_lines").update({ sort_order: positions.get(parent), parent_id: parent })
        .eq("id", lineId).eq("chapter_id", chapterId));
    }
    return {
      success: true,
      line_ids: ordered,
      items: ordered.map((id) => ({ id, parent_id: parents.get(id) })),
    };
  }

  // Deleting a foldout page removes every line nested inside it.
  async function deleteVaultLine(id) {
    await requireRow("vault_lines", id, "Line not found", "id");
    const doomed = [id];
    let frontier = [id];
    while (frontier.length) {
      frontier = (await run(client.from("vault_lines").select("id").in("parent_id", frontier))).map((row) => Number(row.id));
      doomed.push(...frontier);
    }
    await run(client.from("vault_lines").delete().in("id", doomed));
    return { ok: true, id, deleted_ids: doomed };
  }

  /* ---------- Vault references and reference folders ---------- */

  const REFERENCE_FIELD_KINDS = {
    title: "text", raw_content: "text", source_url: "text", topic_tag: "text", tags: "text_list",
    folder_id: "int", folder_name: "text", is_pinned: "flag", attachments: "list", link_preview: "object",
    rich_notes: "text", content: "text", sketch_data: "text", echo_to_home: "flag", daily_echo: "flag",
    echo_frequency: "text", extra_data: "object",
  };
  const ECHO_FREQUENCIES = ["daily_random", "pin", "rotate"];

  function pyString(value) {
    return pyFalsy(value) ? "" : pyStr(value);
  }

  function attachmentId(index, url) {
    const sum = Array.from(url).reduce((total, char) => total + char.codePointAt(0), 0);
    return `att_${index}_${sum % 10000000}`;
  }

  // Legacy URL strings and rich attachment objects become {id, type: link|file, title, url}.
  function normalizeReferenceAttachments(raw) {
    if (!Array.isArray(raw)) return [];
    const items = [];
    const seen = new Set();
    raw.forEach((entry, index) => {
      if (typeof entry !== "string" && !isPlainObject(entry)) return;
      const url = typeof entry === "string" ? entry.trim() : pyText(entry.url);
      if (!url || seen.has(url)) return;
      seen.add(url);
      const isWebLink = /^https?:\/\//.test(url);
      let kind;
      if (typeof entry === "string") {
        kind = isWebLink ? "link" : "file";
      } else {
        kind = pyText(entry.type).toLowerCase();
        if (!["link", "file", "bookmark", "document", "photo"].includes(kind)) {
          kind = isWebLink && !url.includes("/uploads/") ? "link" : "file";
        }
        if (kind === "bookmark") kind = "link";
        if (kind === "document" || kind === "photo") kind = "file";
      }
      const fallbackTitle = basename(url) || (kind === "link" ? "Link" : "File");
      items.push({
        id: typeof entry === "string" ? attachmentId(index, url) : pyStr(pyOr(entry.id, attachmentId(index, url))),
        type: kind,
        title: (typeof entry === "string" ? "" : pyText(entry.title)) || fallbackTitle,
        url,
      });
    });
    return items;
  }

  function cleanUrlList(raw) {
    return Array.isArray(raw) ? raw.map((url) => pyStr(url).trim()).filter(Boolean) : [];
  }

  function normalizeReferenceExtra(raw) {
    const data = parseExtra(raw);
    const preview = isPlainObject(data.link_preview) ? data.link_preview : {};
    let sketch = pyText(data.sketch_data);
    if (sketch && !sketch.startsWith("data:image/")) sketch = "";
    let frequency = pyText(pyOr(data.echo_frequency, "daily_random")).toLowerCase();
    if (!ECHO_FREQUENCIES.includes(frequency)) frequency = "daily_random";
    const rich = sanitizeNoteHtml(pyOr(data.rich_notes, data.content, ""));
    let tags = normalizeTagList(data.tags);
    if (!tags.length) {
      const legacy = normalizeTopicTag(data.topic_tag);
      if (legacy) tags = [legacy];
    }
    const echo = !pyFalsy(data.echo_to_home) || !pyFalsy(data.daily_echo);
    const isPage = pyText(pyOr(data.ref_type, data.type, "")).toLowerCase() === "page";
    return {
      is_snippet: !pyFalsy(data.is_snippet),
      is_vision: !pyFalsy(data.is_vision) || !pyFalsy(data.vision_pins),
      attachments: normalizeReferenceAttachments(data.attachments),
      tags,
      vision_pins: cleanUrlList(data.vision_pins),
      vision_hidden: cleanUrlList(data.vision_hidden),
      link_preview: {
        title: pyString(preview.title),
        description: pyString(preview.description),
        image: pyString(preview.image),
      },
      rich_notes: rich,
      content: rich,
      sketch_data: sketch,
      echo_to_home: echo,
      echo_frequency: frequency,
      daily_echo: echo,
      ref_type: isPage ? "page" : pyText(data.ref_type) || null,
    };
  }

  function referenceFields(body) {
    const fields = modelFields(body, REFERENCE_FIELD_KINDS);
    if (typeof fields.title !== "string" || !fields.title) throw new ApiError(422, "title is required");
    return fields;
  }

  async function requireReference(id) {
    const current = serializeSpark(await requireSpark(id));
    if (current.item_type !== "reference") throw new ApiError(400, "Only references can be filed here");
    return current;
  }

  const nocase = (value) => String(value ?? "").replace(/[A-Z]/g, (char) => char.toLowerCase());
  function byNocase(key) {
    return (a, b) => {
      const left = nocase(a[key]);
      const right = nocase(b[key]);
      return left < right ? -1 : left > right ? 1 : a.id - b.id;
    };
  }

  function referenceHaystack(item) {
    const extra = item.extra_data || {};
    const preview = extra.link_preview || {};
    const attachments = (extra.attachments || [])
      .map((att) => (isPlainObject(att) ? `${att.title} ${att.url}` : ` ${att}`))
      .join(" ");
    return [
      item.title || "",
      item.raw_content || "",
      String(extra.rich_notes || "").replace(/<[^>]+>/g, " "),
      item.source_url || "",
      item.topic_tag || "",
      (extra.tags || []).join(" "),
      item.folder_name || "",
      attachments,
      String(preview.title || ""),
      String(preview.description || ""),
    ].join(" ").toLowerCase();
  }

  async function listReferences(query) {
    const [rows, folders] = await Promise.all([
      selectAll(() => client.from("sparks").select("*").eq("status", "in_cloud").eq("item_type", "reference").order("id")),
      selectAll(() => client.from("reference_folders").select("id, name").order("id")),
    ]);
    const folderNames = new Map(folders.map((folder) => [Number(folder.id), folder.name]));
    const byTitle = byNocase("title");
    rows.sort((a, b) => (b.is_pinned ? 1 : 0) - (a.is_pinned ? 1 : 0) || byTitle(a, b));
    let items = rows.map((row) => ({ ...serializeSpark(row), folder_name: folderNames.get(Number(row.folder_id)) ?? null }));
    const folderId = query.get("folder_id");
    if (folderId !== null && !["", "all", "null"].includes(folderId)) {
      if (folderId === "none" || folderId === "unfiled") {
        items = items.filter((item) => !item.folder_id);
      } else {
        const wanted = strictInt(folderId);
        if (wanted === null) throw new ApiError(400, "folder_id must be a number");
        items = items.filter((item) => item.folder_id === wanted);
      }
    }
    const needle = text(query.get("search")).toLowerCase();
    if (needle) items = items.filter((item) => referenceHaystack(item).includes(needle));
    const tag = text(query.get("tag"));
    if (tag && tag.toLowerCase() !== "all") {
      const wanted = tag.replace(/^#+/, "").toLowerCase();
      const clean = (value) => text(value).replace(/^#+/, "").toLowerCase();
      items = items.filter((item) => [item.topic_tag, ...((item.extra_data || {}).tags || [])].map(clean).includes(wanted));
    }
    return items;
  }

  async function createReference(fields) {
    const title = text(fields.title);
    if (!title) throw new ApiError(400, "Title is required");
    let tags = normalizeTagList(fields.tags);
    if (!tags.length) {
      const legacy = normalizeTopicTag(fields.topic_tag);
      if (legacy) tags = [legacy];
    }
    const extra = normalizeReferenceExtra({ ...fields, tags });
    await ensureTagsForNames(tags);
    const row = await run(client.from("sparks").insert({
      title,
      raw_content: text(fields.raw_content) || null,
      source_url: text(fields.source_url) || null,
      topic_tag: tags[0] || null,
      status: "in_cloud",
      item_type: "reference",
      is_done: 0,
      assignee: "Me",
      extra_data: extra,
      folder_id: present(fields.folder_id) ? Number(fields.folder_id) : null,
      is_pinned: fields.is_pinned ? 1 : 0,
    }).select("*").single());
    return serializeSpark(row);
  }

  async function updateReference(id, fields) {
    const current = await requireReference(id);
    const title = given(fields.title) ? text(fields.title) : current.title;
    if (!title) throw new ApiError(400, "Title is required");
    let extra = { ...current.extra_data };
    if (Array.isArray(fields.attachments)) extra.attachments = normalizeReferenceAttachments(fields.attachments);
    if (Array.isArray(fields.tags) || typeof fields.tags === "string") extra.tags = normalizeTagList(fields.tags);
    if (isPlainObject(fields.link_preview)) extra.link_preview = fields.link_preview;
    if (has(fields, "rich_notes") || has(fields, "content")) {
      extra.rich_notes = sanitizeNoteHtml(has(fields, "rich_notes") ? fields.rich_notes : fields.content);
      extra.content = extra.rich_notes;
    }
    if (has(fields, "sketch_data")) extra.sketch_data = fields.sketch_data;
    if (has(fields, "echo_to_home") || has(fields, "daily_echo")) {
      const echo = Boolean(has(fields, "echo_to_home") ? fields.echo_to_home : fields.daily_echo);
      extra.echo_to_home = echo;
      extra.daily_echo = echo;
    }
    if (has(fields, "echo_frequency")) extra.echo_frequency = fields.echo_frequency;
    if (isPlainObject(fields.extra_data)) {
      const merged = { ...extra, ...fields.extra_data };
      if (has(fields.extra_data, "attachments")) merged.attachments = normalizeReferenceAttachments(fields.extra_data.attachments);
      if (has(fields.extra_data, "tags")) merged.tags = normalizeTagList(fields.extra_data.tags);
      extra = merged;
    }
    extra = normalizeReferenceExtra(extra);
    const topicOnly = has(fields, "topic_tag") && !has(fields, "tags");
    if (topicOnly) {
      const topic = normalizeTopicTag(fields.topic_tag);
      if (topic) extra.tags = normalizeTagList([topic, ...extra.tags]);
    }
    let tag = extra.tags[0] ?? null;
    if (topicOnly && given(fields.topic_tag)) tag = normalizeTopicTag(fields.topic_tag);
    await ensureTagsForNames(extra.tags.length ? extra.tags : tag ? [tag] : []);
    const row = await run(client.from("sparks").update({
      title,
      raw_content: has(fields, "raw_content") ? text(fields.raw_content) || null : current.raw_content ?? null,
      source_url: has(fields, "source_url") ? text(fields.source_url) || null : current.source_url ?? null,
      topic_tag: tag,
      extra_data: extra,
      folder_id: has(fields, "folder_id") ? (present(fields.folder_id) ? Number(fields.folder_id) : null) : current.folder_id,
      is_pinned: has(fields, "is_pinned") ? (fields.is_pinned ? 1 : 0) : current.is_pinned,
    }).eq("id", id).select("*").single());
    return serializeSpark(row);
  }

  // A folder_name without a folder_id files the reference into a new top-level folder,
  // created only once the rest of the write is known to be valid.
  async function saveReference(body, write) {
    const fields = referenceFields(body);
    const newFolder = !pyFalsy(fields.folder_name) && pyFalsy(fields.folder_id);
    if (newFolder && !text(fields.folder_name)) throw new ApiError(400, "Folder name is required");
    if (!text(fields.title)) throw new ApiError(400, "Title is required");
    if (newFolder) fields.folder_id = (await createReferenceFolder(fields.folder_name, null, "📁")).id;
    return write(fields);
  }

  async function updateReferenceRoute(id, body) {
    await requireReference(id);
    return saveReference(body, (fields) => updateReference(id, fields));
  }

  async function pinReference(id, isPinned) {
    const current = await requireReference(id);
    const next = isPinned === null ? (current.is_pinned ? 0 : 1) : (isPinned ? 1 : 0);
    return updateReference(id, { is_pinned: next });
  }

  function referenceFolderNode(row) {
    return {
      id: Number(row.id),
      name: row.name,
      parent_id: given(row.parent_id) ? Number(row.parent_id) : null,
      icon: row.icon || "📁",
      created_at: row.created_at,
      children: [],
    };
  }

  function folderBody(body, extraKinds = {}) {
    const f = modelFields(body, { name: "text", ...extraKinds });
    if (typeof f.name !== "string" || !f.name) throw fieldError("name");
    return f;
  }

  const requireReferenceFolder = (id) => requireRow("reference_folders", id, "Folder not found");

  async function listReferenceFolders() {
    const rows = (await selectAll(() => client.from("reference_folders").select("*").order("id"))).sort(byNocase("name"));
    const nodes = new Map(rows.map((row) => [Number(row.id), referenceFolderNode(row)]));
    const roots = [];
    for (const node of nodes.values()) {
      const parentId = node.parent_id;
      if (parentId && nodes.has(parentId) && parentId !== node.id) nodes.get(parentId).children.push(node);
      else roots.push(node);
    }
    return roots;
  }

  async function createReferenceFolder(name, parentId, icon) {
    const clean = text(name);
    if (!clean) throw new ApiError(400, "Folder name is required");
    if (given(parentId)) await requireRow("reference_folders", parentId, "Parent folder not found", "id");
    const row = await run(client.from("reference_folders")
      .insert({ name: clean, parent_id: given(parentId) ? parentId : null, icon: text(icon || "📁") || "📁" })
      .select("*").single());
    return referenceFolderNode(row);
  }

  async function renameReferenceFolder(id, name) {
    await requireReferenceFolder(id);
    const clean = text(name);
    if (!clean) throw new ApiError(400, "Folder name is required");
    return referenceFolderNode(await run(client.from("reference_folders").update({ name: clean }).eq("id", id).select("*").single()));
  }

  // References in the folder become unfiled; sub-folders move up to its parent.
  async function deleteReferenceFolder(id) {
    const row = await requireReferenceFolder(id);
    await run(client.from("sparks").update({ folder_id: null }).eq("folder_id", id));
    await run(client.from("reference_folders").update({ parent_id: row.parent_id ?? null }).eq("parent_id", id));
    await run(client.from("reference_folders").delete().eq("id", id));
    return { ok: true, id };
  }

  /* ---------- Legacy (Hall of Legacy milestones) ---------- */

  // Calendar day of a stored timestamp as written (database.py _stamp_day).
  function stampDay(raw) {
    const match = /^\d{4}-\d{2}-\d{2}/.exec(text(raw));
    return match && parseDayKey(match[0]) ? match[0] : null;
  }

  function yearKey(year) {
    return year < 0 ? `-${String(-year).padStart(3, "0")}` : String(year).padStart(4, "0");
  }

  function byTextDesc(key) {
    return (a, b) => {
      const left = String(a[key] || "");
      const right = String(b[key] || "");
      return left < right ? 1 : left > right ? -1 : 0;
    };
  }

  // Fulfilled vision boards and mastered trackers. Shipped workbench projects
  // also belong here, but the workbench is retired online, so that list is empty.
  async function legacyHall() {
    const [boards, habitRows] = await Promise.all([
      selectAll(() => client.from("vision_boards").select("id, title, created_at, fulfilled_at").eq("status", "fulfilled").order("id")),
      selectAll(() => client.from("sparks").select("*").eq("status", "in_cloud").eq("item_type", "habit")
        .eq("habit_status", "graduated").order("id")),
    ]);
    const boardIds = boards.map((board) => board.id);
    const goals = boardIds.length
      ? await selectAll(() => client.from("vision_goals").select("id, vision_id, is_completed").in("vision_id", boardIds).order("id"))
      : [];
    const visions = boards.map((board) => {
      const own = goals.filter((goal) => goal.vision_id === board.id);
      const done = own.filter((goal) => goal.is_completed).length;
      const fulfilled = board.fulfilled_at || board.created_at;
      return {
        kind: "vision",
        id: `board-${board.id}`,
        board_id: Number(board.id),
        title: text(board.title) || "Untitled Vision",
        horizon_tag: "Vision",
        graduated_at: fulfilled,
        graduation_date: stampDay(fulfilled),
        photos: [],
        image_url: "",
        description: own.length ? `${done}/${own.length} goals realized` : "",
        badge: "Fulfilled Vision",
      };
    }).sort(byTextDesc("graduated_at"));
    const newestFirst = (a, b) => nullsFirst(Date.parse(b.graduated_at) || null, Date.parse(a.graduated_at) || null)
      || (Date.parse(b.updated_at) || 0) - (Date.parse(a.updated_at) || 0);
    const habits = habitRows.map(serializeSpark)
      .filter((habit) => habit.habit_status === "graduated")
      .sort(newestFirst)
      .map((habit) => {
        const extra = habit.extra_data || {};
        const graduated = habit.graduated_at || habit.updated_at;
        return {
          kind: "habit",
          id: habit.id,
          title: habit.title || "Untitled habit",
          graduated_at: graduated,
          graduation_date: stampDay(graduated),
          peak_streak: Math.max(intOr(habit.current_streak, 0), intOr(extra.current_streak, 0), intOr(extra.peak_streak, 0)),
          photo_pair: habit.photo_pair,
          reflection: text(habit.raw_content),
          badge: "Mastered Tracker",
        };
      });
    return {
      summary: {
        visions_realized: visions.length,
        projects_shipped: 0,
        habits_mastered: habits.length,
        total_milestones: visions.length + habits.length,
      },
      visions,
      projects: [],
      habits,
    };
  }

  // Chronological achievement archive for the Legacy tab, filtered by year, month or date range.
  async function legacyMilestones(query) {
    const hall = await legacyHall();
    const milestones = [];
    const reached = (item) => ({
      completed_at: item.graduated_at,
      completed_day: item.graduation_date || stampDay(item.graduated_at),
    });
    for (const item of hall.visions) {
      milestones.push({ ...item, type: "vision_graduated", icon: "🌟", label: item.badge || "Graduated Vision", ...reached(item) });
    }
    for (const item of hall.habits) {
      milestones.push({ ...item, type: "habit_mastered", icon: "🔄", label: "Mastered Tracker", ...reached(item) });
      const peak = intOr(item.peak_streak, 0);
      if (peak >= 30) {
        milestones.push({
          kind: "habit_streak",
          type: "habit_streak",
          icon: "🔥",
          label: `${peak}-Day Streak`,
          id: `streak-${item.id}-${peak}`,
          title: item.title || "Tracker streak",
          habit_id: item.id,
          peak_streak: peak,
          ...reached(item),
          badge: `${peak}-Day Streak`,
        });
      }
    }

    const filter = text(query.get("filter")).toLowerCase();
    const val = query.get("val");
    let start = query.get("start_date") ? cleanDueDate(query.get("start_date")) : null;
    let end = query.get("end_date") ? cleanDueDate(query.get("end_date")) : null;
    const today = dayKey(localToday());
    const thisYear = Number(today.slice(0, 4));
    if (filter === "year") {
      const year = strictInt(val) ?? thisYear;
      start = `${yearKey(year)}-01-01`;
      end = `${yearKey(year)}-12-31`;
    } else if (filter === "month") {
      const raw = text(pyOr(val, today.slice(0, 7)));
      const [year, month] = raw.length >= 7 && raw[4] === "-"
        ? [strictInt(raw.slice(0, 4)), strictInt(raw.slice(5, 7))]
        : [thisYear, strictInt(raw)];
      const lastDay = new Date(2000, 0, 1);
      if (year !== null && month !== null) lastDay.setFullYear(year, month, 0);
      if (year !== null && month === 12) {
        start = `${yearKey(year)}-12-01`;
        end = `${yearKey(year)}-12-31`;
      } else if (year !== null && month !== null && month >= 0 && month <= 11 && year >= 1 && year <= 9999) {
        start = `${yearKey(year)}-${pad2(month)}-01`;
        end = `${yearKey(lastDay.getFullYear())}-${pad2(lastDay.getMonth() + 1)}-${pad2(lastDay.getDate())}`;
      } else {
        start = `${today.slice(0, 7)}-01`;
        end = today;
      }
    } else if ((filter === "range" || filter === "custom") && (start || end)) {
      // keep the given dates
    } else if (filter && !["all", "all_time"].includes(filter)) {
      start = null;
      end = null;
    }

    const shown = milestones.filter((item) => {
      const day = item.completed_day || stampDay(item.completed_at);
      if (!day) return !start && !end;
      return !(start && day < start) && !(end && day > end);
    });
    const key = (item) => String(item.completed_at || item.completed_day || "");
    shown.sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
    return {
      filter: { type: filter || "all", val, start_date: start, end_date: end },
      summary: { ...hall.summary, milestones_shown: shown.length },
      milestones: shown,
    };
  }

  /* ---------- Request routing ---------- */

  function tagFromPath(segment) {
    let decoded = segment;
    try {
      decoded = decodeURIComponent(segment);
    } catch (_) {}
    return decoded.replace(/^#+/, "");
  }

  const ROUTES = [
    { methods: ["GET"], pattern: /^\/api\/sparks$/, handle: () => listFigs() },
    { methods: ["POST"], pattern: /^\/api\/sparks$/, handle: (m, body) => createFig(body) },
    { methods: ["PUT"], pattern: /^\/api\/sparks\/(\d+)$/, handle: (m, body) => updateFig(Number(m[1]), body) },
    { methods: ["DELETE"], pattern: /^\/api\/sparks\/(\d+)$/, handle: (m) => deleteFig(Number(m[1])) },
    { methods: ["POST"], pattern: /^\/api\/sparks\/(\d+)\/position$/, handle: (m, body) => positionFig(Number(m[1]), body) },
    { methods: ["GET"], pattern: /^\/api\/tags$/, handle: () => listTags() },
    { methods: ["POST"], pattern: /^\/api\/tags$/, handle: (m, body) => createTag(body) },
    { methods: ["PATCH"], pattern: /^\/api\/tags\/(.+)\/color$/, handle: (m, body) => setTagColor(tagFromPath(m[1]), body) },
    { methods: ["PATCH", "PUT"], pattern: /^\/api\/tags\/(.+)$/, handle: (m, body) => updateTag(tagFromPath(m[1]), body) },
    { methods: ["DELETE"], pattern: /^\/api\/tags\/(.+)$/, handle: (m) => deleteTag(tagFromPath(m[1])) },
    { methods: ["PATCH", "POST"], pattern: /^\/api\/sparks\/(\d+)\/convert$/, handle: (m, body) => convertFig(Number(m[1]), body) },
    { methods: ["GET"], pattern: /^\/api\/habits$/, handle: (m, body, query) => listHabitsRoute(query) },
    { methods: ["POST"], pattern: /^\/api\/habits$/, handle: (m, body) => createHabit(body) },
    { methods: ["PATCH", "PUT"], pattern: /^\/api\/habits\/(\d+)$/, handle: (m, body) => updateHabit(Number(m[1]), body) },
    { methods: ["DELETE"], pattern: /^\/api\/habits\/(\d+)$/, handle: (m) => deleteHabit(Number(m[1])) },
    {
      methods: ["PATCH"],
      pattern: /^\/api\/habits\/(\d+)\/status$/,
      handle: (m, body) => {
        if (typeof body.status !== "string") throw new ApiError(422, "status is required");
        return setHabitStatus(Number(m[1]), body.status);
      },
    },
    { methods: ["POST"], pattern: /^\/api\/habits\/(\d+)\/graduate$/, handle: (m) => setHabitStatus(Number(m[1]), "graduated") },
    { methods: ["PATCH"], pattern: /^\/api\/habits\/(\d+)\/log$/, handle: (m, body) => logHabitRoute(Number(m[1]), body) },
    { methods: ["POST"], pattern: /^\/api\/habits\/(\d+)\/check-in$/, handle: (m, body) => checkInHabit(Number(m[1]), body) },
    { methods: ["GET"], pattern: /^\/api\/tasks$/, handle: (m, body, query) => listTasks(query) },
    { methods: ["POST"], pattern: /^\/api\/tasks$/, handle: (m, body) => createTask(body) },
    {
      methods: ["PATCH"],
      pattern: /^\/api\/tasks\/(\d+)$/,
      handle: async (m, body) => annotateTask(await updateTask(Number(m[1]), taskFields(body, true))),
    },
    {
      methods: ["PATCH"],
      pattern: /^\/api\/tasks\/(\d+)\/schedule$/,
      handle: async (m, body) => annotateTask(await scheduleTask(Number(m[1]), body)),
    },
    { methods: ["DELETE"], pattern: /^\/api\/tasks\/(\d+)$/, handle: (m) => deleteTask(Number(m[1])) },
    { methods: ["GET"], pattern: /^\/api\/logs$/, handle: (m, body, query) => listLogs(query) },
    { methods: ["PATCH"], pattern: /^\/api\/sparks\/(\d+)\/action$/, handle: (m, body) => sparkAction(Number(m[1]), body) },
    { methods: ["GET"], pattern: /^\/api\/dashboard\/today$/, signedOut: null, handle: () => dashboardToday() },
    { methods: ["GET"], pattern: /^\/api\/calendar\/month$/, signedOut: null, handle: (m, body, query) => calendarMonth(query) },
    { methods: ["GET"], pattern: /^\/api\/notepads$/, handle: (m, body, query) => listNotepads(query) },
    { methods: ["GET"], pattern: /^\/api\/notepads\/active$/, handle: (m, body, query) => listActiveNotepads(query.get("date")) },
    { methods: ["GET"], pattern: /^\/api\/notepads\/theme$/, signedOut: null, handle: (m, body, query) => themeOfDayNotepad(query.get("date")) },
    { methods: ["POST"], pattern: /^\/api\/notepads$/, handle: (m, body) => createNotepad(body) },
    { methods: ["PATCH"], pattern: /^\/api\/notepads\/(\d+)$/, handle: (m, body) => updateNotepad(Number(m[1]), body) },
    { methods: ["DELETE"], pattern: /^\/api\/notepads\/(\d+)$/, handle: (m) => deleteNotepad(Number(m[1])) },
    { methods: ["GET"], pattern: /^\/api\/checklist-templates$/, handle: () => listChecklistTemplates() },
    { methods: ["POST"], pattern: /^\/api\/checklist-templates$/, handle: (m, body) => saveChecklistTemplate(body) },
    { methods: ["PUT"], pattern: /^\/api\/checklist-templates\/(\d+)$/, handle: (m, body) => saveChecklistTemplate(body, Number(m[1])) },
    { methods: ["DELETE"], pattern: /^\/api\/checklist-templates\/(\d+)$/, handle: (m) => deleteChecklistTemplate(Number(m[1])) },
    { methods: ["POST"], pattern: /^\/api\/upload$/, handle: (m, body) => uploadFile(body) },
    { methods: ["GET"], pattern: /^\/api\/projects$/, handle: () => listBinderProjects() },
    {
      methods: ["POST"],
      pattern: /^\/api\/projects$/,
      handle: (m, body) => {
        const f = modelFields(body, { title: "text", description: "text" });
        if (typeof f.title !== "string" || !f.title) throw new ApiError(422, "title is required");
        return createBinderProject(f.title, f.description);
      },
    },
    { methods: ["GET"], pattern: /^\/api\/projects\/(\d+)$/, signedOut: null, handle: (m) => getBinderProject(Number(m[1])) },
    {
      methods: ["PUT"],
      pattern: /^\/api\/projects\/(\d+)$/,
      handle: (m, body) => updateBinderProject(Number(m[1]), modelFields(body, {
        title: "text", description: "text", tracker: "object", status: "text", ...BINDER_STYLE_SHIP_KINDS,
      })),
    },
    { methods: ["DELETE"], pattern: /^\/api\/projects\/(\d+)$/, handle: (m) => deleteBinderProject(Number(m[1])) },
    {
      methods: ["POST"],
      pattern: /^\/api\/projects\/(\d+)\/sections$/,
      handle: (m, body) => {
        const f = modelFields(body, { title: "text", parent_id: "int" });
        return createBinderSection(Number(m[1]), f.title ?? null, f.parent_id ?? null);
      },
    },
    {
      methods: ["PUT"],
      pattern: /^\/api\/projects\/(\d+)\/sections\/reorder$/,
      handle: (m, body) => {
        const f = modelFields(body, { section_ids: "int_list" });
        if (!f.section_ids?.length) throw new ApiError(422, "section_ids must list at least one section");
        return reorderBinderSections(Number(m[1]), f.section_ids);
      },
    },
    {
      methods: ["PUT"],
      pattern: /^\/api\/projects\/sections\/(\d+)$/,
      handle: (m, body) => {
        const f = modelFields(body, { title: "text", blocks: "blocks", columns: "list", ...BINDER_STYLE_SHIP_KINDS });
        const extra = {};
        for (const key of BINDER_STYLE_SHIP_KEYS) {
          if (has(f, key)) extra[key] = f[key];
        }
        if (!given(f.title) && !given(f.blocks) && !given(f.columns) && !Object.keys(extra).length) {
          throw new ApiError(400, "Nothing to update");
        }
        return updateBinderSection(Number(m[1]), f.title ?? null, f.blocks ?? null, f.columns ?? null, extra);
      },
    },
    { methods: ["DELETE"], pattern: /^\/api\/projects\/sections\/(\d+)$/, handle: (m) => deleteBinderSection(Number(m[1])) },
    {
      methods: ["POST"],
      pattern: /^\/api\/projects\/sections\/(\d+)\/lines$/,
      handle: (m, body) => {
        const f = modelFields(body, { content: "text", title: "text", blocks: "blocks", is_completed: "flag" });
        const content = (given(f.content) ? f.content : f.title) || "";
        return createBinderLine(Number(m[1]), content, f.blocks ?? null, f.is_completed ?? false);
      },
    },
    {
      methods: ["PUT"],
      pattern: /^\/api\/projects\/lines\/(\d+)$/,
      handle: (m, body) => {
        const f = modelFields(body, { content: "text", title: "text", blocks: "blocks", is_completed: "flag" });
        const content = given(f.content) ? f.content : f.title ?? null;
        return updateBinderLine(Number(m[1]), content, f.blocks ?? null, f.is_completed ?? null);
      },
    },
    { methods: ["PUT"], pattern: /^\/api\/projects\/lines\/(\d+)\/toggle$/, handle: (m) => toggleBinderLine(Number(m[1])) },
    { methods: ["DELETE"], pattern: /^\/api\/projects\/lines\/(\d+)$/, handle: (m) => deleteBinderLine(Number(m[1])) },
    { methods: ["GET"], pattern: /^\/api\/visions$/, handle: (m, body, query) => listVisionBoards(query) },
    {
      methods: ["POST"],
      pattern: /^\/api\/visions$/,
      handle: (m, body) => createVisionBoard(modelFields(body, { title: "text" }).title ?? null),
    },
    { methods: ["GET"], pattern: /^\/api\/visions\/(\d+)$/, signedOut: null, handle: (m) => getVisionBoard(Number(m[1])) },
    {
      methods: ["PATCH"],
      pattern: /^\/api\/visions\/(\d+)$/,
      handle: (m, body) => updateVisionBoard(Number(m[1]), modelFields(body, { title: "text" })),
    },
    { methods: ["DELETE"], pattern: /^\/api\/visions\/(\d+)$/, handle: (m) => deleteVisionBoard(Number(m[1])) },
    { methods: ["PUT"], pattern: /^\/api\/visions\/(\d+)\/canvas$/, handle: (m, body) => saveVisionCanvas(Number(m[1]), body) },
    { methods: ["PATCH"], pattern: /^\/api\/visions\/(\d+)\/fulfill$/, handle: (m) => fulfillVisionBoard(Number(m[1])) },
    {
      methods: ["POST"],
      pattern: /^\/api\/visions\/(\d+)\/goals$/,
      handle: (m, body) => createVisionGoal(Number(m[1]), goalContent(body)),
    },
    { methods: ["PUT"], pattern: /^\/api\/visions\/goals\/(\d+)$/, handle: (m, body) => updateVisionGoal(Number(m[1]), goalContent(body)) },
    { methods: ["PUT"], pattern: /^\/api\/visions\/goals\/(\d+)\/toggle$/, handle: (m) => toggleVisionGoal(Number(m[1])) },
    { methods: ["DELETE"], pattern: /^\/api\/visions\/goals\/(\d+)$/, handle: (m) => deleteVisionGoal(Number(m[1])) },
    {
      methods: ["POST"],
      pattern: /^\/api\/visions\/(\d+)\/(?:linked-elements|attach)$/,
      handle: (m, body) => linkVisionElement(Number(m[1]), body),
    },
    {
      methods: ["DELETE"],
      pattern: /^\/api\/visions\/(?:linked-elements|attach)\/(\d+)$/,
      handle: (m) => unlinkVisionElement(Number(m[1])),
    },
    {
      methods: ["POST"],
      pattern: /^\/api\/visions\/(\d+)\/blocks$/,
      handle: (m, body) => {
        const f = visionBlockBody(body, true);
        return createVisionBlock(Number(m[1]), f.block_type, f.content ?? null);
      },
    },
    {
      methods: ["PUT"],
      pattern: /^\/api\/visions\/blocks\/(\d+)$/,
      handle: (m, body) => {
        const f = visionBlockBody(body, false);
        return updateVisionBlock(Number(m[1]), f.content ?? null, f.block_type ?? null);
      },
    },
    { methods: ["DELETE"], pattern: /^\/api\/visions\/blocks\/(\d+)$/, handle: (m) => deleteVisionBlock(Number(m[1])) },
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
    { methods: ["GET"], pattern: /^\/api\/vault\/shelves$/, handle: () => listVaultShelves() },
    {
      methods: ["POST"],
      pattern: /^\/api\/vault\/shelves$/,
      handle: (m, body) => createVaultShelf(vaultTitleFields(body, { title: "text", tab_color: "text" }).title ?? null),
    },
    {
      methods: ["PUT"],
      pattern: /^\/api\/vault\/shelves\/order$/,
      handle: (m, body) => reorderVaultShelves(modelFields(body, { shelf_ids: "int_list" }).shelf_ids || []),
    },
    {
      methods: ["PUT"],
      pattern: /^\/api\/vault\/shelves\/(\d+)$/,
      handle: (m, body) => updateVaultShelf(Number(m[1]), vaultTitleFields(body, { title: "text", tab_color: "text" })),
    },
    {
      methods: ["PUT"],
      pattern: /^\/api\/vault\/shelves\/(\d+)\/stacks$/,
      handle: (m, body) => arrangeVaultShelfStacks(Number(m[1]), modelFields(body, { stack_ids: "int_list" }).stack_ids || []),
    },
    { methods: ["DELETE"], pattern: /^\/api\/vault\/shelves\/(\d+)$/, handle: (m) => deleteVaultShelf(Number(m[1])) },
    { methods: ["GET"], pattern: /^\/api\/vault\/stacks$/, handle: () => listVaultStacks() },
    {
      methods: ["POST"],
      pattern: /^\/api\/vault\/stacks$/,
      handle: (m, body) => createVaultStack(vaultTitleFields(body, { title: "text", shelf_id: "int", slot: "int" })),
    },
    {
      methods: ["PUT"],
      pattern: /^\/api\/vault\/stacks\/(\d+)$/,
      handle: (m, body) => updateVaultStack(Number(m[1]), vaultTitleFields(body, { title: "text", shelf_id: "int", slot: "int" })),
    },
    { methods: ["DELETE"], pattern: /^\/api\/vault\/stacks\/(\d+)$/, handle: (m) => deleteVaultStack(Number(m[1])) },
    { methods: ["GET"], pattern: /^\/api\/vault\/notebooks$/, handle: () => listVaultNotebooks() },
    {
      methods: ["POST"],
      pattern: /^\/api\/vault\/notebooks$/,
      handle: (m, body) => {
        const f = modelFields(body, { title: "text", name: "text", stack_id: "int" });
        return createVaultNotebook(f.title || f.name || "", f.stack_id ?? null);
      },
    },
    { methods: ["GET"], pattern: /^\/api\/vault\/notebooks\/(\d+)$/, signedOut: null, handle: (m) => getVaultNotebook(Number(m[1])) },
    {
      methods: ["PUT"],
      pattern: /^\/api\/vault\/notebooks\/(\d+)$/,
      handle: (m, body) => updateVaultNotebook(Number(m[1]), nonEmptyTitle(modelFields(body, {
        title: "text", cover_color: "text", cover_image: "text", spine_color: "text", stack_id: "int",
      }))),
    },
    { methods: ["DELETE"], pattern: /^\/api\/vault\/notebooks\/(\d+)$/, handle: (m) => deleteVaultNotebook(Number(m[1])) },
    {
      methods: ["POST"],
      pattern: /^\/api\/vault\/notebooks\/(\d+)\/chapters$/,
      handle: (m, body) => createVaultChapter(Number(m[1]), modelFields(body, { title: "text" }).title ?? null),
    },
    {
      methods: ["POST"],
      pattern: /^\/api\/vault\/notebooks\/(\d+)\/reorder-chapters$/,
      handle: (m, body) => reorderVaultChapters(Number(m[1]), modelFields(body, { chapter_ids: "int_list" }).chapter_ids || []),
    },
    {
      methods: ["PUT"],
      pattern: /^\/api\/vault\/chapters\/(\d+)$/,
      handle: (m, body) => updateVaultChapter(Number(m[1]), nonEmptyTitle(modelFields(body, {
        title: "text", background_color: "text", background_image: "text",
      }))),
    },
    { methods: ["DELETE"], pattern: /^\/api\/vault\/chapters\/(\d+)$/, handle: (m) => deleteVaultChapter(Number(m[1])) },
    {
      methods: ["POST"],
      pattern: /^\/api\/vault\/chapters\/(\d+)\/lines$/,
      handle: (m, body) => {
        const f = modelFields(body, { content: "text", title: "text", blocks: "blocks", kind: "text", parent_id: "int" });
        const content = (given(f.content) ? f.content : f.title) || "";
        return createVaultLine(Number(m[1]), content, f.blocks ?? null, f.kind ?? null, f.parent_id ?? null);
      },
    },
    {
      methods: ["POST"],
      pattern: /^\/api\/vault\/chapters\/(\d+)\/reorder-lines$/,
      handle: (m, body) => reorderVaultLines(Number(m[1]), vaultLineOrderBody(body)),
    },
    {
      methods: ["PUT"],
      pattern: /^\/api\/vault\/lines\/(\d+)$/,
      handle: (m, body) => {
        const f = modelFields(body, { content: "text", title: "text", blocks: "blocks", collapsed: "flag" });
        const content = given(f.content) ? f.content : f.title ?? null;
        return updateVaultLine(Number(m[1]), content, f.blocks ?? null, f.collapsed ?? null);
      },
    },
    { methods: ["DELETE"], pattern: /^\/api\/vault\/lines\/(\d+)$/, handle: (m) => deleteVaultLine(Number(m[1])) },
    { methods: ["GET"], pattern: /^\/api\/references$/, handle: (m, body, query) => listReferences(query) },
    { methods: ["POST"], pattern: /^\/api\/references$/, handle: (m, body) => saveReference(body, createReference) },
    { methods: ["PATCH"], pattern: /^\/api\/references\/(\d+)$/, handle: (m, body) => updateReferenceRoute(Number(m[1]), body) },
    {
      methods: ["PATCH"],
      pattern: /^\/api\/references\/(\d+)\/move$/,
      handle: (m, body) => updateReference(Number(m[1]), { folder_id: modelFields(body, { folder_id: "int" }).folder_id ?? null }),
    },
    {
      methods: ["PATCH"],
      pattern: /^\/api\/references\/(\d+)\/pin$/,
      handle: (m, body) => pinReference(Number(m[1]), modelFields(body, { is_pinned: "flag" }).is_pinned ?? null),
    },
    { methods: ["GET"], pattern: /^\/api\/reference-folders$/, handle: () => listReferenceFolders() },
    {
      methods: ["POST"],
      pattern: /^\/api\/reference-folders$/,
      handle: (m, body) => {
        const f = folderBody(body, { parent_id: "int", icon: "text" });
        return createReferenceFolder(f.name, f.parent_id ?? null, has(f, "icon") ? f.icon : "📁");
      },
    },
    {
      methods: ["PATCH"],
      pattern: /^\/api\/reference-folders\/(\d+)$/,
      handle: (m, body) => renameReferenceFolder(Number(m[1]), folderBody(body).name),
    },
    { methods: ["DELETE"], pattern: /^\/api\/reference-folders\/(\d+)$/, handle: (m) => deleteReferenceFolder(Number(m[1])) },
    { methods: ["GET"], pattern: /^\/api\/legacy-hall$/, signedOut: null, handle: () => legacyHall() },
    { methods: ["GET"], pattern: /^\/api\/legacy\/milestones$/, signedOut: null, handle: (m, body, query) => legacyMilestones(query) },
  ];

  const OFFLINE_DETAIL = "This part of FICUS isn't available online yet.";

  // Lists the app loads at startup for modules not yet in the cloud; empty keeps every page rendering.
  const PENDING_MODULE_LISTS = [
    /^\/api\/workbench\/projects$/, /^\/api\/scrapbook\/gif-library$/,
    /^\/api\/vision$/, /^\/api\/contacts$/,
  ];

  function signedOutNoun(path) {
    if (path.startsWith("/api/habits")) return "trackers";
    if (path.startsWith("/api/projects")) return "projects";
    if (path.startsWith("/api/notepads")) return "notepads";
    if (/^\/api\/(visions|scrapbook)/.test(path)) return "your visions";
    if (/^\/api\/(vault|references|reference-folders)/.test(path)) return "your Vault";
    if (path === "/api/upload") return "files";
    if (/^\/api\/(tasks|logs|checklist-templates)/.test(path) || path.endsWith("/action")) return "your Log and Time";
    return "figs";
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
