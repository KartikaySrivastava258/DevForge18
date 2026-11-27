# n8n — research notes

Checked 2026-11-27 (UTC). Reuse these in lessons; add to them instead of researching again.

## Versions

| Component | Version | Notes |
|---|---|---|
| `n8nio/n8n` | 2.49.6 `@sha256:a1a9955a…` | Node 24 inside; no `curl` (use `node -e "fetch(…)"`); data in `/home/node/.n8n` |
| Node types used | httpRequest 4.2, splitOut 1, set 3.4, wait 1.1, code 2, webhook 2, respondToWebhook 1.1, langchain agent **2.2**, lmChatOpenAi 1.3, toolCode 1.3 | read from the node definitions in the image |

## Facts confirmed (source → wording)

- Monitoring (docs.n8n.io/hosting/logging-monitoring/monitoring/): `/healthz` "doesn't indicate DB status"; `/healthz/readiness` returns 200 "if the DB is connected and migrated".
- HTTP Request node: pagination variables `$pageCount`, `$request`, `$response` (body, headers, statusCode). JSON: `options.pagination.pagination` with `paginationMode: updateAParameterInEachRequest`, `parameters.parameters[]` (type qs/headers/body), `paginationCompleteWhen: other`, `completeExpression`.
- Wait node: resume on webhook/form; Limit Wait Time (`limitWaitTime`, `limitType: afterTimeInterval`, `resumeAmount`, `resumeUnit`); while waiting the execution is offloaded to the database and reloaded.
- Encryption key: generated on first launch and saved in `~/.n8n`; used to encrypt credentials; set `N8N_ENCRYPTION_KEY` (on every worker in queue mode).
- Security audit: `n8n audit` (CLI), POST /audit (public API, owner), or the n8n node; reports credentials, database, nodes, filesystem, instance.
- Blocking nodes: `NODES_EXCLUDE` stops a node loading; Execute Command is blocked by default.
- Tools Agent options: System Message, Max Iterations (default 10), Return Intermediate Steps.

## Observed while building lessons

- The CLI started while the server was still migrating crashed n8n ("index IDX_skill_source_identityKey_projectId already exists") — wait for `/healthz/readiness`. This was the cause of earlier unexplained CI failures.
- `--rawOutput` on a failed execution prints the JSON followed by "Error executing workflow…"; parse up to that line.
- HTTP 429 from an API → n8n error "The service is receiving too many requests from you"; node settings `retryOnFail`, `maxTries`, `waitBetweenTries` sit next to `parameters`.
- A resume-URL call before the execution is saved as waiting gets **409**; retry.
- On a Wait time-out, the node passes on the item it received (the original request), not an empty item.
- `publish:workflow` → "A running n8n applies this change shortly"; a GET to a POST-only webhook answers 404 "This webhook is not registered for GET requests. Did you mean to make a POST request?" once it exists.
- Credentials export without `--decrypted` shows `"data":"U2FsdGVkX1…"`; with a different `N8N_ENCRYPTION_KEY` the container exits 1 with "Mismatching encryption keys…".
- Execute Command in a workflow → "Unrecognized node type: n8n-nodes-base.executeCommand".
- The audit's instance report includes "Outdated instance", which depends on a version check — don't print it in executed output.
- AI Agent: with the OpenAI credential's `url` pointing at a chat-completions stand-in and `responsesApiEnabled: false`, the agent works. Agent **3.1** run from the CLI sent the tool result to the model as an empty string; **2.2** works. Code Tool input arrives as the `query` object.
- Max Iterations stops the agent with the output "Agent stopped due to max iterations." — after the tool has run each time.
