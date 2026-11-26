---
id: github-actions-oidc-cloud-access
title: OIDC — cloud access without long-lived secrets
track: github-actions
order: 7
level: advanced
estimated_minutes: 45
prerequisites: [github-actions-caching-and-artifacts]
learning_objectives:
  - Explain how a workflow exchanges GitHub's short-lived OIDC token for temporary cloud credentials, and why that beats storing access keys.
  - Read the claims of an OIDC token (iss, aud, sub) and predict the subject for branches, environments and pull requests.
  - Write trust conditions that admit exactly one repository and environment, and show how a loose wildcard admits too much.
  - Configure a workflow job with id-token write permission and aws-actions/configure-aws-credentials.
resources:
  - title: OpenID Connect (concepts)
    url: https://docs.github.com/en/actions/concepts/security/openid-connect
    publisher: GitHub
    type: documentation
    level: advanced
    official: true
    why: Workflows exchange short-lived tokens with the cloud, which checks the token's subject and other claims against the role's trust conditions.
    verification: { status: verified, checked_on: 2026-11-26 }
  - title: OpenID Connect reference (claims and subject formats)
    url: https://docs.github.com/en/actions/reference/security/oidc
    publisher: GitHub
    type: reference
    level: advanced
    official: true
    why: Claims such as iss, aud and sub; subject formats like repo:ORG/REPO:environment:NAME, and the pull_request subject used only when the job has no environment.
    verification: { status: verified, checked_on: 2026-11-26 }
  - title: Configuring OpenID Connect in Amazon Web Services
    url: https://docs.github.com/en/actions/how-tos/secure-your-work/security-harden-deployments/oidc-in-aws
    publisher: GitHub
    type: documentation
    level: advanced
    official: true
    why: permissions id-token write (it only allows requesting the token), and AWS's recommendation to evaluate token.actions.githubusercontent.com:sub in the trust policy.
    verification: { status: verified, checked_on: 2026-11-26 }
  - title: IAM condition operators (StringEquals, StringLike)
    url: https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_elements_condition_operators.html
    publisher: Amazon Web Services
    type: reference
    level: advanced
    official: true
    why: StringLike is case-sensitive and supports * (any characters) and ? (one character) anywhere in the value.
    verification: { status: verified, checked_on: 2026-11-26 }
  - title: aws-actions/configure-aws-credentials
    url: https://github.com/aws-actions/configure-aws-credentials
    publisher: Amazon Web Services
    type: source-code
    level: advanced
    official: true
    why: Exchanges the OIDC token for temporary credentials (role-to-assume); its audience input defaults to sts.amazonaws.com.
    verification: { status: verified, checked_on: 2026-11-26 }
self_check:
  - id: why-oidc
    prompt: What does OIDC remove compared with storing an AWS access key as a repository secret?
    options:
      - { id: a, text: "Nothing, it is the same key" }
      - { id: b, text: "The long-lived key: each job gets credentials that expire within hours, only if the token's claims match the role's conditions — nothing to leak, rotate or forget" }
      - { id: c, text: "The need for a cloud account" }
    answer: b
    explanation: A leaked access key works until someone revokes it; a leaked temporary credential expires on its own, and the role can only be assumed from the workflows its conditions name.
  - id: subject
    prompt: A job in repository asha-rao/course-site has environment production. What is its token's sub claim?
    options:
      - { id: a, text: "asha-rao" }
      - { id: b, text: "repo:asha-rao/course-site:environment:production" }
      - { id: c, text: "repo:asha-rao/course-site:ref:refs/heads/main, always" }
    answer: b
    explanation: When a job references an environment, the subject names the environment instead of the branch — which is why trust conditions can require the protected production environment.
  - id: wildcard
    prompt: A trust condition says sub StringLike "repo:asha-rao/*". Which workflows can assume the role?
    options:
      - { id: a, text: "Only course-site's production deployments" }
      - { id: b, text: "Any workflow in any repository of asha-rao, on any branch, environment or pull request — far wider than intended" }
      - { id: c, text: "None, wildcards are not allowed" }
    answer: b
    explanation: The lab shows the wildcard admitting a pull request from another repository. Match the exact subject (StringEquals) wherever you can.
verification:
  method: executed
  details: The local commands — building example tokens with GitHub's documented claim names (they are unsigned examples, not real tokens), decoding them, and evaluating trust conditions with StringEquals and StringLike semantics as AWS documents them — run in the test suite and their output is compared with this lesson. A real cloud also verifies the token's signature against GitHub's published keys, which the lab does not model. The workflow is validated by DevForge's workflow checker; claims, subject formats and the AWS setup were checked against GitHub and AWS documentation on 2026-11-26.
owner: content-team
last_reviewed: 2026-11-26
content_version: 1
---

## The idea in one sentence

Instead of storing a cloud access key in GitHub, a job asks GitHub for a short-lived, signed **OIDC token** describing exactly which repository, branch or environment it runs for, and the cloud swaps it for **temporary credentials** — but only if those **claims** match the role's **trust conditions**.

## Explain it like I'm twelve

Instead of giving the delivery driver a copy of the school's front-door key (a stored secret), the driver shows a badge printed this morning by the delivery company, saying "driver for Course-Site Deliveries, route production, valid until 11:00". The caretaker checks the badge's details against a list ("only Course-Site, only the production route") and lets them in for that delivery only.

Where the analogy breaks: the caretaker also checks the badge's tamper-proof stamp — the token's signature — which a forger cannot copy.

## What problem it solves

Long-lived cloud keys in repository secrets are a favourite target: they leak through logs, forks and compromised dependencies, and stay valid until someone notices. With OIDC there is no stored key at all. Credentials last minutes to hours, and the cloud decides per job whether this repository and environment may have them.

## How it works

![](media:github-actions/oidc.svg)

- The job needs `permissions: id-token: write` — which only lets it *request* a token, not change anything.
- GitHub's issuer `https://token.actions.githubusercontent.com` signs a JWT with claims such as `iss`, `aud` (for AWS, `sts.amazonaws.com`), `sub` (`repo:ORG/REPO:environment:production`, or `…:ref:refs/heads/main`, or `…:pull_request` when the job has no environment) and more (`repository`, `ref`, `environment`).
- `aws-actions/configure-aws-credentials` sends the token to AWS STS with `role-to-assume`. AWS checks the signature and the role's **trust policy** conditions — typically `StringEquals` on `aud` and on `token.actions.githubusercontent.com:sub` — and returns temporary credentials.
- `StringLike` allows `*` and `?` wildcards: convenient, and the most common way to trust too much.

## Try it yourself

> **Local lab** — needs Node.js, as in the earlier lessons. The tokens are **examples** built with GitHub's documented claim names and no real signature; real tokens exist only inside a running GitHub job. Every command is run automatically in DevForge's tests.

### 1. Example tokens and what is inside them

```bash run
mkdir -p oidc-lab && cd oidc-lab
cat > token.mjs <<'EOF'
// Builds an EXAMPLE token with GitHub's claim names (no valid signature): node token.mjs REPO KIND VALUE
const [repo, kind, value] = process.argv.slice(2);
const sub = kind === "pull_request" ? `repo:${repo}:pull_request` : `repo:${repo}:${kind}:${value}`;
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const claims = { iss: "https://token.actions.githubusercontent.com", aud: "sts.amazonaws.com", sub, repository: repo };
console.log(`${b64({ alg: "RS256", typ: "JWT" })}.${b64(claims)}.example-signature-not-valid`);
EOF
node token.mjs asha-rao/course-site environment production > prod.jwt
node token.mjs asha-rao/course-site ref refs/heads/main > main.jwt
node token.mjs asha-rao/course-site pull_request > pr.jwt
node token.mjs asha-rao/old-experiment pull_request > other-repo.jwt
# A JWT is header.payload.signature; the payload is base64url-encoded JSON.
for t in prod main pr other-repo; do
  printf '%-11s sub = %s\n' "$t" "$(cut -d. -f2 "$t.jwt" | node -e 'process.stdin.on("data", (d) => console.log(JSON.parse(Buffer.from(String(d).trim(), "base64url")).sub))')"
done
```

```text output
prod        sub = repo:asha-rao/course-site:environment:production
main        sub = repo:asha-rao/course-site:ref:refs/heads/main
pr          sub = repo:asha-rao/course-site:pull_request
other-repo  sub = repo:asha-rao/old-experiment:pull_request
```

Anyone can *read* a JWT's claims — they are only encoded. What makes a real one trustworthy is GitHub's signature, which the cloud verifies before looking at the claims.

### 2. Trust conditions, evaluated like AWS does

```bash run
cat > trust.mjs <<'EOF'
// Evaluates trust conditions against a token's claims: StringEquals (exact) and StringLike (* and ? wildcards).
// Usage: node trust.mjs POLICY.json TOKEN.jwt   (models the condition check only, not signature verification)
import { readFileSync } from "node:fs";
const [policyFile, tokenFile] = process.argv.slice(2);
const conditions = JSON.parse(readFileSync(policyFile, "utf8"));
const claims = JSON.parse(Buffer.from(readFileSync(tokenFile, "utf8").trim().split(".")[1], "base64url"));
const like = (pattern, value) => new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".")}$`).test(value);
const ok = Object.entries(conditions).every(([op, keys]) =>
  Object.entries(keys).every(([key, expected]) => {
    const value = claims[key.split(":").at(-1)];
    const options = [expected].flat();
    return op === "StringEquals" ? options.includes(value) : options.some((p) => like(p, value));
  }));
console.log(ok ? "ALLOW" : "DENY");
EOF
cat > strict.json <<'EOF'
{
  "StringEquals": {
    "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
    "token.actions.githubusercontent.com:sub": "repo:asha-rao/course-site:environment:production"
  }
}
EOF
cat > loose.json <<'EOF'
{
  "StringEquals": { "token.actions.githubusercontent.com:aud": "sts.amazonaws.com" },
  "StringLike": { "token.actions.githubusercontent.com:sub": "repo:asha-rao/*" }
}
EOF
for policy in strict loose; do
  echo "$policy: prod $(node trust.mjs $policy.json prod.jwt), main $(node trust.mjs $policy.json main.jwt), pr $(node trust.mjs $policy.json pr.jwt), other-repo $(node trust.mjs $policy.json other-repo.jwt)"
done
```

```text output
strict: prod ALLOW, main DENY, pr DENY, other-repo DENY
loose: prod ALLOW, main ALLOW, pr ALLOW, other-repo ALLOW
```

- The **strict** policy admits only production deployments of `course-site` — and since the `production` environment has required reviewers, only approved ones.
- The **loose** wildcard admits every branch, every pull request and every other repository of the account owner. A pull request that adds a malicious step could deploy to production.

### 3. The workflow job

```bash run
mkdir -p .github/workflows
cat > .github/workflows/deploy-aws.yml <<'EOF'
name: Deploy to AWS

on:
  push:
    branches: [main]

permissions:
  contents: read

jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: production          # gives the token sub repo:OWNER/REPO:environment:production
    permissions:
      contents: read
      id-token: write                # lets this job request an OIDC token; changes nothing by itself
    steps:
      - uses: actions/checkout@v7
      - name: Temporary AWS credentials from the OIDC token
        uses: aws-actions/configure-aws-credentials@v6
        with:
          role-to-assume: arn:aws:iam::123456789012:role/course-site-deploy
          role-session-name: course-site-${{ github.run_id }}
          aws-region: eu-west-1
      - name: Use them
        run: aws sts get-caller-identity
EOF
grep -cE 'secrets\.|AWS_SECRET_ACCESS_KEY' .github/workflows/deploy-aws.yml || true
```

```text output
0
```

No secret anywhere in the workflow. The role's ARN is not secret either: without a token that matches its trust conditions, nobody can assume it. (The account number above is a documentation placeholder.)

## Common mistakes

- **Wildcards in `sub`.** `repo:org/*` trusts every repository and pull request in the organisation. Name the repository and environment exactly.
- **Not checking `aud`.** Always require the expected audience, as the strict policy does.
- **`id-token: write` for the whole workflow.** Grant it to the one job that needs cloud access.
- **Trusting branches instead of environments.** A `ref:refs/heads/main` condition skips your environment's reviewers; an `environment:production` condition requires them.
- **Keeping the old access keys "just in case".** Delete them once OIDC works, or the risk remains.

## Where this fits in a real system

The same pattern works with Azure, Google Cloud and HashiCorp Vault, each with its own trust configuration. **Terraform** usually creates the identity provider and roles; the image and deployment workflows of the previous lessons use the temporary credentials to push and deploy; and **Kubernetes** uses the same idea (projected service account tokens) for workload identity.
