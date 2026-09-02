import { firebaseConfig } from "./firebase-config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc,
  collection, getDocs, addDoc, deleteDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
const firebaseApp = initializeApp(firebaseConfig);
const auth = getAuth(firebaseApp);
const db = getFirestore(firebaseApp);

const TEAM_DEFAULTS = {
  foTeam: { name: "Fixture Ops Delivery", label: "Wins" },
  foSpecialists: { name: "Fixture Ops Automation / Operational Updates", label: "Big Wins" }
};

const authReady = signInAnonymously(auth).catch((err) => {
  console.error("Anonymous sign-in failed:", err);
  alert("Could not connect — check your internet connection and try reloading.");
});

// ---------- Tabs ----------
document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(`tab-${btn.dataset.tab}`).classList.add("active");
    if (btn.dataset.tab === "bulletin") loadBulletinPreview();
  });
});

// ---------- Emoji picker ----------
const EMOJI_SET = ["🏆", "🎉", "🚀", "💪", "🔥", "⭐", "✅", "👏", "💜", "🌟", "🙌", "❤️", "📅", "🔔", "📌", "🎯"];

function insertAtCursor(el, text) {
  const start = el.selectionStart ?? el.value.length;
  const end = el.selectionEnd ?? el.value.length;
  el.value = el.value.slice(0, start) + text + el.value.slice(end);
  el.focus();
  el.selectionStart = el.selectionEnd = start + text.length;
}

function attachEmojiPicker(row, targetEl) {
  const wrap = document.createElement("div");
  wrap.className = "emoji-picker-wrap";

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "emoji-btn";
  btn.textContent = "+ 😊";
  btn.title = "Insert an emoji";

  const panel = document.createElement("div");
  panel.className = "emoji-panel";

  EMOJI_SET.forEach((emo) => {
    const opt = document.createElement("button");
    opt.type = "button";
    opt.className = "emoji-option";
    opt.textContent = emo;
    opt.addEventListener("click", () => {
      insertAtCursor(targetEl, emo);
      panel.classList.remove("open");
    });
    panel.appendChild(opt);
  });

  btn.addEventListener("click", () => {
    document.querySelectorAll(".emoji-panel.open").forEach((p) => { if (p !== panel) p.classList.remove("open"); });
    panel.classList.toggle("open");
  });

  wrap.appendChild(btn);
  wrap.appendChild(panel);
  const removeBtn = row.querySelector(".remove-btn");
  row.insertBefore(wrap, removeBtn);
}

document.addEventListener("click", (e) => {
  document.querySelectorAll(".emoji-picker-wrap").forEach((wrap) => {
    if (!wrap.contains(e.target)) wrap.querySelector(".emoji-panel").classList.remove("open");
  });
});

// ---------- Dynamic list row builders ----------
function addRow(container, type, values = {}) {
  const row = document.createElement("div");
  row.className = "list-row";

  if (type === "win") {
    row.innerHTML = `
      <textarea class="win-input" rows="2" placeholder="Add a short description of the win, achievement, or milestone">${escapeHtml(values.text || "")}</textarea>
      <button type="button" class="remove-btn">Remove</button>`;
    attachEmojiPicker(row, row.querySelector(".win-input"));
  } else if (type === "upcoming") {
    row.innerHTML = `
      <input type="text" class="upcoming-title" placeholder="Event / Initiative / Project" value="${escapeAttr(values.title || "")}" style="max-width:220px" />
      <textarea class="upcoming-desc" rows="2" placeholder="Short description of what's coming up">${escapeHtml(values.description || "")}</textarea>
      <button type="button" class="remove-btn">Remove</button>`;
    attachEmojiPicker(row, row.querySelector(".upcoming-desc"));
  } else if (type === "shoutout") {
    row.innerHTML = `
      <input type="text" class="shoutout-name" placeholder="Shoutout to [Name or Team]" style="max-width:220px" />
      <textarea class="shoutout-desc" rows="2" placeholder="For their outstanding contribution to..."></textarea>
      <button type="button" class="remove-btn">Remove</button>`;
    attachEmojiPicker(row, row.querySelector(".shoutout-desc"));
  }

  row.querySelector(".remove-btn").addEventListener("click", () => row.remove());
  container.appendChild(row);
}

document.querySelectorAll('[data-action="add-win"]').forEach((btn) =>
  btn.addEventListener("click", () => {
    const list = btn.closest(".team-form").querySelector('[data-list="wins"]');
    addRow(list, "win");
  })
);

document.querySelectorAll('[data-action="add-upcoming"]').forEach((btn) =>
  btn.addEventListener("click", () => {
    const list = btn.closest(".team-form").querySelector('[data-list="upcoming"]');
    addRow(list, "upcoming");
  })
);

document.getElementById("add-shoutout-row").addEventListener("click", () => {
  addRow(document.querySelector('[data-list="shoutouts-input"]'), "shoutout");
});

// ---------- Load existing team data into the Submit form ----------
async function loadTeamForm(teamId) {
  await authReady;
  const form = document.querySelector(`.team-form[data-team="${teamId}"]`);
  const statusEl = form.querySelector(".save-status");
  try {
    const snap = await getDoc(doc(db, "bulletin", "current", "teams", teamId));
    const data = snap.exists() ? snap.data() : null;

    const winsList = form.querySelector('[data-list="wins"]');
    const upcomingList = form.querySelector('[data-list="upcoming"]');
    winsList.innerHTML = "";
    upcomingList.innerHTML = "";

    if (data?.subtitle) form.querySelector(".team-subtitle").value = data.subtitle;
    (data?.wins || []).forEach((w) => addRow(winsList, "win", { text: w }));
    (data?.upcoming || []).forEach((u) => addRow(upcomingList, "upcoming", u));
  } catch (err) {
    console.error(`Failed to load existing data for ${teamId}:`, err);
    statusEl.textContent = "Couldn't load your team's existing data — check your connection and reload.";
  }
}

document.querySelectorAll(".team-form").forEach((form) => {
  loadTeamForm(form.dataset.team);

  form.querySelector('[data-action="save-team"]').addEventListener("click", async () => {
    await authReady;
    const teamId = form.dataset.team;
    const subtitle = form.querySelector(".team-subtitle").value.trim();
    const wins = [...form.querySelectorAll(".win-input")].map((i) => i.value.trim()).filter(Boolean);
    const upcoming = [...form.querySelectorAll(".upcoming-title")].map((titleInput, idx) => {
      const desc = form.querySelectorAll(".upcoming-desc")[idx].value.trim();
      return { title: titleInput.value.trim(), description: desc };
    }).filter((u) => u.title || u.description);

    const statusEl = form.querySelector(".save-status");
    try {
      await setDoc(doc(db, "bulletin", "current", "teams", teamId), {
        name: TEAM_DEFAULTS[teamId].name,
        subtitle,
        wins,
        upcoming
      });
      statusEl.textContent = "Saved — your team's update is in ✅";
      setTimeout(() => (statusEl.textContent = ""), 4000);
    } catch (err) {
      console.error(err);
      statusEl.textContent = "Save failed — check your connection and try again.";
    }
  });
});

// ---------- Shoutouts ----------
async function loadShoutouts() {
  await authReady;
  const container = document.getElementById("existing-shoutouts");
  try {
    const snap = await getDocs(collection(db, "bulletin", "current", "shoutouts"));
    container.innerHTML = "";
    snap.forEach((docSnap) => {
      const s = docSnap.data();
      const row = document.createElement("div");
      row.className = "existing-item";
      row.innerHTML = `<span class="existing-item-text"><strong>${escapeHtml(s.name)}</strong> — ${escapeHtml(s.description)}</span>`;
      const del = document.createElement("button");
      del.className = "remove-btn";
      del.textContent = "Remove";
      del.addEventListener("click", async () => {
        await deleteDoc(doc(db, "bulletin", "current", "shoutouts", docSnap.id));
        loadShoutouts();
      });
      row.appendChild(del);
      container.appendChild(row);
    });
    return snap.size;
  } catch (err) {
    console.error("Failed to load shoutouts list:", err);
    container.innerHTML = `<p class="hint">Couldn't load existing shoutouts — check your connection and reload.</p>`;
    return 0;
  }
}
loadShoutouts();

document.getElementById("save-shoutouts").addEventListener("click", async () => {
  await authReady;
  const rows = [...document.querySelectorAll('[data-list="shoutouts-input"] .list-row')];
  const statusEl = document.getElementById("shoutout-status");
  let added = 0;
  for (const row of rows) {
    const name = row.querySelector(".shoutout-name").value.trim();
    const description = row.querySelector(".shoutout-desc").value.trim();
    if (!name && !description) continue;
    await addDoc(collection(db, "bulletin", "current", "shoutouts"), {
      name, description, createdAt: serverTimestamp()
    });
    added++;
  }
  document.querySelector('[data-list="shoutouts-input"]').innerHTML = "";
  statusEl.textContent = added ? `Saved ${added} shoutout(s) ✅` : "Nothing to save";
  setTimeout(() => (statusEl.textContent = ""), 4000);
  loadShoutouts();
});

// ---------- Bulletin preview / Generate / Clear ----------
async function loadBulletinPreview() {
  await authReady;
  const statusEl = document.getElementById("bulletin-status");
  statusEl.textContent = "Loading current data…";

  const now = new Date();
  const periodInput = document.getElementById("period-override");
  const autoPeriod = now.toLocaleString("en-US", { month: "long", year: "numeric" });
  if (periodInput && !periodInput.value) periodInput.placeholder = `Auto: ${autoPeriod}`;
  const period = (periodInput?.value || "").trim() || autoPeriod;
  document.getElementById("mockup-date").innerHTML =
    `${escapeHtml(period)}<br><small>Published: ${now.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}</small>`;

  let hadError = false;
  for (const teamId of Object.keys(TEAM_DEFAULTS)) {
    const card = document.getElementById(`card-${teamId}`);
    try {
      const snap = await getDoc(doc(db, "bulletin", "current", "teams", teamId));
      const data = snap.exists() ? snap.data() : { name: TEAM_DEFAULTS[teamId].name, subtitle: "", wins: [], upcoming: [] };
      const winsHtml = (data.wins || []).map((w) =>
        `<div class="mockup-item"><div class="item-icon">🏆</div><div class="item-text"><strong>${escapeHtml(w)}</strong></div></div>`
      ).join("") || `<div class="mockup-item"><div class="item-text"><span>Awaiting this month's update…</span></div></div>`;
      const upcomingHtml = (data.upcoming || []).map((u) =>
        `<div class="mockup-item"><div class="item-icon">📅</div><div class="item-text"><strong>${escapeHtml(u.title)}</strong><span>${escapeHtml(u.description)}</span></div></div>`
      ).join("") || `<div class="mockup-item"><div class="item-text"><span>Awaiting this month's update…</span></div></div>`;

      card.innerHTML = `
        <div class="team-card-badge">${teamId === "foTeam" ? "🔵" : "🟢"}</div>
        <div class="team-card-head">
          <div class="team-card-icon">👥</div>
          <div class="team-card-text">
            <h3>${escapeHtml(data.name)}</h3>
            <p class="team-tagline">${escapeHtml(data.subtitle || "")}</p>
          </div>
        </div>
        <div class="team-columns">
          <div class="team-column">
            <h4>🏆 ${escapeHtml(TEAM_DEFAULTS[teamId].label)}</h4>
            ${winsHtml}
            <div class="mockup-signoff">Great work, team! 🎉</div>
          </div>
          <div class="team-column">
            <h4>🚀 Upcoming</h4>
            ${upcomingHtml}
            <div class="mockup-signoff">Let's keep building momentum! 💪</div>
          </div>
        </div>
      `;
    } catch (err) {
      console.error(`Failed to load ${teamId}:`, err);
      card.innerHTML = `<p class="team-tagline">Couldn't load this team's data — check your connection and hit Refresh.</p>`;
      hadError = true;
    }
  }

  const ackCards = document.getElementById("ack-cards");
  const acknowledgementsSection = ackCards.closest(".mockup-acknowledgements");
  try {
    const shoutSnap = await getDocs(collection(db, "bulletin", "current", "shoutouts"));
    ackCards.innerHTML = "";
    acknowledgementsSection.classList.toggle("is-empty", shoutSnap.empty);
    const decorations = ["👏", "💜", "⭐", "🌟", "🎉"];
    let ackIndex = 0;
    shoutSnap.forEach((docSnap) => {
      const s = docSnap.data();
      const initials = (s.name || "?").split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();
      const card = document.createElement("div");
      card.className = "ack-card";
      card.innerHTML = `
        <div class="ack-avatar">${escapeHtml(initials)}</div>
        <div class="ack-text">
          <h5>Shoutout to ${escapeHtml(s.name)}</h5>
          <p>${escapeHtml(s.description)}</p>
        </div>
        <div class="ack-decoration">${decorations[ackIndex % decorations.length]}</div>`;
      ackIndex++;
      ackCards.appendChild(card);
    });
    if (shoutSnap.empty) {
      ackCards.innerHTML = `<div class="ack-card"><p>No shoutouts added yet this cycle.</p></div>`;
    }
  } catch (err) {
    console.error("Failed to load shoutouts:", err);
    acknowledgementsSection.classList.remove("is-empty");
    ackCards.innerHTML = `<div class="ack-card"><p>Couldn't load shoutouts — check your connection and hit Refresh.</p></div>`;
    hadError = true;
  }

  statusEl.textContent = hadError ? "Loaded with errors — see above." : "";
}

document.getElementById("refresh-btn").addEventListener("click", loadBulletinPreview);

async function captureBulletinCanvas() {
  const node = document.getElementById("bulletin-template");
  node.classList.add("pdf-rendering");
  let canvas;
  try {
    // Give the browser one frame to reflow after hiding an empty
    // acknowledgements section, then capture the shorter bulletin.
    await new Promise((resolve) => requestAnimationFrame(resolve));
    canvas = await html2canvas(node, {
      scale: 1,
      backgroundColor: "#ffffff",
      windowWidth: 1400,
      width: 1400
    });
  } finally {
    node.classList.remove("pdf-rendering");
  }
  return canvas;
}

function createPdfFromCanvas(canvas) {
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({
    orientation: canvas.width >= canvas.height ? "landscape" : "portrait",
    unit: "px",
    format: [canvas.width, canvas.height],
    compress: true
  });
  pdf.addImage(canvas, "PNG", 0, 0, canvas.width, canvas.height);
  pdf.setDisplayMode("50%", "continuous", "UseNone");
  return pdf;
}

async function createBulletinPdf() {
  return createPdfFromCanvas(await captureBulletinCanvas());
}

function getBulletinPeriod() {
  const now = new Date();
  const label = document.getElementById("period-override").value.trim() ||
    now.toLocaleString("en-US", { month: "long", year: "numeric" });
  const parsed = new Date(`${label} 1`);
  const date = Number.isNaN(parsed.getTime()) ? now : parsed;
  const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  return { label, key, filename: `fo-monthly-bulletin-${key}.pdf` };
}

document.getElementById("generate-btn").addEventListener("click", async () => {
  const statusEl = document.getElementById("bulletin-status");
  statusEl.textContent = "Generating PDF…";
  try {
    const period = getBulletinPeriod();
    const pdf = await createBulletinPdf();
    pdf.save(period.filename);
    statusEl.textContent = "Downloaded ✅";
  } catch (err) {
    console.error(err);
    statusEl.textContent = "Generation failed — see console for details.";
  }
  setTimeout(() => (statusEl.textContent = ""), 4000);
});

const sendSlackBtn = document.getElementById("send-slack-btn");
const deleteSlackBtn = document.getElementById("delete-slack-btn");
const slackStatusEl = document.getElementById("slack-status");
const SLACK_WORKER_URL = "https://fo-monthly-bulletin-slack.kasparian6.workers.dev/";
const TURNSTILE_SITE_KEY = "0x4AAAAAAEkp-UpXZa3HM01Q";
const MAX_SLACK_PDF_BYTES = 5 * 1024 * 1024;
let turnstileWidgetId = null;
let turnstileWaiter = null;

function waitForTurnstileApi(timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const check = () => {
      if (window.turnstile) {
        resolve(window.turnstile);
      } else if (Date.now() - startedAt >= timeoutMs) {
        reject(new Error("The security check could not load. Refresh the page and try again."));
      } else {
        setTimeout(check, 50);
      }
    };
    check();
  });
}

function settleTurnstile(error, token = "") {
  if (!turnstileWaiter) return;
  const waiter = turnstileWaiter;
  turnstileWaiter = null;
  clearTimeout(waiter.timeoutId);
  if (error) waiter.reject(error);
  else waiter.resolve(token);
}

async function getTurnstileToken() {
  if (turnstileWaiter) throw new Error("A security check is already in progress.");
  const turnstile = await waitForTurnstileApi();

  const tokenPromise = new Promise((resolve, reject) => {
    turnstileWaiter = {
      resolve,
      reject,
      timeoutId: setTimeout(() => {
        settleTurnstile(new Error("The security check timed out. Please try again."));
      }, 120000)
    };
  });

  try {
    if (turnstileWidgetId === null) {
      turnstileWidgetId = turnstile.render("#slack-turnstile", {
        sitekey: TURNSTILE_SITE_KEY,
        action: "slack_request",
        execution: "execute",
        appearance: "interaction-only",
        callback: (token) => settleTurnstile(null, token),
        "error-callback": () => settleTurnstile(new Error("The security check failed. Please try again.")),
        "expired-callback": () => settleTurnstile(new Error("The security check expired. Please try again.")),
        "timeout-callback": () => settleTurnstile(new Error("The security check timed out. Please try again."))
      });
    } else {
      turnstile.reset(turnstileWidgetId);
    }
    turnstile.execute(turnstileWidgetId);
  } catch (error) {
    settleTurnstile(error);
  }

  return tokenPromise;
}

async function callSlackWorker(path, turnstileToken, requestOptions) {
  const response = await fetch(new URL(path, SLACK_WORKER_URL), {
    ...requestOptions,
    headers: {
      ...requestOptions.headers,
      "X-Turnstile-Token": turnstileToken
    }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.ok) {
    throw new Error(data.error || `The Slack service returned HTTP ${response.status}.`);
  }
  return data;
}

function setSlackControlsBusy(busy, action = "") {
  sendSlackBtn.disabled = busy;
  deleteSlackBtn.disabled = busy;
  sendSlackBtn.textContent = busy && action === "send" ? "Sending to Slack…" : "Send to Slack";
  deleteSlackBtn.textContent = busy && action === "delete" ? "Deleting…" : "Delete last Slack post";
}

sendSlackBtn.addEventListener("click", async () => {
  const period = getBulletinPeriod();
  if (!confirm(`Send the ${period.label} bulletin PDF to Slack?`)) return;

  setSlackControlsBusy(true, "send");
  sendSlackBtn.textContent = "Preparing PDF…";
  try {
    slackStatusEl.textContent = "Generating PDF…";
    const pdf = await createBulletinPdf();
    const pdfBlob = pdf.output("blob");
    if (pdfBlob.size > MAX_SLACK_PDF_BYTES) {
      throw new Error(`The generated PDF is ${(pdfBlob.size / 1024 / 1024).toFixed(1)} MB; the Slack limit is 5 MB.`);
    }
    slackStatusEl.textContent = "Completing security check…";
    const turnstileToken = await getTurnstileToken();
    slackStatusEl.textContent = "Sending PDF directly to Slack…";
    const url = new URL("send", SLACK_WORKER_URL);
    url.searchParams.set("periodKey", period.key);
    url.searchParams.set("periodLabel", period.label);
    url.searchParams.set("filename", period.filename);
    const result = await callSlackWorker(url.toString(), turnstileToken, {
      method: "POST",
      headers: { "Content-Type": "application/pdf" },
      body: pdfBlob
    });
    slackStatusEl.textContent = `Sent to Slack ✅ (${result.successfulSends}/3)`;
  } catch (err) {
    console.error(err);
    slackStatusEl.textContent = `Slack send failed: ${err.message}`;
  } finally {
    setSlackControlsBusy(false);
  }
});

deleteSlackBtn.addEventListener("click", async () => {
  const period = getBulletinPeriod();
  if (!confirm(`Delete the latest Slack post for ${period.label}? This does not restore one of the 3 monthly sends.`)) return;

  setSlackControlsBusy(true, "delete");
  try {
    slackStatusEl.textContent = "Completing security check…";
    const turnstileToken = await getTurnstileToken();
    slackStatusEl.textContent = "Deleting the latest Slack post…";
    await callSlackWorker("delete-last", turnstileToken, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ periodKey: period.key, periodLabel: period.label })
    });
    slackStatusEl.textContent = "Last Slack post deleted ✅";
  } catch (err) {
    console.error(err);
    slackStatusEl.textContent = `Slack delete failed: ${err.message}`;
  } finally {
    setSlackControlsBusy(false);
  }
});

document.getElementById("clear-btn").addEventListener("click", async () => {
  if (!confirm("Clear all fields for next month? This removes this cycle's wins, upcoming items, and shoutouts. Make sure you've already downloaded/published this month's picture.")) {
    return;
  }
  await authReady;
  const statusEl = document.getElementById("bulletin-status");
  statusEl.textContent = "Clearing…";

  for (const teamId of Object.keys(TEAM_DEFAULTS)) {
    await setDoc(doc(db, "bulletin", "current", "teams", teamId), {
      name: TEAM_DEFAULTS[teamId].name,
      subtitle: "",
      wins: [],
      upcoming: []
    });
  }
  const shoutSnap = await getDocs(collection(db, "bulletin", "current", "shoutouts"));
  for (const docSnap of shoutSnap.docs) {
    await deleteDoc(doc(db, "bulletin", "current", "shoutouts", docSnap.id));
  }
  statusEl.textContent = "Cleared — ready for next month ✅";
  setTimeout(() => (statusEl.textContent = ""), 4000);
  loadBulletinPreview();
  document.querySelectorAll(".team-form").forEach((form) => loadTeamForm(form.dataset.team));
  loadShoutouts();
});

// ---------- View modes (?mode=submit / ?mode=view / none = full admin) ----------
// UI-level only — hides tabs/buttons for the intended audience of each link.
// Not real access control: there's no login, so this doesn't prevent someone
// technical from reaching the same data another way. Fine given only two
// trusted managers use the submit link.
const viewMode = new URLSearchParams(window.location.search).get("mode");

if (viewMode === "submit") {
  document.querySelector(".tabs").style.display = "none";
  document.getElementById("tab-bulletin").remove();
} else if (viewMode === "view") {
  document.querySelector(".tabs").style.display = "none";
  document.getElementById("tab-submit").remove();
  document.getElementById("tab-bulletin").classList.add("active");
  document.getElementById("generate-btn").style.display = "none";
  document.getElementById("clear-btn").style.display = "none";
  document.querySelector(".slack-controls").style.display = "none";
  document.querySelector(".period-label").style.display = "none";
  loadBulletinPreview();
}

// ---------- helpers ----------
function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}
function escapeAttr(str) { return escapeHtml(str); }
