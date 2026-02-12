import express from "express";
import cors from "cors";
import Database from "better-sqlite3";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import multer from "multer";
import path from "path";
import fs from "fs";

const uploadDir = path.resolve("./uploads");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_");
    cb(null, `${Date.now()}_${safe}`);
  },
});

const upload = multer({ storage });


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

db.exec(`
  CREATE TABLE IF NOT EXISTS files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    original_name TEXT NOT NULL,
    stored_name TEXT NOT NULL,
    mime_type TEXT,
    size_bytes INTEGER,
    uploaded_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS file_text (
    file_id INTEGER PRIMARY KEY,
    text TEXT NOT NULL,
    FOREIGN KEY(file_id) REFERENCES files(id) ON DELETE CASCADE
  );
`);


const JWT_SECRET = process.env.JWT_SECRET || "change-this-secret-in-env";

function requireAuth(req, res, next) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Missing token" });

  try {
    req.user = jwt.verify(token, JWT_SECRET);
    return next();
  } catch {
    return res.status(401).json({ error: "Invalid token" });
  }
}


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

app.post("/api/upload", requireAuth, upload.array("files", 50), (req, res) => {
  const stmt = db.prepare(`
    INSERT INTO files (original_name, stored_name, mime_type, size_bytes)
    VALUES (?, ?, ?, ?)
  `);

  const insertFile = db.prepare(`
  INSERT INTO files (original_name, stored_name, mime_type, size_bytes)
  VALUES (?, ?, ?, ?)
`);

const insertText = db.prepare(`
  INSERT OR REPLACE INTO file_text (file_id, text)
  VALUES (?, ?)
`);

const uploaded = req.files || [];
const results = [];

for (const f of uploaded) {
  const info = insertFile.run(
    f.originalname,
    f.filename,
    f.mimetype,
    f.size
  );

  const fileId = info.lastInsertRowid;

  //A) Ollama embed + generate (offline AI calls)
  const OLLAMA_BASE = "http://localhost:11434";

  async function ollamaEmbed(text) {
    const res = await fetch(`${OLLAMA_BASE}/api/embeddings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "nomic-embed-text",
        prompt: text,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error("Ollama embeddings failed: " + err);
    }

    const data = await res.json();
    return data.embedding; // number[]
  }

  async function ollamaGenerate(prompt) {
    const res = await fetch(`${OLLAMA_BASE}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "llama3.1:8b",
        prompt,
        stream: false,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error("Ollama generate failed: " + err);
    }

    const data = await res.json();
    return data.response;
  }
  
  // MVP: only TXT for now
  if (f.mimetype === "text/plain") {
    const fullPath = path.join(uploadDir, f.filename);
    const text = fs.readFileSync(fullPath, "utf8");
    insertText.run(fileId, text);
  }

  results.push({
    id: fileId,
    name: f.originalname,
    size: f.size,
  });
}

res.json({ ok: true, uploaded: results });

});

//B) Chunking
function chunkText(text, maxChars = 1200, overlap = 150) {
  const clean = String(text || "").replace(/\r\n/g, "\n");
  const chunks = [];
  let i = 0;

  while (i < clean.length) {
    const end = Math.min(clean.length, i + maxChars);
    const slice = clean.slice(i, end);
    chunks.push(slice);
    if (end === clean.length) break;
    i = end - overlap;
    if (i < 0) i = 0;
  }
  return chunks;
}

//C) Cosine similarity
function cosineSim(a, b) {
  let dot = 0, na = 0, nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-9);
}

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

app.get("/api/files", requireAuth, (req, res) => {
  const rows = db.prepare("SELECT * FROM files ORDER BY uploaded_at DESC").all();
  res.json({ files: rows });
});

app.post("/api/search", requireAuth, (req, res) => {
  const { query } = req.body || {};
  if (!query || !query.trim()) {
    return res.status(400).json({ error: "Query required" });
  }

  const q = query.toLowerCase();

  const rows = db.prepare(`
    SELECT f.original_name, t.text
    FROM files f
    JOIN file_text t ON t.file_id = f.id
  `).all();

  const results = [];

  for (const row of rows) {
    const textLower = row.text.toLowerCase();
    const index = textLower.indexOf(q);

    if (index !== -1) {
      const start = Math.max(0, index - 50);
      const end = Math.min(row.text.length, index + q.length + 50);

      results.push({
        file: row.original_name,
        location: `Text index ${index}`,
        snippet: row.text.slice(start, end).replace(/\s+/g, " "),
      });
    }
  }

  res.json({ results });
});


app.listen(3001, () => {
  console.log("Auth server running on http://localhost:3001");
});
