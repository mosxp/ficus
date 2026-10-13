// TEST ONLY: in-memory master file and a fake session for zz-test-user.
(() => {
  const drive = window.FicusDrive;
  const esc = (text) => String(text).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const day = (offset) => {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    return d.toISOString().slice(0, 10);
  };
  const now = new Date().toISOString();
  const textTask = {
    id: "blk_zz_text_t1", type: "task", taskId: "zzt1", tasklistId: "@default", title: "ZZ Temp closed text task",
    status: "needsAction", due: day(1), notes: "", webViewLink: "https://tasks.google.com/task/zzt1",
  };
  const boardTask = {
    id: "blk_zz_board_t2", type: "task", taskId: "zzt2", tasklistId: "@default", title: "ZZ Temp board task",
    status: "needsAction", due: "", notes: "", webViewLink: "https://tasks.google.com/task/zzt2",
  };
  const master = {
    format: "ficus-master",
    version: 1,
    savedAt: now,
    dots: [
      {
        id: "zz_text", type: "text", title: "ZZ Temp Text", x: -120, y: 0, children: [], createdAt: now, updatedAt: now,
        content: `<p>Before the task <span class="text-google-embed" contenteditable="false" data-google-block="${esc(JSON.stringify(textTask))}">\u2610 ${esc(textTask.title)}</span> after it.</p><p>Second line.</p>`,
      },
      { id: "zz_board", type: "board", title: "ZZ Temp Board", x: 120, y: 0, children: [], content: "", createdAt: now, updatedAt: now },
    ],
    pages: [
      {
        kind: "board", id: "zz_board", dotId: "zz_board",
        data: {
          size: { width: 1600, height: 1000 }, objects: [],
          elements: [{ id: "zzel1", type: "google_task", x: 200, y: 150, width: 280, block: boardTask }],
        },
      },
    ],
    tags: { types: {}, colors: {} },
    notebooks: [],
    library: {},
  };
  let text = localStorage.getItem("__zzMasterText") || JSON.stringify(master);
  let revision = Number(localStorage.getItem("__zzMasterRev")) || 1;
  const keepMaster = (next) => {
    text = next;
    revision += 1;
    localStorage.setItem("__zzMasterText", text);
    localStorage.setItem("__zzMasterRev", String(revision));
  };
  const fields = () => ({ id: "zzmaster", headRevisionId: `r${revision}`, modifiedTime: new Date().toISOString(), trashed: false });
  window.__zzMaster = () => JSON.parse(text);
  drive.findMaster = async () => fields();
  drive.getFile = async () => fields();
  drive.download = async () => text;
  drive.createMaster = async (next) => {
    keepMaster(next);
    return fields();
  };
  drive.updateMaster = async (_id, next) => {
    keepMaster(next);
    return fields();
  };
  window.addEventListener("pagehide", () => {
    localStorage.setItem("__zzGoogle", JSON.stringify({ events: window.__zzEvents, tasks: window.__zzTasks }));
  });
  drive.keepCopy = async () => ({ id: "zzcopy" });

  const fake = {
    uid: "zz-test-user", email: "zz@test.invalid", name: "ZZ Temp", picture: "",
    accessToken: "zz-fake-token", expiresAt: Date.now() + 3600 * 1000, calendar: true, tasks: true,
  };
  const realRestore = drive.restore;
  drive.restore = async () => {
    const existing = await window.FicusIDB.get("session").catch(() => null);
    if (existing && existing.uid !== fake.uid) {
      window.__zzAbort = "A real session is on this device; the mock didn't run.";
      return null;
    }
    await window.FicusIDB.set("session", fake);
    return realRestore();
  };
})();
