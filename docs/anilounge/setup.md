# Setting up the gig bot for AniLounge

Work through the steps in order. Several steps need a URL or ID from an earlier step.
Write each value into the **Railway variables** list as you get it. Steps 1–6 take
about an hour, and nothing appears in Discord until step 8.

| Variable | Comes from |
| --- | --- |
| `GITHUB_PROJECT_ID` | step 2 |
| `PUBLIC_URL` | step 3 |
| `GITHUB_APP_ID`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_WEBHOOK_SECRET`, `GITHUB_INSTALLATION_ID` | step 4 |
| `DISCORD_APPLICATION_ID`, `DISCORD_PUBLIC_KEY`, `DISCORD_BOT_TOKEN` | step 5 |
| `DISCORD_GIG_CHANNEL_ID` (Code), `DISCORD_CONTENT_CHANNEL_ID`, `DISCORD_ART_CHANNEL_ID`, `DISCORD_DEVELOPER_ROLE_ID`, `DISCORD_MAINTAINER_ROLE_ID`, `DISCORD_GUILD_ID` | step 5 |

---

## 1. GitHub organization

GitHub only sends Project webhooks for Projects owned by an organization.

1. Create a free organization at github.com → **+** → **New organization**, for
   example `anilounge`.
2. Move both repos into it. In each repo, open **Settings** → **Danger Zone** →
   **Transfer**:
   - `anirudh-naveen/anilounge`
   - `anirudh-naveen/github-gigs`
3. After the transfer:
   - **Vercel and Railway (the main site):** their GitHub integrations need access to
     the new org. In each dashboard, reconnect the project to the moved repo, or
     auto-deploys will stop.
   - **Local checkouts:** old URLs redirect, but update the remotes anyway:
     ```bash
     git remote set-url origin https://github.com/anilounge/anilounge.git
     ```
     ```bash
     git remote set-url origin https://github.com/anilounge/github-gigs.git
     ```
     Run each command in its own checkout.
   - **`.github/CODEOWNERS`** in the main repo: check that it still names you
     correctly.

## 2. GitHub Project

1. In the org: **Projects** → **New project** → **Board**. Name it **AniLounge Gigs**.
2. Set up the fields (the **⋯** menu → **Settings** → **Fields**):

   | Field | Type | Options |
   | --- | --- | --- |
   | Status | single select (exists already) | rename the options to **Open**, **Claimed**, **In review**, **Done** |
   | Type | single select | Code, Content, Art |
   | Difficulty | single select | Easy, Medium, Hard |
   | Area | single select | Frontend, Backend, Security, Mobile |
   | Bounty | text | (none) |

   The bot reads options by name, so spell them exactly as shown.
3. Workflows (**⋯** → **Workflows**):
   - **Item closed** → set Status to **Done**. This one is usually on already.
   - **Pull request merged** → **Done**.
   - **Item added to project:** turn it off, or make sure it doesn't set a Status. A
     gig with a blank Status stays off Discord until you set it to Open, which gives
     you time to fill in its fields first.
4. Add issues #72–#81: **+ Add item** → `#72` and so on. Fill in Type, Difficulty,
   Area, and Bounty, but **leave Status blank for now**. You'll open them in step 8,
   after a test.
5. Copy the Project's ID:
   ```bash
   gh auth refresh -s read:project
   ```
   ```bash
   gh project view 1 --owner anilounge --format json --jq .id
   ```
   Replace `1` with the number in the Project's URL. The ID starts with `PVT_`. It goes
   in `GITHUB_PROJECT_ID`.

## 3. Railway service (get the URL first)

The GitHub App and Discord both need the bot's public URL, so set up the service
before creating them.

1. Railway → **New Project** → **Deploy from GitHub repo** → `anilounge/github-gigs`.
   You may need to give Railway's GitHub app access to the new org.
2. In that project: **+ New** → **Database** → **PostgreSQL**.
3. Open the bot service:
   - **Settings** → **Networking** → **Generate Domain**. Copy it, for example
     `https://github-gigs-production.up.railway.app`. This is `PUBLIC_URL`.
   - **Settings** → **Deploy** → **Healthcheck Path**: `/health`.
4. The first deploy will crash because the variables aren't set yet. That's expected.

## 4. GitHub App

1. Org **Settings** → **Developer settings** → **GitHub Apps** → **New GitHub App**.
   - **Name:** `anilounge-bot` (it must be unique across GitHub)
   - **Homepage URL:** `https://github.com/anilounge/github-gigs`
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
   - **Subscribe to events:** **Issues** and **Projects v2 item**. The second only
     appears after you set the Projects permission.
   - **Where can this app be installed:** Only on this account.
2. Click **Create**. On the App's page:
   - **App ID** → `GITHUB_APP_ID`
   - **Client ID** → `GITHUB_CLIENT_ID`
   - **Generate a new client secret** → `GITHUB_CLIENT_SECRET`
   - **Generate a private key** downloads a `.pem` file. Paste its whole contents into
     `GITHUB_APP_PRIVATE_KEY`, then delete the file.
3. **Install App** → install on the `anilounge` org, then choose **Only select
   repositories** → `anilounge`. The page you land on ends in
   `/settings/installations/<number>`. That number is `GITHUB_INSTALLATION_ID`.

## 5. Discord

**The application**

1. Go to https://discord.com/developers/applications → **New Application** →
   "AniLounge Gigs".
2. **General Information:** copy **Application ID** → `DISCORD_APPLICATION_ID` and
   **Public Key** → `DISCORD_PUBLIC_KEY`. Leave **Interactions Endpoint URL** empty
   for now; you'll set it in step 7.
3. **Bot:** click **Reset Token** and copy it → `DISCORD_BOT_TOKEN`. The bot needs no
   privileged intents.
4. **Installation:** under **Guild Install**, set the scopes to `bot` and
   `applications.commands`. Open the install link and add the bot to your server.

**The server.** Turn on Developer Mode first (User Settings → Advanced) so you can
right-click things to copy their IDs.

1. Right-click the server icon → **Copy Server ID** → `DISCORD_GUILD_ID`.
2. Roles: create **Developer** and **Maintainer**, and give yourself Maintainer.
   Right-click each one → **Copy Role ID** → `DISCORD_DEVELOPER_ROLE_ID` and
   `DISCORD_MAINTAINER_ROLE_ID`.
3. Create three **Forum** channels, for example `code-gigs`, `content-gigs`, and
   `art-gigs`. Right-click each → **Copy Channel ID**:
   - Code → `DISCORD_GIG_CHANNEL_ID`
   - Content → `DISCORD_CONTENT_CHANNEL_ID`
   - Art → `DISCORD_ART_CHANNEL_ID`
4. Tags. In each forum, open **Edit Channel** → **Tags**. The bot matches tags by name.

   | Forum | Tags |
   | --- | --- |
   | Code | Frontend, Backend, Mobile, Feature, Bug Fix, Easy, Medium, Hard, Claimed |
   | Content | Easy, Medium, Hard, Claimed, plus any you use for your own posts |
   | Art | Easy, Medium, Hard, Claimed |

5. Permissions. In each forum, open **Edit Channel** → **Permissions**:
   - **@everyone:** Create Posts **off**, Send Messages in Posts **on**.
   - **Maintainer:** Create Posts **on**.
   - **The bot's role:** View Channel, Create Posts, Send Messages in Posts, Manage
     Threads, and Manage Messages, all **on**.
6. Paste the Post Guidelines from [discord-gig-board.md](discord-gig-board.md) into
   each forum. Content uses its own version. Don't post the pinned intro yet.

## 6. Railway variables and first deploy

In the bot service → **Variables** → **Raw Editor**, paste the following and fill it in:

```
GIGS_CONFIG=config/anilounge.json
PUBLIC_URL=
DATABASE_URL=${{Postgres.DATABASE_URL}}

DISCORD_APPLICATION_ID=
DISCORD_PUBLIC_KEY=
DISCORD_BOT_TOKEN=
DISCORD_GIG_CHANNEL_ID=
DISCORD_CONTENT_CHANNEL_ID=
DISCORD_ART_CHANNEL_ID=
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

`${{Postgres.DATABASE_URL}}` links to the database you added in step 3. The private key
can be pasted with its line breaks, or on one line with `\n` in place of each line
break. Deploy, then check **Deployments** → **Logs**:

- You should see `github-gigs listening on :<port>`, followed by
  `startup backfill: {"created":0,…}`. It's 0 because every Status is still blank.
- If you see "Missing required environment variables: …", the message names each
  missing variable.
- If you see "startup backfill failed: …", it's usually a wrong `GITHUB_PROJECT_ID` or
  `GITHUB_INSTALLATION_ID`, or the App lacks the Projects permission.

Then open `<PUBLIC_URL>/health` in a browser. It should show `{"ok":true}`.

## 7. Connect Discord

1. Back in the Developer Portal → **General Information** → **Interactions Endpoint
   URL**: `<PUBLIC_URL>/discord/interactions`. Click **Save**. Discord tests the URL
   when you save, so the bot must be running. If Discord rejects it, check
   `DISCORD_PUBLIC_KEY`.
2. Register the slash commands, running this from your github-gigs checkout:
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
   It should print `registered 4 commands in guild …`. `/link`, `/claim`, `/unclaim`,
   and `/gigs` then appear in your server.

## 8. Test, then open the gigs

1. Create a throwaway issue in `anilounge`, for example "Test gig", with a
   **Requirements** list. Add it to the Project with Type = Code and Difficulty = Easy,
   then set **Status = Open**. Within a few seconds, a post appears in the Code forum.
2. Edit the issue title, then the Difficulty. The post should update each time.
3. Change Type to Art. The post should move to the Art forum.
4. Give a second account (or a friend) the Developer role. From that account:
   - run `/link` and sign in with GitHub,
   - then run `/claim` in the post.
5. As Maintainer, click **Approve**. The issue should get assigned and commented on,
   Status should become Claimed, and the post should show 🔒.
6. Run `/unclaim`. Everything should reverse.
7. Close the issue. The post should disappear.
8. If all of that works, set Status = **Open** on #72–#81 (other than any security
   issue). They'll be posted within seconds.
9. Post and pin the intro in each forum, using
   [discord-gig-board.md](discord-gig-board.md).
10. Paste [CONTRIBUTING-gigs.md](CONTRIBUTING-gigs.md) into the main repo's
    CONTRIBUTING.md, then delete `TODO.md` as the plan says.

## If something goes wrong

| Symptom | Likely cause |
| --- | --- |
| No post appears after you set Open | Check the GitHub App's **Advanced** tab for webhook deliveries. A 401 means `GITHUB_WEBHOOK_SECRET` doesn't match. No deliveries means the App isn't subscribed to **Projects v2 item**, or the Project isn't owned by the org. |
| Logs show `Discord … 403` | The bot is missing a permission on that forum (step 5.5). |
| Post appears without tags | Tag names don't match. Check spelling, for example `Bug Fix`. |
| `/claim` says "only works inside gig posts" | You ran it in a post the bot didn't create. |
| `/link` button gives a GitHub error | The App's Callback URL must match `<PUBLIC_URL>/github/oauth/callback` exactly. |
| "Field Status has no option Claimed" | Rename the Status options exactly as in step 2. |
| Commands don't appear | Rerun `register-commands` with `DISCORD_GUILD_ID` set, then restart Discord. |
