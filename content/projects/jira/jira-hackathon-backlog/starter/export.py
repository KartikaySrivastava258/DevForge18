"""Export a Jira project's work items to export.json, for check.sh.

Uses Jira Cloud's REST API v3 enhanced search (GET /rest/api/3/search/jql) with basic authentication —
your Atlassian account email and an API token (create one at https://id.atlassian.com/manage-profile/security/api-tokens).
Never commit the token: pass it in an environment variable.

    export JIRA_SITE=https://your-team.atlassian.net
    export JIRA_EMAIL=you@college.example
    export JIRA_API_TOKEN=...          # from your Atlassian account settings
    python3 export.py DEV              # DEV = your project's key; writes export.json

Python 3 standard library only.
"""

import base64
import json
import os
import sys
import urllib.parse
import urllib.request

FIELDS = "summary,issuetype,status,parent,labels,priority,fixVersions,description,created"


def fetch_page(site, auth, jql, token):
    query = {"jql": jql, "fields": FIELDS, "expand": "names,changelog", "maxResults": "100"}
    if token:
        query["nextPageToken"] = token
    request = urllib.request.Request(
        f"{site.rstrip('/')}/rest/api/3/search/jql?{urllib.parse.urlencode(query)}",
        headers={"Authorization": f"Basic {auth}", "Accept": "application/json"},
    )
    with urllib.request.urlopen(request, timeout=60) as response:
        return json.load(response)


def main(argv):
    if len(argv) != 2:
        print(__doc__.strip())
        return 2
    site, email, api_token = (os.environ.get(k) for k in ("JIRA_SITE", "JIRA_EMAIL", "JIRA_API_TOKEN"))
    if not (site and email and api_token):
        print("Set JIRA_SITE, JIRA_EMAIL and JIRA_API_TOKEN first (see the top of this file).", file=sys.stderr)
        return 2
    auth = base64.b64encode(f"{email}:{api_token}".encode()).decode()
    jql = f"project = {argv[1]} ORDER BY key ASC"
    issues, names, token = [], {}, None
    while True:
        page = fetch_page(site, auth, jql, token)
        issues.extend(page.get("issues", []))
        names.update(page.get("names", {}))
        token = page.get("nextPageToken")
        if not token:  # the last page has no nextPageToken
            break
    with open("export.json", "w", encoding="utf-8") as f:
        json.dump({"issues": issues, "names": names}, f, indent=2)
    print(f"Wrote export.json: {len(issues)} work items.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
