const fs = require("fs");
const path = require("path");
const initSqlJs = require("sql.js");
const bcrypt = require("bcryptjs");

const DATA_DIR = path.join(__dirname, "..", "data");
const DB_PATH = path.join(DATA_DIR, "umass_hangout.sqlite");

let db;
let saveTimer;

function persist() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DB_PATH, Buffer.from(db.export()));
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(persist, 50);
}

function run(sql, params = []) {
  db.run(sql, params);
  scheduleSave();
}

function all(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

function get(sql, params = []) {
  return all(sql, params)[0] || null;
}

function lastId() {
  return get("SELECT last_insert_rowid() AS id").id;
}

function createSchema() {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      password TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS user_profile (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bio TEXT,
      department TEXT,
      first_name TEXT,
      last_name TEXT,
      middle_name TEXT,
      graduation_year INTEGER NOT NULL DEFAULT 2026,
      user_id INTEGER UNIQUE,
      email TEXT NOT NULL,
      first_time_update INTEGER NOT NULL DEFAULT 1,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS profile_tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      tag TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      type TEXT NOT NULL,
      created_by INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      join_policy TEXT NOT NULL DEFAULT 'open',
      FOREIGN KEY (created_by) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS join_requests (
      group_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL,
      PRIMARY KEY (group_id, user_id),
      FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS group_members (
      group_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      role TEXT NOT NULL DEFAULT 'member',
      joined_at TEXT NOT NULL,
      PRIMARY KEY (group_id, user_id),
      FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      location TEXT NOT NULL,
      starts_at TEXT NOT NULL,
      created_by INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE,
      FOREIGN KEY (created_by) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS resources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      filename TEXT NOT NULL,
      original_name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
  `);
}

function columnExists(table, column) {
  try {
    return all(`PRAGMA table_info(${table})`).some((c) => c.name === column);
  } catch {
    return false;
  }
}

function migrate() {
  if (!columnExists("groups", "join_policy")) {
    try {
      run("ALTER TABLE groups ADD COLUMN join_policy TEXT NOT NULL DEFAULT 'open'");
    } catch {
      // Column already present on this sqlite file.
    }
    const cs = get("SELECT id FROM groups WHERE name = ?", ["CS Study Circle"]);
    if (cs) {
      run("UPDATE groups SET join_policy = 'internal' WHERE id = ?", [cs.id]);
    }
  }
  db.run(`
    CREATE TABLE IF NOT EXISTS join_requests (
      group_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL,
      PRIMARY KEY (group_id, user_id),
      FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);
}

function seedIfEmpty() {
  const count = get("SELECT COUNT(*) AS n FROM users");
  if (count.n > 0) return;

  const password = bcrypt.hashSync("hangout123", 10);
  const people = [
    {
      email: "kaushik@umass.edu",
      first: "Kaushik",
      last: "Karlapati",
      dept: "Computer Science",
      year: 2026,
      bio: "Pickup soccer after lectures, anyone?",
      tags: ["sports", "evening", "CS 311"],
    },
    {
      email: "demo1@umass.edu",
      first: "Demo Person",
      last: "1",
      dept: "Computer Science",
      year: 2026,
      bio: "Building community one hangout at a time.",
      tags: ["night owl", "group study", "hackathons"],
    },
    {
      email: "demo2@umass.edu",
      first: "Demo Person",
      last: "2",
      dept: "Computer Science",
      year: 2026,
      bio: "Always down for coffee and a whiteboard.",
      tags: ["visual learner", "coffee chats", "algorithms"],
    },
    {
      email: "demo3@umass.edu",
      first: "Demo Person",
      last: "3",
      dept: "Computer Science",
      year: 2026,
      bio: "Looking for hiking buddies and study sprints.",
      tags: ["outdoors", "pomodoro", "weekends"],
    },
    {
      email: "demo4@umass.edu",
      first: "Demo Person",
      last: "4",
      dept: "Computer Science",
      year: 2026,
      bio: "Notes, playlists, and good group energy.",
      tags: ["note sharing", "music", "quiet study"],
    },
  ];

  const userIds = [];
  for (const p of people) {
    run("INSERT INTO users (email, password) VALUES (?, ?)", [p.email, password]);
    const id = lastId();
    userIds.push(id);
    run(
      `INSERT INTO user_profile
        (bio, department, first_name, last_name, middle_name, graduation_year, user_id, email, first_time_update)
       VALUES (?, ?, ?, ?, '', ?, ?, ?, 0)`,
      [p.bio, p.dept, p.first, p.last, p.year, id, p.email]
    );
    for (const tag of p.tags) {
      run("INSERT INTO profile_tags (user_id, tag) VALUES (?, ?)", [id, tag]);
    }
  }

  const now = new Date().toISOString();
  const groups = [
    {
      name: "CS Study Circle",
      description: "Weekly problem sets, exam review, and shared notes for CS courses.",
      type: "study",
      owner: userIds[0],
      members: [userIds[0], userIds[1]],
      join_policy: "internal",
    },
    {
      name: "Intramural Soccer",
      description: "Casual pickup games on the rec fields. All skill levels welcome.",
      type: "sports",
      owner: userIds[3],
      members: [userIds[3], userIds[1], userIds[2]],
      join_policy: "open",
    },
    {
      name: "Weekend Hiking",
      description: "Day trips around the Pioneer Valley. Bring water and good shoes.",
      type: "social",
      owner: userIds[2],
      members: [userIds[2], userIds[0], userIds[4]],
      join_policy: "open",
    },
    {
      name: "Campus Coffee Club",
      description: "Meet new people over lattes at the Campus Center or local spots.",
      type: "social",
      owner: userIds[1],
      members: [userIds[1], userIds[4], userIds[0]],
      join_policy: "open",
    },
  ];

  const groupIds = [];
  for (const g of groups) {
    run(
      "INSERT INTO groups (name, description, type, created_by, created_at, join_policy) VALUES (?, ?, ?, ?, ?, ?)",
      [g.name, g.description, g.type, g.owner, now, g.join_policy || "open"]
    );
    const gid = lastId();
    groupIds.push(gid);
    for (const uid of g.members) {
      const role = uid === g.owner ? "admin" : "member";
      run(
        "INSERT INTO group_members (group_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)",
        [gid, uid, role, now]
      );
    }
  }

  const tomorrow = new Date(Date.now() + 86400000);
  tomorrow.setHours(18, 0, 0, 0);
  const saturday = new Date(Date.now() + 4 * 86400000);
  saturday.setHours(9, 30, 0, 0);

  run(
    `INSERT INTO events (group_id, title, description, location, starts_at, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      groupIds[0],
      "Midterm review sprint",
      "Bring questions from the last two problem sets.",
      "Lederle Grad Research Center, Room 222",
      tomorrow.toISOString(),
      userIds[0],
      now,
    ]
  );
  run(
    `INSERT INTO events (group_id, title, description, location, starts_at, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      groupIds[2],
      "Mt. Tom morning hike",
      "Carpool from the Campus Center at 9:00.",
      "Mt. Tom State Reservation",
      saturday.toISOString(),
      userIds[2],
      now,
    ]
  );

  const chat = [
    [groupIds[0], userIds[0], "Welcome to CS Study Circle — drop your course and what you're stuck on."],
    [groupIds[0], userIds[1], "Anyone reviewing 311 tonight?"],
    [groupIds[0], userIds[1], "I uploaded last week's notes in Resources."],
    [groupIds[1], userIds[3], "Pickup at 6 by the rec fields if the weather holds."],
    [groupIds[2], userIds[2], "Trail looks dry this weekend. Who's in?"],
  ];
  for (const [gid, uid, body] of chat) {
    run("INSERT INTO messages (group_id, user_id, body, created_at) VALUES (?, ?, ?, ?)", [
      gid,
      uid,
      body,
      now,
    ]);
  }

  persist();
}

async function initDb() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const SQL = await initSqlJs();
  if (fs.existsSync(DB_PATH)) {
    db = new SQL.Database(fs.readFileSync(DB_PATH));
  } else {
    db = new SQL.Database();
  }
  createSchema();
  migrate();
  seedIfEmpty();
  persist();
  return { run, all, get, lastId, persist };
}

module.exports = { initDb };
