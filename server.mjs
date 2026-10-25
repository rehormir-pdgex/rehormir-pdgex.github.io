import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { getLeagueStandings, getEventDetail } from "./league-data.mjs";

const prisma = new PrismaClient();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const PORT = 3000;

app.use(express.json());

const ADMIN_USERNAMES = ["david", "miroslav"]; // both log in with either name + the shared password

function requireAdmin(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing or invalid authorization header" });
  }
  const token = authHeader.slice("Bearer ".length);
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.adminUsername = payload.username;
    next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

// --- Auth ---

app.post("/api/login", async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password || !ADMIN_USERNAMES.includes(username.toLowerCase())) {
    return res.status(401).json({ error: "Invalid username or password" });
  }

  const isMatch = await bcrypt.compare(password, process.env.ADMIN_PASSWORD_HASH);
  if (!isMatch) {
    return res.status(401).json({ error: "Invalid username or password" });
  }

  const token = jwt.sign({ username: username.toLowerCase() }, process.env.JWT_SECRET, {
    expiresIn: "7d",
  });

  res.json({ token, username: username.toLowerCase() });
});

// --- Public endpoints ---

app.get("/api/leagues/:slug/standings", async (req, res) => {
  try {
    const snapshot = await prisma.leagueSnapshot.findUnique({
      where: { leagueSlug: req.params.slug },
    });

    if (!snapshot) {
      return res.status(404).json({
        error: "No data yet for this league - an admin needs to trigger a refresh first.",
      });
    }

    const data = JSON.parse(snapshot.data);
    res.json({ ...data, lastUpdated: snapshot.updatedAt });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to read standings", details: err.message });
  }
});

app.get("/api/leagues/:slug/events/:eventShortId", async (req, res) => {
  try {
    const data = await getEventDetail(req.params.eventShortId);
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch event detail", details: err.message });
  }
});

// --- Admin-only endpoint ---

app.post("/api/leagues/:slug/refresh", requireAdmin, async (req, res) => {
  try {
    console.log(`Refresh triggered by ${req.adminUsername} for league ${req.params.slug}...`);
    const data = await getLeagueStandings(req.params.slug);

    const snapshot = await prisma.leagueSnapshot.upsert({
      where: { leagueSlug: req.params.slug },
      update: { data: JSON.stringify(data) },
      create: { leagueSlug: req.params.slug, data: JSON.stringify(data) },
    });

    console.log(`Refresh complete for ${req.params.slug}`);
    res.json({ success: true, updatedAt: snapshot.updatedAt });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Refresh failed", details: err.message });
  }
});

app.use(express.static(path.join(__dirname, "frontend", "dist")));

app.use((req, res) => {
  res.sendFile(path.join(__dirname, "frontend", "dist", "index.html"));
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});