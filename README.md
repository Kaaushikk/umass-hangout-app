# UMass Hangout

**Find your vibe at UMass.**

UMass Hangout is a campus social web app for University of Massachusetts students. It is built so people can stop scrolling empty group chats and actually find classmates who share a course, a sport, a hiking Saturday, or a study style.

This README is the map of the project: what it is for, what you can do in it, how a session feels, how to run it locally, and how the pieces are put together.

---

## Why this exists

Students often want two things at once:

1. A **place to belong** that is smaller than the whole campus.
2. A **practical way to meet up** — a room, a time, a trailhead, a rec field.

UMass Hangout is aimed at that gap. You sign in with a UMass email, fill out a short profile (major, graduation year, bio, tags), then create or join interest groups. Inside a group you get a member list, events, file sharing, and live chat.

The original idea came from a first-semester master’s team project (Group 6, *UMass Hangout — Find your vibe at UMass*, October 2024). This codebase is a working end-to-end version of those features.

---

## Who it is for

- **UMass students** with an `@umass.edu` address (registration rejects other domains).
- **You, running it locally** as a portfolio or class demo: Node.js, one command, a browser.

It is not a production campus-wide deployment (no official UMass SSO, no Google Calendar OAuth). Events can still be saved to a calendar via a downloaded `.ics` file.

---

## What you should expect when you open it

1. You land on **Log in** (or **Sign up**).
2. New accounts must complete a **profile** before the rest of the app (first name, last name, department, graduation year; bio and tags are optional but useful for search).
3. **Discover** shows campus groups as cards (type, description, member count, whether the group is Internal).
4. Opening a group is the hub: description, people, events, files, and chat.
5. **Search** looks across group names/descriptions/types and people (names, majors, tags).

The look is campus-maroon and cream. It is a single-page app in the browser talking to a local API.

---

## Features (in detail)

### 1. Login and registration

- **Register** with `@umass.edu` and a password of at least 6 characters.
- Duplicate emails return the original-style API message: account already exists, please log in.
- Unknown emails and wrong passwords return distinct messages (no account vs invalid password).
- After login you get a session token (JWT) stored in the browser.
- First-time users are sent to **complete profile** before Discover.

**Demo accounts** (password for all: `hangout123`):

| Who | Email |
| --- | --- |
| Kaushik Karlapati | `kaushik@umass.edu` |
| Demo Person 1 | `demo1@umass.edu` |
| Demo Person 2 | `demo2@umass.edu` |
| Demo Person 3 | `demo3@umass.edu` |
| Demo Person 4 | `demo4@umass.edu` |

Use two browsers (or a normal window and a private window) if you want to watch chat or join-approval from two people at once.

### 2. Profiles and tags

Each account has a profile: name, department/major, graduation year, bio, and **tags** (study habits and interests such as “night owl”, “group study”, “soccer”).

Tags are searchable. If someone looks for “algorithms” or “outdoors”, matching people show up next to matching groups.

You can edit your own profile later from **Profile**.

### 3. Groups: create, join, leave

Groups have a **name**, **description**, and **type**:

- **Study** — courses, problem sets, exam review  
- **Social** — coffee, weekends, general hangouts  
- **Sports** — intramurals, pickup games  

**Open groups** (default): anyone logged in can **Join** immediately.

**Internal groups** (“serious” / invite-style): joining is **Request to join**. A creator or moderator must **Approve** or **Deny**. Until you are approved you are not a member: no roster, no chat, no files, no events beyond what the public group card already showed.

When you **create a group**, you become the **Creator** and a **Moderator**. You can check **Internal — require approval to join**.

**Leave:** you can leave a group you joined. The last remaining moderator cannot leave until they promote someone else, so an internal group is not left with nobody who can approve people.

### 4. People in the group, creator, moderator

Members see a **People** list on the group page.

Badges:

- **Creator** — the student who created the group (`created_by`). Stays labeled that way while they are still a member.
- **Moderator** — can approve/deny join requests and create events. The creator is a moderator. A creator can **Make moderator** on another member.
- **Member** — everyone else in the group.

Non-members and people still waiting on approval do **not** see the full roster (only that the group is Internal, plus member count).

### 5. Events

Moderators can schedule an event: title, date/time, location, optional description.

Members see events on the group page and can **Add to calendar (.ics)** (works with Google Calendar, Outlook, Apple Calendar, etc.).

### 6. Group chat

Members get a live chat (Socket.io). Messages are stored, so if you refresh you still see history. Non-members cannot read or send.

### 7. File / resource sharing

Members can upload notes, PDFs, and similar files (size limit on the server). Downloads are listed with who uploaded them.

### 8. Search

The search bar looks for keywords in:

- Group name, description, and type  
- People’s names, email, department, and profile tags  

Example queries: `Computer Science`, `soccer`, `night owl`.

### 9. Seeded campus groups (fresh database)

If you start with an empty `data/umass_hangout.sqlite`, the app plants four groups:

| Group | Type | Join | What it is for |
| --- | --- | --- | --- |
| **CS Study Circle** | Study | **Internal** | Problem sets, exam review, shared notes |
| **Intramural Soccer** | Sports | Open | Pickup on the rec fields |
| **Weekend Hiking** | Social | Open | Pioneer Valley day trips |
| **Campus Coffee Club** | Social | Open | Low-key meetups over coffee |

On a fresh seed, **Kaushik** (`kaushik@umass.edu`) is the creator of **CS Study Circle**. Request to join from a Demo Person account, then approve while logged in as Kaushik.

---

## How to run it

**Need:** [Node.js](https://nodejs.org/) (LTS). This project uses Express and does not require MySQL.

```powershell
cd C:\projects\umass-hangout
npm install
npm start
```

Then open [http://localhost:3000](http://localhost:3000).

If port 3000 is already in use, stop the old Node process and start again.

**Reset demo data:** stop the server, delete `data\umass_hangout.sqlite`, start again. Seed users and groups are recreated.

---

## Project layout

```
umass-hangout/
  server/
    index.js      HTTP API + Socket.io chat
    db.js         SQLite (sql.js), schema, seed
  public/
    index.html    App shell
    app.js        Screens: login, discover, group, search, profile
    styles.css    Campus styling
  data/           Local database (gitignored)
  uploads/        Shared group files (gitignored)
  docs/           Original check-in and API notes (PDFs)
  README.md       This file
```

**Stack:** Node.js, Express, JWT auth, bcrypt password hashes, Socket.io, sql.js (SQLite in a file, no separate database server), vanilla HTML/CSS/JS in the browser.

---

## Typical flows (so you know it “worked”)

**New student**

1. Sign up with `you@umass.edu`.  
2. Fill name, CS (or another major), year, a couple of tags.  
3. Search `hiking` → open Weekend Hiking → Join → send a chat message.

**Internal group**

1. Log in as someone who is **not** already in CS Study Circle.  
2. Open CS Study Circle → **Request to join**.  
3. Log in as **Kaushik** (`kaushik@umass.edu`) if you are testing CS Study Circle → **Join requests** → Approve.  
4. First account: refresh, see People, chat, and files.

**You as organizer**

1. Create Group → type Study or Social → optionally Internal.  
2. Create an event with a building and time.  
3. Promote a trusted member to moderator if you need help approving people.

---

## API notes (from the original backend contract)

Auth responses still use the numbered codes from the course API notes, for example:

- `10001` — registration succeeded  
- `10002` — email already registered  
- `10003` — no account for that email  
- `10004` — login succeeded  
- `10005` — invalid password  

The running app also returns a `token` on login/register so the browser can call the rest of the API.

---

## What this is not

- Not official UMass IT software.  
- Not Google-account login (UMass email format only).  
- Not a full mobile app; it is a responsive website.  
- Chat is realtime on this machine; there is no separate hosted production URL unless you deploy it yourself.

---

## License / use

Personal / academic portfolio project. Reuse the idea freely; do not present the demo accounts as real students other than the one name you chose to keep (`kaushik@umass.edu`).
