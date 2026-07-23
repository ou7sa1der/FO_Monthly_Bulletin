# FO Monthly Bulletin

A static site that is both the submission form and the picture generator for the FO Monthly Bulletin. No backend server — Firebase (Firestore + Anonymous Auth) is the shared store, GitHub Pages hosts the static files, and Slack Workflow Builder sends the reminders.

## One-time setup

Firebase's console has reorganized its sidebar recently — these steps match the current layout (2026), not older tutorials/screenshots you might find elsewhere, which may say "Build →" where this says "Databases & Storage →" or "Security →".

### 1. Create the Firebase project
1. Go to https://console.firebase.google.com, sign in with any Google account, click **Add project**.
2. Name it (e.g. `fo-bulletin`), skip Google Analytics, click **Create project**.

### 2. Enable Firestore
1. In the left sidebar: **Databases & Storage → Firestore → Create database**.
2. When asked to pick an edition, choose **Standard edition** — this is the one with the free Spark-plan quota (1 GB storage, 50,000 reads/day, 20,000 writes/day, 20,000 deletes/day). Enterprise edition uses different, non-free billing — don't pick that one.
3. Pick any region close to you, start in **production mode** (we're pasting our own rules next, so the "test mode" default doesn't matter).

### 3. Enable Anonymous Authentication
1. In the left sidebar: **Security → Authentication → Get started → Sign-in method** tab.
2. Click **Anonymous**, toggle it **Enable**, **Save**.

### 4. Deploy the security rules
1. In the left sidebar: **Databases & Storage → Firestore → Rules** tab.
2. Delete the placeholder content and paste in the contents of [`firestore.rules`](./firestore.rules) from this repo.
3. Click **Publish**.

### 5. Register a Web app and get your config
1. Click the gear icon (top left, next to "Project Overview") → **Project settings**.
2. Scroll to **Your apps** → click the **`</>`** (Web) icon.
3. Give it any nickname, click **Register app** (no need to check "Also set up Firebase Hosting" — we're using GitHub Pages instead).
4. Copy the `firebaseConfig` object it shows you.
5. Open [`firebase-config.js`](./firebase-config.js) in this project and paste your real values in place of the `PASTE_..._HERE` placeholders.

These values aren't secret — they just tell the page which Firebase project to talk to. Real access control lives entirely in `firestore.rules`, not in hiding this file.

### Quick sanity check once you're done
Open the page locally (see below), open the browser's developer console (F12), and reload. You should see no `auth/api-key-not-valid` or `client is offline` errors — if you still see those, double-check `firebase-config.js` has your real values (not the `PASTE_..._HERE` placeholders) and that you completed steps 2–3 above.

## Running it locally to test

Any static file server works. From this folder:

```bash
npx serve .
```

Then open the printed local URL in your browser.

## Publishing to GitHub Pages

1. Push this folder's contents to a GitHub repo.
2. Repo → **Settings → Pages** → Source: **Deploy from a branch** → pick your branch and `/ (root)`.
3. The resulting URL is `https://<username>.github.io/<repo>/` — see "Which link goes to whom" below for what to actually share.

## Which link goes to whom

The same page supports three modes via a URL query parameter — this is a UI convenience, not real access control (no login exists to enforce it, so anyone technical could still reach the same data another way):

- **`https://.../` (no parameter)** — full access: both tabs, Generate, Clear. **Send this to your managers** — decided against restricting them, they get everything.
- **`https://.../?mode=view`** — read-only, auto-loading Bulletin display only, no tabs or admin buttons. Optional — only use this if you want to share a "just look, don't touch" link with someone outside the two managers.
- **`https://.../?mode=submit`** — Submit tab only, no Bulletin access. Built but currently unused — the decision was to give managers full access instead. Kept in the code in case that changes later.

## Generating the monthly picture

The Bulletin tab's **Generate** button produces a **PDF** (not PNG) — decided this way because the file is posted as a channel attachment, not embedded in a Slack Canvas, and PDF previews well there. Each cycle: generate, download, post it to the channel — this creates a permanent archive of that month's bulletin, which a live link wouldn't (a shared link always shows *current* data, so it would show next month's content once Clear Fields runs — the PDF is what stays historically accurate).

## What each file is

- `index.html` — the whole app: Submit tab (per-team forms) and Bulletin tab (preview + Generate/Clear)
- `style.css` — styling, including the mockup-matched bulletin template
- `app.js` — Firebase wiring, dynamic add/remove lists, save/load/clear, view-mode logic, and the Generate-to-PDF logic
- `firebase-config.js` — your project's connection details (fill this in, see step 5 above)
- `firestore.rules` — the only thing that actually restricts who can write what
