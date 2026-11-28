// k6 load test of the DevForge API. Run it through scripts/load-test.sh (npm run test:load), which starts the
// production server on a throwaway database; see docs/load-testing.md for the measured results.
//
// Three groups of virtual users run at the same time:
//   browse   — anonymous visitors: app shell, catalogue, a track, a lesson, search, paths, graph (1–3 s think time)
//   learners — signed-in students: sign in once, then read a lesson, check its self-check, open the dashboard data
//   signin   — a steady stream of sign-ins (scrypt password verification is the most expensive request)
//
// Every virtual user sends its own X-Forwarded-For address (the server runs with TRUST_PROXY=true), standing for a
// different student behind the production Nginx proxy, so that the server's capacity is measured rather than the
// per-address limits (6,000 API requests a minute and 200 sign-ins per 15 minutes by default).
//
// SHARED_ADDRESS=10.0.0.1 instead sends every request of the scenarios from that one address: a classroom behind
// one NAT address, which the per-address limits must let through (docs/deployment.md, "Rate limits").
//
// Environment: BASE_URL, BROWSE_VUS (default 50), LEARNER_VUS (20), SIGNIN_RATE (sign-ins per second, 2),
// DURATION (steady phase, default "2m"), SHARED_ADDRESS (unset). A scenario set to 0 is left out.
import http from "k6/http";
import { check, fail, sleep } from "k6";
import { SharedArray } from "k6/data";

const BASE = __ENV.BASE_URL || "http://127.0.0.1:18090";
const BROWSE_VUS = Number(__ENV.BROWSE_VUS || 50);
const LEARNER_VUS = Number(__ENV.LEARNER_VUS || 20);
const SIGNIN_RATE = Number(__ENV.SIGNIN_RATE || 2);
const DURATION = __ENV.DURATION || "2m";
const SHARED_ADDRESS = __ENV.SHARED_ADDRESS || "";
const PASSWORD = "load-test password 2026";

const TRACKS = ["docker", "kubernetes", "git-github", "postgresql", "redis", "nginx", "kafka", "terraform"];
const LESSONS = new SharedArray("lessons", () => [
  "docker-images-vs-containers",
  "docker-volumes-and-bind-mounts",
  "kubernetes-services-and-rollouts",
  "git-first-commits",
  "postgresql-tables-and-constraints",
]);
const QUERIES = ["docker", "kubernets", "cache", "pipeline", "sql index", "observability"];

export const options = {
  noCookiesReset: true, // a signed-in learner keeps its session cookie across iterations, like a browser
  scenarios: Object.fromEntries(
    Object.entries({
      browse: BROWSE_VUS > 0 && {
        executor: "ramping-vus",
        exec: "browse",
        startVUs: 0,
        stages: [
          { duration: "20s", target: BROWSE_VUS },
          { duration: DURATION, target: BROWSE_VUS },
          { duration: "10s", target: 0 },
        ],
        gracefulRampDown: "5s",
      },
      learners: LEARNER_VUS > 0 && {
        executor: "ramping-vus",
        exec: "learn",
        startVUs: 0,
        stages: [
          { duration: "20s", target: LEARNER_VUS },
          { duration: DURATION, target: LEARNER_VUS },
          { duration: "10s", target: 0 },
        ],
        gracefulRampDown: "5s",
      },
      signin: SIGNIN_RATE > 0 && {
        executor: "constant-arrival-rate",
        exec: "signIn",
        rate: SIGNIN_RATE,
        timeUnit: "1s",
        startTime: "20s",
        duration: DURATION,
        preAllocatedVUs: 10,
        maxVUs: 50,
      },
    }).filter(([, scenario]) => scenario),
  ),
  // Limits from the measured runs in docs/load-testing.md (default load, 2026-11-27: browse p95 12.8 ms, learners
  // p95 11.6 ms, sign-in p95 1.05 s, 0 errors), with headroom for slower CI runners: 8-17x for reads, 2x for
  // sign-in (scrypt is CPU-bound, so it scales with the CPU, not with the noise). A breach fails the run.
  thresholds: {
    http_req_failed: ["rate<0.01"],
    checks: ["rate>0.99"],
    "http_req_duration{scenario:browse}": ["p(95)<100"],
    "http_req_duration{scenario:learners}": ["p(95)<200"],
    "http_req_duration{name:POST /api/auth/login}": ["p(95)<2000"],
  },
  summaryTrendStats: ["avg", "med", "p(90)", "p(95)", "p(99)", "max"],
};

/** A distinct private address per virtual user (and per sign-in), as seen through the trusted proxy; or SHARED_ADDRESS. */
function addressFor(n) {
  return SHARED_ADDRESS || `10.${(n >> 16) & 255}.${(n >> 8) & 255}.${n & 255}`;
}

function headers(ip, extra = {}) {
  return { "X-Forwarded-For": ip, ...extra };
}

function postHeaders(ip) {
  return headers(ip, { "Content-Type": "application/json", "X-DevForge-CSRF": "1", Origin: BASE });
}

const pick = (list) => list[Math.floor(Math.random() * list.length)];

// Accounts are created once, before the load starts, each from its own address (registration is limited per address).
export function setup() {
  const accounts = [];
  for (let i = 0; i < LEARNER_VUS; i++) {
    const email = `load-${Date.now()}-${i}@example.com`;
    const res = http.post(`${BASE}/api/auth/register`, JSON.stringify({ email, displayName: `Load ${i}`, password: PASSWORD }), {
      headers: postHeaders(`172.16.${i >> 8}.${i & 255}`),
    });
    if (res.status !== 201) fail(`registration failed: ${res.status} ${res.body}`);
    accounts.push(email);
  }
  // The hashed script name changes with every build; read it from the app shell like a browser would.
  const shell = http.get(`${BASE}/`);
  const script = /src="(\/assets\/[^"]+\.js)"/.exec(shell.body || "");
  if (!script) fail("app shell does not reference a script");
  return { accounts, script: script[1] };
}

let firstIteration = true;

export function browse(data) {
  const ip = addressFor(__VU);
  const h = { headers: headers(ip) };
  const track = pick(TRACKS);
  if (firstIteration) {
    // A first visit downloads the app; later visits use the browser cache (hashed assets are immutable).
    const asset = http.get(`${BASE}${data.script}`, { ...h, tags: { name: "GET /assets/app.js" } });
    check(asset, { "asset 200": (r) => r.status === 200 });
    firstIteration = false;
  }
  const responses = [
    http.get(`${BASE}/tracks/${track}`, { ...h, tags: { name: "GET /tracks/:slug (app shell)" } }),
    http.get(`${BASE}/api/tracks`, { ...h, tags: { name: "GET /api/tracks" } }),
    http.get(`${BASE}/api/tracks/${track}`, { ...h, tags: { name: "GET /api/tracks/:slug" } }),
    http.get(`${BASE}/api/lessons/${pick(LESSONS)}`, { ...h, tags: { name: "GET /api/lessons/:id" } }),
    http.get(`${BASE}/api/search?q=${encodeURIComponent(pick(QUERIES))}`, { ...h, tags: { name: "GET /api/search" } }),
    http.get(`${BASE}/api/paths`, { ...h, tags: { name: "GET /api/paths" } }),
    http.get(`${BASE}/api/graph`, { ...h, tags: { name: "GET /api/graph" } }),
  ];
  for (const r of responses) check(r, { "browse 200": (res) => res.status === 200 });
  sleep(1 + Math.random() * 2);
}

let signedIn = false;

export function learn(data) {
  const ip = addressFor(100000 + __VU);
  if (!signedIn) {
    const email = data.accounts[__VU % data.accounts.length];
    const res = http.post(`${BASE}/api/auth/login`, JSON.stringify({ email, password: PASSWORD }), {
      headers: postHeaders(ip),
      tags: { name: "POST /api/auth/login" },
    });
    if (!check(res, { "learner signed in": (r) => r.status === 200 })) {
      sleep(1);
      return;
    }
    signedIn = true;
  }
  const id = pick(LESSONS);
  const lesson = http.get(`${BASE}/api/lessons/${id}`, { headers: headers(ip), tags: { name: "GET /api/lessons/:id" } });
  check(lesson, { "lesson 200": (r) => r.status === 200 });
  sleep(2 + Math.random() * 2); // reading
  const questions = lesson.status === 200 ? lesson.json("lesson.selfCheck") : [];
  const answers = {};
  for (const q of questions) answers[q.id] = pick(q.options).id;
  const graded = http.post(`${BASE}/api/lessons/${id}/check`, JSON.stringify({ answers }), {
    headers: postHeaders(ip),
    tags: { name: "POST /api/lessons/:id/check" },
  });
  check(graded, { "check graded and saved": (r) => r.status === 200 && r.json("saved") === true });
  const progress = http.get(`${BASE}/api/me/progress`, { headers: headers(ip), tags: { name: "GET /api/me/progress" } });
  check(progress, { "progress 200": (r) => r.status === 200 });
  sleep(1 + Math.random() * 2);
}

export function signIn(data) {
  // A fresh address and cookie jar per sign-in: each iteration is a different student arriving.
  const ip = addressFor(200000 + ((__VU * 1000 + __ITER) % 60000));
  const email = pick(data.accounts);
  const res = http.post(`${BASE}/api/auth/login`, JSON.stringify({ email, password: PASSWORD }), {
    headers: postHeaders(ip),
    tags: { name: "POST /api/auth/login" },
    jar: new http.CookieJar(),
  });
  check(res, { "signed in": (r) => r.status === 200 && (r.headers["Set-Cookie"] || "").includes("df_session=") });
}
