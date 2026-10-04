/* FICUS cloud layer.
 *
 * When no local FastAPI backend is reachable (the static site on GitHub Pages),
 * this answers the app's `/api/...` requests from Supabase instead. Ported
 * routes mirror main.py / database.py so the rest of index.html is unchanged.
 * With the local server running, every request passes straight through.
 *
 * Ported so far: Figs (inbox sparks), tags, and Trackers (habits).
 */
(function () {
  "use strict";

  // Pages whose data lives in Supabase; index.html locks the other nav tabs on the static site.
  window.FICUS_ONLINE_VIEWS = ["cover", "sparks", "habits"];

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
        .catch(() => false);
    }
    return backendProbe;
  }

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

  async function run(query) {
    const { data, error } = await query;
    if (error) throw new ApiError(500, error.message || "Cloud request failed");
    return data;
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

  // Check-ins also write the day's Log entry so it is already there when the Log page moves online.
  async function recordHabitLogEntry(habitId, key, habit, entry) {
    const [summary, notesHtml] = habitCheckInSummary(habit, entry);
    const title = clip(`:: Habit — ${habit.title || "Habit"}: ${summary}`, 240);
    const plain = stripTags(notesHtml);
    const report = habitTrackerBlock(habitId, key, habit, entry);
    const candidates = await run(client.from("sparks").select("id, extra_data")
      .eq("item_type", "task").eq("entry_type", "log").eq("due_date", key)
      .eq("extra_data->>habit_id", String(habitId)));
    const existing = candidates.find((row) => String(row.extra_data?.habit_log_date || key) === key);
    if (existing) {
      const taskExtra = withTrackerReport(isPlainObject(existing.extra_data) ? existing.extra_data : {}, report);
      await run(client.from("sparks").update({
        title, raw_content: plain, notes: taskExtra.notes || null, extra_data: taskExtra,
      }).eq("id", existing.id));
      return;
    }
    await run(client.from("sparks").insert({
      title,
      raw_content: plain,
      status: "in_cloud",
      item_type: "task",
      is_done: 0,
      assignee: "Me",
      extra_data: {
        blocks: [report],
        migration_history: [{ action: "created", type: "log", timestamp: localHhmm() }],
        habit_id: habitId,
        habit_log_date: key,
      },
      due_date: key,
      end_date: key,
      notes: null,
      is_routine: 0,
      recurrence_days: "[]",
      task_status: "pending",
      postponed_count: 0,
      is_parked: 0,
      entry_type: "log",
      is_theme_of_day: 0,
      is_all_day: 0,
      is_multiday: 0,
    }));
  }

  async function checkInHabit(id, body) {
    const submission = habitLogFields(body);
    const key = cleanDueDate(submission.date);
    if (!key) throw new ApiError(400, "date is required");
    const completed = given(submission.completed) ? Boolean(submission.completed) : true;
    const habit = await logHabit(id, key, completed, submission.value, submission.values, submission);
    const entry = (habit.extra_data.history || {})[key] || {};
    try {
      await recordHabitLogEntry(id, key, habit, entry);
    } catch (err) {
      console.warn("Tracker check-in saved, but its Log entry was not:", err?.message || err);
    }
    // The Log page is still offline, so its entry isn't handed back to the open page yet.
    return { habit, log_entry: null };
  }

  async function convertFig(id, body) {
    const target = text(body.target_type || body.item_type).toLowerCase();
    if (!target) throw new ApiError(400, "target_type or item_type is required");
    const spark = await requireSpark(id);
    if ((spark.item_type || "spark") !== "spark") throw new ApiError(400, "Only inbox sparks can be converted");
    if (target !== "habit") throw new ApiError(503, OFFLINE_DETAIL);
    const row = await run(client.from("sparks").update({
      item_type: "habit",
      assignee: given(body.assignee) ? text(body.assignee) || "Me" : "Me",
      extra_data: normalizeHabitExtra(isPlainObject(body.extra_data) ? body.extra_data : {}),
      is_done: 0,
      task_status: null,
      due_date: null,
      due_time: null,
    }).eq("id", id).select("*").single());
    return serializeSpark(row);
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
  ];

  const OFFLINE_DETAIL = "This part of FICUS isn't available online yet.";

  // Lists the app loads at startup for modules not yet in the cloud; empty keeps every page rendering.
  const PENDING_MODULE_LISTS = [
    /^\/api\/tasks$/, /^\/api\/workbench\/projects$/, /^\/api\/projects$/,
    /^\/api\/references$/, /^\/api\/reference-folders$/, /^\/api\/vault\/notebooks$/,
    /^\/api\/vision$/, /^\/api\/visions$/, /^\/api\/contacts$/, /^\/api\/notepads(\/active)?$/,
    /^\/api\/logs$/,
  ];

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
    if (!request || (await hasLocalBackend())) return nativeFetch(input, init);

    for (const route of ROUTES) {
      if (!route.methods.includes(request.method)) continue;
      const match = request.path.match(route.pattern);
      if (!match) continue;
      if (!client) return jsonResponse(503, { detail: "Cloud sync is unavailable right now." });
      await sessionReady;
      if (!session) {
        const what = request.path.startsWith("/api/habits") ? "trackers" : "figs";
        return request.method === "GET"
          ? jsonResponse(200, [])
          : jsonResponse(401, { detail: `Sign in with Google to save ${what}.` });
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
