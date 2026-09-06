/* NovaDesk 3D v2 — 3D hub + Google login, data in localStorage per user. */
const store = {
  get(k, f) { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? f : v; } catch (e) { return f; } },
  set(k, v) { localStorage.setItem(k, JSON.stringify(v)); }
};
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
function toast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg; t.style.display = "block";
  clearTimeout(t._h); t._h = setTimeout(() => (t.style.display = "none"), 2200);
}
function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

/* ================= CURSOR + POINTER TRACKING ================= */
let PTR = { x: innerWidth / 2, y: innerHeight / 2, nx: 0, ny: 0 };
(function initCursor() {
  const dot = document.getElementById("cursor-dot");
  const ring = document.getElementById("cursor-ring");
  const trail = document.getElementById("cursor-trail");
  if (!dot || !ring || !trail) return;
  let rx = PTR.x, ry = PTR.y, tx = PTR.x, ty = PTR.y;
  addEventListener("pointermove", (e) => {
    PTR.x = e.clientX; PTR.y = e.clientY;
    PTR.nx = (e.clientX / innerWidth) * 2 - 1;
    PTR.ny = (e.clientY / innerHeight) * 2 - 1;
    dot.style.left = e.clientX + "px"; dot.style.top = e.clientY + "px";
  }, { passive: true });
  document.addEventListener("pointerover", (e) => {
    const t = e.target;
    document.body.classList.toggle("cur-hot", !!(t && t.closest && t.closest("button,input,textarea,select,canvas,.note,.skill,.todo")));
  });
  (function loop() {
    requestAnimationFrame(loop);
    rx += (PTR.x - rx) * 0.2; ry += (PTR.y - ry) * 0.2;
    tx += (PTR.x - tx) * 0.09; ty += (PTR.y - ty) * 0.09;
    ring.style.left = rx + "px"; ring.style.top = ry + "px";
    trail.style.left = tx + "px"; trail.style.top = ty + "px";
  })();
})();

/* ================= AUTH ================= */
let USER = null;
const K = (n) => "nd3_" + (USER ? USER.sub : "demo") + "_" + n;

function decodeJwt(t) {
  const b = t.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
  return JSON.parse(atob(b + "=".repeat((4 - (b.length % 4)) % 4)));
}
function setUser(u) {
  USER = u;
  store.set("nd3_session", u);
  document.getElementById("login").classList.add("hidden");
  document.getElementById("hub").classList.remove("hidden");
  document.getElementById("user-name").textContent = u.name || u.email || "User";
  const pic = document.getElementById("user-pic");
  if (u.pic) { pic.src = u.pic; pic.style.display = "block"; }
  bootModules();
  renderHubStats();
  if (!window._hubStatTimer) window._hubStatTimer = setInterval(renderHubStats, 5000);
  toast("Welcome, " + (u.name || "friend"));
}
function renderHubStats() {
  const el = document.getElementById("hub-stats");
  if (!el || !USER) return;
  const notes = (store.get(K("notes"), []) || []).length;
  const todos = (store.get(K("todos"), []) || []).filter((t) => !t.done).length;
  const skills = store.get(K("practice"), []) || [];
  const best = skills.reduce((m, s) => Math.max(m, s.streak || 0), 0);
  const focus = store.get(K("pomo_done"), 0) || 0;
  el.innerHTML = "<span>\uD83D\uDCDD " + notes + " notes</span><span>\u2705 " +
    todos + " open</span><span>\uD83D\uDD25 " + best + "d streak</span><span>\u23F1 " +
    focus + " focus</span>";
}
document.getElementById("logout-btn").addEventListener("click", () => {
  try { if (window.google && window.google.accounts) google.accounts.id.disableAutoSelect(); } catch (e) {}
  USER = null;
  localStorage.removeItem("nd3_session");
  document.getElementById("hub").classList.add("hidden");
  document.getElementById("station").classList.add("hidden");
  document.getElementById("login").classList.remove("hidden");
});
document.getElementById("demo-btn").addEventListener("click", () =>
  setUser({ sub: "demo", name: "Demo User", email: "", pic: "" }));

function initAuth() {
  const saved = store.get("nd3_session", null);
  if (saved) { setUser(saved); return; }
  const cid = (window.NOVA && window.NOVA.GOOGLE_CLIENT_ID) || "";
  const note = document.getElementById("login-note");
  if (!cid) {
    note.textContent = "Google login needs a Client ID in config.js — or use demo mode.";
    return;
  }
  note.textContent = "";
  let tries = 0;
  const timer = setInterval(() => {
    if (window.google && window.google.accounts) {
      clearInterval(timer);
      try {
        google.accounts.id.initialize({
          client_id: cid,
          callback: (res) => {
            try {
              const p = decodeJwt(res.credential);
              setUser({ sub: p.sub, name: p.name, email: p.email, pic: p.picture });
            } catch (e) { toast("Login failed — try demo mode"); }
          }
        });
        google.accounts.id.renderButton(document.getElementById("gsi-btn"), { theme: "filled_blue", size: "large", width: 280 });
      } catch (e) { note.textContent = "Google script blocked — use demo mode."; }
    } else if (++tries > 50) {
      clearInterval(timer);
      note.textContent = "Google script did not load (offline?) — use demo mode.";
    }
  }, 200);
}

/* ================= 3D HUB ================= */
const STATIONS = [
  { id: "notes", label: "NOTES", sub: "capture ideas", color: "#6ea8ff" },
  { id: "todos", label: "TODOS", sub: "get things done", color: "#4ade80" },
  { id: "practice", label: "PRACTICE", sub: "build streaks", color: "#fbbf24" },
  { id: "time", label: "TIME", sub: "focus sessions", color: "#b48cff" }
];
let camGoal = null, lookGoal = null, pickables = [], activeStation = null;
let hovered = null, spinFx = 0;

function labelTexture(main, sub, color) {
  const c = document.createElement("canvas"); c.width = 512; c.height = 288;
  const x = c.getContext("2d");
  x.fillStyle = "rgba(10,16,34,0.92)";
  x.beginPath();
  const r = 36; x.moveTo(r, 4); x.lineTo(508 - r, 4); x.quadraticCurveTo(508, 4, 508, r);
  x.lineTo(508, 284 - r); x.quadraticCurveTo(508, 284, 508 - r, 284);
  x.lineTo(r, 284); x.quadraticCurveTo(4, 284, 4, 284 - r);
  x.lineTo(4, r); x.quadraticCurveTo(4, 4, r, 4); x.closePath(); x.fill();
  x.strokeStyle = color; x.lineWidth = 6; x.stroke();
  x.fillStyle = color;   x.font = "bold 64px 'Space Grotesk', 'Segoe UI', Arial"; x.textAlign = "center";
  x.fillText(main, 256, 140);
  x.fillStyle = "#9aa7c7"; x.font = "30px 'Space Grotesk', 'Segoe UI', Arial";
  x.fillText(sub, 256, 200);
  const t = new THREE.CanvasTexture(c); t.anisotropy = 4;
  return t;
}
function initHub() {
  if (!window.THREE) return;
  const canvas = document.getElementById("bg");
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 100);
  camera.position.set(0, 1.6, 11);
  scene.add(new THREE.AmbientLight(0xffffff, 0.9));
  const dl = new THREE.DirectionalLight(0xffffff, 0.6); dl.position.set(4, 8, 6); scene.add(dl);

  const N = 400, pos = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    pos[i * 3] = (Math.random() - 0.5) * 40;
    pos[i * 3 + 1] = (Math.random() - 0.5) * 24;
    pos[i * 3 + 2] = (Math.random() - 0.5) * 20 - 4;
  }
  const sg = new THREE.BufferGeometry();
  sg.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  const dust = new THREE.Points(sg, new THREE.PointsMaterial({ size: 0.05, color: 0x6ea8ff, transparent: true, opacity: 0.7 }));
  scene.add(dust);

  const grid = new THREE.GridHelper(70, 46, 0x22d3ee, 0x2c2560);
  grid.position.y = -3.2;
  grid.material.transparent = true; grid.material.opacity = 0.28;
  scene.add(grid);

  const halo1 = new THREE.Mesh(new THREE.TorusGeometry(7.5, 0.035, 10, 140),
    new THREE.MeshBasicMaterial({ color: 0x818cf8, transparent: true, opacity: 0.35 }));
  halo1.position.set(0, 0.4, -3); halo1.rotation.x = 1.25; scene.add(halo1);
  const halo2 = new THREE.Mesh(new THREE.TorusGeometry(9.5, 0.025, 10, 140),
    new THREE.MeshBasicMaterial({ color: 0xe879f9, transparent: true, opacity: 0.22 }));
  halo2.position.set(0, 0.4, -4); halo2.rotation.x = 1.05; halo2.rotation.y = 0.3; scene.add(halo2);

  const CRY_COLS = [0x22d3ee, 0x818cf8, 0xe879f9, 0x4ade80, 0xfbbf24];
  const crystals = [];
  for (let i = 0; i < 10; i++) {
    const geo = i % 2 ? new THREE.OctahedronGeometry(0.3) : new THREE.IcosahedronGeometry(0.24);
    const cm = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      color: CRY_COLS[i % CRY_COLS.length], wireframe: true, transparent: true, opacity: 0.65 }));
    cm.position.set((Math.random() - 0.5) * 26, -2 + Math.random() * 6, -2 - Math.random() * 7);
    cm.userData = { baseY: cm.position.y, ph: Math.random() * 6.28, sp: 0.4 + Math.random() * 0.8 };
    scene.add(cm); crystals.push(cm);
  }

  const sun = new THREE.Mesh(new THREE.SphereGeometry(1.05, 32, 32),
    new THREE.MeshBasicMaterial({ color: 0xffc94d }));
  sun.position.set(0, 0.4, -1.5); scene.add(sun);
  const glow = new THREE.Mesh(new THREE.SphereGeometry(1.5, 32, 32),
    new THREE.MeshBasicMaterial({ color: 0xff9d2e, transparent: true, opacity: 0.26 }));
  glow.position.copy(sun.position); scene.add(glow);
  const sunLbl = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 1.1),
    new THREE.MeshBasicMaterial({ map: labelTexture("NOVADESK", "your solar hub", "#ffd166"), transparent: true }));
  sunLbl.position.set(0, 2.5, -1.5); scene.add(sunLbl);

  STATIONS.forEach((s, i) => {
    const px = (i - 1.5) * 4.2;
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(3.2, 1.8, 0.25),
      new THREE.MeshBasicMaterial({ map: labelTexture(s.label, s.sub, s.color), transparent: true })
    );
    mesh.position.set(px, 0.4, 0.5);
    mesh.scale.setScalar(0.001);
    mesh.userData = { station: s, baseY: 0.4, phase: i * 1.7, baseX: px, born: 0.4 + i * 0.22 };
    scene.add(mesh); pickables.push(mesh);
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(1.6, 0.03, 10, 60),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(s.color), transparent: true, opacity: 0 })
    );
    ring.position.set(px, 0.4, 0.1); ring.userData = { ring: true, phase: i };
    scene.add(ring); mesh.userData.ring = ring;
  });

  const ray = new THREE.Raycaster(), ptr = new THREE.Vector2();
  let downAt = 0;
  canvas.addEventListener("pointerdown", () => (downAt = Date.now()));
  canvas.addEventListener("pointerup", (e) => {
    if (Date.now() - downAt > 300 || !document.getElementById("station").classList.contains("hidden")) return;
    ptr.x = (e.clientX / innerWidth) * 2 - 1;
    ptr.y = -(e.clientY / innerHeight) * 2 + 1;
    ray.setFromCamera(ptr, camera);
    const hit = ray.intersectObjects(pickables)[0];
    if (hit) enterStation(hit.object.userData.station);
  });
  canvas.addEventListener("pointermove", (e) => {
    ptr.x = (e.clientX / innerWidth) * 2 - 1;
    ptr.y = -(e.clientY / innerHeight) * 2 + 1;
    ray.setFromCamera(ptr, camera);
    const hit = ray.intersectObjects(pickables)[0];
    hovered = hit ? hit.object : null;
  });
  addEventListener("resize", () => {
    renderer.setSize(innerWidth, innerHeight, false);
    camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  });
  renderer.setSize(innerWidth, innerHeight, false);

  const look = new THREE.Vector3(0, 0.4, 0);
  const basePos = new THREE.Vector3(0, 1.6, 11);
  function easeOutBack(x) { const c = 1.70158; return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2); }
  (function anim(t) {
    requestAnimationFrame(anim);
    const time = (t || 0) / 1000;
    const parX = (typeof PTR !== "undefined" ? PTR.nx : 0);
    const parY = (typeof PTR !== "undefined" ? PTR.ny : 0);
    sun.scale.setScalar(1 + Math.sin(time * 2.2) * 0.045);
    glow.material.opacity = 0.24 + Math.sin(time * 2.2) * 0.07;
    sun.rotation.y += 0.004; sunLbl.lookAt(camera.position);
    pickables.forEach((m) => {
      const u = m.userData;
      const raw = Math.min(1, Math.max(0, (time - u.born) * 1.4));
      const grow = raw <= 0 ? 0.001 : easeOutBack(raw);
      m.scale.setScalar(grow * (m === hovered ? 1.12 : 1));
      m.position.x = u.baseX;
      m.position.y = u.baseY + Math.sin(time * 1.2 + u.phase) * 0.18;
      if (spinFx > 0) m.rotation.y += 0.22 * spinFx; else m.lookAt(camera.position);
      u.ring.position.set(u.baseX, m.position.y, 0.1);
      u.ring.rotation.z += 0.003;
      u.ring.material.opacity = 0.5 * Math.min(1, raw * 2);
    });
    if (spinFx > 0) spinFx -= 0.03;
    dust.rotation.y += 0.0004;
    halo1.rotation.z += 0.0012; halo2.rotation.z -= 0.0009;
    crystals.forEach((c) => {
      c.rotation.x += 0.004 * c.userData.sp; c.rotation.y += 0.006 * c.userData.sp;
      c.position.y = c.userData.baseY + Math.sin(time * c.userData.sp + c.userData.ph) * 0.35;
    });
    if (camGoal) {
      basePos.lerp(camGoal, 0.06);
      if (basePos.distanceTo(camGoal) < 0.05) camGoal = null;
    }
    if (lookGoal) look.lerp(lookGoal, 0.08);
    camera.position.set(basePos.x + parX * 0.6, basePos.y - parY * 0.35, basePos.z);
    camera.lookAt(look.x + parX * 0.9, look.y - parY * 0.4, look.z);
    renderer.render(scene, camera);
  })();
}
function enterStation(s) {
  activeStation = s;
  spinFx = 1;
  camGoal = new THREE.Vector3(s ? meshX(s) : 0, 0.8, 5.7);
  lookGoal = new THREE.Vector3(meshX(s), 0.4, 0.5);
  document.getElementById("station-title").textContent = s.label.charAt(0) + s.label.slice(1).toLowerCase();
  renderStationBody(s.id);
  document.getElementById("station").classList.remove("hidden");
}
function meshX(s) {
  const i = STATIONS.findIndex((x) => x.id === s.id);
  return (i - 1.5) * 4.2;
}
document.getElementById("back-btn").addEventListener("click", () => {
  document.getElementById("station").classList.add("hidden");
  camGoal = new THREE.Vector3(0, 1.6, 11);
  lookGoal = new THREE.Vector3(0, 0.4, 0);
  activeStation = null;
});

/* ================= MODULE TEMPLATES ================= */
const TPL = {
  notes: `<div class="card"><h2>New note</h2>
    <input id="note-title" placeholder="Title" maxlength="120" />
    <input id="note-tag" placeholder="Tag (optional)" maxlength="30" />
    <textarea id="note-body" rows="4" placeholder="Write your note..."></textarea>
    <div class="row"><button id="note-save" class="primary">Save note</button><button id="note-clear">Clear</button></div></div>
    <div class="card"><h2>Saved notes (<span id="note-count">0</span>)</h2>
    <input id="note-search" placeholder="Search notes..." /><div id="note-list" class="grid"></div></div>`,
  todos: `<div class="card"><h2>New task</h2>
    <div class="row"><input id="todo-text" placeholder="What needs doing?" maxlength="160" />
    <select id="todo-priority"><option value="low">Low</option><option value="med" selected>Medium</option><option value="high">High</option></select>
    <button id="todo-add" class="primary">Add</button></div>
    <div class="row filters"><button class="filter active" data-f="all">All</button>
    <button class="filter" data-f="active">Active</button><button class="filter" data-f="done">Done</button>
    <span id="todo-count" class="muted"></span><button id="todo-clear">Clear done</button></div>
    <div id="todo-list"></div></div>`,
  practice: `<div class="card"><h2>Track a skill</h2>
    <div class="row"><input id="practice-name" placeholder="e.g. Guitar, Coding, Spanish" maxlength="80" />
    <button id="practice-add" class="primary">Add</button></div>
    <div id="practice-list" class="grid"></div></div>`,
  time: `<div class="card"><h2>Pomodoro</h2>
    <div class="row filters"><button class="pmode active" data-m="focus">Focus 25</button>
    <button class="pmode" data-m="short">Break 5</button><button class="pmode" data-m="long">Rest 15</button></div>
    <div id="pomo-display" class="big">25:00</div><div class="bar"><div id="pomo-fill"></div></div>
    <div class="row"><button id="pomo-start" class="primary">Start</button><button id="pomo-pause">Pause</button>
    <button id="pomo-reset">Reset</button><span id="pomo-done" class="muted"></span></div></div>
    <div class="card"><h2>Stopwatch</h2><div id="sw-display" class="big">00:00:00</div>
    <div class="row"><button id="sw-start" class="primary">Start</button><button id="sw-pause">Pause</button>
    <button id="sw-reset">Reset</button></div></div>`
};
function renderStationBody(id) {
  document.getElementById("station-body").innerHTML = TPL[id];
  document.querySelectorAll("#station-body .card").forEach(attachTilt);
  if (id === "notes") { wireNotes(); renderNotes(); }
  if (id === "todos") { wireTodos(); renderTodos(); }
  if (id === "practice") { wirePractice(); renderSkills(); }
  if (id === "time") { wireTime(); renderPomo(); }
}
function attachTilt(el) {
  el.addEventListener("mousemove", (e) => {
    const r = el.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - 0.5;
    const y = (e.clientY - r.top) / r.height - 0.5;
    el.style.transform = "perspective(900px) rotateX(" + (-y * 7) + "deg) rotateY(" + x * 9 + "deg) translateZ(4px)";
  });
  el.addEventListener("mouseleave", () => (el.style.transform = ""));
}

/* ================= MODULES (per-user keys) ================= */
let notes = [], editingNote = null, todos = [], todoFilter = "all", skills = [];

function wireNotes() {
  notes = store.get(K("notes"), []); editingNote = null;
  document.getElementById("note-save").addEventListener("click", () => {
    const title = document.getElementById("note-title").value.trim();
    const body = document.getElementById("note-body").value.trim();
    const tag = document.getElementById("note-tag").value.trim();
    if (!title && !body) return toast("Write something first");
    if (editingNote) {
      const n = notes.find((x) => x.id === editingNote);
      if (n) { n.title = title; n.body = body; n.tag = tag; n.updated = Date.now(); }
      editingNote = null;
      document.getElementById("note-save").textContent = "Save note";
    } else notes.push({ id: uid(), title, body, tag, pinned: false, updated: Date.now() });
    store.set(K("notes"), notes);
    document.getElementById("note-title").value = "";
    document.getElementById("note-body").value = "";
    document.getElementById("note-tag").value = "";
    renderNotes(); toast("Note saved");
  });
  document.getElementById("note-clear").addEventListener("click", () => {
    document.getElementById("note-title").value = "";
    document.getElementById("note-body").value = "";
    document.getElementById("note-tag").value = "";
    editingNote = null;
    document.getElementById("note-save").textContent = "Save note";
  });
  document.getElementById("note-search").addEventListener("input", renderNotes);
  document.getElementById("note-list").addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    const n = notes.find((x) => x.id === b.dataset.id); if (!n) return;
    if (b.dataset.a === "del") notes = notes.filter((x) => x.id !== n.id);
    if (b.dataset.a === "pin") n.pinned = !n.pinned;
    if (b.dataset.a === "edit") {
      editingNote = n.id;
      document.getElementById("note-title").value = n.title;
      document.getElementById("note-body").value = n.body;
      document.getElementById("note-tag").value = n.tag || "";
      document.getElementById("note-save").textContent = "Update note";
    }
    store.set(K("notes"), notes); renderNotes();
  });
}
function renderNotes() {
  const q = (document.getElementById("note-search").value || "").toLowerCase();
  const items = notes
    .filter((n) => (n.title + " " + n.body + " " + (n.tag || "")).toLowerCase().includes(q))
    .sort((a, b) => (b.pinned - a.pinned) || (b.updated - a.updated));
  document.getElementById("note-count").textContent = notes.length;
  document.getElementById("note-list").innerHTML = items.map((n) =>
    "<div class='note'><h3>" + (n.pinned ? "PINNED — " : "") + esc(n.title || "Untitled") + "</h3>" +
    (n.tag ? "<span class='tag'>" + esc(n.tag) + "</span>" : "") +
    "<p>" + esc(n.body) + "</p><div class='mini'>" +
    "<button data-a='edit' data-id='" + n.id + "'>Edit</button>" +
    "<button data-a='pin' data-id='" + n.id + "'>" + (n.pinned ? "Unpin" : "Pin") + "</button>" +
    "<button data-a='del' data-id='" + n.id + "'>Delete</button></div></div>"
  ).join("") || "<p class='muted'>No notes yet.</p>";
}

function wireTodos() {
  todos = store.get(K("todos"), []); todoFilter = "all";
  document.getElementById("todo-add").addEventListener("click", () => {
    const inp = document.getElementById("todo-text");
    const text = inp.value.trim(); if (!text) return toast("Type a task first");
    todos.unshift({ id: uid(), text, priority: document.getElementById("todo-priority").value, done: false });
    store.set(K("todos"), todos); inp.value = ""; renderTodos();
  });
  document.getElementById("todo-text").addEventListener("keydown", (e) => {
    if (e.key === "Enter") document.getElementById("todo-add").click();
  });
  document.getElementById("todo-list").addEventListener("click", (e) => {
    const b = e.target.closest("[data-a]");
    if (!b || b.tagName === "INPUT") return;
    if (b.dataset.a === "del") {
      todos = todos.filter((x) => x.id !== b.dataset.id);
      store.set(K("todos"), todos); renderTodos();
    }
  });
  document.getElementById("todo-list").addEventListener("change", (e) => {
    const b = e.target.closest("[data-a='toggle']"); if (!b) return;
    const t = todos.find((x) => x.id === b.dataset.id); if (!t) return;
    t.done = b.checked; store.set(K("todos"), todos); renderTodos();
  });
  document.querySelectorAll("#station-body .filter").forEach((b) =>
    b.addEventListener("click", () => {
      document.querySelectorAll("#station-body .filter").forEach((x) => x.classList.remove("active"));
      b.classList.add("active"); todoFilter = b.dataset.f; renderTodos();
    })
  );
  document.getElementById("todo-clear").addEventListener("click", () => {
    todos = todos.filter((t) => !t.done); store.set(K("todos"), todos); renderTodos(); toast("Completed cleared");
  });
}
function renderTodos() {
  const items = todos.filter((t) =>
    todoFilter === "all" ? true : todoFilter === "done" ? t.done : !t.done);
  const open = todos.filter((t) => !t.done).length;
  document.getElementById("todo-count").textContent = open + " open / " + todos.length + " total";
  document.getElementById("todo-list").innerHTML = items.map((t) =>
    "<div class='todo" + (t.done ? " done" : "") + "'>" +
    "<input type='checkbox' data-a='toggle' data-id='" + t.id + "'" + (t.done ? " checked" : "") + " />" +
    "<span class='t'>" + esc(t.text) + "</span><span class='spacer'></span>" +
    "<span class='prio " + t.priority + "'>" + t.priority + "</span>" +
    "<button data-a='del' data-id='" + t.id + "'>✕</button></div>"
  ).join("") || "<p class='muted'>Nothing here.</p>";
}

function wirePractice() {
  skills = store.get(K("practice"), []);
  document.getElementById("practice-add").addEventListener("click", () => {
    const inp = document.getElementById("practice-name");
    const name = inp.value.trim(); if (!name) return toast("Name a skill first");
    skills.push({ id: uid(), name, sessions: 0, streak: 0, last: null });
    store.set(K("practice"), skills); inp.value = ""; renderSkills();
  });
  document.getElementById("practice-list").addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    const s = skills.find((x) => x.id === b.dataset.id); if (!s) return;
    if (b.dataset.a === "del") skills = skills.filter((x) => x.id !== s.id);
    if (b.dataset.a === "reset") { s.sessions = 0; s.streak = 0; s.last = null; }
    if (b.dataset.a === "log") {
      const today = new Date().toISOString().slice(0, 10);
      const y = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
      s.sessions++;
      if (s.last === y) s.streak++;
      else if (s.last !== today) s.streak = 1;
      s.last = today; toast("Session logged — streak " + s.streak + "d");
    }
    store.set(K("practice"), skills); renderSkills();
  });
}
function renderSkills() {
  document.getElementById("practice-list").innerHTML = skills.map((s) =>
    "<div class='skill'><h3>" + esc(s.name) + "</h3>" +
    "<p class='muted'>Sessions: <b>" + s.sessions + "</b> &nbsp;•&nbsp; Streak: <b>" + s.streak + "d</b>" +
    (s.last ? " &nbsp;•&nbsp; Last: " + s.last : "") + "</p><div class='mini'>" +
    "<button data-a='log' data-id='" + s.id + "'>+ Log session</button>" +
    "<button data-a='reset' data-id='" + s.id + "'>Reset</button>" +
    "<button data-a='del' data-id='" + s.id + "'>Delete</button></div></div>"
  ).join("") || "<p class='muted'>No skills yet — add one above.</p>";
}

const DUR = { focus: 25 * 60, short: 5 * 60, long: 15 * 60 };
let pomo = null, sw = null;
function fmt(s) { return String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0"); }
function swFmt(ms) {
  const s = Math.floor(ms / 1000);
  return String(Math.floor(s / 3600)).padStart(2, "0") + ":" +
    String(Math.floor((s % 3600) / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0");
}
function wireTime() {
  if (pomo && pomo.id) clearInterval(pomo.id);
  if (sw && sw.id) clearInterval(sw.id);
  pomo = { mode: "focus", left: DUR.focus, running: false, id: null, done: store.get(K("pomo_done"), 0) };
  sw = { base: 0, running: false, id: null, t0: 0 };
  document.querySelectorAll("#station-body .pmode").forEach((b) =>
    b.addEventListener("click", () => {
      document.querySelectorAll("#station-body .pmode").forEach((x) => x.classList.remove("active"));
      b.classList.add("active");
      clearInterval(pomo.id); pomo.running = false;
      pomo.mode = b.dataset.m; pomo.left = DUR[pomo.mode]; renderPomo();
    })
  );
  document.getElementById("pomo-start").addEventListener("click", () => {
    if (pomo.running) return;
    pomo.running = true;
    pomo.id = setInterval(() => {
      pomo.left--;
      if (pomo.left <= 0) {
        clearInterval(pomo.id); pomo.running = false;
        if (pomo.mode === "focus") {
          pomo.done++; store.set(K("pomo_done"), pomo.done);
          toast(pomo.done % 4 === 0 ? "Take a long rest!" : "Focus done — break time!");
        } else toast("Break over — back to focus!");
      }
      renderPomo();
    }, 1000);
  });
  document.getElementById("pomo-pause").addEventListener("click", () => { clearInterval(pomo.id); pomo.running = false; });
  document.getElementById("pomo-reset").addEventListener("click", () => {
    clearInterval(pomo.id); pomo.running = false; pomo.left = DUR[pomo.mode]; renderPomo();
  });
  document.getElementById("sw-start").addEventListener("click", () => {
    if (sw.running) return; sw.running = true; sw.t0 = Date.now();
    sw.id = setInterval(() => {
      document.getElementById("sw-display").textContent = swFmt(sw.base + (Date.now() - sw.t0));
    }, 250);
  });
  document.getElementById("sw-pause").addEventListener("click", () => {
    if (!sw.running) return;
    sw.base += Date.now() - sw.t0; sw.running = false; clearInterval(sw.id);
  });
  document.getElementById("sw-reset").addEventListener("click", () => {
    sw.base = 0; sw.running = false; clearInterval(sw.id);
    document.getElementById("sw-display").textContent = "00:00:00";
  });
}
function renderPomo() {
  if (!pomo) return;
  document.getElementById("pomo-display").textContent = fmt(pomo.left);
  document.getElementById("pomo-fill").style.width = (100 * (1 - pomo.left / DUR[pomo.mode])).toFixed(1) + "%";
  document.getElementById("pomo-done").textContent = "Completed: " + pomo.done;
}

function bootModules() { /* modules wire on station entry, per user */ }

/* init */
document.querySelectorAll(".tilt").forEach(attachTilt);
initHub();
initAuth();
