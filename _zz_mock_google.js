// TEST ONLY: fake Google Identity + gapi with in-memory Calendar and Tasks.
(() => {
  const day = (offset) => {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    return d.toISOString().slice(0, 10);
  };
  const at = (offset, hour, min = 0) => {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    d.setHours(hour, min, 0, 0);
    return d.toISOString();
  };
  window.__zzCalls = [];
  window.__zzEvents = {
    zzev1: { id: "zzev1", status: "confirmed", summary: "ZZ Temp Standup", start: { dateTime: at(1, 10) }, end: { dateTime: at(1, 10, 30) }, htmlLink: "https://calendar.google.com/calendar/event?eid=zzev1", description: "" },
    zzev2: { id: "zzev2", status: "confirmed", summary: "ZZ Temp Board review", start: { dateTime: at(2, 14) }, end: { dateTime: at(2, 15) }, htmlLink: "https://calendar.google.com/calendar/event?eid=zzev2", description: "" },
  };
  window.__zzTasks = {
    zzt1: { id: "zzt1", title: "ZZ Temp closed text task", status: "completed", due: `${day(1)}T00:00:00.000Z`, notes: "", webViewLink: "https://tasks.google.com/task/zzt1", updated: at(0, 9) },
    zzt2: { id: "zzt2", title: "ZZ Temp board task (renamed)", status: "needsAction", due: "", notes: "", webViewLink: "https://tasks.google.com/task/zzt2", updated: at(0, 9) },
    zzt3: { id: "zzt3", title: "ZZ Temp fresh task", status: "needsAction", due: `${day(1)}T00:00:00.000Z`, notes: "a note", webViewLink: "https://tasks.google.com/task/zzt3", updated: at(0, 9) },
  };
  try {
    const kept = JSON.parse(localStorage.getItem("__zzGoogle") || "null");
    if (kept) Object.assign(window, { __zzEvents: kept.events, __zzTasks: kept.tasks });
  } catch (_) {}
  const ok = (result) => new Promise((resolve) => setTimeout(() => resolve({ result: JSON.parse(JSON.stringify(result)) }), 60));
  const missing = () => Promise.reject({ status: 404, result: { error: { code: 404, message: "Not Found" } } });
  const log = (name, params) => window.__zzCalls.push({ name, params: JSON.parse(JSON.stringify(params || {})), at: Date.now() });
  let seq = 10;

  const calendar = {
    events: {
      list(params) {
        log("events.list", params);
        const q = String(params.q || "").toLowerCase();
        return ok({ items: Object.values(window.__zzEvents).filter((e) => !q || e.summary.toLowerCase().includes(q)) });
      },
      get(params) {
        log("events.get", params);
        const e = window.__zzEvents[params.eventId];
        return e ? ok(e) : missing();
      },
      insert(params) {
        log("events.insert", params);
        const id = `zzev${++seq}`;
        window.__zzEvents[id] = { id, status: "confirmed", htmlLink: `https://calendar.google.com/calendar/event?eid=${id}`, description: "", ...params.resource };
        return ok(window.__zzEvents[id]);
      },
      patch(params) {
        log("events.patch", params);
        const e = window.__zzEvents[params.eventId];
        if (!e) return missing();
        Object.assign(e, params.resource);
        return ok(e);
      },
    },
  };
  const tasks = {
    tasks: {
      list(params) {
        log("tasks.list", params);
        return ok({ items: Object.values(window.__zzTasks) });
      },
      get(params) {
        log("tasks.get", params);
        const t = window.__zzTasks[params.task];
        return t ? ok(t) : missing();
      },
      insert(params) {
        log("tasks.insert", params);
        const id = `zzt${++seq}`;
        window.__zzTasks[id] = { id, status: "needsAction", webViewLink: `https://tasks.google.com/task/${id}`, ...params.resource };
        return ok(window.__zzTasks[id]);
      },
      patch(params) {
        log("tasks.patch", params);
        const t = window.__zzTasks[params.task];
        if (!t) return missing();
        Object.assign(t, params.resource);
        return ok(t);
      },
    },
  };

  window.google = {
    accounts: {
      oauth2: {
        initTokenClient: () => ({ requestAccessToken() {} }),
        hasGrantedAllScopes: () => true,
      },
    },
  };
  window.gapi = {
    load: (_name, opts) => setTimeout(() => (typeof opts === "function" ? opts() : opts?.callback?.()), 0),
    client: {
      init: () => Promise.resolve(),
      setToken() {},
      load(url) {
        if (/calendar/.test(url)) window.gapi.client.calendar = calendar;
        if (/tasks/.test(url)) window.gapi.client.tasks = tasks;
        return Promise.resolve();
      },
      drive: { files: {} },
    },
  };
})();
