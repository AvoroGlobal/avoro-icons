// Enable GitHub auto-merge on a non-draft pull request so a merge queue
// accepts it once required checks pass. This does not approve, label, or
// admin-merge. The merge queue still enforces every required check.
//
// Credential: the org GitHub App avoro-builder (contents:write,
// pull_requests:write, metadata:read). GITHUB_TOKEN is not used to enable
// auto-merge: events it causes do not start new workflow runs, so a queue
// entry it created would never report required checks and would time out.
// See AvoroGlobal/keystone docs/agent-credentials.md.

import { createSign } from "node:crypto";
import { pathToFileURL } from "node:url";

const GITHUB_API = "https://api.github.com";
const OPT_OUT_LABEL = "no-auto-merge";
const JWT_LIFETIME_SECONDS = 540;

export function bodyOptsOut(body) {
  const text = String(body ?? "");
  if (/do not merge/i.test(text)) return true;
  // "no merge conflicts" is a status, not an instruction to skip the queue.
  const withoutConflictStatus = text.replace(/no merge conflicts?/gi, "");
  return /no merge/i.test(withoutConflictStatus);
}

export function decide({
  draft,
  state,
  baseRef,
  defaultBranch,
  labels,
  body,
  sameRepository,
}) {
  if (!sameRepository) return { action: "skip", reason: "fork" };
  if (state !== "open") return { action: "skip", reason: "closed" };
  if (draft) return { action: "disable", reason: "draft" };
  if (baseRef !== defaultBranch)
    return { action: "disable", reason: "off-default-branch" };
  const names = Array.isArray(labels)
    ? labels.map((label) => String(label))
    : [];
  if (names.some((name) => name.toLowerCase() === OPT_OUT_LABEL)) {
    return { action: "disable", reason: "label" };
  }
  if (bodyOptsOut(body)) return { action: "disable", reason: "body" };
  return { action: "enable", reason: "eligible" };
}

export function selectMergeMethod(rules, rulesetsById = new Map()) {
  if (!Array.isArray(rules))
    return { method: null, reason: "rules-unreadable" };
  const queues = rules.filter((rule) => rule && rule.type === "merge_queue");
  if (queues.length === 0) return { method: null, reason: "no-merge-queue" };
  const active = queues.filter((rule) => {
    const ruleset = rulesetsById.get(rule.ruleset_id);
    if (!ruleset) return true;
    return ruleset.enforcement === "active";
  });
  if (active.length === 0) return { method: null, reason: "queue-not-active" };
  const methods = [
    ...new Set(
      active
        .map((rule) =>
          String(rule.parameters?.merge_method || "").toUpperCase(),
        )
        .filter(Boolean),
    ),
  ];
  if (methods.length !== 1)
    return { method: null, reason: "ambiguous-merge-method" };
  if (!["MERGE", "SQUASH", "REBASE"].includes(methods[0])) {
    return { method: null, reason: "unknown-merge-method" };
  }
  return { method: methods[0], reason: "ok" };
}

function errorMessages(payload) {
  if (!payload || !Array.isArray(payload.errors)) return [];
  return payload.errors
    .map((error) => error?.message)
    .filter((message) => typeof message === "string" && message.length > 0);
}

export function interpretEnableResult(payload) {
  if (payload?.data?.enablePullRequestAutoMerge?.pullRequest)
    return { ok: true, reason: "enabled" };
  const messages = errorMessages(payload);
  const text = messages.join("\n").toLowerCase();
  if (
    /already/.test(text) &&
    /auto[- ]?merge|automatically merge|merge queue/.test(text)
  ) {
    return { ok: true, reason: "already-enabled" };
  }
  if (/merge queue/.test(text) && /already/.test(text))
    return { ok: true, reason: "already-queued" };
  if (
    /not allowed|not permitted|allow auto-merge|auto merge is not allowed/.test(
      text,
    )
  ) {
    return { ok: false, reason: "allow-auto-merge-disabled", messages };
  }
  if (
    /not mergeable|merge conflict|cannot be merged|dirty|unstable/.test(text)
  ) {
    return { ok: true, reason: "not-mergeable", messages };
  }
  return { ok: false, reason: "enable-failed", messages };
}

export function interpretDisableResult(payload) {
  if (payload?.data?.disablePullRequestAutoMerge)
    return { ok: true, reason: "disabled" };
  const messages = errorMessages(payload);
  const text = messages.join("\n").toLowerCase();
  if (
    /not enabled|not set|isn't enabled|is not enabled|no auto-merge|already disabled/.test(
      text,
    )
  ) {
    return { ok: true, reason: "already-clear" };
  }
  return { ok: false, reason: "disable-failed", messages };
}

export function credentialsFromEnv(env) {
  const appId = Number(env.AVORO_BUILDER_APP_ID);
  const installationId = Number(env.AVORO_BUILDER_INSTALLATION_ID);
  const privateKey = env.AVORO_BUILDER_PRIVATE_KEY;
  const missing = [
    (!Number.isInteger(appId) || appId <= 0) && "AVORO_BUILDER_APP_ID",
    (!Number.isInteger(installationId) || installationId <= 0) &&
      "AVORO_BUILDER_INSTALLATION_ID",
    (typeof privateKey !== "string" || !privateKey.includes("PRIVATE KEY")) &&
      "AVORO_BUILDER_PRIVATE_KEY",
  ].filter(Boolean);
  return { missing, appId, installationId, privateKey };
}

export function buildAppJwt({ appId, privateKey, nowMs = Date.now() }) {
  const issuedAt = Math.floor(nowMs / 1000) - 60;
  const unsigned = `${Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url")}.${Buffer.from(JSON.stringify({ iat: issuedAt, exp: issuedAt + JWT_LIFETIME_SECONDS, iss: appId })).toString("base64url")}`;
  const signature = createSign("RSA-SHA256")
    .update(unsigned)
    .sign(privateKey, "base64url");
  return `${unsigned}.${signature}`;
}

export async function mintInstallationToken({
  appId,
  installationId,
  privateKey,
  repository,
  request,
}) {
  const jwt = buildAppJwt({ appId, privateKey });
  const response = await request(
    `${GITHUB_API}/app/installations/${installationId}/access_tokens`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${jwt}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        repositories: [repository],
        permissions: { pull_requests: "write", contents: "read" },
      }),
    },
  );
  if (!response.ok)
    throw new Error(`installation token mint failed: HTTP ${response.status}`);
  const minted = await response.json();
  if (typeof minted.token !== "string" || !minted.token.startsWith("ghs_")) {
    throw new Error("installation token mint returned no installation token");
  }
  return minted.token;
}

function repositoryParts(repository) {
  const match = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/.exec(repository ?? "");
  if (!match) throw new Error("REPOSITORY must be owner/name");
  return { owner: match[1], name: match[2] };
}

async function githubJson(request, token, path, init = {}) {
  const response = await request(
    path.startsWith("http") ? path : `${GITHUB_API}${path}`,
    {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...init.headers,
      },
    },
  );
  const text = await response.text();
  let body = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
  }
  return { status: response.status, ok: response.ok, body };
}

async function graphql(request, token, query, variables) {
  const response = await request(`${GITHUB_API}/graphql`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });
  const body = await response.json();
  return { status: response.status, ok: response.ok, body };
}

const ENABLE_QUERY = `mutation($id:ID!,$method:PullRequestMergeMethod!){
  enablePullRequestAutoMerge(input:{pullRequestId:$id,mergeMethod:$method}){
    pullRequest { number }
  }
}`;

const DISABLE_QUERY = `mutation($id:ID!){
  disablePullRequestAutoMerge(input:{pullRequestId:$id}){
    pullRequest { number }
  }
}`;

async function applyFetchedPull({ env, request, log, token, repository, pr }) {
  const headRepo = pr.head?.repo?.full_name ?? "";
  const decision = decide({
    draft: pr.draft === true,
    state: pr.state,
    baseRef: pr.base?.ref,
    defaultBranch: env.DEFAULT_BRANCH,
    labels: (pr.labels ?? []).map((label) => label.name),
    body: pr.body,
    sameRepository: headRepo === repository,
  });
  log(
    `auto-merge: ${decision.action} (${decision.reason}) for ${repository}#${pr.number}.`,
  );

  if (decision.action === "skip") return { ok: true, ...decision };

  const nodeId = pr.node_id;
  if (typeof nodeId !== "string" || nodeId.length === 0) {
    return { ok: false, reason: "missing-node-id" };
  }

  if (decision.action === "disable") {
    const disabled = await graphql(request, token, DISABLE_QUERY, {
      id: nodeId,
    });
    const result = interpretDisableResult(disabled.body);
    if (!result.ok)
      log(`auto-merge: disable failed: ${(result.messages ?? []).join(" | ")}`);
    else log(`auto-merge: ${result.reason}.`);
    return result;
  }

  const rulesResponse = await githubJson(
    request,
    token,
    `/repos/${repository}/rules/branches/${encodeURIComponent(pr.base.ref)}`,
  );
  if (rulesResponse.status === 403 || rulesResponse.status === 401) {
    log(
      [
        `auto-merge: could not read branch rules (HTTP ${rulesResponse.status}).`,
        "avoro-builder can write pull requests and read contents. It cannot read rulesets without Administration: Read.",
        "A human must grant the avoro-builder GitHub App Administration: Read (read-only), or grant this workflow's GITHUB_TOKEN administration: read, so the queue merge method can be read.",
        "Refusing to guess a merge method and refusing to enable auto-merge without a merge queue.",
      ].join(" "),
    );
    return {
      ok: false,
      reason: "rules-forbidden",
      status: rulesResponse.status,
    };
  }
  if (!rulesResponse.ok || !Array.isArray(rulesResponse.body)) {
    log(
      `auto-merge: branch rules request failed (HTTP ${rulesResponse.status}).`,
    );
    return {
      ok: false,
      reason: "rules-unreadable",
      status: rulesResponse.status,
    };
  }

  const rulesetsById = new Map();
  for (const rule of rulesResponse.body) {
    if (rule?.type !== "merge_queue" || rulesetsById.has(rule.ruleset_id))
      continue;
    const ruleset = await githubJson(
      request,
      token,
      `/repos/${repository}/rulesets/${rule.ruleset_id}`,
    );
    if (ruleset.ok && ruleset.body)
      rulesetsById.set(rule.ruleset_id, ruleset.body);
  }
  const selected = selectMergeMethod(rulesResponse.body, rulesetsById);
  if (!selected.method) {
    log(
      `auto-merge: not enabling (${selected.reason}). Direct auto-merge stays off when no active merge queue applies.`,
    );
    return { ok: true, action: "skip", reason: selected.reason };
  }

  const repoResponse = await githubJson(request, token, `/repos/${repository}`);
  if (repoResponse.ok && repoResponse.body?.allow_auto_merge === false) {
    log(
      "auto-merge: repository setting Allow auto-merge is off. An admin must enable Settings → General → Pull Requests → Allow auto-merge. This job will not change that setting.",
    );
    return { ok: false, reason: "allow-auto-merge-disabled" };
  }
  const methodFlag = {
    MERGE: "allow_merge_commit",
    SQUASH: "allow_squash_merge",
    REBASE: "allow_rebase_merge",
  }[selected.method];
  if (repoResponse.ok && repoResponse.body?.[methodFlag] === false) {
    log(
      `auto-merge: queue merge method ${selected.method} is disabled on this repository.`,
    );
    return { ok: false, reason: "merge-method-disabled" };
  }

  const enabled = await graphql(request, token, ENABLE_QUERY, {
    id: nodeId,
    method: selected.method,
  });
  const result = interpretEnableResult(enabled.body);
  if (!result.ok) {
    log(
      `auto-merge: enable failed (${result.reason}): ${(result.messages ?? []).join(" | ")}`,
    );
    if (result.reason === "allow-auto-merge-disabled") {
      log(
        "auto-merge: an admin must enable Settings → General → Pull Requests → Allow auto-merge.",
      );
    }
  } else {
    log(
      `auto-merge: ${result.reason} with ${selected.method}. Required checks are unchanged.`,
    );
  }
  return { ...result, method: selected.method };
}

function humanCredentialMessage(missing) {
  return [
    "Auto-merge was not changed.",
    `Missing ${missing.join(", ")}.`,
    "These already exist at the AvoroGlobal org (AvoroGlobal/keystone docs/agent-credentials.md): variable AVORO_BUILDER_APP_ID, variable AVORO_BUILDER_INSTALLATION_ID, secret AVORO_BUILDER_PRIVATE_KEY.",
    "A human must make that variable pair and that secret available to this repository's Actions.",
    "Do not create a new token. Public repositories need an org admin to allow those org credentials on public repositories.",
  ].join(" ");
}

export async function run({ env, request, log = console.log }) {
  const repository = env.REPOSITORY;
  const { name } = repositoryParts(repository);
  const credentials = credentialsFromEnv(env);
  if (credentials.missing.length) {
    log(humanCredentialMessage(credentials.missing));
    return {
      ok: false,
      reason: "missing-credentials",
      missing: credentials.missing,
    };
  }

  const token = await mintInstallationToken({
    appId: credentials.appId,
    installationId: credentials.installationId,
    privateKey: credentials.privateKey,
    repository: name,
    request,
  });
  if (env.GITHUB_ACTIONS === "true") log(`::add-mask::${token}`);

  if (env.ENROLL_OPEN === "true") {
    const numbers = [];
    for (let page = 1; page <= 10; page += 1) {
      const listed = await githubJson(
        request,
        token,
        `/repos/${repository}/pulls?state=open&base=${encodeURIComponent(env.DEFAULT_BRANCH)}&per_page=100&page=${page}`,
      );
      if (!listed.ok || !Array.isArray(listed.body)) {
        log(
          `auto-merge: could not list open pull requests (HTTP ${listed.status}).`,
        );
        return { ok: false, reason: "list-failed", status: listed.status };
      }
      numbers.push(...listed.body.map((pull) => pull.number));
      if (listed.body.length < 100) break;
    }
    const results = [];
    for (const number of numbers) {
      const listedPr = await githubJson(
        request,
        token,
        `/repos/${repository}/pulls/${number}`,
      );
      if (!listedPr.ok) {
        results.push({ ok: false, reason: "pr-unreadable", number });
        continue;
      }
      results.push(
        await applyFetchedPull({
          env,
          request,
          log,
          token,
          repository,
          pr: listedPr.body,
        }),
      );
    }
    log(
      `auto-merge: enrolled ${results.length} open pull request(s) targeting ${env.DEFAULT_BRANCH}.`,
    );
    return {
      ok: results.every((result) => result.ok),
      reason: "enrolled",
      results,
    };
  }

  const prNumber = Number(env.PR_NUMBER);
  if (!Number.isInteger(prNumber) || prNumber <= 0) {
    return { ok: false, reason: "bad-pr-number" };
  }

  const prResponse = await githubJson(
    request,
    token,
    `/repos/${repository}/pulls/${prNumber}`,
  );
  if (!prResponse.ok) {
    log(
      `auto-merge: could not read pull request ${prNumber} (HTTP ${prResponse.status}).`,
    );
    return { ok: false, reason: "pr-unreadable", status: prResponse.status };
  }
  return applyFetchedPull({
    env,
    request,
    log,
    token,
    repository,
    pr: prResponse.body,
  });
}

async function main() {
  try {
    const result = await run({ env: process.env, request: fetch });
    if (!result.ok) process.exitCode = 1;
  } catch (error) {
    process.stderr.write(
      `auto-merge: ${error instanceof Error ? error.message : "failed"}\n`,
    );
    process.exitCode = 1;
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await main();
}
