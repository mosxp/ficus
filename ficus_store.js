/* FICUS store: the signed-in user's work, kept in their Google Drive.
 *
 * Everything a user makes is one JSON object, saved as Ficus/ficus_master_backup.json in their Drive
 * (ficus_drive.js):
 *   { format: "ficus-master", version: 2, savedAt,
 *     dots,        Space's dots, each with its `children` (the arrows, in order)
 *     pages,       [{ kind: "board" | "block" | "block_board", id, dotId, data }]: board dots' sheets, block dots'
 *                  grids and scrapboard blocks' boards
 *     tags,        { types: { Type: [Name, ...] }, colors: { "Type:Name": { color } } }
 *     notebooks,   Collection's notebooks, in Shelf order
 *     library,     { checklistTemplates, pads, stickers, palettes, gif } (answered by ficus_cloud.js)
 *     loggers,     tracking loggers' definitions (see ficus_loggers.js)
 *     logger_groups } the groups Manage Loggers clusters them in
 * Version 2 added loggers and logger_groups; a page still on version 1 refuses a version 2 file (parseMaster), so
 * it can't save over them.
 *
 * load(session) reads it once, at sign-in, and space.js and collection.js then read from memory without waiting.
 * Their saves change memory at once; a copy goes into IndexedDB on this device straight after, and 3 seconds after
 * the last change the whole object overwrites the Drive file. Saves that can't reach Drive (offline, or the token
 * ran out) stay on this device and go up once they can, including after a reload.
 */
(function () {
  "use strict";

  const FORMAT = "ficus-master";
  const VERSION = 2;
  const PAGE_KINDS = new Set(["board", "block", "block_board"]);
  const DRIVE_DELAY_MS = 3000;
  const DEVICE_DELAY_MS = 400;
  // After a failed write, the next try waits each of these in turn (the last one from then on).
  const RETRY_MS = [5000, 15000, 30000, 60000];

  // Where each user's data was kept in this browser's localStorage before Drive: <prefix><owner>, the owner being
  // the account id of the time or "local" (pages add :<dot or block id>).
  const LOCAL = {
    dots: "ficus_space_dots_v1:",
    board: "ficus_space_board_v1:",
    block: "ficus_space_blocks_v1:",
    block_board: "ficus_space_block_board_v1:",
    tags: "ficus_master_tags:",
    colors: "ficus_tag_metadata:",
    notebooks: "ficus_notebooks:",
  };
  // Set once a user has skipped syncing this browser's data, so they aren't asked again here.
  const SYNC_SKIPPED = "ficus_cloud_sync_skipped_v1:";

  const drive = () => window.FicusDrive;
  const idb = () => window.FicusIDB;
  const deviceKey = (owner) => `master:${owner}`;

  const isObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
  const list = (value) => (Array.isArray(value) ? value.filter(isObject) : []);
  const pageKey = (kind, id) => `${kind}:${id}`;
  const sameText = (a, b) => a.localeCompare(b, undefined, { sensitivity: "accent" }) === 0;

  const emptyLibrary = () => ({ checklistTemplates: [], pads: [], stickers: [], palettes: [], gif: null });

  let uid = null;
  let dots = [];
  // "kind:id" -> { kind, id, dotId, json }; kept as JSON so every read hands out a fresh copy.
  const pages = new Map();
  let tags = { types: {}, colors: {} };
  let notebooks = [];
  let library = emptyLibrary();
  let loggers = [];
  let loggerGroups = [];

  // The Drive file and the revision of it this device last read or wrote.
  let fileId = null;
  let revision = null;
  // Bumped by every change; `driveSeq` / `deviceSeq` are the changes Drive / this device's copy hold.
  let changeSeq = 0;
  let driveSeq = 0;
  let deviceSeq = 0;
  let driveTimer = 0;
  let deviceTimer = 0;
  let retryTimer = 0;
  let failures = 0;
  let lastError = null;
  let running = null;
  let again = false;
  let shownStatus = "synced";
  const listeners = new Set();

  /* ---------- The master object ---------- */

  function snapshot() {
    return {
      format: FORMAT,
      version: VERSION,
      savedAt: new Date().toISOString(),
      dots,
      pages: [...pages.values()].map(({ kind, id, dotId, json }) => ({ kind, id, dotId, data: JSON.parse(json) })),
      tags,
      notebooks,
      library,
      loggers,
      logger_groups: loggerGroups,
    };
  }

  function apply(master) {
    dots = list(master.dots);
    pages.clear();
    for (const page of list(master.pages)) {
      if (!PAGE_KINDS.has(page.kind) || page.id == null || !isObject(page.data)) continue;
      const id = String(page.id);
      pages.set(pageKey(page.kind, id), { kind: page.kind, id, dotId: page.dotId == null ? null : String(page.dotId), json: JSON.stringify(page.data) });
    }
    tags = {
      types: isObject(master.tags?.types) ? master.tags.types : {},
      colors: isObject(master.tags?.colors) ? master.tags.colors : {},
    };
    notebooks = list(master.notebooks);
    const saved = isObject(master.library) ? master.library : {};
    library = {
      checklistTemplates: list(saved.checklistTemplates),
      pads: list(saved.pads),
      stickers: list(saved.stickers),
      palettes: list(saved.palettes),
      gif: isObject(saved.gif) ? saved.gif : null,
    };
    loggers = list(master.loggers);
    loggerGroups = list(master.logger_groups);
  }

  // The Drive file's text as a master object; throws (so nothing overwrites it) if it isn't one.
  function parseMaster(text) {
    let master;
    try {
      master = JSON.parse(text);
    } catch (_) {
      throw new Error(`${drive().MASTER_NAME} in your Google Drive isn't valid JSON, so Ficus won't overwrite it. Fix or remove it, then try again.`);
    }
    if (!isObject(master) || (master.format !== undefined && master.format !== FORMAT)) {
      throw new Error(`${drive().MASTER_NAME} in your Google Drive isn't a Ficus backup, so Ficus won't overwrite it.`);
    }
    if (Number(master.version) > VERSION) {
      throw new Error(`${drive().MASTER_NAME} was saved by a newer version of Ficus. Reload the page to update.`);
    }
    return master;
  }

  // Local time, e.g. "2026-10-12 14-52" (no colon, so the copy can be downloaded to Windows as it is).
  function stamp() {
    const now = new Date();
    const two = (value) => String(value).padStart(2, "0");
    return `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())} ${two(now.getHours())}-${two(now.getMinutes())}`;
  }
  const copyName = (why) => `ficus_master_backup (${why} ${stamp()}).json`;

  /* ---------- Status ---------- */

  const unsaved = () => driveSeq !== changeSeq;
  const needsAuth = () => lastError instanceof drive().AuthError;

  // "synced": Drive has everything. "saving": a write is waiting or on its way. "offline": the last write failed
  // (or there's no connection); changes are kept on this device until one gets through.
  function currentStatus() {
    if (!unsaved()) return "synced";
    if (lastError || !navigator.onLine) return "offline";
    return "saving";
  }

  function setStatus() {
    const next = `${currentStatus()}${needsAuth() ? ":auth" : ""}`;
    if (next === shownStatus) return;
    shownStatus = next;
    listeners.forEach((listener) => {
      try { listener(currentStatus(), { needsAuth: needsAuth(), error: lastError }); } catch (err) { console.error(err); }
    });
  }

  /* ---------- This device's copy (IndexedDB) ---------- */

  // { master, fileId, revision, unsaved }: everything, the Drive file it came from, and whether Drive lacks some.
  async function writeDevice() {
    clearTimeout(deviceTimer);
    deviceTimer = 0;
    if (!uid) return;
    const owner = uid;
    const seq = changeSeq;
    try {
      await idb().set(deviceKey(owner), { master: snapshot(), fileId, revision, unsaved: driveSeq !== seq });
      if (owner === uid) deviceSeq = Math.max(deviceSeq, seq);
    } catch (err) {
      console.warn("FICUS: couldn't keep a copy on this device", err);
    }
  }

  function scheduleDevice() {
    clearTimeout(deviceTimer);
    deviceTimer = setTimeout(() => void writeDevice(), DEVICE_DELAY_MS);
  }

  /* ---------- Writing to Drive ---------- */

  // Overwrites the Drive file with everything. If it changed since this device last read or wrote it (another
  // device saved in between), that version is kept beside it as a copy first.
  async function pushOnce() {
    const text = JSON.stringify(snapshot());
    if (!fileId) {
      // Loaded without reaching Drive: a file made since (or before) is kept as a copy, not silently replaced.
      const found = await drive().findMaster();
      if (found) {
        await drive().keepCopy(copyName("replaced"), { id: found.id });
        fileId = found.id;
        revision = found.headRevisionId || null;
      }
    }
    if (fileId) {
      const current = await drive().getFile(fileId).catch((err) => {
        if (err.status === 404) return null;
        throw err;
      });
      if (current && !current.trashed) {
        if (revision && current.headRevisionId !== revision) {
          await drive().keepCopy(copyName("replaced"), { id: fileId });
        }
        const saved = await drive().updateMaster(fileId, text);
        revision = saved.headRevisionId || null;
        return;
      }
      fileId = null;
    }
    const made = await drive().createMaster(text);
    fileId = made.id;
    revision = made.headRevisionId || null;
  }

  function scheduleDrive(delay = DRIVE_DELAY_MS) {
    if (!uid || retryTimer) return;
    clearTimeout(driveTimer);
    driveTimer = setTimeout(() => {
      driveTimer = 0;
      void pump();
    }, delay);
  }

  function pump() {
    if (running) {
      again = true;
      return running;
    }
    running = (async () => {
      do {
        again = false;
        if (!uid || !unsaved()) break;
        const owner = uid;
        const seq = changeSeq;
        try {
          await pushOnce();
          if (owner !== uid) return;
          driveSeq = seq;
          failures = 0;
          lastError = null;
        } catch (err) {
          if (owner !== uid) return;
          lastError = err;
          failures += 1;
          console.warn("FICUS: saving to Google Drive failed; kept on this device for now.", err);
          // Without a token only Reconnect helps; anything else is tried again later.
          if (!(err instanceof drive().AuthError)) {
            retryTimer = setTimeout(() => {
              retryTimer = 0;
              void pump();
            }, RETRY_MS[Math.min(failures, RETRY_MS.length) - 1]);
          }
          return;
        } finally {
          setStatus();
        }
        await writeDevice();
        // Changes made meanwhile wait out their own delay, unless it already ran out during this write.
      } while (again);
    })().finally(() => {
      running = null;
      setStatus();
    });
    setStatus();
    return running;
  }

  function changed() {
    if (!uid) return;
    changeSeq += 1;
    scheduleDevice();
    scheduleDrive();
    setStatus();
  }

  // Sends everything now; rejects if Drive still lacks some of it.
  async function flush() {
    clearTimeout(driveTimer);
    driveTimer = 0;
    clearTimeout(retryTimer);
    retryTimer = 0;
    await pump();
    if (running) await running;
    if (unsaved()) {
      await writeDevice();
      throw lastError || new Error("Some changes couldn't be saved to Google Drive");
    }
  }

  // Tries Drive again now (after Reconnect, or when the connection is back).
  function retry() {
    clearTimeout(retryTimer);
    retryTimer = 0;
    if (unsaved()) void pump();
  }

  window.addEventListener("online", () => {
    setStatus();
    retry();
  });
  window.addEventListener("offline", setStatus);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "hidden" || !uid) return;
    if (deviceSeq !== changeSeq) void writeDevice();
    if (driveTimer) {
      clearTimeout(driveTimer);
      driveTimer = 0;
      void pump();
    }
  });
  // Changes not yet on this device would be lost; ones only missing from Drive go up next time.
  window.addEventListener("beforeunload", (event) => {
    if (!uid || deviceSeq === changeSeq) return;
    void writeDevice();
    event.preventDefault();
    event.returnValue = "";
  });

  /* ---------- Reading ---------- */

  function reset() {
    [driveTimer, deviceTimer, retryTimer].forEach(clearTimeout);
    driveTimer = 0;
    deviceTimer = 0;
    retryTimer = 0;
    failures = 0;
    lastError = null;
    again = false;
    uid = null;
    fileId = null;
    revision = null;
    changeSeq = 0;
    driveSeq = 0;
    deviceSeq = 0;
    dots = [];
    pages.clear();
    tags = { types: {}, colors: {} };
    notebooks = [];
    library = emptyLibrary();
    loggers = [];
    loggerGroups = [];
    setStatus();
  }

  /* Reads the user's work: from Drive, or from this device's copy when that holds changes Drive lacks (or Drive
     can't be reached). Rejects, keeping nothing, if neither is available. */
  async function load(session) {
    if (!drive() || !idb()) throw new Error("Ficus's Drive layer didn't load. Reload the page.");
    if (!session?.uid) throw new Error("No one is signed in.");
    reset();
    const owner = session.uid;
    const device = await idb().get(deviceKey(owner)).catch(() => null);

    let remote;
    try {
      remote = await drive().findMaster();
    } catch (err) {
      if (!device?.master) throw err;
      // Offline (or the token ran out): carry on with this device's copy and save to Drive once it's back.
      uid = owner;
      apply(device.master);
      ({ fileId, revision } = device);
      lastError = err;
      changeSeq = device.unsaved ? 1 : 0;
      deviceSeq = changeSeq;
      if (device.unsaved) scheduleDrive(RETRY_MS[0]);
      setStatus();
      return;
    }

    const local = device?.master && device.unsaved ? device : null;
    let master = null;
    let keepLocal = false;
    if (remote) {
      if (local && local.fileId === remote.id && local.revision === remote.headRevisionId) {
        keepLocal = true;
      } else {
        master = parseMaster(await drive().download(remote.id));
        if (local) {
          // Both changed since they last matched: the newer one stays, the other is kept in Drive as a copy.
          if (Date.parse(local.master.savedAt) > Date.parse(master.savedAt)) {
            await drive().keepCopy(copyName("replaced"), { id: remote.id });
            keepLocal = true;
          } else {
            await drive().keepCopy(copyName("unsynced from a device"), { text: JSON.stringify(local.master) });
          }
        }
      }
    } else {
      // No file in Drive yet (or it was deleted): start one from this device's copy, or empty.
      keepLocal = Boolean(device?.master);
    }

    uid = owner;
    if (keepLocal) {
      apply(device.master);
      fileId = remote?.id || null;
      revision = remote?.headRevisionId || null;
    } else {
      apply(master || {});
      fileId = remote?.id || null;
      revision = remote?.headRevisionId || null;
    }
    // Drive needs a write if this device's copy won or there's no file yet.
    changeSeq = keepLocal || !remote ? 1 : 0;
    driveSeq = 0;
    deviceSeq = 0;
    await writeDevice();
    if (unsaved()) scheduleDrive(0);
    setStatus();
  }

  // Signing out: forgets the user's work in memory, and on this device too unless Drive still lacks some of it.
  async function signOut() {
    const owner = uid;
    const keep = unsaved();
    if (owner && keep) await writeDevice();
    reset();
    if (owner && !keep) await idb().del(deviceKey(owner)).catch(() => {});
  }

  /* ---------- This browser's data from before Drive (localStorage) ---------- */

  function readLocal(key) {
    try {
      return JSON.parse(localStorage.getItem(key));
    } catch (_) {
      return null;
    }
  }

  /* Ficus data still in this browser's localStorage (anyone's who used it here, and what was made signed out),
     unless this user has skipped syncing it here before: { keys, dots, pages, types, colors, notebooks, counts },
     or null if there's nothing. */
  function findLocalData() {
    if (!uid) return null;
    let keys;
    try {
      if (localStorage.getItem(SYNC_SKIPPED + uid)) return null;
      keys = Object.keys(localStorage);
    } catch (_) {
      return null;
    }
    const found = { keys: [], dots: [], pages: [], types: [], colors: [], notebooks: [] };
    for (const key of keys) {
      for (const [name, prefix] of Object.entries(LOCAL)) {
        if (!key.startsWith(prefix)) continue;
        const tail = key.slice(prefix.length);
        if (!tail) break;
        const data = readLocal(key);
        found.keys.push(key);
        if (PAGE_KINDS.has(name)) {
          // <owner>:<id>; owners never contain a colon.
          const id = tail.slice(tail.indexOf(":") + 1);
          if (tail.includes(":") && id && isObject(data)) found.pages.push({ kind: name, id, data });
        } else {
          if (name === "dots" && Array.isArray(data)) found.dots.push(...data.filter(isObject));
          if (name === "notebooks" && Array.isArray(data)) found.notebooks.push(...data.filter(isObject));
          if (name === "tags" && isObject(data?.Types) && Object.keys(data.Types).length) found.types.push(data.Types);
          if (name === "colors" && isObject(data) && Object.keys(data).length) found.colors.push(data);
        }
        break;
      }
    }
    const counts = { dots: found.dots.length, notebooks: found.notebooks.length, pages: found.pages.length, tags: found.types.length + found.colors.length };
    if (!counts.dots && !counts.notebooks && !counts.pages && !counts.tags) return null;
    return { ...found, counts };
  }

  // Merges this browser's data into the user's (what they already have, by id, stays as it is), saves it to Drive,
  // then removes it from localStorage. Rejects, leaving localStorage alone, if Drive didn't take it.
  async function importLocalData(found) {
    if (!uid || !found) return;
    const knownDots = new Set(dots.map((dot) => dot.id));
    const added = [];
    for (const dot of found.dots) {
      if (typeof dot.id !== "string" || knownDots.has(dot.id)) continue;
      knownDots.add(dot.id);
      added.push(dot);
    }
    if (added.length) dots = [...dots, ...added];

    const blockOf = new Map();
    for (const page of found.pages) {
      if (page.kind !== "block" || !Array.isArray(page.data.blocks)) continue;
      for (const item of page.data.blocks) {
        const blockId = item?.block?.id ?? item?.id;
        if (blockId != null) blockOf.set(String(blockId), page.id);
      }
    }
    for (const page of found.pages) {
      if (pages.has(pageKey(page.kind, page.id))) continue;
      writePage(page.kind, page.id, page.data, page.kind === "block_board" ? blockOf.get(page.id) || null : page.id);
    }

    if (found.types.length || found.colors.length) {
      const types = Object.entries(tags.types).map(([type, names]) => [type, Array.isArray(names) ? [...names] : []]);
      for (const extra of found.types) {
        for (const [type, names] of Object.entries(extra)) {
          let entry = types.find(([known]) => sameText(known, type));
          if (!entry) types.push(entry = [type, []]);
          for (const name of Array.isArray(names) ? names : []) {
            if (typeof name === "string" && !entry[1].some((known) => sameText(known, name))) entry[1].push(name);
          }
        }
      }
      const colors = { ...tags.colors };
      for (const extra of found.colors) {
        for (const [id, meta] of Object.entries(extra)) {
          if (!Object.keys(colors).some((known) => sameText(known, id))) colors[id] = meta;
        }
      }
      tags = { types: Object.fromEntries(types), colors };
    }

    const knownBooks = new Set(notebooks.map((book) => book.id));
    const books = found.notebooks.filter((book) => typeof book.id === "string" && !knownBooks.has(book.id));
    if (books.length) notebooks = [...notebooks, ...books];

    changed();
    await flush();
    found.keys.forEach((key) => {
      try { localStorage.removeItem(key); } catch (_) {}
    });
  }

  function skipLocalData() {
    if (!uid) return;
    try { localStorage.setItem(SYNC_SKIPPED + uid, new Date().toISOString()); } catch (_) {}
  }

  /* ---------- What space.js, collection.js and ficus_cloud.js call ---------- */

  function writePage(kind, id, data, dotId) {
    pages.set(pageKey(kind, id), { kind, id: String(id), dotId: dotId == null ? null : String(dotId), json: JSON.stringify(data) });
  }

  window.FicusStore = {
    get uid() {
      return uid;
    },
    get status() {
      return currentStatus();
    },
    get needsAuth() {
      return needsAuth();
    },
    load,
    flush,
    retry,
    signOut,
    // Forgets the user's work in memory only.
    clear: reset,
    // Calls back with ("synced" | "saving" | "offline", { needsAuth, error }) now and whenever that changes.
    onStatus(listener) {
      listeners.add(listener);
      listener(currentStatus(), { needsAuth: needsAuth(), error: lastError });
      return () => listeners.delete(listener);
    },

    // Dot objects as space.js keeps them (see the Dot typedef there), each with its `children`.
    getDots: () => dots,
    saveDots(next) {
      if (!uid || !Array.isArray(next)) return;
      dots = next;
      changed();
    },

    // A page's saved state as an object (a fresh copy each time), or null. kind: "board" | "block" | "block_board".
    getPage(kind, id) {
      const entry = pages.get(pageKey(kind, id));
      return entry ? JSON.parse(entry.json) : null;
    },
    setPage(kind, id, data, dotId = null) {
      if (!uid || !PAGE_KINDS.has(kind) || !isObject(data)) return;
      writePage(kind, id, data, dotId);
      changed();
    },
    removePage(kind, id) {
      if (!uid || !PAGE_KINDS.has(kind) || !pages.delete(pageKey(kind, id))) return;
      changed();
    },

    // { types: { Type: [Name, ...] }, colors: { "Type:Name": { color } } }
    getTags: () => tags,
    saveTagTypes(types) {
      if (!uid || !isObject(types)) return;
      tags = { ...tags, types };
      changed();
    },
    saveTagColors(colors) {
      if (!uid || !isObject(colors)) return;
      tags = { ...tags, colors };
      changed();
    },

    // Notebook objects as collection.js keeps them, in Shelf order.
    getNotebooks: () => notebooks,
    saveNotebooks(next) {
      if (!uid || !Array.isArray(next)) return;
      notebooks = next;
      changed();
    },

    // Loggers and their groups as ficus_loggers.js keeps them (it checks their shape); saved together, as a logger's
    // groupId points into the groups.
    getLoggers: () => ({ loggers, groups: loggerGroups }),
    saveLoggers(nextLoggers, nextGroups) {
      if (!uid || !Array.isArray(nextLoggers) || !Array.isArray(nextGroups)) return;
      loggers = nextLoggers;
      loggerGroups = nextGroups;
      changed();
    },

    // The libraries ficus_cloud.js answers /api/checklist-templates and /api/scrapbook/... from. `edit` changes
    // them in place and its result is returned; they're saved with everything else.
    getLibrary: () => library,
    editLibrary(edit) {
      if (!uid) throw new Error("No one is signed in.");
      const result = edit(library);
      changed();
      return result;
    },

    findLocalData,
    importLocalData,
    skipLocalData,
  };
})();
