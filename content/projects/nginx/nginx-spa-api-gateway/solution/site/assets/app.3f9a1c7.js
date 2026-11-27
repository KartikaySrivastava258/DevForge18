// Campus Store frontend (built bundle; the hash in the file name changes whenever the content changes).
// A tiny router: the browser's address decides which view is shown, so /orders/42 is a page of the app,
// not a file on the server. The API lives under /api/v1/.
(function () {
  "use strict";
  var app = document.getElementById("app");

  function escapeHtml(text) {
    return String(text).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function render(title, body) {
    app.innerHTML = "<h1>" + escapeHtml(title) + "</h1><div class=\"view\">" + body + "</div>";
  }

  function showText(title, url) {
    render(title, "<p>Loading…</p>");
    fetch(url, { headers: { Accept: "application/json" } })
      .then(function (response) { return response.text().then(function (text) { return { status: response.status, text: text }; }); })
      .then(function (result) { render(title, "<p>HTTP " + result.status + "</p><pre>" + escapeHtml(result.text) + "</pre>"); })
      .catch(function (error) { render(title, "<p class=\"error\">" + escapeHtml(error.message) + "</p>"); });
  }

  var routes = [
    { pattern: /^\/$/, view: function () { render("Campus Store", "<p>Notebooks, lab coats and hoodies for the new term.</p><p><a href=\"/orders/42\">Order 42</a> · <a href=\"/account\">My account</a></p>"); } },
    { pattern: /^\/orders\/(\d+)$/, view: function (m) { showText("Order " + m[1], "/api/v1/orders/" + m[1]); } },
    { pattern: /^\/account$/, view: function () { showText("My account", "/api/v1/users/me"); } }
  ];

  function route() {
    var path = window.location.pathname;
    for (var i = 0; i < routes.length; i++) {
      var match = path.match(routes[i].pattern);
      if (match) return routes[i].view(match);
    }
    render("Not found", "<p>There is no page at " + escapeHtml(path) + ".</p><p><a href=\"/\">Back to the store</a></p>");
  }

  document.addEventListener("click", function (event) {
    var link = event.target.closest("a");
    if (!link || link.origin !== window.location.origin) return;
    event.preventDefault();
    window.history.pushState(null, "", link.pathname);
    route();
  });
  window.addEventListener("popstate", route);
  route();
})();
