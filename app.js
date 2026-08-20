(function () {
  "use strict";
  const SCHEMA = window.LIVESTOCK_SCHEMA;
  const DB_NAME = "chegutu_livestock_v1";
  const STORE = "submissions";

  // ---------- IndexedDB ----------
  function openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const store = db.createObjectStore(STORE, { keyPath: "localId" });
          store.createIndex("status", "status", { unique: false });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function dbAdd(record) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).add(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function dbAll() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).getAll();
      req.onsuccess = () => resolve(req.result.sort((a, b) => b.created_at.localeCompare(a.created_at)));
      req.onerror = () => reject(req.error);
    });
  }

  async function dbUpdate(record) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return "id-" + Date.now() + "-" + Math.random().toString(16).slice(2);
  }

  // ---------- Rendering ----------
  const frontMatterEl = document.getElementById("front-matter");
  const groupsEl = document.getElementById("groups");

  function fieldHtml(f, idPrefix) {
    const id = idPrefix + f.name;
    const req = f.required ? '<span class="req">*</span>' : "";
    const hint = f.hint ? `<div class="hint">${f.hint}</div>` : "";
    let input = "";
    if (f.type === "fixed") {
      input = `<input type="text" id="${id}" name="${f.name}" value="${f.value}" disabled>`;
    } else if (f.type === "text") {
      input = `<input type="text" id="${id}" name="${f.name}" ${f.required ? "required" : ""}>`;
    } else if (f.type === "date") {
      input = `<input type="date" id="${id}" name="${f.name}" ${f.required ? "required" : ""}>`;
    } else if (f.type === "integer") {
      input = `<input type="number" inputmode="numeric" min="0" step="1" id="${id}" name="${f.name}" ${f.required ? "required" : ""}>`;
    } else if (f.type === "decimal") {
      input = `<input type="number" inputmode="decimal" min="0" step="0.01" id="${id}" name="${f.name}" ${f.required ? "required" : ""}>`;
    } else if (f.type === "select_one") {
      const opts = SCHEMA.choices[f.choices].map(([v, l]) => `<option value="${v}">${l}</option>`).join("");
      input = `<select id="${id}" name="${f.name}" ${f.required ? "required" : ""}><option value="">Select…</option>${opts}</select>`;
    } else if (f.type === "geopoint") {
      input = `<div class="gps-row">
        <input type="text" id="${id}" name="${f.name}" placeholder="Not captured" readonly>
        <button type="button" class="ghost-btn" id="gps-btn">Capture GPS</button>
      </div>`;
    }
    return `<div class="field"><label for="${id}">${f.label}${req}</label>${hint}${input}</div>`;
  }

  frontMatterEl.innerHTML = SCHEMA.frontMatter.map((f) => fieldHtml(f, "fm_")).join("");

  const today = new Date().toISOString().slice(0, 10);
  const dateInput = document.getElementById("fm_collection_date");
  if (dateInput) dateInput.value = today;

  const gpsBtn = document.getElementById("gps-btn");
  if (gpsBtn) {
    gpsBtn.addEventListener("click", () => {
      if (!navigator.geolocation) { showToast("GPS not available on this device."); return; }
      gpsBtn.textContent = "Locating…";
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          document.getElementById("fm_gps_location").value =
            pos.coords.latitude.toFixed(6) + ", " + pos.coords.longitude.toFixed(6);
          gpsBtn.textContent = "Capture GPS";
        },
        () => { showToast("Could not get GPS fix — continuing without it."); gpsBtn.textContent = "Capture GPS"; },
        { enableHighAccuracy: true, timeout: 10000 }
      );
    });
  }

  groupsEl.innerHTML = SCHEMA.groups.map((g) => {
    const fields = g.fields.map((f) => fieldHtml(f, g.key + "_")).join("");
    return `
    <div class="card group-card" data-group="${g.key}">
      <div class="group-head" data-toggle="${g.hasField}">
        <div class="name">${g.label}</div>
        <label class="switch">
          <input type="checkbox" id="${g.hasField}" name="${g.hasField}">
          <span class="slider"></span>
        </label>
      </div>
      <div class="group-body" id="body_${g.key}">
        ${fields}
        <div class="group-total" id="total_${g.key}"></div>
      </div>
    </div>`;
  }).join("");

  // toggle open/close + required-when-enabled behaviour
  SCHEMA.groups.forEach((g) => {
    const checkbox = document.getElementById(g.hasField);
    const body = document.getElementById("body_" + g.key);
    const head = document.querySelector(`.group-head[data-toggle="${g.hasField}"]`);
    const setRequired = (on) => {
      g.fields.forEach((f) => {
        const el = document.getElementById(g.key + "_" + f.name);
        if (!el) return;
        if (on) el.setAttribute("required", "required"); else el.removeAttribute("required");
      });
    };
    const applyState = () => {
      const on = checkbox.checked;
      body.classList.toggle("open", on);
      setRequired(on);
    };
    checkbox.addEventListener("change", applyState);
    head.addEventListener("click", (e) => {
      if (e.target === checkbox) return;
      checkbox.checked = !checkbox.checked;
      applyState();
    });
    applyState();
  });

  // ---------- Status / connectivity ----------
  const statusDot = document.getElementById("status-dot");
  const statusText = document.getElementById("status-text");
  const queueBadge = document.getElementById("queue-badge");
  let isReallyOnline = false;

  async function checkConnectivity() {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 4000);
      const res = await fetch("/api/health", { cache: "no-store", signal: ctrl.signal });
      clearTimeout(t);
      isReallyOnline = res.ok;
    } catch (e) {
      isReallyOnline = false;
    }
    updateStatusUI();
    if (isReallyOnline) syncQueued();
  }

  function updateStatusUI() {
    statusDot.className = "dot " + (isReallyOnline ? "online" : "offline");
    statusText.textContent = isReallyOnline
      ? "Online — new households sync automatically"
      : "Offline — households are saved on this device";
  }

  window.addEventListener("online", checkConnectivity);
  window.addEventListener("offline", () => { isReallyOnline = false; updateStatusUI(); });
  document.getElementById("sync-now").addEventListener("click", checkConnectivity);
  setInterval(checkConnectivity, 15000);
  checkConnectivity();

  // ---------- Toast ----------
  let toastTimer;
  function showToast(msg) {
    const el = document.getElementById("toast");
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), 3200);
  }

  // ---------- Queue list ----------
  async function renderQueueList() {
    const all = await dbAll();
    const list = document.getElementById("queue-list");
    const queuedCount = all.filter((r) => r.status === "queued").length;
    queueBadge.textContent = queuedCount + " queued";
    queueBadge.classList.toggle("zero", queuedCount === 0);
    if (all.length === 0) {
      list.innerHTML = '<li style="color:#8a8a80">No submissions yet on this device.</li>';
      return;
    }
    list.innerHTML = all.slice(0, 20).map((r) => {
      const who = r.data.household_head_name || r.data.household_id || "Household";
      const when = new Date(r.created_at).toLocaleString();
      const pill = r.status === "synced" ? '<span class="pill synced">Synced</span>' : '<span class="pill queued">Queued</span>';
      return `<li><span>${who} — ${r.data.village || ""} (${when})</span>${pill}</li>`;
    }).join("");
  }

  // ---------- Sync ----------
  let syncing = false;
  async function syncQueued() {
    if (syncing) return;
    syncing = true;
    try {
      const all = await dbAll();
      const queued = all.filter((r) => r.status === "queued");
      let synced = 0;
      for (const record of queued) {
        try {
          const res = await fetch("/api/submissions", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ localId: record.localId, created_at: record.created_at, data: record.data }),
          });
          if (res.ok) {
            record.status = "synced";
            record.synced_at = new Date().toISOString();
            await dbUpdate(record);
            synced++;
          } else {
            break; // server rejected — stop, keep the rest queued
          }
        } catch (e) {
          break; // network dropped mid-sync — stop, keep the rest queued
        }
      }
      if (synced > 0) showToast(`Synced ${synced} household${synced > 1 ? "s" : ""} to the server.`);
      await renderQueueList();
    } finally {
      syncing = false;
    }
  }

  // ---------- Form submit ----------
  const form = document.getElementById("census-form");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!form.checkValidity()) { form.reportValidity(); return; }

    const data = {};
    SCHEMA.frontMatter.forEach((f) => {
      const el = document.getElementById("fm_" + f.name);
      if (el) data[f.name] = el.value;
    });
    SCHEMA.groups.forEach((g) => {
      const enabled = document.getElementById(g.hasField).checked;
      data[g.hasField] = enabled ? "yes" : "no";
      if (enabled) {
        g.fields.forEach((f) => {
          const el = document.getElementById(g.key + "_" + f.name);
          data[f.name] = el.value;
        });
      }
    });
    data.field_notes = document.getElementById("field_notes").value;

    const record = { localId: uuid(), created_at: new Date().toISOString(), status: "queued", data };
    await dbAdd(record);
    showToast("Saved on this device. Will sync when online.");
    form.reset();
    if (dateInput) dateInput.value = today;
    SCHEMA.groups.forEach((g) => {
      document.getElementById("body_" + g.key).classList.remove("open");
    });
    await renderQueueList();
    if (isReallyOnline) syncQueued();
  });

  document.getElementById("clear-btn").addEventListener("click", () => {
    form.reset();
    if (dateInput) dateInput.value = today;
    SCHEMA.groups.forEach((g) => document.getElementById("body_" + g.key).classList.remove("open"));
  });

  renderQueueList();

  // ---------- Service worker ----------
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("/service-worker.js").catch(() => {});
    });
  }

  // ---------- Install banner ----------
  const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent);
  const isStandalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone;
  const banner = document.getElementById("install-banner");
  let deferredPrompt = null;

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e;
    if (!isStandalone) banner.style.display = "flex";
  });

  if (isIOS && !isStandalone) {
    banner.style.display = "flex";
    banner.querySelector("span").textContent =
      "Tap the Share icon, then “Add to Home Screen” — the form then opens like an app, even with no signal.";
    document.getElementById("install-btn").style.display = "none";
  }

  document.getElementById("install-btn").addEventListener("click", async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      await deferredPrompt.userChoice;
      deferredPrompt = null;
      banner.style.display = "none";
    }
  });
})();
