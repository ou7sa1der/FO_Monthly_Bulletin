# FO Monthly Bulletin

Static GitHub Pages site for collecting Fixture Operations updates, previewing the monthly bulletin, generating its PDF, and queueing direct Slack delivery without exposing the Slack bot token.

## Architecture

The site remains public and requires no visible login. Firebase Anonymous Authentication signs the browser in silently so Firestore Security Rules can validate writes.

Slack operations use this flow:

1. `Send to Slack` generates the same PDF as `Generate PDF`.
2. The browser writes a tightly validated request to `bulletin/current/slackQueue` in Firestore.
3. `.github/workflows/process-slack-queue.yml` checks the queue approximately every five minutes.
4. The workflow reads the Slack token and Firebase service account from GitHub Actions Secrets.
5. The workflow uploads the PDF directly to Slack with the fixed message in channel `C0AFA7FR5EZ`, then records the result in Firestore.

The Slack token and Firebase private key never appear in the website, `firebase-config.js`, Firestore, or committed source files.

## Slack behavior

- The destination channel is fixed as `C0AFA7FR5EZ` while testing.
- The exact generated PDF is queued and uploaded directly to Slack; it is not published through GitHub Pages.
- When there are no acknowledgements, the section remains visible as an empty state on the website but is omitted from generated PDFs.
- Firestore documents have a 1 MiB limit, so the PDF is capped at 650 KiB. A normal bulletin is expected to be around 200 KiB.
- Up to three successful sends are allowed per bulletin month. Failed attempts do not count.
- `Delete last Slack post` removes the latest undeleted bot message and PDF for the selected month.
- Deleting does not reduce the successful-send counter.
- Both operations ask for confirmation and temporarily disable both Slack buttons.
- Closing the page does not cancel an already queued request.

The Slack app must be a member of the test channel and have these Bot Token Scopes:

- `chat:write` — post and delete the bot's own message.
- `files:write` — upload and delete the PDF.
- `files:read` — find the Slack message timestamp associated with the uploaded PDF.

After changing scopes, reinstall the Slack app to the workspace so the `xoxb-...` token receives them.

## One-time setup

### 1. Firebase

The existing Firebase project is `fo-bulletin`.

1. Keep Firestore and Anonymous Authentication enabled.
2. In Firebase Console, open **Firestore Database → Rules**.
3. Replace the published rules with [`firestore.rules`](./firestore.rules) and click **Publish**.
4. Keep the existing Firebase service-account private key in the GitHub Actions secret.

The values in `firebase-config.js` are public web identifiers. Firestore Security Rules control browser access. Never commit the Firebase service-account JSON.

### 2. GitHub Actions Secrets

In **Settings → Secrets and variables → Actions**, keep these repository secrets:

- `SLACK_BOT_TOKEN` — the complete `xoxb-...` token for the bot with all three scopes above.
- `FIREBASE_SERVICE_ACCOUNT_JSON` — the complete Firebase service-account JSON.

### 3. Publish and test

Upload the changed files to the default branch, preserving their directories. GitHub Pages continues using the existing branch configuration.

To process a request immediately, use **Actions → Process Slack queue → Run workflow**. The scheduled GitHub trigger can occasionally be delayed, so it should not be treated as an exact five-minute timer.

## Using the site

- Normal URL — full submission and bulletin controls.
- `?mode=view` — read-only bulletin display with Slack/admin controls hidden.
- `?mode=submit` — submission form only.

On the Bulletin tab:

- `Generate PDF` downloads the monthly PDF locally.
- `Send to Slack` confirms, generates the PDF, and queues it for direct Slack upload.
- `Delete last Slack post` confirms and queues deletion of the latest bot delivery for that month.
- `Clear Fields` keeps its existing behavior.

## Main files

- `index.html`, `style.css`, `app.js` — UI, Firebase data flow, PDF generation, and queue controls.
- `firebase-config.js` — public Firebase web configuration.
- `firestore.rules` — validation for bulletin data and immutable queue requests.
- `.github/workflows/process-slack-queue.yml` — scheduled and manual processor.
- `actions/process-slack-queue.mjs` — server-side Firestore and direct Slack PDF upload.
- `actions/process-slack-queue.test.mjs` — processor validation tests.
