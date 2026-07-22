# Echo in Ink Founder OS

### A central operating system for managing Echo in Ink’s projects, clients, freelance growth, content, priorities, and studio operations.

Founder OS is the internal command centre for Echo in Ink.

It brings together day-to-day execution, project planning, client management, portfolio development, freelance growth, content, and studio operations in one connected workspace.

Rather than operating as a collection of disconnected dashboards, Founder OS is designed to answer the questions that matter most:

- What should I focus on today?
- What needs attention?
- What is progressing?
- What is blocked or at risk?
- Which opportunities should I act on?
- How close is Echo in Ink to its next business and product milestones?

---

## Live Deployment

**Cloudflare Worker**

https://echo-in-ink-founder-os.echoin.workers.dev

Founder OS is deployed using Vinext and Cloudflare Workers.

The production runtime uses:

- Cloudflare Workers
- Cloudflare D1
- Cloudflare R2
- Vinext
- Vite

> Founder OS is not currently configured as a standard Vercel deployment. Its runtime and persistence layer depend on Cloudflare Workers, D1, and R2.

---

## Core Systems

Founder OS currently brings together the main systems required to operate and grow Echo in Ink.

### Mission Control

A central dashboard for understanding:

- Today’s primary objective
- Highest-priority tasks
- Current risks
- Active opportunities
- Project progress
- Studio readiness
- Recommended next actions

### Tasks and Objectives

Manage actionable work across the studio.

Tasks can support connections to:

- Daily objectives
- Freelance launch objectives
- Sprint objectives
- Projects
- Clients
- Products
- Internal studio work

Objective progress should be calculated from linked task records rather than stored as an independent hardcoded value.

### Projects and Products

Track the development of Echo in Ink products and portfolio work, including:

- Echo in Ink
- Lumo
- Codexia
- Founder OS
- AquaFix Plumbing
- Future client and internal projects

### Clients and Leads

Manage the client acquisition lifecycle:

1. New lead
2. Reviewing
3. Contacted
4. Discovery scheduled
5. Qualified
6. Proposal required
7. Proposal sent
8. Negotiating
9. Won
10. Lost
11. Follow-up later

### Freelance Growth

Founder OS supports the complete freelance growth workflow:

- Service positioning
- Portfolio readiness
- GitHub readiness
- Marketing content
- Outreach
- Freelance platforms
- Lead generation
- Proposal tracking
- Client conversion
- Testimonials and referrals

### Content and Marketing

Plan and track:

- Reddit freelance posts
- LinkedIn content
- Portfolio updates
- Product announcements
- Case studies
- Outreach messages
- Marketing performance

### Portfolio and GitHub

Manage repository quality and portfolio readiness.

Each public repository should include:

- Professional README
- Screenshots
- Features
- Technology stack
- Installation instructions
- Live demo
- Problem statement
- Architecture notes where relevant
- Future improvements
- Licence

### Studio Operations

Founder OS is intended to become the operational source of truth for:

- Priorities
- Projects
- Clients
- Products
- Content
- Leads
- Revenue
- Portfolio readiness
- Freelance launch progress
- Strategic goals

---

## Featured Echo in Ink Projects

### Echo in Ink

The official website and digital home of Echo in Ink — a creative technology studio building thoughtful websites, applications, identities, and AI-powered experiences.

### Lumo

A gentle productivity and life-planning application designed for neurodivergent minds.

Lumo helps users organise tasks, routines, habits, goals, wellbeing, budgeting, and everyday responsibilities without adding pressure or overwhelm.

### Codexia

A local-first AI coding assistant designed to understand codebases, plan changes, execute development workflows, and verify results through structured, context-aware automation.

### AquaFix Plumbing

A responsive business website created as a polished portfolio project demonstrating modern front-end development, commercial UX, accessibility, SEO, and deployment.

---

## Technology Stack

### Application

- Next.js 16
- React 19
- TypeScript
- Vinext
- Vite
- Tailwind CSS 4

### Data

- Drizzle ORM
- Cloudflare D1

### Storage

- Cloudflare R2

### Runtime and Hosting

- Cloudflare Workers
- Wrangler

### Quality and Tooling

- ESLint
- Node.js test runner
- Verified build scripts
- Artifact validation scripts

---

## Architecture

Founder OS uses a Cloudflare-native runtime.

```text
Browser
   │
   ▼
Cloudflare Worker
   │
   ├── Vinext application runtime
   ├── API routes
   ├── Cloudflare D1 database
   └── Cloudflare R2 storage
```

### Application Structure

```text
app/
├── api/
│   ├── assistant/
│   ├── data/
│   └── files/
├── globals.css
├── layout.tsx
└── page.tsx

db/
├── bootstrap.ts
├── index.ts
├── runtime.ts
└── schema.ts

drizzle/
├── migrations
└── metadata

worker/
└── index.ts

scripts/
├── build-verified.sh
├── install-ci.sh
├── sites-env.sh
└── validate-artifact.sh
```

---

## Requirements

- Node.js 22.13.0 or newer
- npm
- Cloudflare account
- Wrangler authentication
- Cloudflare D1 database
- Cloudflare R2 bucket
- GNU `timeout` for the verified build script on macOS

Check the active Node version:

```bash
node -v
```

The project expects Node 22.

If using `nvm`:

```bash
nvm install 22
nvm use 22
```

The repository includes an `.nvmrc` file when configured correctly, allowing:

```bash
nvm use
```

---

## Local Development

Clone the repository:

```bash
git clone https://github.com/EchoinInk/founder-os.git
cd founder-os
```

Install dependencies:

```bash
npm install
```

Start the local development server:

```bash
npm run dev
```

---

## macOS Build Requirement

The verified build script uses GNU `timeout`.

Install GNU Coreutils:

```bash
brew install coreutils
```

Add the GNU command aliases to your shell path:

```bash
echo 'export PATH="$(brew --prefix coreutils)/libexec/gnubin:$PATH"' >> ~/.zshrc
source ~/.zshrc
```

Confirm `timeout` is available:

```bash
timeout --version
```

---

## Build

Run the verified production build:

```bash
npm run build
```

Validate the generated deployment artifact:

```bash
npm run validate:artifact
```

The Vinext build generates:

```text
dist/
├── client/
└── server/
    └── wrangler.json
```

Wrangler uses the generated deployment redirect:

```text
.wrangler/deploy/config.json
```

---

## Cloudflare Authentication

Authenticate Wrangler:

```bash
npx wrangler login
```

Confirm the active account:

```bash
npx wrangler whoami
```

---

## Cloudflare Bindings

The deployed Worker expects these bindings:

| Binding | Resource |
|---|---|
| `env.DB` | Cloudflare D1 database |
| `env.BUCKET` | Cloudflare R2 bucket |

Current production resources:

- D1 database: `site-creator-d1`
- R2 bucket: `site-creator-r2`

Do not commit secrets or private Cloudflare credentials to the repository.

---

## Database

Founder OS uses Cloudflare D1 with Drizzle ORM.

### Generate migrations

```bash
npm run db:generate
```

### List D1 databases

```bash
npx wrangler d1 list
```

### Inspect the production database

```bash
npx wrangler d1 info site-creator-d1
```

### Apply a migration manually

```bash
npx wrangler d1 execute site-creator-d1 \
  --remote \
  --file=drizzle/0000_gray_reaper.sql
```

Apply migrations in numerical order.

> Always use `--remote` when applying schema changes to the production D1 database.

---

## R2 Storage

Founder OS uses Cloudflare R2 for persistent file storage.

List available buckets:

```bash
npx wrangler r2 bucket list
```

Create the expected bucket when required:

```bash
npx wrangler r2 bucket create site-creator-r2
```

---

## Deployment

Build first:

```bash
npm run build
```

Validate the artifact:

```bash
npm run validate:artifact
```

Deploy to Cloudflare:

```bash
npx wrangler deploy
```

Wrangler automatically follows:

```text
.wrangler/deploy/config.json
```

to the generated Vinext configuration:

```text
dist/server/wrangler.json
```

After deployment, Wrangler prints the active Worker URL and version ID.

---

## Important Generated Configuration Note

`dist/server/wrangler.json` is generated during the build.

A new build may overwrite manual changes made directly inside the generated file.

Before deploying, confirm that:

- The D1 database ID is valid
- The D1 binding is named `DB`
- The R2 binding is named `BUCKET`
- The R2 bucket exists
- The Worker name is correct

Do not treat generated output as the long-term source of configuration.

---

## Available Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Start the local Vite development environment |
| `npm run build` | Run the verified Vinext production build |
| `npm run start` | Start the Vinext production server locally |
| `npm run test` | Build and run rendered HTML tests |
| `npm run validate:artifact` | Validate the generated Worker artifact |
| `npm run lint` | Run ESLint |
| `npm run db:generate` | Generate Drizzle migrations |
| `npm run install:ci` | Run the repository CI installation script |

---

## Repository Standards

This repository should maintain:

- Clear and meaningful commits
- No committed secrets
- No API keys
- No generated build metadata such as `*.tsbuildinfo`
- Clean build output
- Current documentation
- Working production links
- Consistent TypeScript and application patterns
- Database migrations committed in order
- No unnecessary architectural rewrites

---

## Deployment Troubleshooting

### `node:fs/promises` does not provide `glob`

The project is running on Node 20 or older.

Switch to Node 22:

```bash
nvm use 22
```

Then reinstall:

```bash
rm -rf node_modules
npm install
```

### `build-verified.sh requires GNU timeout`

Install Coreutils:

```bash
brew install coreutils
```

Then add the GNU commands to the shell path.

### Vercel cannot find `.next`

Founder OS is not currently a standard Vercel deployment.

The project builds a Cloudflare Worker artifact through Vinext instead of a conventional Next.js `.next` deployment directory.

Deploy using Wrangler.

### R2 code `10042`

Enable R2 in the Cloudflare Dashboard and create the expected bucket:

```bash
npx wrangler r2 bucket create site-creator-r2
```

### D1 code `10181`

The generated Wrangler configuration references an invalid or placeholder D1 database ID.

Find the correct database:

```bash
npx wrangler d1 list
```

Then ensure the generated deployment configuration references the correct database ID before deploying.

---

## Product Direction

Founder OS is being developed as a connected operating system rather than a static dashboard.

Future development should preserve the existing architecture while expanding:

- Mission Control intelligence
- Objective and task relationships
- Freelance readiness scoring
- Portfolio quality tracking
- Lead and proposal management
- Client conversion workflows
- Revenue visibility
- Product development planning
- Automated next-action recommendations
- Studio-wide reporting

The system should continue evolving around persistent records, relational data, and actionable workflows rather than hardcoded progress values.

---

## Status

Founder OS is under active development.

Current focus areas include:

- Freelance launch readiness
- Task and objective relationships
- Portfolio presentation
- GitHub quality
- Lead generation
- Studio operations
- Product execution

---

## Licence

This project is currently maintained as an Echo in Ink internal product.

Unless a separate licence is added, all rights are reserved.

---

## Echo in Ink

Echo in Ink is a creative technology studio building digital worlds where design, storytelling, and software converge.

The studio creates:

- Brand identities
- Websites
- Web applications
- Mobile products
- AI integrations
- Design systems
- Intelligent creative tools

Built by **Alexandria**  
Auckland, New Zealand
