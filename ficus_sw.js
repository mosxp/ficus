/* FICUS file server (a service worker, registered by ficus_drive.js).
 *
 * Uploads live in the user's Google Drive, which only hands them over with their access token, so the app links
 * them as /drive-file/<Drive file id> and this answers those requests from Drive, with the token ficus_drive.js
 * keeps in IndexedDB. Whole files are cached (a file's id never points at other content); ranges (video seeking)
 * go straight to Drive. Everything else passes through untouched.
 */
"use strict";

// /drive-file/<id>, optionally with the file's extension (the app reads it, e.g. .gif to animate).
const FILE_PATH = /^\/drive-file\/([\w-]+)(?:\.[a-z0-9]{1,8})?$/i;
const CACHE = "ficus-drive-files-v1";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("message", (event) => {
  if (event.data === "claim") event.waitUntil(self.clients.claim());
});

function readSession() {
  return new Promise((resolve) => {
    const request = indexedDB.open("ficus", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("kv");
    request.onerror = () => resolve(null);
    request.onsuccess = () => {
      const db = request.result;
      try {
        const get = db.transaction("kv", "readonly").objectStore("kv").get("session");
        get.onsuccess = () => resolve(get.result || null);
        get.onerror = () => resolve(null);
      } catch (_) {
        resolve(null);
      }
    };
  });
}

async function serveFile(request, id) {
  const range = request.headers.get("Range");
  const cache = await caches.open(CACHE);
  if (!range) {
    const hit = await cache.match(request.url);
    if (hit) return hit;
  }
  const session = await readSession();
  if (!session?.accessToken || session.expiresAt <= Date.now()) {
    return new Response("Reconnect Google Drive to load this file.", { status: 401 });
  }
  const headers = { Authorization: `Bearer ${session.accessToken}` };
  if (range) headers.Range = range;
  let res;
  try {
    res = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?alt=media`, { headers });
  } catch (_) {
    return new Response("Google Drive couldn't be reached.", { status: 504 });
  }
  if (res.status === 200 && !range) await cache.put(request.url, res.clone()).catch(() => {});
  return res;
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  const match = FILE_PATH.exec(url.pathname);
  if (match) event.respondWith(serveFile(request, match[1]));
});
