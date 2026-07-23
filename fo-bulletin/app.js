import { firebaseConfig } from "./firebase-config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc,
  collection, getDocs, addDoc, deleteDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const TEAM_DEFAULTS = {
  foTeam: { name: "FO Team", label: "Wins" },
  foSpecialists: { name: "FO Specialists Team", label: "Big Wins" }
};

let authReady = signInAnonymously(auth).catch((err) => {
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
  try {
    const shoutSnap = await getDocs(collection(db, "bulletin", "current", "shoutouts"));
    ackCards.innerHTML = "";
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
    ackCards.innerHTML = `<div class="ack-card"><p>Couldn't load shoutouts — check your connection and hit Refresh.</p></div>`;
    hadError = true;
  }

  statusEl.textContent = hadError ? "Loaded with errors — see above." : "";
}

document.getElementById("refresh-btn").addEventListener("click", loadBulletinPreview);

document.getElementById("generate-btn").addEventListener("click", async () => {
  const statusEl = document.getElementById("bulletin-status");
  statusEl.textContent = "Generating PDF…";
  const node = document.getElementById("bulletin-template");
  try {
    // windowWidth forces html2canvas to lay out the template as if the browser
    // were 1400px wide, ignoring the template's `max-width: 100%` and whatever
    // the admin's actual window size happens to be. scale: 1 keeps the source
    // at real screen resolution (1400x~1347px, ~1.9 megapixels) — higher scale
    // values (tested 2/3/4x) render a clean, uncorrupted canvas on this end,
    // but the resulting PDF glitches into visual noise when previewed (Slack's
    // in-app PDF viewer is exactly this kind of lightweight renderer that
    // chokes on a single very large embedded image). Since scale:1 is already
    // fully lossless PNG (zero compression artifacts, confirmed separately),
    // the extra sharpness from supersampling isn't worth risking broken
    // previews for what you'll actually do with this file.
    const canvas = await html2canvas(node, {
      scale: 1,
      backgroundColor: "#ffffff",
      windowWidth: 1400,
      width: 1400
    });
    // PNG, not JPEG — JPEG (even at quality 1.0) has inherent chroma-subsampling
    // softness around sharp edges (text, icons) that quality alone can't remove.
    // Embedding a PNG via jsPDF's addImage without the `compress` option bloats
    // the file to several MB (tested) because jsPDF re-encodes the pixel data
    // inefficiently regardless of input compression — but enabling `compress`
    // (Flate-compresses the PDF's internal streams) brings that same lossless
    // PNG down to ~0.2MB, nowhere near Slack's 10MB cap, with zero compression
    // artifacts. One PDF page sized exactly to the image, so the whole page is
    // the bulletin with no extra margins.
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({
      orientation: canvas.width >= canvas.height ? "landscape" : "portrait",
      unit: "px",
      format: [canvas.width, canvas.height],
      compress: true
    });
    pdf.addImage(canvas, "PNG", 0, 0, canvas.width, canvas.height);
    pdf.save(`fo-monthly-bulletin-${new Date().toISOString().slice(0, 10)}.pdf`);
    statusEl.textContent = "Downloaded ✅";
  } catch (err) {
    console.error(err);
    statusEl.textContent = "Generation failed — see console for details.";
  }
  setTimeout(() => (statusEl.textContent = ""), 4000);
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
