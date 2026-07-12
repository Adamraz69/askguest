require("dotenv").config();

const express = require("express");
const fs = require("fs");
const path = require("path");
const rateLimit = require("express-rate-limit");

const app = express();
const PORT = process.env.PORT || 3000;
const DB_PATH = path.join(__dirname, "database.json");
const PUBLIC_DIR = path.join(__dirname, "public");
const VIEWS_DIR = path.join(__dirname, "views");
const ADMIN_HTML = path.join(VIEWS_DIR, "admin.html");

const ADMIN_USER = process.env.ADMIN_USER || "admin";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "Admin123";

/** Max questions one browser session may send (client + optional server hint). Clamped 1–100. */
const MAX_SUBMISSIONS_PER_SESSION = (() => {
  const n = parseInt(process.env.MAX_SUBMISSIONS_PER_SESSION || "2", 10);
  if (Number.isNaN(n)) return 2;
  return Math.min(100, Math.max(1, n));
})();

if (!process.env.ADMIN_USER || !process.env.ADMIN_PASSWORD) {
  console.warn(
    "[wisdom-circle-malahida-swelguest] Using default ADMIN_USER / ADMIN_PASSWORD. Set both in .env for production."
  );
}

const adminPageLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.RATE_LIMIT_ADMIN_PAGE_MAX) || 80,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Try again later." },
});

const adminLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.RATE_LIMIT_ADMIN_LOGIN_MAX) || 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many login attempts. Try again later." },
});

const adminApiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.RATE_LIMIT_ADMIN_API_MAX) || 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Try again later." },
});

app.use(express.json());
app.use(express.static(PUBLIC_DIR));

app.get("/api/public-config", (req, res) => {
  res.json({ maxSubmissionsPerSession: MAX_SUBMISSIONS_PER_SESSION });
});

function readDb() {
  try {
    const raw = fs.readFileSync(DB_PATH, "utf8");
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function writeDb(items) {
  fs.writeFileSync(DB_PATH, JSON.stringify(items, null, 2), "utf8");
}

function getAdminCredentials(req) {
  let user = "";
  let pwd = "";

  const auth = req.headers.authorization;
  if (auth && typeof auth === "string" && auth.startsWith("Basic ")) {
    try {
      const decoded = Buffer.from(auth.slice(6), "base64").toString("utf8");
      const colon = decoded.indexOf(":");
      if (colon !== -1) {
        user = decoded.slice(0, colon).trim();
        pwd = decoded.slice(colon + 1);
      }
    } catch (_) {
      /* ignore */
    }
  }

  if (!user) {
    const h = req.headers["x-admin-user"];
    user = typeof h === "string" ? h.trim() : "";
  }
  if (!pwd) {
    const hp = req.headers["x-admin-password"];
    pwd = typeof hp === "string" ? hp : "";
  }
  if (req.body && typeof req.body === "object") {
    if (!user && typeof req.body.username === "string") {
      user = req.body.username.trim();
    }
    if (!pwd && typeof req.body.password === "string") {
      pwd = req.body.password;
    }
  }

  return { user, pwd };
}

function requireAdmin(req, res, next) {
  const { user, pwd } = getAdminCredentials(req);
  if (user === ADMIN_USER && pwd === ADMIN_PASSWORD) {
    return next();
  }
  return res.status(401).json({ error: "Unauthorized" });
}

app.post("/api/questions", (req, res) => {
  const name = typeof req.body.name === "string" ? req.body.name.trim() : "";
  const question =
    typeof req.body.question === "string" ? req.body.question.trim() : "";

  if (!question) {
    return res.status(400).json({ error: "Question is required." });
  }

  const items = readDb();
  const entry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    name: name || null,
    question,
    createdAt: new Date().toISOString(),
  };
  items.unshift(entry);
  writeDb(items);
  return res.status(201).json({ ok: true, id: entry.id });
});

app.get(
  "/api/questions",
  adminApiLimiter,
  requireAdmin,
  (req, res) => {
    const items = readDb();
    return res.json(items);
  }
);

app.delete(
  "/api/questions/:id",
  adminApiLimiter,
  requireAdmin,
  (req, res) => {
    const { id } = req.params;
    const items = readDb();
    const next = items.filter((q) => q.id !== id);
    if (next.length === items.length) {
      return res.status(404).json({ error: "Not found" });
    }
    writeDb(next);
    return res.json({ ok: true });
  }
);

app.delete("/api/questions", adminApiLimiter, requireAdmin, (req, res) => {
  writeDb([]);
  return res.json({ ok: true });
});

app.post("/api/admin/verify", adminLoginLimiter, (req, res) => {
  const user =
    typeof req.body.username === "string" ? req.body.username.trim() : "";
  const pwd =
    typeof req.body.password === "string" ? req.body.password : "";
  if (user === ADMIN_USER && pwd === ADMIN_PASSWORD) {
    return res.json({ ok: true });
  }
  return res.status(401).json({ error: "Invalid credentials" });
});

app.get("/admin/wisdom/ask", adminPageLimiter, (req, res) => {
  res.sendFile(ADMIN_HTML);
});

app.get("/admin", (req, res) => {
  res.status(404).send("Not found");
});

app.get("/admin.html", (req, res) => {
  res.status(404).send("Not found");
});

app.listen(PORT, () => {
  console.log(`Wisdom Circle - Malahida SwelGuest listening at http://localhost:${PORT}`);
  console.log(`Admin UI: http://localhost:${PORT}/admin/wisdom/ask`);
});
