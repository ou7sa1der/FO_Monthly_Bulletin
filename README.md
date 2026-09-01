# FO Monthly Bulletin

Static GitHub Pages site for collecting Fixture Operations updates, previewing the monthly bulletin, generating its PDF, and queueing Slack delivery without exposing the Slack bot token.

## Architecture

The existing site remains public and requires no visible login. Firebase Anonymous Authentication signs the browser in silently so Firestore Security Rules can validate writes.

Slack operations use this flow:

1. `Send to Slack` generates the same PDF as `Generate PDF`.
2. The browser writes a tightly validated request to `bulletin/current/slackQueue` in Firestore.
3. `.github/workflows/process-slack-queue.yml` checks the queue every five minutes.
4. The workflow reads the Slack token and Firebase service account from GitHub Actions Secrets.
5. The workflow sends the fixed message and PDF to channel `C0AFA7FR5EZ`, then records the result in Firestore.

The Slack token and Firebase private key never appear in the website, `firebase-config.js`, Firestore, or committed source files.

## Slack behavior

- The destination channel is fixed in the workflow as `C0AFA7FR5EZ`.
- The exact generated PDF is queued; it is not regenerated later.
- When there are no acknowledgements, that entire section remains visible as an empty state on the website but is omitted from generated PDFs.
- Firestore documents have a 1 MiB limit, so the generated PDF is capped at 650 KiB. The normal bulletin PDF is expected to be around 200 KiB.
- Up to three successful sends are allowed per bulletin month. Failed attempts do not count.
- `Delete last Slack post` removes the latest undeleted bot post and PDF for the selected bulletin month.
- Deleting does not reduce the successful-send counter.
- Both operations ask for confirmation and disable both Slack buttons while the request is being watched.
- Closing the page does not cancel an already queued request.

The Slack app must be a member of the test channel and have these Bot Token Scopes:

- `files:write` — upload and delete the PDF.
- `files:read` — find the Slack message timestamp associated with the uploaded PDF.
- `chat:write` — delete the bot's own message.

After changing scopes, reinstall the Slack app to the workspace so the bot token receives them.

## One-time setup

### 1. Firebase

The existing Firebase project is `fo-bulletin`.

1. Keep Firestore and Anonymous Authentication enabled.
2. In Firebase Console, open **Firestore Database → Rules**.
3. Replace the published rules with [`firestore.rules`](./firestore.rules) and click **Publish**.
4. Open **Project settings → Service accounts** and generate a private key for a service account that can read and write this project's Firestore database.
5. Keep the downloaded JSON private. Do not copy it into this repository or send it in chat.

The Firebase values in `firebase-config.js` are public web identifiers. Firestore Security Rules control browser access.
The included `.gitignore` also blocks common service-account filename patterns, but the JSON should still be kept outside the project folder.

### 2. GitHub Actions Secrets

In the GitHub repository open **Settings → Secrets and variables → Actions → New repository secret** and create:

- `SLACK_BOT_TOKEN` — the complete `xoxb-...` bot token.
- `FIREBASE_SERVICE_ACCOUNT_JSON` — the complete contents of the downloaded Firebase service-account JSON file.

Do not add quotation marks around the Slack token. Paste the service-account JSON as the secret value, not as a repository file.

### 3. Publish the files

Push the changed files to the repository's default branch. GitHub Pages continues to deploy from the configured branch, and the scheduled workflow runs from the default branch.

The workflow can also be tested immediately from **Actions → Process Slack queue → Run workflow**. Scheduled GitHub Actions runs can occasionally start later than five minutes.

## Using the site

- Normal URL — full submission and bulletin controls.
- `?mode=view` — read-only bulletin display with Slack/admin controls hidden.
- `?mode=submit` — submission form only.

On the Bulletin tab:

- `Generate PDF` downloads the monthly PDF locally.
- `Send to Slack` confirms, generates the PDF, and queues it for Slack.
- `Delete last Slack post` confirms and queues deletion of the latest bot delivery for that month.
- `Clear Fields` keeps its existing behavior.

## Main files

- `index.html`, `style.css`, `app.js` — static UI, Firebase data flow, PDF generation, and Slack queue controls.
- `firebase-config.js` — public Firebase web configuration.
- `firestore.rules` — validation for bulletin data and immutable Slack queue requests.
- `.github/workflows/process-slack-queue.yml` — five-minute scheduler.
- `actions/process-slack-queue.mjs` — server-side Firestore and Slack processing; uses Node.js built-ins only.
