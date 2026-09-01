# FO Monthly Bulletin

Static GitHub Pages site for collecting Fixture Operations updates, previewing the monthly bulletin, generating versioned public PDF archives, and announcing them in Slack without exposing the Slack bot token.

## Architecture

The site remains public and requires no visible login. Firebase Anonymous Authentication signs the browser in silently so Firestore Security Rules can validate writes.

`Send to Slack` uses this flow:

1. The browser captures the bulletin once and creates the PDF plus a compressed JPEG preview.
2. The browser writes a tightly validated request to `bulletin/current/slackQueue` in Firestore.
3. `.github/workflows/process-slack-queue.yml` checks the queue every five minutes.
4. GitHub Actions writes permanent versioned archive files under `bulletins/<YYYY-MM>/v<1-3>/`.
5. The same workflow deploys the site and archive with GitHub Pages.
6. After both public URLs respond successfully, the workflow posts a Slack Block Kit message containing the PDF link and visible preview image.
7. The successful delivery counter and Slack message timestamp are recorded in Firestore.

The Slack token and Firebase private key never appear in the website, `firebase-config.js`, Firestore, the public archive, or committed source files.

## Archive and Slack behavior

- The destination channel is fixed at `C0AFA7FR5EZ` while testing.
- Each successful send receives an immutable version: `v1`, `v2`, or `v3`.
- Example PDF: `bulletins/2026-09/v1/fo-monthly-bulletin-2026-09-v1.pdf`.
- Example preview: `bulletins/2026-09/v1/fo-monthly-bulletin-2026-09-v1-preview.jpg`.
- The public PDF and JPEG remain available after the Slack message is deleted.
- `Delete last Slack post` removes only the latest undeleted bot message for that bulletin month.
- Deleting does not reduce the successful-send counter.
- Up to three successful sends are allowed per bulletin month. Failed attempts do not count.
- The generated PDF is capped at 520 KiB and the preview JPEG at 140 KiB so their combined base64 queue payload stays below Firestore's 1 MiB document limit.
- When there are no acknowledgements, the section remains visible as an empty state on the website but is omitted from both the generated PDF and preview image.
- Closing the page does not cancel an already queued request.

The Slack app only needs the `chat:write` Bot Token Scope. It must also be invited to the destination channel, unless the channel is public and the app has `chat:write.public`. `files:read` and `files:write` are not used.

## One-time setup

### 1. Firebase

The existing Firebase project is `fo-bulletin`.

1. Keep Firestore and Anonymous Authentication enabled.
2. In Firebase Console, open **Firestore Database → Rules**.
3. Replace the published rules with [`firestore.rules`](./firestore.rules) and click **Publish**.
4. Keep the existing Firebase service-account private key used by GitHub Actions.

The Firebase values in `firebase-config.js` are public web identifiers. Firestore Security Rules control browser access. Never commit or share the service-account JSON.

### 2. GitHub Actions Secrets

In the repository open **Settings → Secrets and variables → Actions**. These repository secrets must exist:

- `SLACK_BOT_TOKEN` — the complete `xoxb-...` token for the approved bot with `chat:write`.
- `FIREBASE_SERVICE_ACCOUNT_JSON` — the complete Firebase service-account JSON.

Do not put either value in a repository file.

### 3. GitHub Actions and Pages permissions

1. Open **Settings → Actions → General**.
2. Under **Workflow permissions**, choose **Read and write permissions** and save.
3. Open **Settings → Pages**.
4. Under **Build and deployment → Source**, choose **GitHub Actions**.

The workflow itself limits its token to `contents: write`, `pages: write`, and `id-token: write`. It uses GitHub's temporary automatic `GITHUB_TOKEN`; no personal access token is needed.

### 4. Publish and initialize

1. Push or upload all changed files to the default branch, preserving their directories.
2. Open **Actions → Process Slack queue**.
3. Select **Run workflow** once to deploy the initial GitHub Pages artifact.
4. Confirm that the workflow finishes successfully before using `Send to Slack`.

Scheduled GitHub Actions runs can occasionally start later than five minutes.

## Using the site

- Normal URL — full submission and bulletin controls.
- `?mode=view` — read-only bulletin display with Slack/admin controls hidden.
- `?mode=submit` — submission form only.

On the Bulletin tab:

- `Generate PDF` downloads the monthly PDF locally without publishing it.
- `Send to Slack` confirms, generates PDF/JPEG, publishes a permanent version, and posts the link plus image to Slack.
- `Delete last Slack post` confirms and removes only the latest bot message; its public archive remains.
- `Clear Fields` keeps its existing behavior.

## Main files

- `index.html`, `style.css`, `app.js` — UI, Firebase data flow, PDF/JPEG generation, and queue controls.
- `firebase-config.js` — public Firebase web configuration.
- `firestore.rules` — validation for bulletin data and immutable queue requests.
- `.github/workflows/process-slack-queue.yml` — queue scheduler, archive commit, Pages deployment, and Slack finalization.
- `actions/process-slack-queue.mjs` — server-side Firestore, archive, and Slack processing.
- `actions/build-pages.mjs` — builds the exact static artifact deployed to GitHub Pages.
- `actions/process-slack-queue.test.mjs` — archive validation and Slack payload tests.
