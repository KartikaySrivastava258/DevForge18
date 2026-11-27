# Support ticket triage

The college's IT and accounts office (fictional) receives every support ticket in one inbox. Someone reads each
one and forwards it — slowly, and refunds are sometimes paid because a ticket "sounded urgent". Build a workflow
that sorts tickets with a language model, sends them to the right queue, and never pays a refund without a person.

The starter workflow assigns everything to one queue and has the helpdesk API key typed into a node. Anyone who
can read the workflow file — or a Git repository it is committed to — has that key.

## The contract (the check relies on it)

`POST /webhook/support-ticket` with `{"ticket_id": "T-1001", "from": "asha@students.northfield.example", "subject": "…", "body": "…"}`.

1. **Validate** first: `ticket_id` (letters, digits, dashes), `from` (an e-mail address) and `subject` are
   required. Otherwise answer `400` with a reason — before calling the model or the helpdesk.
2. **Classify** with an AI Agent (v2.2) and an OpenAI Chat Model node, into `billing`, `technical`, `account` or
   `refund`. The model's answer is untrusted text: anything other than exactly one of those words — or a model
   that fails — means `needs-human`.
3. **Answer** `202` with JSON including `"category"`.
4. **Route**: `POST /tickets/<id>/assign` with `{"queue": …}` — billing → `billing`, technical → `it-support`,
   account → `accounts`, needs-human → `triage-desk`.
5. **Refunds** go to a person: `POST /approvals` with `{"ticket_id", "requester", "summary", "approve_url"}`,
   where `approve_url` is the execution's resume URL, then wait (at most 24 hours). The approver calls the URL
   with `{"decision": "approve" | "decline", "approver": "<e-mail>"}`. Only an approval by someone other than the
   requester leads to `POST /refunds` with `{"ticket_id", "approved_by"}`; anything else is recorded with
   `POST /tickets/<id>/notes` `{"text": …}`.
6. **No secrets in the file**: every helpdesk call uses a *Header Auth* credential (header `X-API-Key`), and the
   model node an *OpenAI* credential. The exported JSON then holds only the credentials' ids and names.

## The services (stand-ins, inside the n8n container)

`stubs/helpdesk-and-model.js <key>` starts the helpdesk API on 127.0.0.1:9000 (it refuses calls without
`X-API-Key: <key>`) and a stand-in OpenAI-compatible model on 127.0.0.1:9100. The model is no classifier: it
picks a category from keywords, and it obeys a line `category: …` in a ticket, as a prompt-injected model might.

## Run it

Start n8n as in "Workflows, nodes and items" (`devforge-n8n`, port 5678), then:

```bash
docker cp stubs/helpdesk-and-model.js devforge-n8n:/tmp/
docker exec -d devforge-n8n node /tmp/helpdesk-and-model.js lab-only-helpdesk-key
```

In the editor create two credentials: *Header Auth* named "Helpdesk API" (name `X-API-Key`, value
`lab-only-helpdesk-key`) and *OpenAI* named "Triage model" (any API key, base URL `http://127.0.0.1:9100/v1`).
Build and publish the workflow, send tickets with `curl`, export it back into `triage.json`, and run
`bash check.sh .` — the check creates its own credentials with the ids your file refers to, and a key only it knows.
