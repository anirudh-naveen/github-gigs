# Setting up github-gigs

This guide sets up your own copy of the bot, for one Discord server and one GitHub
Project. Work through it in order, because several steps need a URL or ID from an
earlier step. Each step shows AniLounge's choices as an example.

Write each value into your **Railway variables** list as you go. Steps 1–6 take about
an hour.

| Variable | Comes from |
| --- | --- |
| `GITHUB_PROJECT_ID` | step 2 |
| `PUBLIC_URL` | step 3 |
| `GITHUB_APP_ID`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_WEBHOOK_SECRET`, `GITHUB_INSTALLATION_ID` | step 4 |
| `DISCORD_APPLICATION_ID`, `DISCORD_PUBLIC_KEY`, `DISCORD_BOT_TOKEN` | step 5 |
| `DISCORD_GIG_CHANNEL_ID`, one variable per extra board, `DISCORD_DEVELOPER_ROLE_ID`, `DISCORD_MAINTAINER_ROLE_ID`, `DISCORD_GUILD_ID` | step 5 |
| `GIGS_CONFIG` or `GIGS_CONFIG_JSON` | step 6 |

---

## 1. GitHub organization

GitHub only sends Project webhooks for Projects owned by an organization. If your repo
is under a personal account:

1. Create a free organization: github.com → **+** → **New organization**.
2. Move the repo there: **Settings** → **Danger Zone** → **Transfer**. AniLounge moved
   its site repo and its copy of this bot.
3. After the transfer:
   - Reconnect any deploy integrations (Vercel, Railway, Netlify) to the moved repo,
     or auto-deploys stop.
   - Update your local remotes. Old URLs redirect, but it's tidier:
     ```bash
     git remote set-url origin https://github.com/<org>/<repo>.git
     ```
   - Check that `.github/CODEOWNERS` still names the right people.

## 2. GitHub Project

1. In the org: **Projects** → **New project** → **Board**. AniLounge's is called
   **AniLounge Gigs**.
2. Set up the fields (the **⋯** menu → **Settings** → **Fields**). The bot reads them by
   name. If yours differ, set `fields` in your config.

   | Field | Type | Options | Needed? |
   | --- | --- | --- | --- |
   | Status | single select (exists already) | rename options to **Open**, **Claimed**, **In review**, **Done** | yes |
   | Difficulty | single select | for example Easy, Medium, Hard | recommended |
   | Bounty | text | (none) | optional |
   | Area | single select | for example Frontend, Backend, Mobile | optional |
   | Type | single select | one option per board | only with several boards |

   AniLounge's Type options are Code, Content, and Art.
3. Workflows (**⋯** → **Workflows**):
   - **Item closed** → Status **Done**. This one is usually on already.
   - **Pull request merged** → **Done**.
   - **Item added to project:** turn it off, or make sure it doesn't set a Status. A
     gig with a blank Status stays off Discord until you set it to Open.
4. Add your issues (**+ Add item** → `#12`) and fill in their fields, but **leave Status
   blank for now**. You'll open them in step 8, after a test.
5. Copy the Project's ID. It starts with `PVT_` and goes in `GITHUB_PROJECT_ID`:
   ```bash
   gh auth refresh -s read:project
   ```
   ```bash
   gh project view <number> --owner <org> --format json --jq .id
   ```
   `<number>` is the number in the Project's URL.

## 3. Railway service (get the URL first)

The GitHub App and Discord both need the bot's public URL, so create the service first.

1. Railway → **New Project** → **Deploy from GitHub repo**. You can deploy this repo or
   your fork of it. Railway may ask for access to the org.
2. In that project: **+ New** → **Database** → **PostgreSQL**.
3. Bot service → **Settings** → **Networking** → **Generate Domain**. That's
   `PUBLIC_URL`, for example `https://github-gigs-production.up.railway.app`. The
   health check and start command come from `railway.json`.
4. The first deploy crashes until the variables are set. That's expected.

Any host that runs Node 22 and has Postgres works. The bot only needs a public HTTPS
URL and the variables in `.env.example`.

## 4. GitHub App

1. Org **Settings** → **Developer settings** → **GitHub Apps** → **New GitHub App**.
   - **Name:** for example `anilounge-bot` (it must be unique across GitHub)
   - **Homepage URL:** your repo
   - **Callback URL:** `<PUBLIC_URL>/github/oauth/callback`
   - Leave **Request user authorization (OAuth) during installation** off.
   - **Webhook:** set it to Active.
     - **URL:** `<PUBLIC_URL>/github/webhook`
     - **Secret:** generate one with the command below. It goes in
       `GITHUB_WEBHOOK_SECRET`.
       ```bash
       openssl rand -hex 32
       ```
   - **Repository permissions:** Issues **Read and write**. Metadata **Read** is set
     automatically.
   - **Organization permissions:** Projects **Read and write**.
   - **Subscribe to events:** **Issues** and **Projects v2 item**. The second appears
     after you set the Projects permission.
   - **Where can this app be installed:** Only on this account.
2. Click **Create**. On the App's page:
   - **App ID** → `GITHUB_APP_ID`
   - **Client ID** → `GITHUB_CLIENT_ID`
   - **Generate a new client secret** → `GITHUB_CLIENT_SECRET`
   - **Generate a private key** downloads a `.pem` file. Paste its whole contents into
     `GITHUB_APP_PRIVATE_KEY`, then delete the file.
3. **Install App** → choose the org → **Only select repositories** → your repo. The page
   you land on ends in `/settings/installations/<number>`. That number is
   `GITHUB_INSTALLATION_ID`.

## 5. Discord

**The application**

1. Go to https://discord.com/developers/applications → **New Application**.
2. **General Information:** copy **Application ID** → `DISCORD_APPLICATION_ID` and
   **Public Key** → `DISCORD_PUBLIC_KEY`. Leave **Interactions Endpoint URL** empty for
   now.
3. **Bot:**
   - Click **Reset Token** and copy it → `DISCORD_BOT_TOKEN`.
   - Turn **Public Bot** off, so only you can add it to a server. Each copy of this bot
     serves one server.
   - The bot needs no privileged intents.
4. **Installation:** under **Guild Install**, set the scopes to `bot` and
   `applications.commands`. Open the install link and add the bot to your server.

**The server.** Turn on Developer Mode first (User Settings → Advanced) so you can
right-click things to copy their IDs.

1. Right-click the server icon → **Copy Server ID** → `DISCORD_GUILD_ID`.
2. Roles: create **Developer** and **Maintainer** (any names work), and give yourself
   Maintainer. Copy their IDs → `DISCORD_DEVELOPER_ROLE_ID` and
   `DISCORD_MAINTAINER_ROLE_ID`.
3. Forum channels: create one per board and copy each ID. The default board goes in
   `DISCORD_GIG_CHANNEL_ID`. Each extra board gets the variable named in its config
   entry. AniLounge has three forums: Code (`DISCORD_GIG_CHANNEL_ID`), Content
   (`DISCORD_CONTENT_CHANNEL_ID`), and Art (`DISCORD_ART_CHANNEL_ID`).
4. Tags. In each forum, open **Edit Channel** → **Tags** and add the tags your gigs use:
   - **Claimed**
   - your Difficulty options
   - the tag names in your config's `areaTags` and `labelTags`

   The bot matches tags by name. Step 7's checker lists any that are missing.
5. Permissions. In each forum, open **Edit Channel** → **Permissions**:
   - **@everyone:** Create Posts **off**, Send Messages in Posts **on**.
   - **Maintainer:** Create Posts **on**.
   - **The bot's role:** View Channel, Create Posts, Send Messages in Posts, Manage
     Threads, and Manage Messages, all **on**.

## 6. Configuration, variables, and first deploy

**Board settings.** Start from [config/example.json](../config/example.json). Every key
is optional; see the README's Configuration table. You have two ways to load it:

- **No fork:** paste the JSON into a `GIGS_CONFIG_JSON` variable.
- **Fork:** commit the file, for example `config/myproject.json`, and set
  `GIGS_CONFIG=config/myproject.json`. AniLounge uses
  [config/anilounge.json](../config/anilounge.json).

**Variables.** In the bot service → **Variables** → **Raw Editor**, paste this and fill
it in:

```
GIGS_CONFIG_JSON=
PUBLIC_URL=
DATABASE_URL=${{Postgres.DATABASE_URL}}

DISCORD_APPLICATION_ID=
DISCORD_PUBLIC_KEY=
DISCORD_BOT_TOKEN=
DISCORD_GIG_CHANNEL_ID=
DISCORD_DEVELOPER_ROLE_ID=
DISCORD_MAINTAINER_ROLE_ID=
DISCORD_GUILD_ID=

GITHUB_APP_ID=
GITHUB_INSTALLATION_ID=
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
GITHUB_WEBHOOK_SECRET=
GITHUB_PROJECT_ID=
GITHUB_APP_PRIVATE_KEY=
```

Add one line for each extra board's channel variable. `${{Postgres.DATABASE_URL}}` links
to the database from step 3. The private key can be pasted with its line breaks, or on
one line with `\n` in place of each line break.

Deploy, then check **Deployments** → **Logs**:

- You should see `github-gigs listening on :<port>`, followed by
  `startup backfill: {"created":0,…}`. It's 0 because every Status is still blank.
- If you see "Missing required environment variables: …", the message names each
  missing variable.

## 7. Connect Discord and check everything

1. Developer Portal → **General Information** → **Interactions Endpoint URL**:
   `<PUBLIC_URL>/discord/interactions`. Click **Save**. Discord tests the URL when you
   save, so the bot must be running. If Discord rejects it, check `DISCORD_PUBLIC_KEY`.
2. From a checkout of this repo, connect the Railway CLI, then register the slash
   commands:
   ```bash
   npm install -g @railway/cli
   ```
   ```bash
   railway login
   ```
   ```bash
   railway link
   ```
   ```bash
   railway run npm run register-commands
   ```
   This runs on your machine with Railway's variables. With `DISCORD_GUILD_ID` set, the
   commands appear in your server straight away.
3. Run the checker. It's read-only and compares your settings with the live GitHub and
   Discord:
   ```bash
   railway run npm run check-config
   ```
   It checks:
   - the App's permissions, events, and webhook URL
   - the Project's fields and Status options
   - the Interactions Endpoint URL and the Public Bot setting
   - the slash commands and roles
   - that every board is a forum with the expected tags

   Fix anything marked ✗. Lines marked ! are worth a look.

## 8. Test, then open the gigs

1. Create a throwaway issue with a `**Requirements**` list. Add it to the Project and
   set **Status = Open**. Within seconds, a post appears on the default board.
2. Edit the issue title or a field. The post updates.
3. With several boards: change Type. The post moves to that board's forum.
4. From a second account with the Developer role:
   - run `/link` and sign in with GitHub,
   - then run `/claim` in the post.
5. As Maintainer, click **Approve**. The issue should get assigned and commented on,
   Status should become Claimed, and the post should show 🔒.
6. Run `/unclaim`. Everything should reverse.
7. Close the issue. The post should disappear.
8. If all of that works, set your real gigs to **Open**.
9. Write a pinned intro post for each forum. AniLounge's text is in
   [docs/anilounge](anilounge) and can be adapted.

## If something goes wrong

Run `railway run npm run check-config` first. It finds most problems.

| Symptom | Likely cause |
| --- | --- |
| No post appears after you set Open | Check the GitHub App's **Advanced** tab for webhook deliveries. A 401 means `GITHUB_WEBHOOK_SECRET` doesn't match. No deliveries means the App isn't subscribed to **Projects v2 item**, or the Project isn't owned by the org. |
| Logs show `Discord … 403` | The bot is missing a permission on that forum (step 5.5). |
| A post appears without tags | Tag names don't match the config. Check spelling. |
| `/claim` says "only works inside gig posts" | It was run in a post the bot didn't create. |
| `/link` button gives a GitHub error | The App's Callback URL must match `<PUBLIC_URL>/github/oauth/callback` exactly. |
| "Field Status has no option Claimed" | Rename the Status options (step 2), or set `statuses` in the config. |
| Commands don't appear | Rerun `register-commands` with `DISCORD_GUILD_ID` set, then restart Discord. |

## Keeping it updated

To update, pull this repo's changes into your fork, or redeploy if you deploy this repo
directly. Database tables upgrade themselves on start. The license is AGPL-3.0: if you
run a modified copy, you must offer its source code to the people who use it.
