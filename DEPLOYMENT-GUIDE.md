# Founder OS — GitHub and deployment guide

This checkout includes founder isolation and the Phase 2 engineering baseline. The live cutover has a separate ownership and verification procedure.

## Upload to GitHub

1. Create a new empty GitHub repository.
2. Unzip this package.
3. Open Terminal in the `echo-in-ink-founder-os` folder.
4. Run:

```bash
git init
git add .
git commit -m "Initial Founder OS import"
git branch -M main
git remote add origin YOUR_GITHUB_REPOSITORY_URL
git push -u origin main
```

## Run locally

Use the Node and npm versions pinned in .nvmrc and package.json.

```bash
npm run install:ci
npm run db:migrate -- --local
npm run db:normalize -- --local
npm run dev
```

## Production build

```bash
npm run build
```

Apply the database initialization procedure on the restored staging copy before cutover. The Phase 2 record covers release inputs, migration adoption and explicit seed access. [Engineering stability and operations](docs/phase-2-engineering-stability.md)

## Important Vercel note

Founder OS currently uses Vinext, Cloudflare Workers and a Cloudflare D1 database for persistent tasks, objectives, clients, projects and other records. It is therefore not a direct Vercel deployment in its current form.

Uploading this repository to Vercel without changing the database/runtime layer may display build or runtime errors and will not provide working persistent data.

## Private founder deployment

The Phase 1 application accepts identity from the private Sites dispatcher at the documented Site origin. The checkout records a Sites project ID, a standalone Cloudflare Worker and a historical Site URL. Verify the actual Site project and its dedicated bindings before registering a founder. The old Worker retains its own deployment settings until it is retired or isolated. The ownership rehearsal, deployment prerequisites and acceptance checks are in the [Phase 1 report](docs/phase-1-workspace-isolation.md).
