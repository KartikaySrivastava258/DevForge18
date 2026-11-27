"""Figure for n8n-calling-apis-and-mapping; run: python3 scripts/figures/n8n/api-mapping.py"""
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "scripts" / "figures"))
from figlib import Fig, write  # noqa: E402

f = Fig(720, 300, "Fetch, split and map, from Calling APIs and mapping data in depth.")
f.box(10, 40, 200, 120, "f-box-accent"); f.text(110, 64, "HTTP Request", "f-small f-strong")
f.text(110, 88, "page = $pageCount + 1", "f-small f-mono", fit=190); f.text(110, 108, "until next_page = null", "f-small f-mono", fit=190); f.text(110, 132, "retry on 429", "f-small")
f.box(260, 40, 200, 120, "f-box-accent"); f.text(360, 64, "Split Out", "f-small f-strong")
f.text(360, 92, "2 page items", "f-small"); f.text(360, 112, "→ 3 customer items", "f-small", fit=190)
f.box(510, 40, 200, 120, "f-box-ok"); f.text(610, 64, "Edit Fields", "f-small f-strong")
f.text(610, 88, "first + last → customer", "f-small", fit=190); f.text(610, 108, "city ?? 'unknown'", "f-small f-mono", fit=190); f.text(610, 128, "Number(total) → spent", "f-small f-mono", fit=190)
f.arrow([(212, 100), (258, 100)]); f.arrow([(462, 100), (508, 100)])
f.box(10, 200, 700, 70, "f-box-faint")
f.text(360, 226, "{\"customer\":\"Meera Das\",\"city\":\"unknown\",\"orders\":1,\"spent\":300}", "f-small f-mono", fit=680)
f.text(360, 250, "one flat, predictable item per record, whatever the API's shape", "f-small", fit=680)
write(ROOT, "n8n", "api-mapping", f,
      "The HTTP Request node sets the page parameter to $pageCount plus 1 until next_page is null, and retries on HTTP 429. Split Out turns the two page items into three customer items. Edit Fields joins first and last name into customer, defaults a missing city to unknown and converts order totals with Number before adding them into spent. The result is one flat, predictable item per record, for example customer Meera Das, city unknown, 1 order, 300 spent.",
      "Paginate, split, then map each record to the shape the next step needs.")
