/* FICUS cloud layer.
 *
 * When no local FastAPI backend is reachable (the static site on GitHub Pages),
 * this answers the app's `/api/...` requests from Supabase instead. Ported
 * routes mirror main.py / database.py so the rest of index.html is unchanged.
 * With the local server running, every request passes straight through.
 *
 * Ported so far: Figs (inbox sparks), tags, Trackers (habits), and the Log and
 * Time pages (tasks, events and log entries, plus checklist templates).
 */
(function () {
  "use strict";

  // Pages whose data lives in Supabase; index.html locks the other nav tabs on the static site.
  window.FICUS_ONLINE_VIEWS = ["cover", "sparks", "habits", "today", "tasks"];

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

  // Projects aren't online yet, so no task can point at one.
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

  async function clearThemeOfDay(dateKey, exceptId) {
    const key = text(dateKey);
    if (!key) return;
    let query = client.from("sparks").update({ is_theme_of_day: 0 })
      .eq("item_type", "task").eq("entry_type", "event").eq("is_theme_of_day", 1).eq("due_date", key);
    if (given(exceptId)) query = query.neq("id", exceptId);
    await run(query);
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
    const days = [];
    for (let day = first; day <= last; day = shiftDays(day, 1)) {
      const key = dayKey(day);
      days.push({ date: key, tasks: tasks.filter((task) => task.due_date === key), notepads: [] });
    }
    return { year, month, start_date: dayKey(first), end_date: dayKey(last), days, notepads: [] };
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
    if (target !== "habit") throw new ApiError(503, OFFLINE_DETAIL);
    const row = await run(client.from("sparks").update({
      item_type: "habit",
      assignee,
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
    { methods: ["GET"], pattern: /^\/api\/checklist-templates$/, handle: () => listChecklistTemplates() },
    { methods: ["POST"], pattern: /^\/api\/checklist-templates$/, handle: (m, body) => saveChecklistTemplate(body) },
    { methods: ["PUT"], pattern: /^\/api\/checklist-templates\/(\d+)$/, handle: (m, body) => saveChecklistTemplate(body, Number(m[1])) },
    { methods: ["DELETE"], pattern: /^\/api\/checklist-templates\/(\d+)$/, handle: (m) => deleteChecklistTemplate(Number(m[1])) },
  ];

  const OFFLINE_DETAIL = "This part of FICUS isn't available online yet.";

  // Lists the app loads at startup for modules not yet in the cloud; empty keeps every page rendering.
  const PENDING_MODULE_LISTS = [
    /^\/api\/workbench\/projects$/, /^\/api\/projects$/,
    /^\/api\/references$/, /^\/api\/reference-folders$/, /^\/api\/vault\/notebooks$/,
    /^\/api\/vision$/, /^\/api\/visions$/, /^\/api\/contacts$/, /^\/api\/notepads(\/active)?$/,
  ];

  function signedOutNoun(path) {
    if (path.startsWith("/api/habits")) return "trackers";
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
