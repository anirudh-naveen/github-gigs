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

## How sync works

Every webhook (`projects_v2_item` or `issues`) makes the bot re-read that Project item
and bring its forum post in line:

- **Gets a post:** the issue is open, its Status is one of `postStatuses` (by default
  Open, Claimed, In review), and it isn't in a private area.
- **Loses its post:** any other status (blank or Done), a closed issue, an archived
  item, or an item removed from the Project.
- **Edits:** changes to the title, body, labels, or fields update the post in place.
  If someone deleted the post by hand, the bot reposts it.

Postgres stores which item owns which post, so the bot can still delete the post after
the item is gone from the Project. `npm run backfill` (`railway run npm run backfill`
on Railway) brings the whole board up to date. Run it once after setup, or any time
the bot was down.

## Claiming gigs

Every command needs the Developer role (or Maintainer).

| Command | What it does |
| --- | --- |
| `/link` | Sends a "Sign in with GitHub" button, visible only to you. Signing in proves you own the account. The bot keeps only your login name. |
| `/claim` | Run inside a gig post. It posts a public request with **Approve** and **Deny** buttons and pings the Maintainer role. Only maintainers can press them. |
| `/unclaim` | Run inside a gig post. It withdraws your request or releases your claim. Maintainers can release anyone's claim. |
| `/gigs` | Lists open, unclaimed gigs (visible only to you). |

When a maintainer approves a request, the bot:
- assigns the issue to the claimant,
- sets Status to Claimed,
- comments on the issue,
- and adds a 🔒 line and the Claimed tag to the post.

Releasing a claim reverses all four. GitHub won't assign outside contributors until
they've commented on the issue. If assigning fails, the claim still counts, and both
the bot's reply and its issue comment tell the claimant to comment.

Rules (all configurable):
- **Limit:** each person can hold 2 claims or pending requests at a time.
- **Expiry:** an hourly check releases a claim once 7 days pass after the claimant's
  newest commit on an open PR linked to the issue. A PR is linked through "Fixes #N"
  or the issue's Development sidebar. With no PR, the 7 days count from approval.
  The bot pings the claimant in the post. Gigs In review never expire, since they're
  waiting on a maintainer.
- **Assigned on GitHub:** a gig assigned directly on GitHub shows as claimed by that
  person, and `/claim` refuses it.

## Routes

| Route | What it does |
| --- | --- |
| `GET /health` | Liveness check for Railway. |
| `POST /github/webhook` | Checks the HMAC SHA-256 signature, then syncs the forum from `projects_v2_item` and `issues` events. |
| `POST /discord/interactions` | Checks the Ed25519 signature, then handles slash commands and buttons. |
| `GET /github/oauth/callback` | Finishes `/link`. Its signed state expires after 10 minutes. |

## Configuration

Set `GIGS_CONFIG` to a JSON file. Anything you leave out falls back to the generic
defaults in [src/settings.js](src/settings.js). AniLounge's file is
[config/anilounge.json](config/anilounge.json).

| Key | Meaning | Default |
| --- | --- | --- |
| `fields` | Names of the Project's Status, Difficulty, Bounty, and Area fields | the same words |
| `postStatuses` | Statuses that get a forum post | Open, Claimed, In review |
| `areaTags` | Project "Area" value or issue label → forum tag name | `{}` |
| `labelTags` | Other issue labels → forum tag name | `enhancement`→Feature, `bug`→Bug Fix |
| `privateAreas` | Areas and labels never posted publicly | `["security"]` |
| `claimedTag` | Forum tag for claimed gigs | `Claimed` |
| `statuses` | Status values the bot sets on claim and release | `open`: Open, `claimed`: Claimed |
| `claims.requireApproval` | `/claim` needs a maintainer to approve it (`false` = first come, first served) | `true` |
| `claims.maxActivePerUser` | Claims plus pending requests allowed per person | `2` |
| `claims.expireDaysAfterLastCommit` | A claim lapses this many days after the claimant's last commit on the linked PR (or after approval if there is no PR). `0` means never. | `7` |

Forum tags are matched by name, ignoring case, so create them in Discord first.
Difficulty tags use the Project's Difficulty value (for example `Easy`).

## Setup

1. **GitHub org.** Your repo and Project must belong to an organization, because
   GitHub only sends `projects_v2_item` webhooks for org-owned Projects. Create the
   gig Project there (AniLounge's is **AniLounge Gigs**).
2. **GitHub App** (for example `anilounge-bot`) on the org.
   - Repository permissions: Issues read/write, Metadata read.
   - Organization permissions: Projects read/write.
   - Events: Projects v2 item, Issues.
   - Webhook URL: `https://<railway-domain>/github/webhook`, with a random secret.
   - Callback URL (for `/link`): `https://<railway-domain>/github/oauth/callback`.
     Copy the App's Client ID and generate a client secret.
   - Generate a private key. Install the App on the org, and note the installation
     id at the end of the installation's settings URL.
   - Get the Project's node id (`PVT_...`). The `gh` command needs the
     `read:project` scope (`gh auth refresh -s read:project`):
     `gh project view <number> --owner <org> --format json --jq .id`
3. **Discord application.**
   - Set the Interactions Endpoint URL to `https://<railway-domain>/discord/interactions`.
   - Invite the bot with the `bot` and `applications.commands` scopes.
   - On the gig forum, give it View Channel, Send Messages, Create Posts, Manage
     Threads, and Manage Messages.
   - Find the forum's channel ID: it is the last number in
     `discord.com/channels/<guild>/<channel>`.
   - Create the forum tags you use (for AniLounge: Frontend, Backend, Content Update,
     Mobile, Feature, Bug Fix, Easy, Medium, Hard, Claimed).
   - Create Developer and Maintainer roles. Copy their IDs: turn on Developer Mode,
     then right-click each role.
4. **Railway.** Add a Postgres database. The tables are created on startup. Set the
   variables listed in `.env.example`; secrets live only there. `PUBLIC_URL` is the
   service's Railway domain. Deploy, then run:
   - `railway run npm run register-commands`. Set `DISCORD_GUILD_ID` first if you
     want the commands to appear instantly in one server.
   - `railway run npm run backfill`

## Development

```bash
npm install
npm test
```

`npm run test:e2e` runs the real server, backfill, and claim flows against a real
Postgres, with stand-in GitHub and Discord APIs on localhost:

```bash
docker run -d --rm --name gigs-pg -e POSTGRES_PASSWORD=pg -p 127.0.0.1:55432:5432 postgres:16
DATABASE_URL=postgres://postgres:pg@127.0.0.1:55432/postgres npm run test:e2e
```

## License

AGPL-3.0. If you run a modified version as a public service, you must share your changes.
