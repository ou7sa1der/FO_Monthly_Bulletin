# FO Monthly Bulletin — Cloudflare Worker

Готов backend за директно GitHub Pages → Cloudflare Worker → Slack изпращане.

Worker URL:

`https://fo-monthly-bulletin-slack.kasparian6.workers.dev`

## Какво е предварително конфигурирано

- Worker: `fo-monthly-bulletin-slack`
- Slack channel: `C0AFA7FR5EZ`
- Allowed GitHub Pages origin: `https://ou7sa1der.github.io`
- D1 binding: `DB`
- Максимум 3 успешни изпращания за период
- Максимален PDF: 5 MB
- Персонализиран Slack текст от submission формата и PDF upload preview
- Delete last Slack post
- Turnstile проверка

## 1. D1 database ID

В Cloudflare отвори **Storage & Databases → D1 → fo-monthly-bulletin-data → Settings**.

Копирай Database ID и в `wrangler.jsonc` замени:

`PASTE_D1_DATABASE_ID_HERE`

## 2. Cloudflare login

В PowerShell, в тази папка, изпълни:

```powershell
npm install
npx wrangler login
```

Cloudflare ще отвори browser authorization. Провери, че разрешаваш точно личния акаунт, в който е Worker-ът.

## 3. Secrets

Стартирай:

```powershell
powershell -ExecutionPolicy Bypass -File .\SET_CLOUDFLARE_SECRETS.ps1
```

Скриптът ще поиска скрито:

- Slack `xoxb-...` token
- private Turnstile secret key

Стойностите не се записват във файл и не трябва да се добавят в GitHub.

## 4. Deploy

Стартирай:

```powershell
powershell -ExecutionPolicy Bypass -File .\DEPLOY_WORKER.ps1
```

Това изпълнява тестовете, създава D1 таблиците и deploy-ва Worker-а.

## 5. Проверка

Отвори:

`https://fo-monthly-bulletin-slack.kasparian6.workers.dev`

Очакван отговор:

```json
{"ok":true,"service":"fo-monthly-bulletin-slack"}
```

GitHub frontend-ът още не използва Worker-а. Той трябва да бъде променен едва след като Worker, D1 и Turnstile са потвърдени като работещи.
