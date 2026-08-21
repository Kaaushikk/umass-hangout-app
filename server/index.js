const fs = require("fs");
const path = require("path");
const http = require("http");
const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const multer = require("multer");
const { Server } = require("socket.io");
const { initDb } = require("./db");

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || "umass-hangout-dev-secret";
const UPLOAD_DIR = path.join(__dirname, "..", "uploads");
const PUBLIC_DIR = path.join(__dirname, "..", "public");

const CODES = {
  REGISTER_OK: 10001,
  REGISTER_EXISTS: 10002,
  LOGIN_MISSING: 10003,
  LOGIN_OK: 10004,
  LOGIN_BAD_PASSWORD: 10005,
};

function isUmassEmail(email) {
  return /^[^\s@]+@umass\.edu$/i.test(String(email || "").trim());
}

function signToken(user) {
  return jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: "7d" });
}

function authMiddleware(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ code: 401, message: "Please log in first." });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ code: 401, message: "Session expired. Please log in again." });
  }
}

function displayName(profile) {
  if (!profile) return "UMass student";
  return [profile.first_name, profile.last_name].filter(Boolean).join(" ") || profile.email;
}

function toIcs(event, groupName) {
  const dt = new Date(event.starts_at);
  const stamp = dt.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const end = new Date(dt.getTime() + 90 * 60000)
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//UMass Hangout//EN",
    "BEGIN:VEVENT",
    `UID:event-${event.id}@umass-hangout`,
    `DTSTART:${stamp}`,
    `DTEND:${end}`,
    `SUMMARY:${(event.title || "").replace(/\n/g, " ")}`,
    `DESCRIPTION:${((event.description || "") + " (" + groupName + ")").replace(/\n/g, " ")}`,
    `LOCATION:${(event.location || "").replace(/\n/g, " ")}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
}

async function main() {
  const db = await initDb();
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });

  const upload = multer({
    storage: multer.diskStorage({
      destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
      filename: (_req, file, cb) => {
        const safe = Date.now() + "-" + file.originalname.replace(/[^\w.\-]+/g, "_");
        cb(null, safe);
      },
    }),
    limits: { fileSize: 8 * 1024 * 1024 },
  });

  function profileFor(userId) {
    const profile = db.get("SELECT * FROM user_profile WHERE user_id = ?", [userId]);
    const tags = db.all("SELECT tag FROM profile_tags WHERE user_id = ?", [userId]).map((r) => r.tag);
    return profile ? { ...profile, tags } : null;
  }

  function isMember(groupId, userId) {
    return !!db.get("SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?", [groupId, userId]);
  }

  function groupPayload(group, userId) {
    const members = db.all(
      `SELECT u.id, u.email, p.first_name, p.last_name, gm.role
       FROM group_members gm
       JOIN users u ON u.id = gm.user_id
       LEFT JOIN user_profile p ON p.user_id = u.id
       WHERE gm.group_id = ?`,
      [group.id]
    );
    return {
      ...group,
      memberCount: members.length,
      joined: members.some((m) => m.id === userId),
      role: members.find((m) => m.id === userId)?.role || null,
      members: members.map((m) => ({
        id: m.id,
        email: m.email,
        name: displayName(m),
        role: m.role,
      })),
    };
  }

  const app = express();
  const server = http.createServer(app);
  const io = new Server(server, { cors: { origin: true } });

  app.use(cors());
  app.use(express.json({ limit: "2mb" }));
  app.use("/uploads", express.static(UPLOAD_DIR));
  app.use(express.static(PUBLIC_DIR));

  app.post("/api/register", (req, res) => {
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");
    if (!isUmassEmail(email) || password.length < 6) {
      return res.status(400).json({
        code: 400,
        message: "Use a @umass.edu email and a password of at least 6 characters.",
      });
    }
    const existing = db.get("SELECT id FROM users WHERE email = ?", [email]);
    if (existing) {
      return res.status(400).json({
        code: CODES.REGISTER_EXISTS,
        message: "There's already an account associated with the email ID. Please login!",
      });
    }
    db.run("INSERT INTO users (email, password) VALUES (?, ?)", [email, bcrypt.hashSync(password, 10)]);
    const user = { id: db.lastId(), email };
    db.run(
      `INSERT INTO user_profile (bio, department, first_name, last_name, middle_name, graduation_year, user_id, email, first_time_update)
       VALUES ('', '', '', '', '', 2026, ?, ?, 1)`,
      [user.id, email]
    );
    return res.json({
      code: CODES.REGISTER_OK,
      data: { id: user.id, email },
      message: "Email ID registered successfully!",
      token: signToken(user),
    });
  });

  app.post("/api/login", (req, res) => {
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");
    const user = db.get("SELECT * FROM users WHERE email = ?", [email]);
    if (!user) {
      return res.status(404).json({
        code: CODES.LOGIN_MISSING,
        message: "There's no account associated with the email ID. Please register!",
      });
    }
    if (!bcrypt.compareSync(password, user.password)) {
      return res.status(401).json({
        code: CODES.LOGIN_BAD_PASSWORD,
        message: "User login failed, invalid password",
      });
    }
    return res.json({
      code: CODES.LOGIN_OK,
      data: { id: user.id, email: user.email },
      message: "User login successful",
      token: signToken(user),
    });
  });

  app.get("/api/me", authMiddleware, (req, res) => {
    const user = db.get("SELECT id, email FROM users WHERE id = ?", [req.user.id]);
    res.json({ user, profile: profileFor(req.user.id) });
  });

  app.get("/api/profile/:emailId", authMiddleware, (req, res) => {
    const user = db.get("SELECT id, email FROM users WHERE email = ?", [req.params.emailId]);
    if (!user) return res.status(404).json({ message: "Profile not found" });
    res.json({ user, profile: profileFor(user.id) });
  });

  app.post("/api/profile", authMiddleware, (req, res) => {
    const { first_name, last_name, middle_name, department, graduation_year, bio, tags } = req.body;
    const year = Number(graduation_year);
    if (!first_name || !last_name || !department || !year) {
      return res.status(400).json({ message: "Name, department, and graduation year are required." });
    }
    const existing = db.get("SELECT id FROM user_profile WHERE user_id = ?", [req.user.id]);
    if (existing) {
      db.run(
        `UPDATE user_profile SET first_name=?, last_name=?, middle_name=?, department=?, graduation_year=?, bio=?, first_time_update=0
         WHERE user_id=?`,
        [first_name, last_name, middle_name || "", department, year, bio || "", req.user.id]
      );
    } else {
      db.run(
        `INSERT INTO user_profile (bio, department, first_name, last_name, middle_name, graduation_year, user_id, email, first_time_update)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`,
        [bio || "", department, first_name, last_name, middle_name || "", year, req.user.id, req.user.email]
      );
    }
    db.run("DELETE FROM profile_tags WHERE user_id = ?", [req.user.id]);
    const list = Array.isArray(tags)
      ? tags
      : String(tags || "")
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean);
    for (const tag of list.slice(0, 12)) {
      db.run("INSERT INTO profile_tags (user_id, tag) VALUES (?, ?)", [req.user.id, tag]);
    }
    res.json({ message: "Profile saved", profile: profileFor(req.user.id) });
  });

  app.get("/api/groups", authMiddleware, (req, res) => {
    const mine = req.query.mine === "1";
    const groups = mine
      ? db.all(
          `SELECT g.* FROM groups g
           JOIN group_members gm ON gm.group_id = g.id
           WHERE gm.user_id = ? ORDER BY g.created_at DESC`,
          [req.user.id]
        )
      : db.all("SELECT * FROM groups ORDER BY created_at DESC");
    res.json(groups.map((g) => groupPayload(g, req.user.id)));
  });

  app.post("/api/groups", authMiddleware, (req, res) => {
    const name = String(req.body.name || "").trim();
    const description = String(req.body.description || "").trim();
    const type = String(req.body.type || "social").toLowerCase();
    if (!name || !description) {
      return res.status(400).json({ message: "Group name and description are required." });
    }
    const allowed = ["study", "social", "sports"];
    const kind = allowed.includes(type) ? type : "social";
    const now = new Date().toISOString();
    db.run("INSERT INTO groups (name, description, type, created_by, created_at) VALUES (?, ?, ?, ?, ?)", [
      name,
      description,
      kind,
      req.user.id,
      now,
    ]);
    const id = db.lastId();
    db.run("INSERT INTO group_members (group_id, user_id, role, joined_at) VALUES (?, ?, 'admin', ?)", [
      id,
      req.user.id,
      now,
    ]);
    const group = db.get("SELECT * FROM groups WHERE id = ?", [id]);
    res.json(groupPayload(group, req.user.id));
  });

  app.get("/api/groups/:id", authMiddleware, (req, res) => {
    const group = db.get("SELECT * FROM groups WHERE id = ?", [req.params.id]);
    if (!group) return res.status(404).json({ message: "Group not found" });
    const events = db.all("SELECT * FROM events WHERE group_id = ? ORDER BY starts_at", [group.id]);
    const resources = db.all(
      `SELECT r.*, p.first_name, p.last_name FROM resources r
       LEFT JOIN user_profile p ON p.user_id = r.user_id
       WHERE r.group_id = ? ORDER BY r.created_at DESC`,
      [group.id]
    );
    res.json({
      ...groupPayload(group, req.user.id),
      events,
      resources: resources.map((r) => ({
        ...r,
        uploader: displayName(r),
      })),
    });
  });

  app.post("/api/groups/:id/join", authMiddleware, (req, res) => {
    const group = db.get("SELECT * FROM groups WHERE id = ?", [req.params.id]);
    if (!group) return res.status(404).json({ message: "Group not found" });
    if (!isMember(group.id, req.user.id)) {
      db.run("INSERT INTO group_members (group_id, user_id, role, joined_at) VALUES (?, ?, 'member', ?)", [
        group.id,
        req.user.id,
        new Date().toISOString(),
      ]);
    }
    res.json(groupPayload(db.get("SELECT * FROM groups WHERE id = ?", [group.id]), req.user.id));
  });

  app.post("/api/groups/:id/leave", authMiddleware, (req, res) => {
    const group = db.get("SELECT * FROM groups WHERE id = ?", [req.params.id]);
    if (!group) return res.status(404).json({ message: "Group not found" });
    db.run("DELETE FROM group_members WHERE group_id = ? AND user_id = ?", [group.id, req.user.id]);
    res.json({ ok: true });
  });

  app.post("/api/groups/:id/events", authMiddleware, (req, res) => {
    const group = db.get("SELECT * FROM groups WHERE id = ?", [req.params.id]);
    if (!group) return res.status(404).json({ message: "Group not found" });
    const membership = db.get("SELECT role FROM group_members WHERE group_id = ? AND user_id = ?", [
      group.id,
      req.user.id,
    ]);
    if (!membership) return res.status(403).json({ message: "Join the group first." });
    if (membership.role !== "admin") {
      return res.status(403).json({ message: "Only a group admin can create events." });
    }
    const { title, description, location, starts_at } = req.body;
    if (!title || !location || !starts_at) {
      return res.status(400).json({ message: "Title, location, and date/time are required." });
    }
    db.run(
      `INSERT INTO events (group_id, title, description, location, starts_at, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [group.id, title, description || "", location, starts_at, req.user.id, new Date().toISOString()]
    );
    res.json(db.get("SELECT * FROM events WHERE id = ?", [db.lastId()]));
  });

  app.get("/api/events/:id.ics", (req, res) => {
    const event = db.get("SELECT * FROM events WHERE id = ?", [req.params.id]);
    if (!event) return res.status(404).send("Not found");
    const group = db.get("SELECT name FROM groups WHERE id = ?", [event.group_id]);
    res.setHeader("Content-Type", "text/calendar");
    res.setHeader("Content-Disposition", `attachment; filename="event-${event.id}.ics"`);
    res.send(toIcs(event, group?.name || "UMass Hangout"));
  });

  app.get("/api/groups/:id/messages", authMiddleware, (req, res) => {
    if (!isMember(req.params.id, req.user.id)) {
      return res.status(403).json({ message: "Join the group to view chat." });
    }
    const messages = db.all(
      `SELECT m.*, p.first_name, p.last_name, u.email
       FROM messages m
       JOIN users u ON u.id = m.user_id
       LEFT JOIN user_profile p ON p.user_id = u.id
       WHERE m.group_id = ? ORDER BY m.created_at ASC`,
      [req.params.id]
    );
    res.json(
      messages.map((m) => ({
        id: m.id,
        group_id: m.group_id,
        user_id: m.user_id,
        body: m.body,
        created_at: m.created_at,
        name: displayName(m),
      }))
    );
  });

  app.post("/api/groups/:id/resources", authMiddleware, upload.single("file"), (req, res) => {
    if (!isMember(req.params.id, req.user.id)) {
      return res.status(403).json({ message: "Join the group to share files." });
    }
    if (!req.file) return res.status(400).json({ message: "Choose a file to upload." });
    db.run(
      "INSERT INTO resources (group_id, user_id, filename, original_name, created_at) VALUES (?, ?, ?, ?, ?)",
      [req.params.id, req.user.id, req.file.filename, req.file.originalname, new Date().toISOString()]
    );
    res.json({ ok: true, id: db.lastId() });
  });

  app.get("/api/search", authMiddleware, (req, res) => {
    const q = String(req.query.q || "").trim().toLowerCase();
    if (!q) return res.json({ groups: [], users: [] });
    const like = `%${q}%`;
    const groups = db
      .all(
        `SELECT * FROM groups
         WHERE lower(name) LIKE ? OR lower(description) LIKE ? OR lower(type) LIKE ?`,
        [like, like, like]
      )
      .map((g) => groupPayload(g, req.user.id));
    const users = db.all(
      `SELECT DISTINCT u.id, u.email, p.first_name, p.last_name, p.department, p.graduation_year, p.bio
       FROM users u
       LEFT JOIN user_profile p ON p.user_id = u.id
       LEFT JOIN profile_tags t ON t.user_id = u.id
       WHERE lower(u.email) LIKE ?
          OR lower(COALESCE(p.first_name,'')) LIKE ?
          OR lower(COALESCE(p.last_name,'')) LIKE ?
          OR lower(COALESCE(p.department,'')) LIKE ?
          OR lower(COALESCE(t.tag,'')) LIKE ?`,
      [like, like, like, like, like]
    );
    res.json({
      groups,
      users: users.map((u) => ({
        ...u,
        name: displayName(u),
        tags: db.all("SELECT tag FROM profile_tags WHERE user_id = ?", [u.id]).map((r) => r.tag),
      })),
    });
  });

  app.get("*", (_req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, "index.html"));
  });

  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    try {
      socket.user = jwt.verify(token, JWT_SECRET);
      next();
    } catch {
      next(new Error("unauthorized"));
    }
  });

  io.on("connection", (socket) => {
    socket.on("join-group", (groupId) => {
      if (!isMember(groupId, socket.user.id)) return;
      socket.join("group:" + groupId);
    });

    socket.on("chat-message", ({ groupId, body }) => {
      const text = String(body || "").trim();
      if (!text || !isMember(groupId, socket.user.id)) return;
      const created_at = new Date().toISOString();
      db.run("INSERT INTO messages (group_id, user_id, body, created_at) VALUES (?, ?, ?, ?)", [
        groupId,
        socket.user.id,
        text,
        created_at,
      ]);
      const profile = profileFor(socket.user.id);
      const payload = {
        id: db.lastId(),
        group_id: Number(groupId),
        user_id: socket.user.id,
        body: text,
        created_at,
        name: displayName(profile),
      };
      io.to("group:" + groupId).emit("chat-message", payload);
    });
  });

  server.listen(PORT, () => {
    console.log(`UMass Hangout running at http://localhost:${PORT}`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
