import { readState, signState } from './link.js';
import {
  DEFERRED_MESSAGE, DEFERRED_UPDATE, NO_MENTIONS, UPDATE_MESSAGE, ephemeral, publicMessage,
} from './responses.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const BUTTON = 2;
const ROW = 1;
const SUCCESS = 3;
const DANGER = 4;
const LINK = 5;

const same = (a, b) => (a || '').toLowerCase() === (b || '').toLowerCase();

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function page(status, message) {
  return {
    status,
    html: `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>GitHub link</title><body style="font:16px system-ui;max-width:32rem;margin:4rem auto;padding:0 1rem">
<p>${escapeHtml(message)}</p></body>`,
  };
}

// /link, /claim, /unclaim, /gigs, the Approve/Deny buttons, the GitHub
// sign-in callback, and claim expiry.
//
// handleInteraction returns { response, followUp? }. The response goes back to
// Discord at once (it allows 3 seconds); followUp does the slow GitHub work
// afterwards and edits the reply.
export function createClaims({ github, discord, store, sync, settings, config, log = console.log }) {
  const { claims: rules, statuses, fields } = settings;
  const { applicationId, maintainerRoleId } = config.discord;
  const projectId = config.github.projectId;
  const max = rules.maxActivePerUser;

  const userOf = (i) => i.member?.user?.id ?? i.user?.id;
  const isMaintainer = (i) => Boolean(maintainerRoleId) && (i.member?.roles || []).includes(maintainerRoleId);
  const reply = (response) => ({ response });

  function deferred(response, interaction, work) {
    return {
      response,
      followUp: async () => {
        let body;
        try {
          body = await work();
        } catch (err) {
          log(`/${interaction.data?.name || interaction.data?.custom_id} failed: ${err.message}`);
          body = { content: 'Something went wrong talking to GitHub. Try again, or ask a maintainer.', components: [] };
        }
        await discord.editOriginal(applicationId, interaction.token, { allowed_mentions: NO_MENTIONS, ...body });
      },
    };
  }

  function decisionButtons(itemId) {
    return [{
      type: ROW,
      components: [
        { type: BUTTON, style: SUCCESS, label: 'Approve', custom_id: `gig:approve:${itemId}` },
        { type: BUTTON, style: DANGER, label: 'Deny', custom_id: `gig:deny:${itemId}` },
      ],
    }];
  }

  // Turns a gig's pending request into a claim: assign on GitHub, set Status,
  // comment, and refresh the post.
  async function grant(itemId, approverId) {
    const row = await store.get(itemId);
    const p = row?.pending;
    if (!p) return { content: 'This request is no longer pending.', components: [] };

    const item = await github.getItem(itemId, fields);
    const issue = item?.issue;
    const open = issue && issue.state === 'OPEN' && same(item.fields.status, statuses.open)
      && issue.assignees.length === 0;
    if (!open) {
      await store.clearPending(itemId);
      return { content: `<@${p.discordId}>'s request was dropped: this gig is no longer open.`, components: [] };
    }
    // countActive includes this pending request.
    if ((await store.countActive(p.discordId)) - 1 >= max) {
      await store.clearPending(itemId);
      return { content: `<@${p.discordId}> already has ${max} active claims, so this request was dropped.`, components: [] };
    }

    await store.setClaim(itemId, p.discordId, p.githubLogin);
    let assigned;
    try {
      assigned = await github.assign(issue.repo, issue.number, p.githubLogin);
      await github.setField(projectId, itemId, fields.status, statuses.claimed);
    } catch (err) {
      await store.clearClaim(itemId);
      throw err;
    }
    const by = approverId ? ', approved by a maintainer' : '';
    const note = assigned
      ? ''
      : `\n\n@${p.githubLogin}, GitHub couldn't assign you yet. Leave a comment here and a maintainer can assign you.`;
    await github.comment(issue.repo, issue.number, `Claimed by @${p.githubLogin} via Discord${by}.${note}`);
    await sync.reconcile(itemId);

    const approved = approverId ? `, approved by <@${approverId}>` : '';
    const warn = assigned ? '' : ' GitHub could not assign them yet; they should comment on the issue.';
    return { content: `✅ <@${p.discordId}> (GitHub: ${p.githubLogin}) claimed this gig${approved}.${warn}`, components: [] };
  }

  // Ends a claim: unassign, set Status back to Open, comment, refresh the post.
  async function release(itemId, reason) {
    const row = await store.get(itemId);
    const c = row?.claim;
    if (!c) return null;
    await store.clearClaim(itemId);
    const item = await github.getItem(itemId, fields);
    if (item?.issue) {
      const { repo, number } = item.issue;
      await github.unassign(repo, number, c.githubLogin);
      await github.setField(projectId, itemId, fields.status, statuses.open);
      const text = {
        self: `@${c.githubLogin} unclaimed this via Discord. It's open again.`,
        maintainer: `A maintainer released @${c.githubLogin}'s claim. It's open again.`,
        expired: `@${c.githubLogin}'s claim expired after ${rules.expireDaysAfterLastCommit} days without commits. It's open again.`,
      }[reason];
      await github.comment(repo, number, text);
    }
    await sync.reconcile(itemId);
    return c;
  }

  async function claimCommand(i) {
    const user = userOf(i);
    const row = await store.getByThread(i.channel_id);
    if (!row) return reply(ephemeral('Run `/claim` inside a gig post.'));
    if (row.claim) {
      return reply(ephemeral(row.claim.discordId === user ? 'You already have this gig.' : 'This gig is already claimed.'));
    }
    if (row.pending) {
      return reply(ephemeral(row.pending.discordId === user
        ? 'Your request is waiting for a maintainer.'
        : 'Someone already requested this gig. A maintainer will decide soon.'));
    }
    if (!same(row.status, statuses.open)) return reply(ephemeral('This gig is not open for claims.'));
    const login = await store.getLink(user);
    if (!login) return reply(ephemeral('Link your GitHub account first with `/link`.'));
    if ((await store.countActive(user)) >= max) {
      return reply(ephemeral(`You already have ${max} active claims or requests. Finish one, or \`/unclaim\` it, first.`));
    }
    // Pending first, even without approval, so two people can't both get it.
    if (!(await store.setPending(row.itemId, user, login))) {
      return reply(ephemeral('Someone requested this gig just before you.'));
    }

    if (!rules.requireApproval) {
      return deferred({ type: DEFERRED_MESSAGE }, i, () => grant(row.itemId, null));
    }
    const ping = maintainerRoleId ? `<@&${maintainerRoleId}> ` : '';
    return reply(publicMessage(
      `<@${user}> (GitHub: ${login}) wants this gig. ${ping}Approve or deny below.`,
      { allowed_mentions: { parse: [], roles: maintainerRoleId ? [maintainerRoleId] : [] }, components: decisionButtons(row.itemId) },
    ));
  }

  async function unclaimCommand(i) {
    const user = userOf(i);
    const row = await store.getByThread(i.channel_id);
    if (!row) return reply(ephemeral('Run `/unclaim` inside a gig post.'));
    if (row.pending?.discordId === user) {
      await store.clearPending(row.itemId);
      return reply(publicMessage(`<@${user}> withdrew their request. This gig is open again.`));
    }
    if (!row.claim) return reply(ephemeral('This gig has no claim made through Discord.'));
    const own = row.claim.discordId === user;
    if (!own && !isMaintainer(i)) return reply(ephemeral('Only the claimant or a maintainer can release this claim.'));

    return deferred({ type: DEFERRED_MESSAGE }, i, async () => {
      const c = await release(row.itemId, own ? 'self' : 'maintainer');
      if (!c) return { content: 'This gig is no longer claimed.' };
      return { content: own
        ? `<@${user}> released this gig. It's open again.`
        : `<@${user}> released <@${c.discordId}>'s claim. This gig is open again.` };
    });
  }

  async function gigsCommand() {
    const open = (await store.all()).filter(
      (r) => r.threadId && same(r.status, statuses.open) && !r.claim && !r.pending,
    );
    if (!open.length) return reply(ephemeral('No open gigs right now.'));
    const lines = open.slice(0, 20).map((r) => `- <#${r.threadId}> (${r.repo}#${r.number})`);
    if (open.length > 20) lines.push(`…and ${open.length - 20} more in the gig board.`);
    return reply(ephemeral(`**Open gigs**\n${lines.join('\n')}`));
  }

  async function linkCommand(i) {
    if (!github.linkingEnabled || !config.publicUrl) {
      return reply(ephemeral('GitHub linking is not set up on this server yet.'));
    }
    const current = await store.getLink(userOf(i));
    const state = signState(config.github.webhookSecret, userOf(i));
    const url = github.authorizeUrl(state, `${config.publicUrl}/github/oauth/callback`);
    const now = current ? `You're linked to **${current}**. ` : '';
    return reply(ephemeral(
      `${now}Sign in with GitHub to link your account. The button works for 10 minutes.`,
      [{ type: ROW, components: [{ type: BUTTON, style: LINK, label: 'Sign in with GitHub', url }] }],
    ));
  }

  async function decide(i, action, itemId) {
    if (!isMaintainer(i)) return reply(ephemeral('Only maintainers can approve or deny requests.'));
    const maintainer = userOf(i);
    if (action === 'approve') {
      return deferred({ type: DEFERRED_UPDATE }, i, () => grant(itemId, maintainer));
    }
    const row = await store.get(itemId);
    if (!row?.pending) {
      return reply({ type: UPDATE_MESSAGE, data: { content: 'This request is no longer pending.', components: [] } });
    }
    await store.clearPending(itemId);
    return reply({
      type: UPDATE_MESSAGE,
      data: {
        content: `<@${row.pending.discordId}>'s request was denied by <@${maintainer}>.`,
        components: [],
        allowed_mentions: NO_MENTIONS,
      },
    });
  }

  return {
    grant,
    release,

    async handleInteraction(i) {
      if (i.type === 3) {
        const [, action, itemId] = (i.data?.custom_id || '').split(':');
        if (action === 'approve' || action === 'deny') return decide(i, action, itemId);
        return reply(ephemeral('That button is no longer active.'));
      }
      switch (i.data?.name) {
        case 'claim': return claimCommand(i);
        case 'unclaim': return unclaimCommand(i);
        case 'gigs': return gigsCommand();
        case 'link': return linkCommand(i);
        default: return reply(ephemeral(`Unknown command \`/${i.data?.name}\`.`));
      }
    },

    async linkCallback({ code, state }) {
      const discordId = readState(config.github.webhookSecret, state);
      if (!discordId || !code) return page(400, 'This sign-in link has expired. Run /link in Discord again.');
      try {
        const login = await github.loginFromCode(code);
        await store.saveLink(discordId, login);
        return page(200, `Linked to GitHub account ${login}. You can close this tab and return to Discord.`);
      } catch (err) {
        log(`link callback failed: ${err.message}`);
        return page(502, 'GitHub sign-in failed. Run /link in Discord and try again.');
      }
    },

    // Releases claims with no commits on a linked PR for the configured days,
    // counting from the claim itself if there are none. Only gigs still in
    // the claimed status expire; one in review waits on the maintainer.
    async expire(now = new Date()) {
      const days = rules.expireDaysAfterLastCommit;
      if (!days) return [];
      const expired = [];
      for (const row of await store.all()) {
        if (!row.claim || !same(row.status, statuses.claimed)) continue;
        try {
          const item = await github.getItem(row.itemId, fields);
          if (!item?.issue) continue;
          const commit = await github.lastCommitAt(item.issue.id, row.claim.githubLogin);
          const last = Math.max(new Date(row.claim.at).getTime(), commit ? commit.getTime() : 0);
          if (now.getTime() - last <= days * DAY_MS) continue;
          const c = await release(row.itemId, 'expired');
          if (!c) continue;
          expired.push(row.itemId);
          if (row.threadId) {
            await discord.sendMessage(row.threadId, {
              content: `<@${c.discordId}>'s claim expired after ${days} days without commits. This gig is open again.`,
              allowed_mentions: { parse: [], users: [c.discordId] },
            });
          }
        } catch (err) {
          log(`expiry check for ${row.repo}#${row.number} failed: ${err.message}`);
        }
      }
      return expired;
    },
  };
}
