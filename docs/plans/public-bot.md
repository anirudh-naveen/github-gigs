# Plan: a hosted public bot

**Status:** not started. Today each community runs its own copy (see
[docs/setup.md](../setup.md)). This plan is for later. Revisit it once several
communities ask for a hosted version, or once self-hosting is clearly what stops people
from using the bot.

## Goal

One hosted copy that any community can use without deploying anything:

1. A server admin clicks **Add to Discord** from the App Directory or a website.
2. They run `/setup`, which installs our public GitHub App on their org and picks the
   Project, forums, and roles.
3. Their gig board works, with no Railway account, private keys, or environment
   variables.

Self-hosting stays supported from the same codebase.

**Not in scope:**
- GitHub Enterprise Server
- user-owned Projects (GitHub sends no webhooks for them; polling could come later)
- paid tiers

## What changes

### 1. Tenants

Today one copy means one server, set up by environment variables. A hosted copy needs a
**tenant**: one Discord server linked to one GitHub Project.

- New table `tenants`:
  - `guild_id` (primary key)
  - `installation_id`
  - `project_id`
  - `default_channel_id`
  - `developer_role_id`, `maintainer_role_id`
  - `settings` (jsonb, the same shape as today's config file)
  - `status` (`setup` / `active` / `disabled`)
  - timestamps
- `gigs` gets a `guild_id`, and its primary key becomes `(guild_id, project_item_id)`.
  Every query is scoped by tenant.
- `links` (Discord user ↔ GitHub login) stays global. A person is the same person on
  every server.
- Claim limits are counted per tenant.
- **Single-tenant mode:** if the current environment variables are set, start-up builds
  one tenant from them. Self-hosted copies keep working unchanged.

### 2. Setup inside Discord

Settings move from a JSON file to commands, so the hosted bot needs no file access.

- `/setup` (needs Manage Server) walks through:
  1. **Connect GitHub:** a button opens the GitHub App install page, with signed state
     carrying the guild ID. The App's **Setup URL** lands back on us with
     `installation_id`, which we tie to that guild.
  2. **Pick the Project:** a select menu of the org's Projects (`organization.projectsV2`).
  3. **Map fields:** found automatically by name, then confirmed or changed in select
     menus.
  4. **Pick forums and roles:** Discord's built-in channel and role select menus. Boards
     are added one at a time ("Add board": name, forum, Type values, labels).
  5. **Check:** run today's checker (`src/doctor.js`) for this tenant and show the
     results. The tenant becomes `active` only when there are no errors.
- `/settings` changes the claim rules, tags, and private areas later.
- `/setup status` reruns the checker at any time.
- A web dashboard is optional and can come after this.

### 3. GitHub App goes public

- Set **Where can this app be installed** to **Any account**.
- Add a **Setup URL**.
- Route webhooks by `installation.id` to tenant(s), then match `project_node_id` to a
  tenant's Project. One installation can serve several tenants, for example two
  Projects in one org.
- Handle the App's lifecycle events: `installation` (deleted / suspended),
  `installation_repositories` (removed), and `projects_v2` (deleted). Mark the affected
  tenants `disabled` and tell their admins in Discord.
- Cache installation tokens per installation. Today there is only one.
- Binding check: the person who runs `/setup` must also complete the GitHub install,
  through the signed state. That stops someone from linking another org's Project to
  their server.

### 4. Discord app goes public

- Turn **Public Bot** on and register the commands globally.
- Use Discord's app webhook events (application authorized and deauthorized) to notice
  when the bot leaves a server, without opening a gateway connection. On leaving,
  disable the tenant and delete its data after a grace period.
- Check permissions in each tenant's forums during `/setup`, and explain anything
  missing.

### 5. Sync and claims per tenant

- `createSync` and `createClaims` take a tenant instead of global config. The router,
  tag cache, and per-item locks are keyed by tenant.
- Start-up backfill and the hourly expiry check loop over active tenants, spread out
  over time.
- Interactions look up the tenant from `guild_id`.

### 6. Reliability at scale

- **Job queue:** webhook handling moves to a Postgres table read with `SKIP LOCKED`.
  Several instances can then run, and deploys don't drop events.
- **Rate limits:**
  - Discord: honor the `X-RateLimit-*` bucket headers, not only 429 retries.
  - GitHub: budget GraphQL points per installation.
- **Fairness:** a cap on jobs per tenant, so one busy tenant can't starve the rest.
- **Migrations:** replace today's `CREATE TABLE IF NOT EXISTS` and `ALTER TABLE` lines
  with numbered migrations.

### 7. Security and privacy

- Tenant isolation tests: no query or post can reach another tenant's data.
- Data stored: Discord user IDs, GitHub logins, issue numbers, and thread IDs. Write it
  down in a privacy policy. Delete a tenant's data 30 days after uninstall, and delete a
  user's link when they ask.
- Keep the current safety rules for every tenant: signed webhooks, no mentions,
  private areas, no logged secrets.
- An audit log of claims and approvals, viewable by each tenant's maintainers.

### 8. Running it as a service

- **Policies:** a privacy policy and terms of service, hosted, for example, on the
  project site.
- **Discord verification:** apps can apply for verification once they're in 75
  servers, and must be verified to grow past 100.
- **App Directory listing:** description, icon, screenshots, support server, and
  contact email.
- **Monitoring:** uptime checks, error tracking, Postgres backups, and a status channel.
- **Cost:** a small Railway service plus Postgres to start. Watch it per tenant.
- **AGPL:** add an `/about` command that links to the source, which also meets the
  license's network-use clause.

## Phases

| Phase | Work | Rough size |
| --- | --- | --- |
| A | Tenant tables, everything scoped by tenant, single-tenant mode, isolation tests | 1–2 days |
| B | Public GitHub App: Setup URL, routing by installation, lifecycle events | 1 day |
| C | `/setup`, `/settings`, and checks inside Discord | 2 days |
| D | Job queue, rate-limit buckets, migrations | 1–2 days |
| E | Policies, verification, directory listing, monitoring | 1 day plus waiting on Discord |
| F | Beta with 2–3 friendly communities, then public | ongoing |

## Open questions

1. Should one Discord server be able to link several Projects, for example one per
   repo? (The current plan says no: one tenant per server, but one installation can
   serve several tenants.)
2. Should we also support user-owned Projects by polling, for people who don't want an
   org?
3. Who handles support, and through which channel?
4. Should hosting stay free, with a limit on tenants, or ask for donations, for
   example through AniLounge's Ko-fi?
5. Should the hosted bot be separate from AniLounge's own copy, or should AniLounge
   become its first tenant?
