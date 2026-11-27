# Student event registration

The student council of Northfield College (fictional) takes registrations for its events through a web form.
Today every submission is copied into a spreadsheet by hand: names have stray spaces, the same student appears
three times, and nobody gets a confirmation. Build the n8n workflow behind the form.

## The contract (the check relies on it)

The form sends `POST /webhook/event-registration` with JSON:

```json
{ "name": "Asha Rao", "email": "asha.rao@students.northfield.example", "roll_number": "NF23CS014", "event": "hackathon" }
```

| Situation | Answer | Side effects |
|---|---|---|
| Valid, new | `201` and JSON | one record saved, one confirmation e-mail |
| `name` or `roll_number` missing, `email` not an address, `event` not one of `hackathon`, `robotics-workshop`, `career-fair` | `400` and a JSON reason | nothing — no service is called |
| Same e-mail already registered for the same event | `409` and JSON | nothing saved, no e-mail |
| The registrations service fails | `503` and a JSON message | no e-mail |

Normalise before you compare or save: trim every field, e-mail and event in lower case, roll number in capitals.

## The services (stand-ins, on 127.0.0.1:9000 inside the n8n container)

`stubs/registration-services.js` plays the college's registration store and mail API:

- `GET /registrations?event=…&email=…` → `{"count": n, "registrations": [...]}`
- `POST /registrations` with the record as JSON → `201`
- `POST /mail` with `{"to", "subject", "text"}` → `202`

## Run it

Start n8n as in "Workflows, nodes and items" (`devforge-n8n`, port 5678), then run the stand-in inside it:

```bash
docker cp stubs/registration-services.js devforge-n8n:/tmp/
docker exec -d devforge-n8n node /tmp/registration-services.js
```

Import `registration.json` (in the editor: Import from File), build the workflow, publish it, and try it with
`curl -X POST http://127.0.0.1:5678/webhook/event-registration -H 'Content-Type: application/json' -d '{…}'`.
Export it back into `registration.json` (in the editor: Download; or
`n8n export:workflow --id=<id> --output=/tmp/registration.json` inside the container), then run
`bash check.sh .`.
