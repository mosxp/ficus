/* FICUS cloud layer.
 *
 * When no local FastAPI backend is reachable (the static site on GitHub Pages),
 * this answers the app's `/api/...` requests from Supabase instead. Ported
 * routes mirror main.py / database.py so the rest of index.html is unchanged.
 * With the local server running, every request passes straight through.
 *
 * Ported so far: Figs (inbox sparks) and tags.
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

  function localHhmm() {
    const now = new Date();
    return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
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
  ];

  // Lists the app loads at startup for modules not yet in the cloud; empty keeps every page rendering.
  const PENDING_MODULE_LISTS = [
    /^\/api\/tasks$/, /^\/api\/workbench\/projects$/, /^\/api\/projects$/, /^\/api\/habits$/,
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
          ? jsonResponse(200, [])
          : jsonResponse(401, { detail: "Sign in with Google to save figs." });
      }
      try {
        return jsonResponse(200, await route.handle(match, request.body));
      } catch (err) {
        const status = err instanceof ApiError ? err.status : 500;
        return jsonResponse(status, { detail: err?.message || "Cloud request failed" });
      }
    }

    if (request.method === "GET" && PENDING_MODULE_LISTS.some((pattern) => pattern.test(request.path))) {
      return jsonResponse(200, []);
    }
    return jsonResponse(503, { detail: "This part of FICUS isn't available online yet." });
  };
})();
