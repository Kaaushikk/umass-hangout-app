const app = document.getElementById("app");
const state = {
  token: localStorage.getItem("uh_token"),
  me: null,
  socket: null,
};

function api(path, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  if (!(opts.body instanceof FormData)) headers["Content-Type"] = "application/json";
  if (state.token) headers.Authorization = "Bearer " + state.token;
  return fetch(path, { ...opts, headers }).then(async (res) => {
    const text = await res.text();
    let data;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { message: text };
    }
    if (!res.ok) throw Object.assign(new Error(data.message || "Request failed"), { data, status: res.status });
    return data;
  });
}

function setToken(token) {
  state.token = token;
  if (token) localStorage.setItem("uh_token", token);
  else localStorage.removeItem("uh_token");
}

function escapeHtml(str) {
  return String(str || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function route() {
  const hash = location.hash || "#/";
  const [path, query] = hash.replace(/^#/, "").split("?");
  const parts = path.split("/").filter(Boolean);
  const params = Object.fromEntries(new URLSearchParams(query));
  return { path: "/" + parts.join("/"), parts, params };
}

function banner(msg, kind = "err") {
  return msg ? `<div class="banner ${kind}">${escapeHtml(msg)}</div>` : "";
}

function layout(html) {
  const name = state.me?.profile
    ? [state.me.profile.first_name, state.me.profile.last_name].filter(Boolean).join(" ")
    : state.me?.user?.email || "";
  app.innerHTML = `
    <header class="topbar">
      <div class="brand">UMass <span>Hangout</span></div>
      <nav class="nav">
        <a href="#/" class="${location.hash === "#/" || location.hash === "" ? "active" : ""}">Discover</a>
        <a href="#/mine">My groups</a>
        <a href="#/create">Create group</a>
        <a href="#/search">Search</a>
        <a href="#/profile">Profile</a>
        <button class="linkish" id="logout">Sign out ${escapeHtml(name)}</button>
      </nav>
    </header>
    <main class="wrap">${html}</main>
  `;
  document.getElementById("logout").onclick = () => {
    setToken(null);
    state.me = null;
    if (state.socket) state.socket.disconnect();
    location.hash = "#/login";
    render();
  };
}

function connectSocket() {
  if (state.socket || !state.token) return;
  state.socket = io({ auth: { token: state.token } });
}

async function ensureAuth() {
  if (!state.token) {
    location.hash = "#/login";
    return false;
  }
  if (!state.me) {
    try {
      state.me = await api("/api/me");
    } catch {
      setToken(null);
      location.hash = "#/login";
      return false;
    }
  }
  if (state.me.profile?.first_time_update && location.hash !== "#/onboarding") {
    location.hash = "#/onboarding";
    return false;
  }
  connectSocket();
  return true;
}

function groupCard(g) {
  const internal = (g.join_policy || "open") === "internal";
  return `
    <article class="card group-card">
      <span class="pill">${escapeHtml(g.type)}</span>
      ${internal ? `<span class="pill pill-internal">Internal</span>` : ""}
      <h3>${escapeHtml(g.name)}</h3>
      <p>${escapeHtml(g.description)}</p>
      <p class="meta">${g.memberCount} members${internal ? " · approval required" : ""}</p>
      <a class="btn" href="#/groups/${g.id}">Open group</a>
    </article>
  `;
}

function renderLogin(err = "") {
  app.innerHTML = `
    <div class="auth-shell">
      <div class="card auth-card">
        <div class="brand">UMass <span>Hangout</span></div>
        <h1>Find your vibe at UMass</h1>
        <p class="lede">Sign in with your UMass email.</p>
        ${banner(err)}
        <form id="login-form">
          <label>Email</label>
          <input name="email" type="email" placeholder="you@umass.edu" required />
          <label>Password</label>
          <input name="password" type="password" required />
          <div class="row" style="margin-top:16px">
            <button class="btn" type="submit">Log in</button>
            <a href="#/register">Create an account</a>
          </div>
        </form>
        <p class="meta" style="margin-top:18px">Demo: kaushik@umass.edu / hangout123<br />Also Demo Person 1–4: demo1@umass.edu through demo4@umass.edu</p>
      </div>
    </div>
  `;
  document.getElementById("login-form").onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      const res = await api("/api/login", {
        method: "POST",
        body: JSON.stringify({ email: fd.get("email"), password: fd.get("password") }),
      });
      setToken(res.token);
      state.me = null;
      location.hash = "#/";
      render();
    } catch (ex) {
      renderLogin(ex.message);
    }
  };
}

function renderRegister(err = "") {
  app.innerHTML = `
    <div class="auth-shell">
      <div class="card auth-card">
        <h1>Join Hangout</h1>
        <p class="lede">UMass email required. Password at least 6 characters.</p>
        ${banner(err)}
        <form id="reg-form">
          <label>UMass email</label>
          <input name="email" type="email" placeholder="you@umass.edu" required />
          <label>Password</label>
          <input name="password" type="password" minlength="6" required />
          <div class="row" style="margin-top:16px">
            <button class="btn" type="submit">Sign up</button>
            <a href="#/login">I already have an account</a>
          </div>
        </form>
      </div>
    </div>
  `;
  document.getElementById("reg-form").onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      const res = await api("/api/register", {
        method: "POST",
        body: JSON.stringify({ email: fd.get("email"), password: fd.get("password") }),
      });
      setToken(res.token);
      state.me = null;
      location.hash = "#/onboarding";
      render();
    } catch (ex) {
      renderRegister(ex.message);
    }
  };
}

function profileForm(profile, title, extra = "") {
  const tags = (profile?.tags || []).join(", ");
  return `
    <div class="card">
      <h2>${title}</h2>
      ${extra}
      <form id="profile-form">
        <label>First name</label>
        <input name="first_name" value="${escapeHtml(profile?.first_name || "")}" required />
        <label>Last name</label>
        <input name="last_name" value="${escapeHtml(profile?.last_name || "")}" required />
        <label>Department / major</label>
        <input name="department" value="${escapeHtml(profile?.department || "")}" required />
        <label>Graduation year</label>
        <input name="graduation_year" type="number" value="${escapeHtml(profile?.graduation_year || 2026)}" required />
        <label>Bio</label>
        <textarea name="bio">${escapeHtml(profile?.bio || "")}</textarea>
        <label>Profile tags (comma separated)</label>
        <input name="tags" value="${escapeHtml(tags)}" placeholder="night owl, group study, soccer" />
        <div class="row" style="margin-top:16px"><button class="btn" type="submit">Save profile</button></div>
      </form>
    </div>
  `;
}

async function saveProfile(form) {
  const fd = new FormData(form);
  await api("/api/profile", {
    method: "POST",
    body: JSON.stringify({
      first_name: fd.get("first_name"),
      last_name: fd.get("last_name"),
      department: fd.get("department"),
      graduation_year: fd.get("graduation_year"),
      bio: fd.get("bio"),
      tags: fd.get("tags"),
    }),
  });
  state.me = await api("/api/me");
}

async function renderDiscover(mine = false) {
  if (!(await ensureAuth())) return render();
  const groups = await api("/api/groups" + (mine ? "?mine=1" : ""));
  layout(`
    <section class="hero">
      <div>
        <h1>${mine ? "Your groups" : "Find your people"}</h1>
        <p class="lede">${mine ? "Groups you have already joined." : "Create or join groups by course, sport, or weekend plans."}</p>
      </div>
      <div class="card">
        <b>Quick start</b>
        <p class="meta">Search “soccer”, join Intramural Soccer, then open chat.</p>
        <a class="btn gold" href="#/search">Search campus</a>
      </div>
    </section>
    <div class="grid">${groups.map(groupCard).join("") || "<p>No groups yet.</p>"}</div>
  `);
}

async function renderCreate(msg = "") {
  if (!(await ensureAuth())) return render();
  layout(`
    ${profileForm ? "" : ""}
    <div class="card">
      <h2>Create a group</h2>
      ${banner(msg, msg.includes("created") ? "ok" : "err")}
      <form id="create-form">
        <label>Group name</label>
        <input name="name" required />
        <label>Description</label>
        <textarea name="description" required></textarea>
        <label>Type</label>
        <select name="type">
          <option value="study">Study</option>
          <option value="social">Social</option>
          <option value="sports">Sports</option>
        </select>
        <label class="check-row">
          <input type="checkbox" name="internal" />
          <span>Internal — require approval to join</span>
        </label>
        <p class="meta">Open groups let anyone join immediately. Internal groups wait for a moderator to approve each request.</p>
        <div class="row" style="margin-top:16px"><button class="btn" type="submit">Create group</button></div>
      </form>
    </div>
  `);
  document.getElementById("create-form").onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      const g = await api("/api/groups", {
        method: "POST",
        body: JSON.stringify({
          name: fd.get("name"),
          description: fd.get("description"),
          type: fd.get("type"),
          join_policy: fd.get("internal") ? "internal" : "open",
        }),
      });
      location.hash = "#/groups/" + g.id;
      render();
    } catch (ex) {
      renderCreate(ex.message);
    }
  };
}

async function renderSearch() {
  if (!(await ensureAuth())) return render();
  const q = route().params.q || "";
  let results = { groups: [], users: [] };
  if (q) results = await api("/api/search?q=" + encodeURIComponent(q));
  layout(`
    <div class="card">
      <h2>Search groups, people, and topics</h2>
      <form id="search-form" class="row">
        <input name="q" value="${escapeHtml(q)}" placeholder="Computer Science, soccer, night owl" style="flex:1; min-width:220px" />
        <button class="btn" type="submit">Search</button>
      </form>
    </div>
    <h3>Groups</h3>
    <div class="grid">${results.groups.map(groupCard).join("") || "<p class='meta'>No matching groups.</p>"}</div>
    <h3>People</h3>
    <div class="grid">
      ${
        results.users
          .map(
            (u) => `
        <article class="card">
          <h3>${escapeHtml(u.name)}</h3>
          <p class="meta">${escapeHtml(u.department || "")} · ${escapeHtml(u.graduation_year || "")}</p>
          <p>${escapeHtml(u.bio || "")}</p>
          ${(u.tags || []).map((t) => `<span class="pill">${escapeHtml(t)}</span>`).join("")}
        </article>`
          )
          .join("") || "<p class='meta'>No matching people.</p>"
      }
    </div>
  `);
  document.getElementById("search-form").onsubmit = (e) => {
    e.preventDefault();
    location.hash = "#/search?q=" + encodeURIComponent(new FormData(e.target).get("q"));
    render();
  };
}

async function renderProfile(msg = "") {
  if (!(await ensureAuth())) return render();
  layout(profileForm(state.me.profile, "Your profile", banner(msg, "ok")));
  document.getElementById("profile-form").onsubmit = async (e) => {
    e.preventDefault();
    await saveProfile(e.target);
    renderProfile("Profile saved.");
  };
}

async function renderOnboarding() {
  if (!state.token) {
    location.hash = "#/login";
    return render();
  }
  if (!state.me) state.me = await api("/api/me");
  app.innerHTML = `
    <div class="auth-shell">
      ${profileForm(state.me.profile, "Complete your profile", "<p class='lede'>Name, major, and year help other students find you.</p>")}
    </div>
  `;
  document.getElementById("profile-form").onsubmit = async (e) => {
    e.preventDefault();
    await saveProfile(e.target);
    location.hash = "#/";
    render();
  };
}

function fmtWhen(iso) {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function roleBadges(m) {
  const parts = [];
  if (m.isCreator) parts.push(`<span class="pill role-creator">Creator</span>`);
  if (m.isModerator) parts.push(`<span class="pill role-mod">Moderator</span>`);
  if (!m.isCreator && !m.isModerator) parts.push(`<span class="pill role-member">Member</span>`);
  return parts.join("");
}

function yourStatus(g) {
  if (g.joined) {
    if (g.isCreator) return "you are the creator";
    if (g.isModerator) return "you are a moderator";
    return "you are a member";
  }
  if (g.requestStatus === "pending") return "waiting for approval";
  if (g.requestStatus === "denied") return "your last request was denied";
  return "you are not a member";
}

function joinLeaveControls(g) {
  if (g.joined) return `<button class="btn ghost" id="leave">Leave group</button>`;
  if ((g.join_policy || "open") === "internal") {
    if (g.requestStatus === "pending") {
      return `<button class="btn" id="join" disabled>Waiting for approval</button>`;
    }
    return `<button class="btn" id="join">Request to join</button>`;
  }
  return `<button class="btn" id="join">Join group</button>`;
}

async function renderGroup(id, msg = "") {
  if (!(await ensureAuth())) return render();
  const g = await api("/api/groups/" + id);
  let messages = [];
  if (g.joined) messages = await api("/api/groups/" + id + "/messages");
  const internal = (g.join_policy || "open") === "internal";
  const meId = state.me?.user?.id;
  const pendingNote =
    !g.joined && g.requestStatus === "pending"
      ? banner("Waiting for a moderator to approve your request. You’ll see members, chat, files, and events after you’re in.", "ok")
      : !g.joined && internal
        ? `<p class="meta">This is an internal group. A moderator must approve your request before you can join.</p>`
        : "";

  layout(`
    <div class="split">
      <div>
        <div class="card">
          <span class="pill">${escapeHtml(g.type)}</span>
          ${internal ? `<span class="pill pill-internal">Internal</span>` : ""}
          <h1>${escapeHtml(g.name)}</h1>
          <p>${escapeHtml(g.description)}</p>
          <p class="meta">${g.memberCount} members · created by ${escapeHtml(g.creator?.name || "a student")} · ${yourStatus(g)}</p>
          ${banner(msg, msg.includes("last moderator") || msg.includes("failed") || msg.includes("Only") ? "err" : msg ? "ok" : "err")}
          ${pendingNote}
          <div class="row">
            ${joinLeaveControls(g)}
          </div>
        </div>
        <div class="card" style="margin-top:16px">
          <h2>People in this group</h2>
          ${
            g.joined
              ? `<ul class="member-list">
                  ${(g.members || [])
                    .map(
                      (m) => `
                    <li>
                      <div>
                        <strong>${escapeHtml(m.name)}</strong>
                        ${roleBadges(m)}
                      </div>
                      ${
                        g.isCreator && !m.isModerator && m.id !== meId
                          ? `<button class="btn ghost btn-sm promote-btn" data-user-id="${m.id}">Make moderator</button>`
                          : ""
                      }
                    </li>`
                    )
                    .join("")}
                </ul>`
              : `<p class="meta">${internal ? "Member list is visible after you are approved." : "Join this group to see who is in it."}</p>`
          }
        </div>
        ${
          g.isModerator
            ? `<div class="card" style="margin-top:16px">
                <h2>Join requests</h2>
                ${
                  (g.pendingRequests || []).length
                    ? (g.pendingRequests || [])
                        .map(
                          (r) => `
                    <div class="request-row">
                      <span>${escapeHtml(r.name)}</span>
                      <div class="row">
                        <button class="btn btn-sm approve-btn" data-user-id="${r.id}">Approve</button>
                        <button class="btn ghost btn-sm deny-btn" data-user-id="${r.id}">Deny</button>
                      </div>
                    </div>`
                        )
                        .join("")
                    : "<p class='meta'>No pending requests.</p>"
                }
              </div>`
            : ""
        }
        ${
          g.joined
            ? `<div class="card" style="margin-top:16px">
          <h2>Events</h2>
          ${(g.events || [])
            .map(
              (ev) => `
            <div class="card" style="margin-bottom:10px">
              <b>${escapeHtml(ev.title)}</b>
              <p class="meta">${escapeHtml(fmtWhen(ev.starts_at))} · ${escapeHtml(ev.location)}</p>
              <p>${escapeHtml(ev.description || "")}</p>
              <a href="/api/events/${ev.id}.ics" target="_blank">Add to calendar (.ics)</a>
            </div>`
            )
            .join("") || "<p class='meta'>No events yet.</p>"}
          ${
            g.isModerator
              ? `<form id="event-form">
                  <label>New event title</label><input name="title" required />
                  <label>Location</label><input name="location" required />
                  <label>Date and time</label><input name="starts_at" type="datetime-local" required />
                  <label>Description</label><textarea name="description"></textarea>
                  <button class="btn" style="margin-top:12px" type="submit">Create event</button>
                </form>`
              : "<p class='meta'>Only a moderator can create events.</p>"
          }
        </div>
        <div class="card" style="margin-top:16px">
          <h2>Shared files</h2>
          ${(g.resources || [])
            .map(
              (r) =>
                `<p><a href="/uploads/${encodeURIComponent(r.filename)}" target="_blank">${escapeHtml(r.original_name)}</a> <span class="meta">by ${escapeHtml(r.uploader)}</span></p>`
            )
            .join("") || "<p class='meta'>No files yet.</p>"}
          <form id="file-form"><input type="file" name="file" required /><button class="btn" type="submit">Upload</button></form>
        </div>`
            : ""
        }
      </div>
      <div class="card">
        <h2>Group chat</h2>
        ${
          g.joined
            ? `<div class="chat" id="chat">${messages
                .map(
                  (m) =>
                    `<div class="msg"><b>${escapeHtml(m.name)}</b><time>${escapeHtml(fmtWhen(m.created_at))}</time><div>${escapeHtml(m.body)}</div></div>`
                )
                .join("")}</div>
               <form id="chat-form" class="row" style="margin-top:10px">
                 <input name="body" placeholder="Send a message" style="flex:1" />
                 <button class="btn" type="submit">Send</button>
               </form>`
            : `<p>${internal ? "Request to join and wait for approval to chat." : "Join this group to chat."}</p>`
        }
      </div>
    </div>
  `);

  const join = document.getElementById("join");
  const leave = document.getElementById("leave");
  if (join && !join.disabled)
    join.onclick = async () => {
      try {
        await api("/api/groups/" + id + "/join", { method: "POST", body: "{}" });
        renderGroup(id);
      } catch (ex) {
        renderGroup(id, ex.message);
      }
    };
  if (leave)
    leave.onclick = async () => {
      try {
        await api("/api/groups/" + id + "/leave", { method: "POST", body: "{}" });
        location.hash = "#/";
        render();
      } catch (ex) {
        renderGroup(id, ex.message);
      }
    };

  document.querySelectorAll(".approve-btn").forEach((btn) => {
    btn.onclick = async () => {
      try {
        await api("/api/groups/" + id + "/requests/" + btn.dataset.userId + "/approve", {
          method: "POST",
          body: "{}",
        });
        renderGroup(id);
      } catch (ex) {
        renderGroup(id, ex.message);
      }
    };
  });
  document.querySelectorAll(".deny-btn").forEach((btn) => {
    btn.onclick = async () => {
      try {
        await api("/api/groups/" + id + "/requests/" + btn.dataset.userId + "/deny", {
          method: "POST",
          body: "{}",
        });
        renderGroup(id);
      } catch (ex) {
        renderGroup(id, ex.message);
      }
    };
  });
  document.querySelectorAll(".promote-btn").forEach((btn) => {
    btn.onclick = async () => {
      try {
        await api("/api/groups/" + id + "/members/" + btn.dataset.userId + "/promote", {
          method: "POST",
          body: "{}",
        });
        renderGroup(id);
      } catch (ex) {
        renderGroup(id, ex.message);
      }
    };
  });

  const eventForm = document.getElementById("event-form");
  if (eventForm) {
    eventForm.onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      await api("/api/groups/" + id + "/events", {
        method: "POST",
        body: JSON.stringify({
          title: fd.get("title"),
          location: fd.get("location"),
          starts_at: new Date(fd.get("starts_at")).toISOString(),
          description: fd.get("description"),
        }),
      });
      render();
    };
  }

  const fileForm = document.getElementById("file-form");
  if (fileForm) {
    fileForm.onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const headers = { Authorization: "Bearer " + state.token };
      await fetch("/api/groups/" + id + "/resources", { method: "POST", headers, body: fd });
      render();
    };
  }

  const chatForm = document.getElementById("chat-form");
  if (chatForm && state.socket) {
    state.socket.emit("join-group", Number(id));
    const chatEl = document.getElementById("chat");
    const onMsg = (m) => {
      if (String(m.group_id) !== String(id)) return;
      chatEl.insertAdjacentHTML(
        "beforeend",
        `<div class="msg"><b>${escapeHtml(m.name)}</b><time>${escapeHtml(fmtWhen(m.created_at))}</time><div>${escapeHtml(m.body)}</div></div>`
      );
      chatEl.scrollTop = chatEl.scrollHeight;
    };
    state.socket.off("chat-message");
    state.socket.on("chat-message", onMsg);
    chatEl.scrollTop = chatEl.scrollHeight;
    chatForm.onsubmit = (e) => {
      e.preventDefault();
      const body = new FormData(e.target).get("body");
      state.socket.emit("chat-message", { groupId: Number(id), body });
      e.target.reset();
    };
  }
}

async function render() {
  const { parts } = route();
  const page = parts[0] || "";
  try {
    if (page === "login") return renderLogin();
    if (page === "register") return renderRegister();
    if (page === "onboarding") return renderOnboarding();
    if (page === "create") return renderCreate();
    if (page === "search") return renderSearch();
    if (page === "profile") return renderProfile();
    if (page === "mine") return renderDiscover(true);
    if (page === "groups" && parts[1]) return renderGroup(parts[1]);
    return renderDiscover(false);
  } catch (err) {
    app.innerHTML = `<main class="wrap">${banner(err.message)}</main>`;
  }
}

window.addEventListener("hashchange", render);
render();
