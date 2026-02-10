import express from "express";
import cors from "cors";
import Database from "better-sqlite3";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";

const app = express();
app.use(express.json());

// IMPORTANT: in production, lock this down to your frontend origin.
app.use(cors({ origin: "http://localhost:5176" }));

// Local DB file
const db = new Database("./auth.db");

// Create table if not exists
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

const JWT_SECRET = process.env.JWT_SECRET || "change-this-secret-in-env";

// Helper: create a default user if DB is empty (remove later if you want)
const count = db.prepare("SELECT COUNT(*) as c FROM users").get().c;
if (count === 0) {
  const email = "admin@company.com";
  const pass = "admin1234";
  const hash = bcrypt.hashSync(pass, 10);
  db.prepare("INSERT INTO users (email, password_hash) VALUES (?, ?)").run(email, hash);
  console.log("Created default user:", email, "password:", pass);
}

// Register (optional, for testing)
app.post("/api/register", async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password || password.length < 6) {
      return res.status(400).json({ error: "Email and password (min 6 chars) required" });
    }
    const password_hash = await bcrypt.hash(password, 10);
    db.prepare("INSERT INTO users (email, password_hash) VALUES (?, ?)").run(email, password_hash);
    return res.json({ ok: true });
  } catch (e) {
    if (String(e).includes("UNIQUE")) return res.status(409).json({ error: "User already exists" });
    return res.status(500).json({ error: "Server error" });
  }
});

// Real login
app.post("/api/login", async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: "Email and password required" });

  const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email);
  if (!user) return res.status(401).json({ error: "Invalid credentials" });

  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return res.status(401).json({ error: "Invalid credentials" });

  const token = jwt.sign({ sub: user.id, email: user.email }, JWT_SECRET, { expiresIn: "8h" });
  return res.json({ token });
});

// Example protected route (test)
app.get("/api/me", (req, res) => {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Missing token" });

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    return res.json({ id: payload.sub, email: payload.email });
  } catch {
    return res.status(401).json({ error: "Invalid token" });
  }
});

app.listen(3001, () => {
  console.log("Auth server running on http://localhost:3001");
});
