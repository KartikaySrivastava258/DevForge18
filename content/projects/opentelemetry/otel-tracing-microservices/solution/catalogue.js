// The catalogue service: GET /items returns the products the canteen sells today.
const http = require("node:http");
const { trace } = require("@opentelemetry/api");

const tracer = trace.getTracer("catalogue");
const PRODUCTS = [
  { id: 1, name: "Masala dosa", price: 60 },
  { id: 2, name: "Veg thali", price: 100 },
  { id: 3, name: "Chai", price: 15 },
];

function loadProducts() {
  // A manual span for the work inside the service, as a child of the HTTP server span that the
  // instrumentation created for this request (startActiveSpan picks up the active context).
  return tracer.startActiveSpan("load products", (span) => {
    try {
      const items = PRODUCTS.filter((p) => p.price > 0); // stands in for a database query
      span.setAttribute("products.count", items.length);
      return items;
    } finally {
      span.end();
    }
  });
}

http
  .createServer((req, res) => {
    if (req.method === "GET" && req.url === "/items") {
      const items = loadProducts();
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(items));
      return;
    }
    res.writeHead(404).end();
  })
  .listen(8081, () => console.log("catalogue listening on 8081"));
