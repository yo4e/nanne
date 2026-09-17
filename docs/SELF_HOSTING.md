# Self-hosting nanne on Cloudflare Workers

`nanne` v1 can be self-hosted on Cloudflare Workers. The current implementation uses Cloudflare Workers, Static Assets, and Durable Objects.

The easiest path is browser-only deployment through Cloudflare's Git integration. You do not need a local terminal for normal deployment or operation.

## What you need

- A GitHub account
- A Cloudflare account
- A fork of this repository

Cloudflare assigns Workers URLs in the following form:

```text
https://<worker-name>.<your-workers-dev-subdomain>.workers.dev/
```

The account-level `workers.dev` subdomain is shared by Workers in that Cloudflare account.

## 1. Fork the repository

Fork `yo4e/nanne` to your own GitHub account.

The repository already contains `wrangler.jsonc`, including:

- Worker entry point: `src/index.js`
- Static assets: `public/`
- Durable Object binding: `ROOMS`
- Durable Object class: `Room`
- SQLite-backed Durable Object storage
- persistent Workers observability disabled by default for this small deployment

You normally do not need to create the Durable Object namespace manually. Wrangler uses the declarations in `wrangler.jsonc` when deploying.

## 2. Choose the Worker name

The default Worker name in `wrangler.jsonc` is:

```json
"name": "nanne"
```

If your Cloudflare account already has a Worker named `nanne`, or you want another name, edit this value in your fork before deployment.

For example:

```json
"name": "my-nanne"
```

This affects the first part of the `workers.dev` URL.

## 3. Import the fork into Cloudflare

In the Cloudflare dashboard:

1. Open **Workers & Pages**.
2. Select **Create application**.
3. Choose **Import a repository**.
4. Connect GitHub if Cloudflare does not already have access.
5. Select your fork of `nanne`.
6. Set the production branch to `main`.
7. Keep the repository's `wrangler.jsonc` as the Worker configuration.
8. Save and deploy.

Cloudflare Workers Builds uses Wrangler for deployment. For this repository there is no separate application build step required before Wrangler deploys the Worker.

After deployment, Cloudflare should provide a URL similar to:

```text
https://nanne.example-subdomain.workers.dev/
```

If the production `workers.dev` URL is disabled in your Cloudflare account, enable it from the Worker settings before testing the public URL.

## 4. Smoke-test the deployment

Open the deployed URL and verify at least:

1. The top page appears.
2. **部屋を作る** creates a room.
3. Open the generated room URL in another browser or browser profile.
4. Both participants receive automatically assigned animal names.
5. Messages travel in both directions.
6. Reloading the same room in the same browser keeps that browser's participant identity.
7. The room shows the remaining lifetime.
8. The UI states that the room and its history are deleted 24 hours after room creation.

The lifetime is fixed from room creation. Sending a new message does not extend it.

## 5. Updating your deployment

With Cloudflare Git integration connected, pushes to the configured production branch trigger a new build and deployment automatically.

A simple maintenance flow is:

```text
change your fork
  ↓
merge or push to main
  ↓
Cloudflare Workers Builds
  ↓
automatic deployment
```

Because this Worker uses Durable Objects, Cloudflare preview URL behavior may be more limited than for ordinary Workers. Production deployment from `main` is the primary path documented here.

## Optional: local development and manual deploy

Local development remains available for contributors:

```bash
npm install
npm run dev
```

Checks:

```bash
npm run check
```

Manual deployment:

```bash
npm run deploy
```

These commands are development and operations alternatives. They are not required for people who deploy through Cloudflare's Git integration.

## Privacy and operations

The default repository intentionally keeps the service small:

- no account system
- no public room directory
- no advertising or analytics tags
- no file uploads
- room history expires 24 hours after room creation
- persistent Workers observability is disabled in `wrangler.jsonc`

If you change logging, analytics, advertising, storage, retention, authentication, or moderation behavior, document those changes for your users.

## Public operation in Japan

The MIT License permits use, modification, and redistribution of the software. It does not replace obligations that may apply to the operator of a publicly available communication service.

If you operate your fork for third parties in Japan, review:

- [日本で公開運用する場合の電気通信事業法ガイド](./JAPAN_TELECOM.md)
- [公開前法務・運用レビュー](./LEGAL_REVIEW.md)
- [埋め込み提供形態の法務レビュー](./EMBEDDING_LEGAL_REVIEW.md)

Each self-hosting operator is responsible for their own deployment, users, data handling, abuse response, and applicable legal or administrative requirements.

## Scope of v1

Cloudflare Workers is the reference deployment for v1, not the definition of the `nanne` concept itself.

Future versions may separate the chat protocol/core from the Cloudflare-specific backend so that other hosting environments can implement the same small temporary-chat model. That portability work is intentionally outside the v1 self-hosting guide.
