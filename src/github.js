import { sign } from 'node:crypto';

const API = 'https://api.github.com';
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

function fieldText(value) {
  if (!value) return '';
  if (value.name != null) return value.name;
  if (value.text != null) return value.text;
  if (value.number != null) return String(value.number);
  return '';
}

export function createGitHubClient({ appId, privateKey, installationId }, fetchImpl = fetch) {
  const key = normalizePrivateKey(privateKey);
  let cached = null;

  async function installationToken() {
    if (cached && cached.expiresAt - Date.now() > 5 * 60 * 1000) return cached.token;
    const res = await fetchImpl(`${API}/app/installations/${installationId}/access_tokens`, {
      method: 'POST',
      headers: { ...HEADERS, Authorization: `Bearer ${appJwt(appId, key)}` },
    });
    if (!res.ok) throw new Error(`GitHub installation token request failed: ${res.status}`);
    const json = await res.json();
    cached = { token: json.token, expiresAt: Date.parse(json.expires_at) };
    return cached.token;
  }

  async function graphql(query, variables) {
    const res = await fetchImpl(`${API}/graphql`, {
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
  };
}
