/* FICUS Google sign-in and Google Drive.
 *
 * Ficus keeps each user's work in their own Google Drive, in a "Ficus" folder it creates in My Drive:
 *   Ficus/ficus_master_backup.json   everything they've made (written by ficus_store.js)
 *   Ficus/uploads/                   photos, files, audio, video, stickers and sticky pads
 * The drive.file scope lets Ficus see only the files it made there, nothing else in the user's Drive.
 *
 * Sign-in uses Google Identity Services for an access token and the Google API client (gapi) to call Drive.
 * Tokens last about an hour and the browser gets no refresh token, so once one runs out the user presses
 * Reconnect (a new token needs a click, for the popup). The session (profile and token) is kept in IndexedDB,
 * where ficus_sw.js reads the token to serve uploads at /drive-file/<file id>.
 *
 * The same token can carry the calendar.events scope, for Calendar Event blocks (find or make events in the
 * user's primary calendar). Drive is required; Calendar is optional, so someone who unticks it (or signed in
 * before Ficus asked for it) still gets in, and is asked again only when they add a calendar block.
 */
(function () {
  "use strict";

  const config = window.FICUS_GOOGLE_CONFIG || {};
  const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
  const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.events";
  const SCOPES = `${DRIVE_SCOPE} ${CALENDAR_SCOPE} openid email profile`;
  const GIS_SRC = "https://accounts.google.com/gsi/client";
  const GAPI_SRC = "https://apis.google.com/js/api.js";
  const DISCOVERY = "https://www.googleapis.com/discovery/v1/apis/drive/v3/rest";
  const CALENDAR_DISCOVERY = "https://www.googleapis.com/discovery/v1/apis/calendar/v3/rest";
  const DRIVE_API = "https://www.googleapis.com/drive/v3";
  const UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";
  const USERINFO = "https://www.googleapis.com/oauth2/v3/userinfo";
  const FOLDER_MIME = "application/vnd.google-apps.folder";
  const FOLDER_NAME = "Ficus";
  const UPLOADS_NAME = "uploads";
  const MASTER_NAME = "ficus_master_backup.json";
  // A token this close to running out counts as gone, so nothing starts that it can't finish.
  const TOKEN_MARGIN_MS = 60 * 1000;
  // Larger bodies go up in a resumable upload (Drive's simple and multipart uploads are meant for 5MB or less).
  const SIMPLE_UPLOAD_MAX = 4 * 1024 * 1024;
  const FILE_URL_PREFIX = "/drive-file/";
  // Keep these in step with FILE_PATH and CACHE in ficus_sw.js.
  const FILE_URL = /^\/drive-file\/([\w-]+)(?:\.[a-z0-9]{1,8})?$/i;
  const FILE_CACHE = "ficus-drive-files-v1";

  /* ---------- IndexedDB (shared with ficus_sw.js and ficus_store.js) ---------- */

  const idb = (() => {
    let opening = null;
    function open() {
      if (!opening) {
        opening = new Promise((resolve, reject) => {
          const request = indexedDB.open("ficus", 1);
          request.onupgradeneeded = () => request.result.createObjectStore("kv");
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        opening.catch(() => { opening = null; });
      }
      return opening;
    }
    async function run(mode, action) {
      const db = await open();
      return new Promise((resolve, reject) => {
        const tx = db.transaction("kv", mode);
        const request = action(tx.objectStore("kv"));
        tx.oncomplete = () => resolve(request.result);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
    }
    return {
      get: (key) => run("readonly", (kv) => kv.get(key)),
      set: (key, value) => run("readwrite", (kv) => kv.put(value, key)),
      del: (key) => run("readwrite", (kv) => kv.delete(key)),
    };
  })();
  window.FicusIDB = idb;

  /* ---------- Errors ---------- */

  class DriveError extends Error {
    constructor(message, status = 0) {
      super(message);
      this.status = status;
    }
  }
  // The token is missing, ran out or was refused: only Reconnect can fix it.
  class AuthError extends DriveError {}
  // The token works but doesn't carry the Calendar scope: only connectCalendar() (from a click) can fix it.
  class CalendarAccessError extends DriveError {}

  function driveError(status, message) {
    if (status === 401) return new AuthError("Google Drive needs you to reconnect.", 401);
    if (!status) return new DriveError("Google Drive couldn't be reached. Check the connection.", 0);
    return new DriveError(message || `Google Drive answered ${status}.`, status);
  }

  /* ---------- Loading Google's libraries ---------- */

  function loadScript(src, ready) {
    if (ready()) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = src;
      script.async = true;
      script.onload = () => (ready() ? resolve() : reject(new DriveError("Google's sign-in library didn't start.")));
      script.onerror = () => {
        script.remove();
        reject(new DriveError("Google's sign-in library couldn't be loaded. Check the connection (or an ad blocker) and reload."));
      };
      document.head.append(script);
    });
  }

  let preparing = null;
  let tokenClient = null;
  let pendingToken = null;

  // Loads Google Identity Services and gapi with the Drive API, and makes the token client. Safe to call again.
  function prepare() {
    if (!preparing) {
      preparing = (async () => {
        if (!config.clientId) throw new DriveError("Google sign-in isn't set up: add the OAuth client ID to FICUS_GOOGLE_CONFIG in index.html.");
        await Promise.all([
          loadScript(GIS_SRC, () => Boolean(window.google?.accounts?.oauth2)),
          loadScript(GAPI_SRC, () => Boolean(window.gapi?.load)),
        ]);
        await new Promise((resolve, reject) => {
          window.gapi.load("client", { callback: resolve, onerror: () => reject(new DriveError("The Google API client didn't load.")) });
        });
        await window.gapi.client.init({ discoveryDocs: [DISCOVERY] });
        calendarApi().catch(() => {});
        if (session?.accessToken) window.gapi.client.setToken({ access_token: session.accessToken });
        tokenClient = window.google.accounts.oauth2.initTokenClient({
          client_id: config.clientId,
          scope: SCOPES,
          include_granted_scopes: true,
          callback: (response) => settleToken(response),
          error_callback: (error) => settleToken({ error: error?.type || "unknown" }),
        });
      })();
      preparing.catch(() => { preparing = null; });
    }
    return preparing;
  }

  // The Calendar API (gapi.client.calendar), loaded apart from Drive's so a failure here leaves Drive working.
  let calendarLoading = null;
  function calendarApi() {
    if (window.gapi?.client?.calendar) return Promise.resolve(window.gapi.client.calendar);
    if (!calendarLoading) {
      calendarLoading = Promise.resolve(window.gapi.client.load(CALENDAR_DISCOVERY)).then(() => window.gapi.client.calendar);
      calendarLoading.catch(() => { calendarLoading = null; });
    }
    return calendarLoading;
  }

  /* ---------- Session ---------- */

  const SESSION_KEY = "session";
  // { uid, email, name, picture, accessToken, expiresAt, calendar }; uid is the Google account's stable id ("sub"),
  // and calendar says whether the token carries the Calendar scope.
  let session = null;
  const listeners = new Set();

  const tokenLive = () => Boolean(session?.accessToken) && session.expiresAt - TOKEN_MARGIN_MS > Date.now();

  function announce() {
    listeners.forEach((listener) => {
      try { listener(session, tokenLive()); } catch (err) { console.error(err); }
    });
  }

  function useToken(token) {
    window.gapi?.client?.setToken(token ? { access_token: token } : null);
  }

  // The session kept from last time, or null. With `live` false its token has run out (sign in again).
  async function restore() {
    try {
      session = (await idb.get(SESSION_KEY)) || null;
    } catch (_) {
      session = null;
    }
    if (session && !session.uid) session = null;
    if (session) useToken(session.accessToken);
    return session ? { ...session, live: tokenLive() } : null;
  }

  function settleToken(response) {
    const waiting = pendingToken;
    pendingToken = null;
    if (!waiting) return;
    if (response?.error) {
      const closed = response.error === "popup_closed" || response.error === "access_denied";
      const blocked = response.error === "popup_failed_to_open";
      const error = new DriveError(closed ? "Sign-in was cancelled."
        : blocked ? "The Google sign-in window was blocked. Allow pop-ups for this site and try again."
          : `Google sign-in failed (${response.error_description || response.error}).`);
      error.cancelled = closed;
      waiting.reject(error);
      return;
    }
    if (!window.google.accounts.oauth2.hasGrantedAllScopes(response, DRIVE_SCOPE)) {
      waiting.reject(new DriveError("Ficus needs access to its own folder in your Google Drive to save your work. Tick the Drive box when Google asks."));
      return;
    }
    waiting.resolve(response);
  }

  /* Opens Google's sign-in popup. It must be called straight from a click (browsers block popups opened later),
     after prepare() has finished. Resolves with the session once the profile is in. */
  function requestToken({ hint = "", prompt = "" } = {}) {
    if (!tokenClient) return Promise.reject(new DriveError("Still connecting to Google. Try again in a moment."));
    if (pendingToken) pendingToken.reject(new DriveError("Sign-in was restarted."));
    const token = new Promise((resolve, reject) => { pendingToken = { resolve, reject }; });
    tokenClient.requestAccessToken({ prompt, login_hint: hint || undefined });
    return token.then(async (response) => {
      const res = await fetch(USERINFO, { headers: { Authorization: `Bearer ${response.access_token}` } }).catch(() => null);
      const profile = res?.ok ? await res.json() : null;
      if (!profile?.sub) throw new DriveError("Google didn't say who signed in. Try again.");
      return {
        uid: String(profile.sub),
        email: String(profile.email || ""),
        name: String(profile.name || profile.email || ""),
        picture: /^https:\/\//.test(profile.picture || "") ? profile.picture : "",
        accessToken: response.access_token,
        expiresAt: Date.now() + (Number(response.expires_in) || 3600) * 1000,
        calendar: window.google.accounts.oauth2.hasGrantedAllScopes(response, CALENDAR_SCOPE),
      };
    });
  }

  async function keep(next) {
    session = next;
    useToken(next.accessToken);
    await idb.set(SESSION_KEY, next).catch((err) => console.warn("FICUS: couldn't keep the session on this device", err));
    announce();
    return { ...next, live: true };
  }

  // Signs in from the Log in button: the account picker the first time, quietly as `hint` after that.
  function signIn(hint = "") {
    return requestToken({ hint }).then(keep);
  }

  // A fresh token for the signed-in user (from a click), asking for every scope again, Calendar included. Rejects
  // if a different account was picked. `consent` shows Google's consent screen even if nothing new is asked for,
  // so a Calendar box unticked before can be ticked.
  function reconnect({ consent = false } = {}) {
    if (!session) return Promise.reject(new DriveError("No one is signed in."));
    const uid = session.uid;
    return requestToken({ hint: session.email, prompt: consent ? "consent" : "" }).then((next) => {
      if (next.uid !== uid) throw new DriveError(`That's a different Google account. Reconnect as ${session.email || "the account you signed in with"}.`);
      return keep(next);
    });
  }

  // From a click: asks Google for the Calendar scope. The new token is kept even if it was refused again.
  async function connectCalendar() {
    const next = await reconnect({ consent: true });
    if (!next.calendar) throw new CalendarAccessError("Ficus can't reach your calendar without it. Tick the Google Calendar box when Google asks.");
    return next;
  }

  // Forgets the session and the uploads cached on this device. The Google grant stays, so signing back in is quick.
  async function signOut() {
    session = null;
    useToken(null);
    await idb.del(SESSION_KEY).catch(() => {});
    await window.caches?.delete(FILE_CACHE).catch(() => {});
    announce();
  }

  /* ---------- Drive requests ---------- */

  function bearer() {
    if (!tokenLive()) throw new AuthError("Google Drive needs you to reconnect.", 401);
    return `Bearer ${session.accessToken}`;
  }

  // A gapi.client call, its failures turned into DriveError / AuthError.
  async function gapiCall(run) {
    bearer();
    await prepare();
    try {
      return (await run(window.gapi.client.drive)).result;
    } catch (err) {
      const status = Number(err?.status ?? err?.result?.error?.code) || 0;
      throw driveError(status, err?.result?.error?.message);
    }
  }

  async function driveFetch(url, init = {}) {
    let res;
    try {
      res = await fetch(url, { ...init, headers: { ...(init.headers || {}), Authorization: bearer() } });
    } catch (_) {
      throw driveError(0);
    }
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      throw driveError(res.status, body?.error?.message);
    }
    return res;
  }

  const quote = (text) => `'${String(text).replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;

  async function findOne(q, fields = "id") {
    const result = await gapiCall((drive) => drive.files.list({
      q: `${q} and trashed = false`,
      spaces: "drive",
      fields: `files(${fields})`,
      orderBy: "modifiedTime desc",
      pageSize: 1,
    }));
    return result.files?.[0] || null;
  }

  async function ensureFolder(name, parent) {
    const found = await findOne(`name = ${quote(name)} and mimeType = '${FOLDER_MIME}' and ${quote(parent)} in parents`);
    if (found) return found.id;
    const made = await gapiCall((drive) => drive.files.create({
      resource: { name, mimeType: FOLDER_MIME, parents: [parent] },
      fields: "id",
    }));
    return made.id;
  }

  const folders = { uid: null, root: null, uploads: null };
  async function folderIds() {
    if (folders.uid !== session?.uid) Object.assign(folders, { uid: session?.uid, root: null, uploads: null });
    if (!folders.root) folders.root = await ensureFolder(FOLDER_NAME, "root");
    return folders;
  }
  async function uploadsFolder() {
    const ids = await folderIds();
    if (!ids.uploads) ids.uploads = await ensureFolder(UPLOADS_NAME, ids.root);
    return ids.uploads;
  }

  const FILE_FIELDS = "id,headRevisionId,modifiedTime,trashed";

  // Sends `blob` as a new file (`metadata`) or as the new content of file `id`, and returns its FILE_FIELDS.
  async function upload({ id = null, metadata = null, blob }) {
    const target = id ? `${UPLOAD_API}/files/${encodeURIComponent(id)}` : `${UPLOAD_API}/files`;
    const method = id ? "PATCH" : "POST";
    const type = blob.type || "application/octet-stream";
    if (blob.size <= SIMPLE_UPLOAD_MAX) {
      if (id && !metadata) {
        const res = await driveFetch(`${target}?uploadType=media&fields=${FILE_FIELDS}`, { method, headers: { "Content-Type": type }, body: blob });
        return res.json();
      }
      const boundary = `ficus${Math.random().toString(36).slice(2)}`;
      const body = new Blob([
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata || {})}\r\n`,
        `--${boundary}\r\nContent-Type: ${type}\r\n\r\n`, blob, `\r\n--${boundary}--`,
      ]);
      const res = await driveFetch(`${target}?uploadType=multipart&fields=${FILE_FIELDS}`, {
        method, headers: { "Content-Type": `multipart/related; boundary=${boundary}` }, body,
      });
      return res.json();
    }
    const start = await driveFetch(`${target}?uploadType=resumable&fields=${FILE_FIELDS}`, {
      method,
      headers: { "Content-Type": "application/json; charset=UTF-8", "X-Upload-Content-Type": type },
      body: JSON.stringify(metadata || {}),
    });
    const location = start.headers.get("Location");
    if (!location) throw new DriveError("Google Drive didn't start the upload.");
    const res = await driveFetch(location, { method: "PUT", headers: { "Content-Type": type }, body: blob });
    return res.json();
  }

  const jsonBlob = (text) => new Blob([text], { type: "application/json" });

  /* ---------- Calendar requests (the user's primary calendar) ---------- */

  function calendarError(err) {
    const status = Number(err?.status ?? err?.result?.error?.code) || 0;
    const body = err?.result?.error || {};
    const reasons = `${body.status || ""} ${(body.errors || []).map((row) => row.reason).join(" ")} ${body.message || ""}`;
    if (status === 401) return new AuthError("Google needs you to reconnect.", 401);
    if (status === 403 && /insufficient|scope/i.test(reasons)) {
      return new CalendarAccessError("Ficus isn't allowed to use your calendar yet.", 403);
    }
    if (status === 403 && /accessNotConfigured|SERVICE_DISABLED|has not been used|is disabled/i.test(reasons)) {
      return new DriveError("The Google Calendar API isn't turned on for Ficus yet (in its Google Cloud project).", 403);
    }
    if (!status) return new DriveError("Google Calendar couldn't be reached. Check the connection.", 0);
    return new DriveError(body.message || `Google Calendar answered ${status}.`, status);
  }

  async function calendarCall(run) {
    bearer();
    if (!session.calendar) throw new CalendarAccessError("Connect Google Calendar to use calendar events.", 403);
    await prepare();
    let calendar;
    try {
      calendar = await calendarApi();
    } catch (_) {
      throw new DriveError("Google Calendar couldn't be reached. Check the connection.", 0);
    }
    try {
      return (await run(calendar)).result;
    } catch (err) {
      throw calendarError(err);
    }
  }

  // What a Calendar Event block keeps of an event. An all-day event's start / end are dates ("2026-10-13", the end
  // the day after it finishes); a timed one's are date-times with their offset.
  function eventFields(event) {
    return {
      eventId: String(event.id || ""),
      title: String(event.summary || "").trim(),
      start: String(event.start?.dateTime || event.start?.date || ""),
      end: String(event.end?.dateTime || event.end?.date || ""),
      allDay: !event.start?.dateTime,
      htmlLink: /^https:\/\//.test(event.htmlLink || "") ? event.htmlLink : "",
    };
  }

  // Upcoming events (those not yet over) whose text matches `text`, soonest first; all of them for no text.
  async function searchEvents(text = "") {
    const params = {
      calendarId: "primary",
      timeMin: new Date().toISOString(),
      singleEvents: true,
      orderBy: "startTime",
      maxResults: 25,
    };
    const q = String(text || "").trim();
    if (q) params.q = q;
    const result = await calendarCall((calendar) => calendar.events.list(params));
    return (result.items || []).filter((event) => event.status !== "cancelled").map(eventFields);
  }

  // Makes a timed event from `start` to `end` (Dates) in the device's time zone.
  async function createEvent({ title, start, end }) {
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
    const event = await calendarCall((calendar) => calendar.events.insert({
      calendarId: "primary",
      resource: {
        summary: String(title || "").trim(),
        start: { dateTime: start.toISOString(), timeZone },
        end: { dateTime: end.toISOString(), timeZone },
      },
    }));
    return eventFields(event);
  }

  window.FicusDrive = {
    DriveError,
    AuthError,
    CalendarAccessError,
    MASTER_NAME,
    get configured() {
      return Boolean(config.clientId);
    },
    get ready() {
      return Boolean(tokenClient);
    },
    get session() {
      return session;
    },
    get tokenLive() {
      return tokenLive();
    },
    // Whether the current token carries the Calendar scope.
    get hasCalendar() {
      return Boolean(session?.calendar);
    },
    prepare,
    restore,
    signIn,
    reconnect,
    connectCalendar,
    signOut,
    searchEvents,
    createEvent,
    // Calls back with (session, tokenLive) whenever either changes.
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    // The master file's FILE_FIELDS, or null if there isn't one in the Ficus folder.
    async findMaster() {
      const { root } = await folderIds();
      return findOne(`name = ${quote(MASTER_NAME)} and ${quote(root)} in parents`, FILE_FIELDS);
    },
    getFile: (id) => gapiCall((drive) => drive.files.get({ fileId: id, fields: FILE_FIELDS })),
    async download(id) {
      const res = await driveFetch(`${DRIVE_API}/files/${encodeURIComponent(id)}?alt=media`);
      return res.text();
    },
    async createMaster(text) {
      const { root } = await folderIds();
      return upload({ metadata: { name: MASTER_NAME, mimeType: "application/json", parents: [root] }, blob: jsonBlob(text) });
    },
    // Overwrites the master file's content (a PATCH upload).
    updateMaster: (id, text) => upload({ id, blob: jsonBlob(text) }),
    // Keeps `text` (or file `id`'s current content) beside the master file as `name`.
    async keepCopy(name, { id = null, text = null }) {
      const { root } = await folderIds();
      if (id) return gapiCall((drive) => drive.files.copy({ fileId: id, resource: { name, parents: [root] }, fields: "id" }));
      return upload({ metadata: { name, mimeType: "application/json", parents: [root] }, blob: jsonBlob(text) });
    },

    // Puts a file in Ficus/uploads; resolves with { id, url }. The url keeps the name's extension, which the app
    // reads (e.g. .gif to animate).
    async uploadFile(blob, name, mimeType) {
      const parent = await uploadsFolder();
      const typed = mimeType && blob.type !== mimeType ? new Blob([blob], { type: mimeType }) : blob;
      const made = await upload({ metadata: { name, mimeType: typed.type || undefined, parents: [parent] }, blob: typed });
      const suffix = (/\.[a-z0-9]{1,8}$/i.exec(name)?.[0] || "").toLowerCase();
      return { id: made.id, url: FILE_URL_PREFIX + made.id + suffix };
    },
    trashFile: (id) => gapiCall((drive) => drive.files.update({ fileId: id, resource: { trashed: true }, fields: "id" })),
    fileIdFromUrl(url) {
      const match = FILE_URL.exec(String(url || ""));
      return match ? match[1] : null;
    },
  };

  /* ---------- Serving uploads ---------- */

  // ficus_sw.js answers /drive-file/<id> with the file from Drive. `filesReady` settles once it controls the page
  // (or straight away where service workers aren't available, e.g. some private windows).
  let filesReady = Promise.resolve(false);
  if ("serviceWorker" in navigator && window.isSecureContext) {
    filesReady = navigator.serviceWorker.register("/ficus_sw.js", { scope: "/" })
      .then(() => navigator.serviceWorker.ready)
      .then((registration) => {
        if (navigator.serviceWorker.controller) return true;
        // A hard reload leaves the page uncontrolled; the worker claims it.
        registration.active?.postMessage("claim");
        return new Promise((resolve) => {
          const timer = setTimeout(() => resolve(false), 3000);
          navigator.serviceWorker.addEventListener("controllerchange", () => {
            clearTimeout(timer);
            resolve(true);
          }, { once: true });
        });
      })
      .catch((err) => {
        console.warn("FICUS: the file server (ficus_sw.js) didn't start; uploads won't show.", err);
        return false;
      });
  }
  window.FicusDrive.filesReady = filesReady;
})();
