import { sign } from 'node:crypto';

const API = 'https://api.github.com';
const WEB = 'https://github.com';
const HEADERS = {
  Accept: 'application/vnd.github+json',
  'User-Agent': 'github-gigs',
  'X-GitHub-Api-Version': '2022-11-28',
};

// Railway variables often hold PEM keys with literal "\n"s.
export function normalizePrivateKey(key) {
  return key.includes('\\n') ? key.replace(/\\n/g, '\n') : key;
}

// A short-lived JWT that authenticates as the GitHub App itself.
export function appJwt(appId, privateKey, now = Date.now()) {
  const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  const iat = Math.floor(now / 1000) - 60;
  const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({ iat, exp: iat + 600, iss: String(appId) })}`;
  const signature = sign('RSA-SHA256', Buffer.from(unsigned), privateKey).toString('base64url');
  return `${unsigned}.${signature}`;
}

const VALUE = `
  ... on ProjectV2ItemFieldSingleSelectValue { name }
  ... on ProjectV2ItemFieldTextValue { text }
  ... on ProjectV2ItemFieldNumberValue { number }
`;

const ITEM_QUERY = `
query($id: ID!, $status: String!, $difficulty: String!, $bounty: String!, $area: String!) {
  node(id: $id) {
    ... on ProjectV2Item {
      id
      isArchived
      project { id }
      content {
        __typename
        ... on Issue {
          id number title body url state
          repository { nameWithOwner }
          labels(first: 50) { nodes { name } }
          assignees(first: 10) { nodes { login } }
        }
      }
      status: fieldValueByName(name: $status) { ${VALUE} }
      difficulty: fieldValueByName(name: $difficulty) { ${VALUE} }
      bounty: fieldValueByName(name: $bounty) { ${VALUE} }
      area: fieldValueByName(name: $area) { ${VALUE} }
    }
  }
}`;

const ISSUE_ITEMS_QUERY = `
query($id: ID!) {
  node(id: $id) {
    ... on Issue { projectItems(first: 50) { nodes { id project { id } } } }
  }
}`;

const PROJECT_ITEMS_QUERY = `
query($id: ID!, $after: String) {
  node(id: $id) {
    ... on ProjectV2 {
      items(first: 100, after: $after) {
        pageInfo { hasNextPage endCursor }
        nodes { id }
      }
    }
  }
}`;

const STATUS_FIELD_QUERY = `
query($id: ID!, $name: String!) {
  node(id: $id) {
    ... on ProjectV2 {
      field(name: $name) {
        ... on ProjectV2SingleSelectField { id options { id name } }
      }
    }
  }
}`;

const SET_FIELD_MUTATION = `
mutation($project: ID!, $item: ID!, $field: ID!, $option: String!) {
  updateProjectV2ItemFieldValue(input: {
    projectId: $project, itemId: $item, fieldId: $field,
    value: { singleSelectOptionId: $option }
  }) { projectV2Item { id } }
}`;

// Open PRs that will close the issue, with their newest commit.
const LINKED_PRS_QUERY = `
query($id: ID!) {
  node(id: $id) {
    ... on Issue {
      closedByPullRequestsReferences(first: 10, includeClosedPrs: false) {
        nodes {
          author { login }
          commits(last: 1) { nodes { commit { committedDate } } }
        }
      }
    }
  }
}`;

function fieldText(value) {
  if (!value) return '';
  if (value.name != null) return value.name;
  if (value.text != null) return value.text;
  if (value.number != null) return String(value.number);
  return '';
}

export function createGitHubClient(
  { appId, privateKey, installationId, clientId, clientSecret, apiUrl = API, webUrl = WEB },
  fetchImpl = fetch,
) {
  const key = normalizePrivateKey(privateKey);
  let cached = null;

  async function installationToken() {
    if (cached && cached.expiresAt - Date.now() > 5 * 60 * 1000) return cached.token;
    const res = await fetchImpl(`${apiUrl}/app/installations/${installationId}/access_tokens`, {
      method: 'POST',
      headers: { ...HEADERS, Authorization: `Bearer ${appJwt(appId, key)}` },
    });
    if (!res.ok) throw new Error(`GitHub installation token request failed: ${res.status}`);
    const json = await res.json();
    cached = { token: json.token, expiresAt: Date.parse(json.expires_at) };
    return cached.token;
  }

  async function graphql(query, variables) {
    const res = await fetchImpl(`${apiUrl}/graphql`, {
      method: 'POST',
      headers: { ...HEADERS, Authorization: `Bearer ${await installationToken()}` },
      body: JSON.stringify({ query, variables }),
    });
    if (!res.ok) throw new Error(`GitHub GraphQL request failed: ${res.status}`);
    const json = await res.json();
    // A deleted node comes back as null with a NOT_FOUND error; that is an answer.
    const errors = (json.errors || []).filter((e) => e.type !== 'NOT_FOUND');
    if (errors.length) throw new Error(`GitHub GraphQL error: ${errors.map((e) => e.message).join('; ')}`);
    return json.data;
  }

  async function rest(method, path, body) {
    const res = await fetchImpl(`${apiUrl}${path}`, {
      method,
      headers: { ...HEADERS, Authorization: `Bearer ${await installationToken()}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`GitHub ${method} ${path} failed: ${res.status}`);
    return res.status === 204 ? null : res.json();
  }

  const statusFields = new Map();
  async function statusField(projectId, name) {
    const key = `${projectId}/${name}`;
    if (!statusFields.has(key)) {
      const data = await graphql(STATUS_FIELD_QUERY, { id: projectId, name });
      const field = data?.node?.field;
      if (!field?.options) throw new Error(`Project has no single-select field named "${name}"`);
      statusFields.set(key, field);
    }
    return statusFields.get(key);
  }

  return {
    graphql,

    // A Project item in a flat shape, or null if it no longer exists.
    async getItem(itemId, fieldNames) {
      const data = await graphql(ITEM_QUERY, { id: itemId, ...fieldNames });
      const node = data?.node;
      if (!node?.project) return null;
      const c = node.content;
      return {
        id: node.id,
        projectId: node.project.id,
        isArchived: node.isArchived,
        issue: c?.__typename === 'Issue'
          ? {
            id: c.id,
            repo: c.repository.nameWithOwner,
            number: c.number,
            title: c.title,
            body: c.body,
            url: c.url,
            state: c.state,
            labels: c.labels.nodes.map((l) => l.name),
            assignees: c.assignees.nodes.map((a) => a.login),
          }
          : null,
        fields: {
          status: fieldText(node.status),
          difficulty: fieldText(node.difficulty),
          bounty: fieldText(node.bounty),
          area: fieldText(node.area),
        },
      };
    },

    // Ids of the given Project's items that point at an issue.
    async itemsForIssue(issueId, projectId) {
      const data = await graphql(ISSUE_ITEMS_QUERY, { id: issueId });
      const nodes = data?.node?.projectItems?.nodes || [];
      return nodes.filter((n) => n.project.id === projectId).map((n) => n.id);
    },

    async listItems(projectId) {
      const ids = [];
      let after = null;
      do {
        const data = await graphql(PROJECT_ITEMS_QUERY, { id: projectId, after });
        const items = data?.node?.items;
        if (!items) throw new Error('Project not found, or the GitHub App cannot read it');
        ids.push(...items.nodes.map((n) => n.id));
        after = items.pageInfo.hasNextPage ? items.pageInfo.endCursor : null;
      } while (after);
      return ids;
    },

    // GitHub silently skips people it won't let you assign (outside
    // contributors who haven't commented on the issue), so report what stuck.
    async assign(repo, number, login) {
      const issue = await rest('POST', `/repos/${repo}/issues/${number}/assignees`, { assignees: [login] });
      return (issue.assignees || []).some((a) => a.login.toLowerCase() === login.toLowerCase());
    },

    async unassign(repo, number, login) {
      await rest('DELETE', `/repos/${repo}/issues/${number}/assignees`, { assignees: [login] });
    },

    async comment(repo, number, body) {
      await rest('POST', `/repos/${repo}/issues/${number}/comments`, { body });
    },

    // Sets a single-select field (e.g. Status) by option name.
    async setField(projectId, itemId, fieldName, optionName) {
      const field = await statusField(projectId, fieldName);
      const option = field.options.find((o) => o.name.toLowerCase() === optionName.toLowerCase());
      if (!option) throw new Error(`Field "${fieldName}" has no option "${optionName}"`);
      await graphql(SET_FIELD_MUTATION, { project: projectId, item: itemId, field: field.id, option: option.id });
    },

    // Newest commit date on the claimant's open PRs linked to the issue, or null.
    async lastCommitAt(issueId, login) {
      const data = await graphql(LINKED_PRS_QUERY, { id: issueId });
      const prs = data?.node?.closedByPullRequestsReferences?.nodes || [];
      const dates = prs
        .filter((pr) => pr.author?.login?.toLowerCase() === login.toLowerCase())
        .map((pr) => pr.commits.nodes[0]?.commit.committedDate)
        .filter(Boolean)
        .map((d) => new Date(d));
      return dates.length ? new Date(Math.max(...dates)) : null;
    },

    linkingEnabled: Boolean(clientId && clientSecret),

    authorizeUrl(state, redirectUri) {
      const params = new URLSearchParams({ client_id: clientId, state, redirect_uri: redirectUri });
      return `${webUrl}/login/oauth/authorize?${params}`;
    },

    // Trades an OAuth code for the user's login. The user token is not kept.
    async loginFromCode(code) {
      const res = await fetchImpl(`${webUrl}/login/oauth/access_token`, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': 'github-gigs' },
        body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.access_token) throw new Error('GitHub did not accept the sign-in code');
      const user = await fetchImpl(`${apiUrl}/user`, {
        headers: { ...HEADERS, Authorization: `Bearer ${json.access_token}` },
      });
      if (!user.ok) throw new Error(`GitHub user lookup failed: ${user.status}`);
      return (await user.json()).login;
    },
  };
}
