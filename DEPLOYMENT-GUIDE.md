# Founder OS — GitHub and deployment guide

This export contains the complete Founder OS source at the latest published version.

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

Founder OS requires Node.js 22.13 or newer.

```bash
npm install
npm run dev
```

## Production build

```bash
npm run build
```

## Important Vercel note

Founder OS currently uses Vinext, Cloudflare Workers and a Cloudflare D1 database for persistent tasks, objectives, clients, projects and other records. It is therefore not a direct Vercel deployment in its current form.

Uploading this repository to Vercel without changing the database/runtime layer may display build or runtime errors and will not provide working persistent data.

The source is ready for GitHub and for its existing Sites/Cloudflare deployment. A Vercel version requires a separate migration from Cloudflare D1 to a Vercel-compatible database such as Neon Postgres, Supabase Postgres or Turso, plus replacement of the Vinext/Worker runtime integration.

## Existing deployment

The current production version remains available at:

https://echo-in-ink-founder-os.echoinink.chatgpt.site
