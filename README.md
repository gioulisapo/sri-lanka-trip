# Sri Lanka trip

## Cloudflare deployment through GitHub Actions

Production URL: https://sri-lanka.giouliscloud.gr. Pushes to `main` test and deploy the Worker. Pull requests only test and build. The Cloudflare deployment uses a dedicated Supabase project for this trip. Docker continues to use its local SQLite database.

### One-time setup

Create a dedicated Supabase project named `sri-lanka-trip`. Use that project's URL, server secret key, and database connection URI for every Supabase setting below. Do not use credentials from your other project's database. CI creates the trip tables during the first deployment.

The `giouliscloud.gr` zone must be active in the Cloudflare account used below. Wrangler's Custom Domain configuration creates the site's DNS record and certificate. An existing DNS record at `sri-lanka.giouliscloud.gr` must be removed before attaching the Worker. Do not remove a record serving another application without checking it first.

In the GitHub repository, open **Settings → Secrets and variables → Actions** and add:

| Type | Name | Value |
| --- | --- | --- |
| Variable | `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account ID containing the domain |
| Variable | `SUPABASE_URL` | Dedicated trip project's URL, such as `https://PROJECT.supabase.co` |
| Secret | `CLOUDFLARE_API_TOKEN` | Token scoped to this account with Workers Scripts Edit and to `giouliscloud.gr` with Zone Read and DNS Edit |
| Secret | `SUPABASE_SECRET_KEY` | Supabase project's server-side `sb_secret_...` key, from Project Settings → API Keys |
| Secret | `SUPABASE_DB_URL` | PostgreSQL connection URI from Supabase's Connect dialog, using the shared session pooler for GitHub's IPv4 runners, with the real database password and `sslmode=require` |
| Secret | `SITE_PASSWORD` | Unique site password of at least 16 characters |

Percent-encode special characters in the database password when putting it into the connection URI. The Supabase Data API must be enabled with the `public` schema exposed. This setup requires the new `sb_secret_` key format, not a publishable or legacy JWT key.

The workflow applies [supabase/schema.sql](supabase/schema.sql) in a transaction before deployment. It creates only `sri_lanka_comments`, `sri_lanka_answers`, their index, and the `sri_lanka_save_answers` function. It can run repeatedly. RLS and grants prevent anonymous and ordinary authenticated Supabase clients from accessing these tables or calling the save function. The Worker alone uses the server key. The key has project-wide privileges, so keep it in GitHub and Cloudflare secrets.

Push the repository to `main`, then check **Actions → Cloudflare**. Sign in as `traveller` with `SITE_PASSWORD`. The workflow checks the live page, comments, and questionnaire reads after deploying. First-time DNS and certificate provisioning can delay that check. Rerun the workflow once provisioning completes if needed.

The database starts empty. Existing hosted-site or Docker data is not imported. Schema changes apply before code and must remain compatible with the previous deployed version.

### Local verification

Requires Node 24 or newer:

```sh
npm ci
npm test
npm run build
```

For local Worker development, create an ignored `.dev.vars` file containing `SITE_PASSWORD`, `SUPABASE_URL`, and `SUPABASE_SECRET_KEY`, apply `supabase/schema.sql` to the project, then run `npm run dev`. This uses the configured remote Supabase database, including writes. The test suite uses in-memory SQLite and simulated Supabase HTTP responses.

## Docker deployment

## Start

Requires Docker Engine and Docker Compose v2.

1. Copy .env.example to .env.
2. Set SITE_PASSWORD to a unique password of at least 16 characters.
3. Run docker compose up -d --build.
4. Open http://localhost:8080 and sign in with SITE_USER and SITE_PASSWORD.

The site has a shared password. Comment names Maria, Apostolis and Giannis are selectable display names, not individual authenticated accounts.

## Remote access

The default port binds to localhost. Put an HTTPS reverse proxy or Cloudflare Tunnel in front of it for remote access, and set PUBLIC_URL to the exact external origin, for example https://trip.example.com. Restart after changing .env. Correct PUBLIC_URL is required for comment and questionnaire writes. Use HTTPS for password protection over the internet.

## Data

Comments and questionnaire answers persist in the Docker volume trip-data. Ordinary docker compose down preserves the volume; down -v deletes it. The export starts with an empty database and the itinerary's prefilled questionnaire defaults. Existing hosted-site comments and saved answers are not included.

Back up the SQLite database with SQLite's backup API or stop the container before copying the entire data volume, including any WAL files. Keep backups private.

## Source

worker.mjs contains the exported page, frontend JavaScript and API logic. server.mjs adapts it to Node and SQLite. cloudflare.mjs provides password authentication for Cloudflare. storage.mjs implements SQLite and Supabase storage. migrations contains the Docker database schema, and supabase/schema.sql contains the Cloudflare deployment's PostgreSQL schema. There are no runtime npm dependencies. Wrangler is a development dependency.

Edit worker.mjs and rebuild with docker compose up -d --build. The ChatGPT-hosted site and this deployment are separate copies.

## External resources

Maps still use OpenStreetMap's public tile service; Leaflet and destination photos are loaded externally. Internet access is required. Self-hosting does not guarantee removal of a tile-service block. Follow the tile provider's policy and use a configured commercial provider if necessary.

## Verification

The adapter can be tested directly with Node 24. Docker availability in the export environment is recorded in the delivery message.
