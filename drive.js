/* NovaDesk 3D — Google Drive cloud sync (hidden appDataFolder).
   Local-first: everything still saves to localStorage instantly;
   cloud copy is pushed debounced. Demo mode stays local-only. */
const DRIVE_SCOPE = "openid email profile https://www.googleapis.com/auth/drive.appdata";
const DRIVE = { token: null, exp: 0, fileId: null, enabled: false, timer: null, quiet: false };

function driveBtn() { return document.getElementById("sync-btn"); }
function driveStatus(t) { const b = driveBtn(); if (b) b.textContent = "\u2601 " + t; }

function collectState() {
  return {
    v: 1,
    savedAt: new Date().toISOString(),
    notes: store.get(K("notes"), []),
    todos: store.get(K("todos"), []),
    practice: store.get(K("practice"), []),
    pomo_done: store.get(K("pomo_done"), 0)
  };
}
function applyState(s) {
  if (!s || typeof s !== "object") return false;
  DRIVE.quiet = true;
  try {
    if (Array.isArray(s.notes)) store.set(K("notes"), s.notes);
    if (Array.isArray(s.todos)) store.set(K("todos"), s.todos);
    if (Array.isArray(s.practice)) store.set(K("practice"), s.practice);
    if (typeof s.pomo_done === "number") store.set(K("pomo_done"), s.pomo_done);
  } finally { DRIVE.quiet = false; }
  if (typeof activeStation !== "undefined" && activeStation && typeof renderStationBody === "function") {
    try { renderStationBody(activeStation.id); } catch (e) {}
  }
  return true;
}

async function driveFetch(url, opts) {
  opts = opts || {};
  opts.headers = Object.assign({}, opts.headers, { Authorization: "Bearer " + DRIVE.token });
  const r = await fetch(url, opts);
  if (r.status === 401) {
    DRIVE.enabled = false; driveStatus("reconnect");
    toast("Cloud session expired — tap \u2601 Sync");
    throw new Error("auth");
  }
  if (!r.ok) throw new Error("drive " + r.status + ": " + (await r.text()).slice(0, 120));
  return r;
}
async function driveFind() {
  const q = encodeURIComponent("name = 'novadesk.json' and 'appDataFolder' in parents and trashed = false");
  const r = await driveFetch("https://www.googleapis.com/drive/v3/files?q=" + q + "&spaces=appDataFolder&fields=files(id)&pageSize=1");
  const j = await r.json();
  return j.files && j.files[0] ? j.files[0].id : null;
}
async function driveCreate() {
  const r = await driveFetch("https://www.googleapis.com/drive/v3/files", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "novadesk.json", parents: ["appDataFolder"], mimeType: "application/json" })
  });
  return (await r.json()).id;
}
async function drivePull() {
  if (!DRIVE.fileId) DRIVE.fileId = store.get(K("drive_file"), null) || (await driveFind());
  if (!DRIVE.fileId) {
    DRIVE.fileId = await driveCreate();
    store.set(K("drive_file"), DRIVE.fileId);
    await drivePush(true);
    return;
  }
  store.set(K("drive_file"), DRIVE.fileId);
  const r = await driveFetch("https://www.googleapis.com/drive/v3/files/" + DRIVE.fileId + "?alt=media");
  const txt = await r.text();
  if (!txt) { await drivePush(true); return; }
  let ok = false;
  try { ok = applyState(JSON.parse(txt)); } catch (e) { ok = false; }
  if (!ok) await drivePush(true);
}
async function drivePush(silent) {
  if (!DRIVE.enabled || !DRIVE.fileId) return;
  try {
    if (Date.now() > DRIVE.exp - 60000) await ensureToken(false);
    await driveFetch("https://www.googleapis.com/upload/drive/v3/files/" + DRIVE.fileId + "?uploadType=media", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(collectState())
    });
    driveStatus("synced \u2713");
  } catch (e) { if (!silent) driveStatus("error"); }
}
function scheduleSave() {
  if (!DRIVE.enabled || DRIVE.quiet) return;
  clearTimeout(DRIVE.timer);
  driveStatus("saving\u2026");
  DRIVE.timer = setTimeout(() => drivePush(false), 2500);
}

function ensureToken(interactive) {
  return new Promise((resolve, reject) => {
    if (!interactive && DRIVE.token && Date.now() < DRIVE.exp - 60000) return resolve();
    const cid = (window.NOVA && window.NOVA.GOOGLE_CLIENT_ID) || "";
    if (!cid) { toast("Add your Client ID in config.js first"); return reject(new Error("no cid")); }
    if (!window.google || !google.accounts || !google.accounts.oauth2) {
      toast("Google script not loaded (offline?)"); return reject(new Error("no gsi"));
    }
    const client = google.accounts.oauth2.initTokenClient({
      client_id: cid,
      scope: DRIVE_SCOPE,
      callback: (res) => {
        if (res && res.access_token) {
          DRIVE.token = res.access_token;
          DRIVE.exp = Date.now() + (parseInt(res.expires_in || "3600", 10) * 1000);
          resolve();
        } else reject(new Error("no token"));
      }
    });
    try {
      if (interactive) client.requestAccessToken();
      else client.requestAccessToken({ prompt: "" });
    } catch (e) {
      if (!interactive) { try { client.requestAccessToken(); return; } catch (e2) { return reject(e2); } }
      reject(e);
    }
  });
}

async function driveConnect() {
  if (!USER || USER.sub === "demo") { toast("Log in with Google first — demo stays local"); return; }
  driveStatus("connecting\u2026");
  try {
    await ensureToken(true);
    DRIVE.fileId = store.get(K("drive_file"), null);
    await drivePull();
    DRIVE.enabled = true;
    driveStatus("synced \u2713");
    toast("Cloud sync on");
  } catch (e) { driveStatus("off"); toast("Sync failed: " + ((e && e.message) || e)); }
}

(function initDrive() {
  const _set = store.set.bind(store);
  store.set = function (k, v) {
    _set(k, v);
    if (!DRIVE.quiet && DRIVE.enabled && typeof k === "string" && k.indexOf("nd3_") === 0 && k !== "nd3_session") scheduleSave();
  };
  const sb = document.getElementById("sync-btn");
  if (sb) sb.addEventListener("click", driveConnect);
  const lo = document.getElementById("logout-btn");
  if (lo) lo.addEventListener("click", () => {
    DRIVE.enabled = false; DRIVE.token = null; DRIVE.fileId = null; driveStatus("off");
  });
})();
