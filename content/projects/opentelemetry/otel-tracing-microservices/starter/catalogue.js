// The catalogue service: GET /items returns the products the canteen sells today.
const http = require("node:http");

const PRODUCTS = [
  { id: 1, name: "Masala dosa", price: 60 },
  { id: 2, name: "Veg thali", price: 100 },
  { id: 3, name: "Chai", price: 15 },
];

function loadProducts() {
  // Stands in for a database query.
  return PRODUCTS.filter((p) => p.price > 0);
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
