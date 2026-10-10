# github-gigs

A self-hosted Discord bot that turns a GitHub Project into a gig board. Issues on the
Project show up as posts in Discord forum channels, and contributors claim them with
slash commands. A maintainer approves each claim, and the result shows up on GitHub.

- **GitHub is the source of truth.** The bot creates, updates, and deletes forum posts to
  match the Project, so nobody edits them by hand. Posts it didn't create are left alone.
- **Claims flow both ways.** `/claim` in Discord assigns the issue and sets its Status on
  GitHub. A claim with no commits for a while expires by itself.
- **Several boards.** Gigs can be split across forums by type, for example Code, Content,
  and Art.
- **One copy per community.** Each copy serves one Discord server and one GitHub
  Project. You run it yourself, for example on Railway, with your own GitHub App and
  Discord application. ([Plans for a hosted public bot](docs/plans/public-bot.md).)

Built for [AniLounge](https://anilounge.net), whose setup is the worked example
throughout these docs.

**To run your own copy, follow [docs/setup.md](docs/setup.md).**

## How it works

### Sync

Every GitHub webhook (`projects_v2_item` or `issues`) makes the bot re-read that
Project item and bring its forum post in line:

- **Gets a post:** the issue is open, its Status is one of `postStatuses` (by default
  Open, Claimed, In review), and it isn't in a private area such as `security`.
- **Loses its post:** any other status (blank or Done), a closed issue, an archived
  item, or an item removed from the Project.
- **Edits:** changes to the title, body, labels, fields, or assignees update the post
  in place. If someone deleted the post by hand, the bot reposts it.

Each post shows the issue's first paragraph, its **Requirements** bullet list, the
Difficulty, the Bounty, and forum tags from the Area, Difficulty, and labels. Mentions
in issue text never ping anyone.

Postgres records which item owns which post. On every start, the bot runs a backfill
that brings every board up to date, so it catches up after downtime by itself.

### Multiple boards

Each entry in `boards` matches on the Project's **Type** field or on issue labels. The
first match wins, and everything else goes to the default board
(`DISCORD_GIG_CHANNEL_ID`). AniLounge's setup:

```json
"boards": [
  { "name": "Content", "channel": "$DISCORD_CONTENT_CHANNEL_ID", "types": ["Content"], "labels": ["content"] },
  { "name": "Art", "channel": "$DISCORD_ART_CHANNEL_ID", "types": ["Art"], "labels": ["art"] }
],
"defaultBoard": "Code"
```

`channel` is a channel ID, or `$NAME` to read it from an environment variable. Discord
can't move posts between forums, so when a gig's Type changes, the bot deletes the old
post and reposts it on the new board. Any claim is kept.

### Claiming

Every command needs the Developer or Maintainer role.

| Command | What it does |
| --- | --- |
| `/link` | Sends a "Sign in with GitHub" button, visible only to you. Signing in proves you own the account. The bot keeps only your login name. |
| `/claim` | Run in a gig post. It posts a request with **Approve** and **Deny** buttons and pings the Maintainer role. Only maintainers can press them. |
| `/unclaim` | Withdraws your request or releases your claim. Maintainers can release anyone's claim. |
| `/gigs` | Lists open gigs, grouped by board (visible only to you). |

When a request is approved, the bot:
- assigns the issue,
- sets Status to Claimed,
- comments on the issue,
- and marks the post with 🔒 and the Claimed tag.

Releasing a claim reverses all four. GitHub won't assign outside contributors until
they've commented on the issue. If assigning fails, the claim still counts, and the bot
tells the claimant to comment.

Rules (all configurable):
- **Limit:** each person can hold 2 claims or pending requests.
- **Expiry:** an hourly check releases a claim 7 days after the claimant's newest commit
  on an open PR linked to the issue, or 7 days after approval if there's no PR. The bot
  pings the claimant. Gigs In review never expire, since they're waiting on a maintainer.
- **Assigned on GitHub:** a gig assigned directly on GitHub shows as claimed, and
  `/claim` refuses it.

## Configuration

Settings that differ between communities live in JSON. Load it one of two ways:
- `GIGS_CONFIG_JSON`: the JSON inline in an environment variable, so you can deploy this
  repo without forking it.
- `GIGS_CONFIG`: a path to a file in your fork.

Start from [config/example.json](config/example.json). Anything you leave out falls
back to the defaults in [src/settings.js](src/settings.js). AniLounge's file is
[config/anilounge.json](config/anilounge.json).

| Key | Meaning | Default |
| --- | --- | --- |
| `fields` | Names of the Project's Status, Difficulty, Bounty, Area, and Type fields | the same words |
| `postStatuses` | Statuses that get a forum post | Open, Claimed, In review |
| `statuses` | Status values the bot sets on claim and release | `open`: Open, `claimed`: Claimed |
| `boards` | Extra forums, routed by Type or labels (see [Multiple boards](#multiple-boards)) | `[]` |
| `defaultBoard` | Name of the default board, used by `/gigs` | `Gigs` |
| `areaTags` | Project "Area" value or issue label → forum tag name | `{}` |
| `labelTags` | Other issue labels → forum tag name | `enhancement`→Feature, `bug`→Bug Fix |
| `privateAreas` | Areas and labels never posted publicly | `["security"]` |
| `claimedTag` | Forum tag for claimed gigs | `Claimed` |
| `claims.requireApproval` | `/claim` needs a maintainer to approve it (`false` = first come, first served) | `true` |
| `claims.maxActivePerUser` | Claims plus pending requests allowed per person | `2` |
| `claims.expireDaysAfterLastCommit` | Days without commits before a claim lapses. `0` means never. | `7` |

Environment variables (IDs, secrets, URLs) are listed in [.env.example](.env.example).
In production they live only in your host's variable settings.

## Scripts

| Command | What it does |
| --- | --- |
| `npm start` | Runs the bot. It creates or upgrades its tables and backfills on start. |
| `npm run check-config` | Read-only check of your settings against the live GitHub and Discord. |
| `npm run register-commands` | Registers the slash commands. Set `DISCORD_GUILD_ID` to make them appear instantly. |
| `npm run backfill` | Resyncs every board by hand. It needs access to the database. |
| `npm test` | Runs the unit tests. |
| `npm run test:e2e` | Runs end-to-end tests against a real Postgres (see below). |

On Railway, prefix a command with `railway run` to use the service's variables.

## Routes

| Route | What it does |
| --- | --- |
| `GET /health` | Liveness check. |
| `POST /github/webhook` | Checks the HMAC SHA-256 signature, then syncs from `projects_v2_item` and `issues` events. |
| `POST /discord/interactions` | Checks the Ed25519 signature, then handles slash commands and buttons. |
| `GET /github/oauth/callback` | Finishes `/link`. Its signed state expires after 10 minutes. |

## Development

```bash
npm install
npm test
```

`npm run test:e2e` runs the real server, backfill, claims, and board routing against a
real Postgres, with stand-in GitHub and Discord APIs on localhost:

```bash
docker run -d --rm --name gigs-pg -e POSTGRES_PASSWORD=pg -p 127.0.0.1:55432:5432 postgres:16
DATABASE_URL=postgres://postgres:pg@127.0.0.1:55432/postgres npm run test:e2e
```

See [CONTRIBUTING.md](CONTRIBUTING.md) to contribute changes.

## License

AGPL-3.0. You can run, change, and share it. If you run a modified copy, you must offer
its source code to the people who use it.
