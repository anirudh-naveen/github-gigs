# Discord gig board text

Two pieces of text for each gig forum (Code, Content, and Art). Use the same text in
all three. Before posting, replace CONTRIBUTING_URL and BOUNTY_TERMS.

## 1. Post Guidelines

To set them: Edit Channel → Overview → Post Guidelines. Discord shows them at the top
of the forum and in the "new post" form.

```
Every gig here is created and updated by the bot from GitHub, so please don't open posts here yourself.
To claim a gig: get the Developer role, run /link once, then run /claim inside a gig's post. A maintainer approves each claim.
Questions about a gig? Reply in its post.
```

## 2. Pinned intro post

Post it as a maintainer, then right-click the post → **Pin Post**. The bot ignores posts
it didn't create, so this one stays. Paste the title and body as they are. The body is
under Discord's 2000-character limit.

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
