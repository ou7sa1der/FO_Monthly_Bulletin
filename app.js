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

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
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
const MAX_QUEUED_PDF_BYTES = 650 * 1024;

function activeSlackJobKey(action, periodKey) {
  return `fo-monthly-bulletin:slack-job:${action}:${periodKey}`;
}

function clearActiveSlackJob(action, periodKey) {
  localStorage.removeItem(activeSlackJobKey(action, periodKey));
}

async function getActiveSlackJob(action, periodKey) {
  await authReady;
  const path = localStorage.getItem(activeSlackJobKey(action, periodKey));
  if (!path) return null;

  try {
    const jobRef = doc(db, path);
    const snapshot = await getDoc(jobRef);
    const job = snapshot.data();
    if (snapshot.exists()
      && job.requestedBy === auth.currentUser?.uid
      && ["queued", "processing"].includes(job.status)) {
      return jobRef;
    }
  } catch (error) {
    console.warn("Could not resume the existing Slack request:", error);
  }

  clearActiveSlackJob(action, periodKey);
  return null;
}

function setSlackControlsBusy(busy, action = "") {
  sendSlackBtn.disabled = busy;
  deleteSlackBtn.disabled = busy;
  sendSlackBtn.textContent = busy && action === "send" ? "Queued for Slack…" : "Send to Slack";
  deleteSlackBtn.textContent = busy && action === "delete" ? "Delete queued…" : "Delete last Slack post";
}

async function queueSlackJob(payload) {
  await authReady;
  const user = auth.currentUser;
  if (!user) throw new Error("Anonymous Firebase sign-in is not ready. Reload the page and try again.");
  const jobRef = await addDoc(collection(db, "bulletin", "current", "slackQueue"), {
    ...payload,
    requestedBy: user.uid,
    status: "queued",
    createdAt: serverTimestamp()
  });
  localStorage.setItem(activeSlackJobKey(payload.action, payload.periodKey), jobRef.path);
  return jobRef;
}

async function waitForSlackJob(jobRef, action, periodKey) {
  // The queued job continues even when the page is closed. GitHub's scheduled
  // trigger is best effort, so a repository owner can run the workflow manually
  // when immediate processing is needed.
  for (let attempt = 0; attempt < 120; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 5000));
    const snapshot = await getDoc(jobRef);
    if (!snapshot.exists()) {
      clearActiveSlackJob(action, periodKey);
      throw new Error("The queued Slack request could not be found.");
    }
    const job = snapshot.data();
    if (job.status === "succeeded") {
      clearActiveSlackJob(action, periodKey);
      return action === "send"
        ? `Sent to Slack ✅ (${job.successfulSends}/3)`
        : "Last Slack post deleted ✅";
    }
    if (job.status === "rejected" || job.status === "failed") {
      clearActiveSlackJob(action, periodKey);
      throw new Error(job.message || "The Slack request failed.");
    }
    if (job.status === "processing") {
      slackStatusEl.textContent = "GitHub Actions is processing the request…";
    } else {
      slackStatusEl.textContent = "Queued — waiting for GitHub Actions…";
    }
  }
  return "Still queued — GitHub's schedule is delayed; the request remains saved.";
}

sendSlackBtn.addEventListener("click", async () => {
  const period = getBulletinPeriod();
  if (!confirm(`Send the ${period.label} bulletin PDF to Slack?`)) return;

  setSlackControlsBusy(true, "send");
  sendSlackBtn.textContent = "Preparing PDF…";
  try {
    const existingJob = await getActiveSlackJob("send", period.key);
    if (existingJob) {
      slackStatusEl.textContent = "Resuming the existing queued Slack request…";
      slackStatusEl.textContent = await waitForSlackJob(existingJob, "send", period.key);
      return;
    }

    slackStatusEl.textContent = "Generating PDF…";
    const pdf = await createBulletinPdf();
    const pdfBlob = pdf.output("blob");
    if (pdfBlob.size > MAX_QUEUED_PDF_BYTES) {
      throw new Error(`The generated PDF is ${(pdfBlob.size / 1024).toFixed(0)} KB; the Slack queue limit is 650 KB.`);
    }
    slackStatusEl.textContent = "Adding the request to the secure queue…";
    const jobRef = await queueSlackJob({
      action: "send",
      periodKey: period.key,
      periodLabel: period.label,
      filename: period.filename,
      pdfBytes: pdfBlob.size,
      pdfBase64: await blobToBase64(pdfBlob)
    });
    setSlackControlsBusy(true, "send");
    slackStatusEl.textContent = "Queued — waiting for GitHub Actions…";
    slackStatusEl.textContent = await waitForSlackJob(jobRef, "send", period.key);
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
    const existingJob = await getActiveSlackJob("delete", period.key);
    if (existingJob) {
      slackStatusEl.textContent = "Resuming the existing queued delete request…";
      slackStatusEl.textContent = await waitForSlackJob(existingJob, "delete", period.key);
      return;
    }

    slackStatusEl.textContent = "Adding the delete request to the secure queue…";
    const jobRef = await queueSlackJob({
      action: "delete",
      periodKey: period.key,
      periodLabel: period.label
    });
    slackStatusEl.textContent = "Queued — waiting for GitHub Actions…";
    slackStatusEl.textContent = await waitForSlackJob(jobRef, "delete", period.key);
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
