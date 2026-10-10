# github-gigs

A Discord bot that keeps a gig board (a Discord forum channel) in sync with a GitHub
Project, and lets developers request gigs from Discord. It was built for
[AniLounge](https://anilounge.net), but any project can use it: its board-specific
settings live in a JSON config file (see [Configuration](#configuration)).

- GitHub is the source of truth. The bot creates, updates, and deletes the forum posts,
  so nobody edits them by hand.
- It runs as its own Railway service and only talks to the GitHub and Discord APIs.
  It needs no checkout of the project's repo.
- It only touches forum posts it created. Hand-written posts, such as AniLounge's
  Discord-only content tasks, are left alone.

## Status

Phase 3 (skeleton) is done:

| Route | What it does |
| --- | --- |
| `GET /health` | Liveness check for Railway. |
| `POST /github/webhook` | Checks the HMAC SHA-256 signature, then dispatches `projects_v2_item` and `issues` events. Sync comes in phase 4. |
| `POST /discord/interactions` | Checks the Ed25519 signature, answers PING, and runs slash commands for Developer or Maintainer roles. Commands come in phase 5. |

`src/gig.js` builds forum posts in the gig format (Description / Difficulty /
Bounty / Requirements). It enforces Discord's limits (100-char title, 2000-char
message, 5 tags), never allows mentions, and never mirrors security gigs.

Still to do:
- **Phase 4:** sync the Project to Discord (create, update, delete) and add a backfill command.
- **Phase 5:** `/link`, `/claim`, `/unclaim`, `/gigs`, and claim limits and expiry
  from the config.

## Configuration

Set `GIGS_CONFIG` to a JSON file. Anything you leave out falls back to the generic
defaults in [src/settings.js](src/settings.js). AniLounge's file is
[config/anilounge.json](config/anilounge.json).

| Key | Meaning | Default |
| --- | --- | --- |
| `areaTags` | Project "Area" value or issue label → forum tag name | `{}` |
| `labelTags` | Other issue labels → forum tag name | `enhancement`→Feature, `bug`→Bug Fix |
| `privateAreas` | Areas and labels never posted publicly | `["security"]` |
| `claimedTag` | Forum tag for claimed gigs | `Claimed` |
| `claims.requireApproval` | `/claim` needs a maintainer to approve it | `true` |
| `claims.maxActivePerUser` | Active claims allowed per person | `2` |
| `claims.expireDaysAfterLastCommit` | A claim lapses this many days after the claimant's last commit on the linked PR (or after approval if there is no PR). `0` means never. | `7` |

Forum tags are matched by name, ignoring case, so create them in Discord first.
Difficulty tags use the Project's Difficulty value (for example `Easy`).

## Setup

1. **GitHub org.** Your repo and Project must belong to an organization, because
   GitHub only sends `projects_v2_item` webhooks for org-owned Projects. Create the
   gig Project there (AniLounge's is **AniLounge Gigs**).
2. **GitHub App** (for example `anilounge-bot`) on the org.
   - Permissions: Issues read/write, Projects read/write, Metadata read.
   - Events: Projects v2 item, Issues.
   - Webhook URL: `https://<railway-domain>/github/webhook`, with a random secret.
3. **Discord application.**
   - Set the Interactions Endpoint URL to `https://<railway-domain>/discord/interactions`.
   - Invite the bot with the `bot` and `applications.commands` scopes.
   - On the gig forum, give it View Channel, Send Messages, Create Posts, Manage
     Threads, and Manage Messages.
   - Find the forum's channel ID: it is the last number in
     `discord.com/channels/<guild>/<channel>`.
4. **Railway variables.** Set the names listed in `.env.example`. Secrets live only there.

## Development

```bash
npm install
npm test
```

## License

AGPL-3.0. If you run a modified version as a public service, you must share your changes.
