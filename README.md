# Push

Put a file on a screen. Upload images, video, PDFs, slides, Word documents and
spreadsheets to cloud storage, pair any browser as a display with a one-time
code, and push content to it — live, from anywhere.

- **Media in Cloudflare R2.** Uploads go straight from the browser to the
  bucket; screens stream from it. Nothing large ever passes through the server.
- **Screens anywhere.** A display is just a browser tab on a TV, kiosk or
  signage player. It pairs once with a 6-character code and holds its own
  revocable token.
- **Live.** A push reaches the wall in milliseconds over a WebSocket, with a
  push-up transition between items. The console shows which screens are online
  and warns when a push reached no display.

## Stack

| | |
|---|---|
| Console + display | React 19, Vite, React Router (data mode), TanStack Query, shadcn/ui, Tailwind v4 |
| API | Hono on Node, WebSocket gateway (`@hono/node-server`), better-auth |
| Data | Postgres 16, Drizzle ORM |
| Storage | Cloudflare R2 (any S3-compatible store; MinIO in development) |
| Monorepo | pnpm workspaces, Turborepo |

```
apps/
  api/        REST API + WebSocket gateway                     :4000
  console/    admin console, /display player, document viewers  :3000
packages/
  types/      wire contracts and zod schemas (shared)
  db/         Drizzle schema, migrations, queries (API only)
  storage/    zero-dependency SigV4 presigner for R2/S3
  ui/         shadcn/ui components
infra/
  docker-compose.dev.yml   Postgres + MinIO for development
  docker-compose.yml       production stack
  nginx/                   production web server (serves the console, proxies the API)
```

## Development

Needs Node 24 (`.nvmrc`), pnpm (via `corepack enable`) and Docker.

```bash
pnpm install
pnpm services:up                 # Postgres :5433, MinIO :9100 (console :9101)
cp .env.example .env             # then set BETTER_AUTH_SECRET and UPLOAD_TICKET_SECRET
                                 # (openssl rand -hex 32) and the R2_* block for MinIO:
                                 #   R2_ACCESS_KEY_ID=pushdev  R2_SECRET_ACCESS_KEY=pushdev-secret
                                 #   R2_ENDPOINT=http://localhost:9100  R2_REGION=us-east-1
pnpm db:migrate
pnpm --filter api seed:admin --email you@example.com --password <min 8 chars> --name "You"
pnpm dev                         # console http://localhost:3000, API :4000
```

Open the console at http://localhost:3000 and sign in. To try a display, open
http://localhost:3000/display in another browser (or a private window), add a
screen in the console, choose **Pair display**, and type the code.

```bash
pnpm typecheck      # every package
pnpm test           # includes live round trips against MinIO
pnpm build
pnpm db:generate    # after editing packages/db/src/schema
```

Adding a shadcn component: run `pnpm dlx shadcn@latest add <name>` from
`apps/console`. Primitives land in `packages/ui`; import them as
`@workspace/ui/components/<name>`.

## How it works

**Upload.** The console asks the API to presign an upload. The API chooses the
object key and content type, signs them into a ticket, and returns a presigned
PUT. The browser uploads directly to storage with a progress bar, makes a
thumbnail from the file it already has (including a poster frame for video),
then commits the ticket. The API confirms the object exists before recording
it. A reaper (10 minutes after boot, then every 6 hours) deletes objects that were
never committed, once they are a day old.

**Serving.** Rows store the bucket and key, never a URL. With
`R2_PUBLIC_BASE_URL` set, screens load from the bucket's public custom domain
(stable, CDN-cached). Without it, `/api/media/:id/file` redirects to a fresh
presigned URL. Either way the URL a screen sees never changes, which matters:
the player treats a changed URL as new content.

**Pairing.** An admin generates a code for a screen; the display redeems it at
`/api/pair` (rate-limited) and receives a 256-bit token, stored only as a hash.
Re-pairing or unpairing revokes the old token and closes that display's live
connection immediately.

**Pushing.** Every change is written to the database first, then delivered
over the gateway, and logged with the user who made it. Each push reports how
many displays received it; zero means nothing changed on any wall yet.

**Playing.** The display preloads the next item, keeps the previous one on
screen until the new one can paint, then slides it up. Documents render in the
browser: PDFs and slides one page at a time with auto-advance (`?advance=`
seconds, default 10, `0` = off), Word as a readable page, spreadsheets as a
table.

## Deployment

One Docker Compose stack: Postgres, the API, and nginx serving the built console.

1. **Storage.** Create an R2 bucket and an API token with read/write on that
   bucket only. Bind a custom domain to it (recommended). Set the bucket CORS
   policy shown in `.env.production.example` — it must allow `content-type`
   *and* `cache-control`, or uploads fail with a generic CORS error.
2. **Configure.** `cp .env.production.example .env.production` and fill it in.
3. **Start.**
   ```bash
   docker compose --env-file .env.production -f infra/docker-compose.yml up -d --build
   docker compose --env-file .env.production -f infra/docker-compose.yml exec api \
     node dist/seed-admin.mjs --email you@example.com --password '<secret>' --name "You"
   ```
   Migrations run automatically when the API starts.
4. **Reach it.** Either forward a port to `HTTP_PORT` and put TLS in front, or
   add `--profile tunnel` with a `CLOUDFLARE_TUNNEL_TOKEN` and point the
   tunnel's public hostname at `http://web:80` — no open ports, no certificates.
   Serve over https in production: better-auth issues secure cookies.

   The pairing endpoint is rate-limited per client address. Behind the tunnel,
   nginx takes that address from Cloudflare's `CF-Connecting-IP` — trusted only
   from the dedicated `tunnel` network, so it cannot be spoofed through the
   published port. Without the tunnel on **Docker Desktop**, published-port
   traffic reaches nginx from Docker's gateway address, so every client shares
   one rate-limit bucket; on Linux the real source address is preserved.

Displays are long-lived tabs: after deploying a new version, use **Reload** on
a screen's page (or wait for the display's next restart) to load it.

**Kiosk tip:** launch the display browser with
`--autoplay-policy=no-user-gesture-required` so video starts with sound, and
`?pushTransition=0` on the display URL for players with a single hardware video
decoder.
