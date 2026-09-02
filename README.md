# FO Monthly Bulletin

Public GitHub Pages single-page app for collecting Fixture Operations updates, previewing the monthly bulletin, generating its PDF, and sending it directly to Slack.

## Architecture

- GitHub Pages hosts the public vanilla JavaScript frontend.
- Firebase Anonymous Authentication and Firestore keep the existing bulletin data flow.
- Cloudflare Turnstile protects the two public Slack controls from automated abuse.
- The browser sends the generated PDF directly to the Cloudflare Worker.
- The Worker reads the Slack bot token from an encrypted Cloudflare Secret, uploads the PDF to the fixed Slack channel, and uses D1 for the monthly counter and delivery history.

The Slack bot token is never present in GitHub, Firebase, HTML, JavaScript, or the generated PDF.

## Slack behavior

- Worker: `https://fo-monthly-bulletin-slack.kasparian6.workers.dev`
- Test channel: `C0AFA7FR5EZ`
- `Send to Slack` asks for confirmation, creates the same PDF as `Generate PDF`, completes Turnstile verification, and uploads it immediately.
- The Slack post contains the fixed Fixtures Operations announcement followed by the PDF attachment and Slack preview.
- Up to three successful sends are allowed per bulletin month. Failed attempts do not count.
- `Delete last Slack post` immediately removes the latest undeleted bot message and PDF for the selected month.
- Deleting does not reduce the successful-send counter.
- Both buttons stay disabled while their request is running, preventing accidental double clicks.
- The maximum PDF size is 5 MB. A normal bulletin is expected to be much smaller.
- When there are no acknowledgements, the section remains visible as an empty state on the website but is omitted from generated PDFs.

The Slack app must be a member of the test channel and have these Bot Token Scopes:

- `chat:write`
- `files:write`
- `files:read`

## Cloudflare configuration

The deployable Worker project is in `cloudflare-worker/`.

- Worker name: `fo-monthly-bulletin-slack`
- D1 database: `fo-monthly-bulletin-data`
- D1 binding: `DB`
- Secret: `SLACK_BOT_TOKEN`
- Secret: `TURNSTILE_SECRET`
- Variable: `SLACK_CHANNEL_ID=C0AFA7FR5EZ`
- Variable: `ALLOWED_ORIGIN=https://ou7sa1der.github.io`
- Turnstile site key in the frontend: `0x4AAAAAAEkp-UpXZa3HM01Q`

See `cloudflare-worker/README.md` for deploy instructions. Never commit a real `xoxb-...` token or Turnstile secret.

## GitHub Actions

The old Firestore queue processor is retained only as a manual legacy fallback. Its scheduled trigger is disabled and the current frontend no longer creates Slack queue documents.

## Using the site

- Normal URL — full submission and bulletin controls.
- `?mode=view` — read-only bulletin display with Slack/admin controls hidden.
- `?mode=submit` — submission form only.

On the Bulletin tab:

- `Generate PDF` downloads the monthly PDF locally.
- `Send to Slack` sends the PDF directly through the Cloudflare Worker.
- `Delete last Slack post` deletes the latest Worker delivery for that month.
- `Clear Fields` keeps its existing behavior.

## Main files

- `index.html`, `style.css`, `app.js` — UI, Firebase data flow, PDF generation, Turnstile, and direct Worker requests.
- `firebase-config.js` — public Firebase web configuration.
- `firestore.rules` — security rules for the existing bulletin data.
- `cloudflare-worker/` — Worker, D1 schema, tests, and deploy scripts.
- `.github/workflows/process-slack-queue.yml` — manual-only legacy fallback.
