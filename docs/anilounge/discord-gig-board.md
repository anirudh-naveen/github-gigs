# Discord gig board text

Text for the three gig forums: Code, Content, and Art. Code and Art hold only bot posts.
Content holds bot posts and tasks maintainers write by hand. The bot never touches posts
it didn't create, so the two kinds can share a forum. Before posting, replace
CONTRIBUTING_URL and BOUNTY_TERMS.

## 0. Permissions (all three forums)

So that only maintainers and the bot open posts:

- **@everyone:** turn off **Create Posts**. Leave **Send Messages in Posts** on, so
  people can reply.
- **Maintainer role:** turn on **Create Posts**, so you can write content tasks and the
  pinned intro.
- **Bot:** the permissions from the README setup steps.

## 1. Post Guidelines

To set them: Edit Channel → Overview → Post Guidelines. Discord shows them at the top
of the forum and in the "new post" form.

**Code and Art**

```
Every gig here is created and updated by the bot from GitHub, so please don't open posts here yourself.
To claim a gig: get the Developer role, run /link once, then run /claim inside a gig's post. A maintainer approves each claim.
Questions about a gig? Reply in its post.
```

**Content**

```
Two kinds of posts live here:
• Gigs from GitHub, which have Difficulty, Bounty and Requirements lines. The bot keeps them up to date. To claim one: get the Developer role, run /link once, then run /claim inside the post. A maintainer approves each claim.
• Content tasks written by maintainers. To take one, reply in its post.
Questions? Reply in the post.
```

## 2. Pinned intro post

Post it as a maintainer in each forum, then right-click the post → **Pin Post**. Use the
same title and body everywhere. In the Content forum, add the extra section where the
body marks it. Both versions are under Discord's 2000-character limit.

**Title**

```
📌 How the gig board works
```

**Body**

```
Welcome! Each post in this channel is a **gig**: an open AniLounge task backed by a GitHub issue. Gigs are split across the Code, Content and Art forums, and `/gigs` lists all of them. The bot creates, updates and deletes these posts to match GitHub, so what you see here is always current.

**Reading a gig**
**Difficulty**: Easy, Medium or Hard
**Bounty**: shown when the gig pays; "—" means volunteer
**Requirements**: what the pull request must do
🔒 means someone has already claimed it

**Claiming a gig**
1. Ask for the **Developer** role.
2. Run `/link` and sign in with GitHub. You only do this once.
3. Open a gig's post and run `/claim`.
4. A maintainer approves it. You're assigned on GitHub, and the post shows your claim.

**Rules**
• You can hold **2** claims or pending requests at a time.
• A claim expires **7 days after your last commit** on a pull request linked to the issue, or 7 days after approval if you haven't opened one. Open a draft PR early and put `Closes #<issue>` in it. PRs waiting for review don't expire.
• Done with it, or changed your mind? Run `/unclaim` in the post.
• `/gigs` lists every open gig.

**Bounties**
BOUNTY_TERMS

**Getting started**
Read the contributing guide first: CONTRIBUTING_URL
Ask questions in the gig's post. Report security problems by email to support@anilounge.net, never here.
```

**Extra section for the Content forum.** Paste it into the body just before **Reading a gig**:

```
**Two kinds of posts here**
Gigs from GitHub have Difficulty, Bounty and Requirements lines, and you claim them with `/claim`. The other posts are content tasks written by a maintainer. To take one, reply in the post, and the maintainer will confirm. Content tasks don't count toward the 2-claim limit and don't appear in `/gigs`.

```
