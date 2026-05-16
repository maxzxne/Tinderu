import { randomUUID } from "crypto";

export function registerSocialRoutes(app, db, helpers) {
  const {
    getUserId,
    getCurrentUser,
    oppositeGender,
    validateGender,
    calcAge,
    genderLabel,
    toPublicUser,
  } = helpers;

  db.exec(`
    CREATE TABLE IF NOT EXISTS matches (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      peer_id TEXT NOT NULL,
      peer_type TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(user_id, peer_id, peer_type)
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      match_id TEXT NOT NULL,
      sender_id TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (match_id) REFERENCES matches(id)
    );

    CREATE TABLE IF NOT EXISTS ratings (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      target_id TEXT NOT NULL,
      target_type TEXT NOT NULL,
      score INTEGER NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(user_id, target_id, target_type)
    );

    CREATE TABLE IF NOT EXISTS calls (
      id TEXT PRIMARY KEY,
      match_id TEXT NOT NULL,
      caller_id TEXT NOT NULL,
      callee_id TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      ended_at TEXT
    );

    CREATE TABLE IF NOT EXISTS call_signals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      call_id TEXT NOT NULL,
      from_user_id TEXT NOT NULL,
      type TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  function getRatingStats(targetId, targetType) {
    const row = db
      .prepare(
        `SELECT ROUND(AVG(score), 1) AS avg, COUNT(*) AS cnt
         FROM ratings WHERE target_id = ? AND target_type = ?`
      )
      .get(targetId, targetType);
    return {
      ratingAvg: row.avg ?? 0,
      ratingCount: row.cnt ?? 0,
    };
  }

  function toPublicProfile(row) {
    const r = getRatingStats(row.id, "profile");
    return {
      id: row.id,
      type: "profile",
      name: row.name,
      age: row.age,
      bio: row.bio,
      photo: row.photo,
      gender: row.gender,
      ...r,
    };
  }

  function toPublicPersonFromUser(row) {
    const r = getRatingStats(row.id, "user");
    return {
      id: row.id,
      type: "user",
      login: row.login,
      name: row.name,
      age: calcAge(row.date_of_birth),
      bio: row.bio || "",
      photo: row.photo,
      gender: row.gender,
      genderLabel: genderLabel(row.gender),
      ...r,
    };
  }

  function getPeer(peerId, peerType) {
    const type = String(peerType || "profile").toLowerCase();
    if (type === "profile") {
      const row = db.prepare("SELECT * FROM profiles WHERE id = ?").get(peerId);
      return row ? toPublicProfile(row) : null;
    }
    if (type === "user") {
      const row = getCurrentUser(peerId);
      return row ? toPublicPersonFromUser(row) : null;
    }
    return null;
  }

  function repairMatches(userId) {
    const rows = db.prepare("SELECT * FROM matches WHERE user_id = ?").all(userId);
    const del = db.prepare("DELETE FROM matches WHERE id = ?");
    for (const row of rows) {
      if (!getPeer(row.peer_id, row.peer_type)) del.run(row.id);
    }
  }

  function createMatch(userId, peerId, peerType) {
    const existing = db
      .prepare(
        "SELECT id FROM matches WHERE user_id = ? AND peer_id = ? AND peer_type = ?"
      )
      .get(userId, peerId, peerType);
    if (existing) return existing.id;
    const id = randomUUID();
    db.prepare(
      "INSERT INTO matches (id, user_id, peer_id, peer_type) VALUES (?, ?, ?, ?)"
    ).run(id, userId, peerId, peerType);
    return id;
  }

  function getMatchForUser(matchId, userId) {
    return db
      .prepare("SELECT * FROM matches WHERE id = ? AND user_id = ?")
      .get(matchId, userId);
  }

  function enrichMatch(row) {
    const peer = getPeer(row.peer_id, row.peer_type);
    const last = db
      .prepare(
        `SELECT body, created_at FROM messages WHERE match_id = ?
         ORDER BY created_at DESC LIMIT 1`
      )
      .get(row.id);
    return {
      matchId: row.id,
      peer,
      lastMessage: last?.body || null,
      lastMessageAt: last?.created_at || null,
      createdAt: row.created_at,
    };
  }

  app.get("/api/users", (req, res) => {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Нужен X-User-Id" });

    const me = getCurrentUser(userId);
    if (!me || !validateGender(me.gender)) {
      return res.status(400).json({ error: "Укажите пол в профиле" });
    }

    const targetGender = oppositeGender(me.gender);
    const sort = req.query.sort === "rating" ? "rating" : "name";

    const profiles = db
      .prepare("SELECT * FROM profiles WHERE gender = ?")
      .all(targetGender)
      .map(toPublicProfile);

    const users = db
      .prepare("SELECT * FROM users WHERE id != ? AND gender = ?")
      .all(userId, targetGender)
      .map(toPublicPersonFromUser);

    let people = [...profiles, ...users];
    if (sort === "rating") {
      people.sort((a, b) => b.ratingAvg - a.ratingAvg || b.ratingCount - a.ratingCount);
    } else {
      people.sort((a, b) => a.name.localeCompare(b.name, "ru"));
    }

    res.json(people);
  });

  app.get("/api/ratings/leaderboard", (req, res) => {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Нужен X-User-Id" });

    const profileRows = db
      .prepare(
        `SELECT p.*,
                COALESCE(ROUND(AVG(r.score), 1), 0) AS rating_avg,
                COUNT(r.score) AS rating_count
         FROM profiles p
         LEFT JOIN ratings r ON r.target_id = p.id AND r.target_type = 'profile'
         GROUP BY p.id`
      )
      .all();

    const userRows = db
      .prepare(
        `SELECT u.*,
                COALESCE(ROUND(AVG(r.score), 1), 0) AS rating_avg,
                COUNT(r.score) AS rating_count
         FROM users u
         LEFT JOIN ratings r ON r.target_id = u.id AND r.target_type = 'user'
         GROUP BY u.id`
      )
      .all();

    const board = [
      ...profileRows.map((p) => ({
        ...toPublicProfile(p),
        ratingAvg: p.rating_avg,
        ratingCount: p.rating_count,
      })),
      ...userRows.map((u) => ({
        ...toPublicPersonFromUser(u),
        ratingAvg: u.rating_avg,
        ratingCount: u.rating_count,
      })),
    ]
      .sort((a, b) => b.ratingAvg - a.ratingAvg || b.ratingCount - a.ratingCount)
      .slice(0, 20);

    res.json(board);
  });

  app.post("/api/ratings", (req, res) => {
    const userId = getUserId(req);
    const { targetId, targetType, score } = req.body || {};
    if (!userId) return res.status(401).json({ error: "Нужен X-User-Id" });
    if (!targetId || !["profile", "user"].includes(targetType)) {
      return res.status(400).json({ error: "Некорректная цель" });
    }
    const s = Number(score);
    if (!Number.isInteger(s) || s < 1 || s > 5) {
      return res.status(400).json({ error: "Оценка от 1 до 5" });
    }
    if (targetType === "user" && targetId === userId) {
      return res.status(400).json({ error: "Нельзя оценить себя" });
    }

    db.prepare(
      `INSERT INTO ratings (id, user_id, target_id, target_type, score)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(user_id, target_id, target_type) DO UPDATE SET score = excluded.score`
    ).run(randomUUID(), userId, targetId, targetType, s);

    res.json(getRatingStats(targetId, targetType));
  });

  function syncMatchesFromSwipes(userId) {
    const me = getCurrentUser(userId);
    if (!me || !validateGender(me.gender)) return;
    const targetGender = oppositeGender(me.gender);
    const liked = db
      .prepare(
        `SELECT p.id FROM profiles p
         INNER JOIN swipes s ON s.profile_id = p.id AND s.user_id = ? AND s.liked = 1
         WHERE p.gender = ?
           AND NOT EXISTS (
             SELECT 1 FROM profile_likes pl
             WHERE pl.profile_id = p.id AND pl.user_id = ?
           )`
      )
      .all(userId, targetGender, userId);
    for (const r of liked) createMatch(userId, r.id, "profile");
  }

  app.get("/api/matches", (req, res) => {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Нужен X-User-Id" });

    syncMatchesFromSwipes(userId);
    repairMatches(userId);

    const rows = db
      .prepare("SELECT * FROM matches WHERE user_id = ? ORDER BY created_at DESC")
      .all(userId);

    res.json(
      rows
        .map(enrichMatch)
        .filter((m) => m.peer && m.peer.name)
    );
  });

  app.get("/api/matches/:matchId/messages", (req, res) => {
    const userId = getUserId(req);
    const { matchId } = req.params;
    if (!userId) return res.status(401).json({ error: "Нужен X-User-Id" });

    const match = getMatchForUser(matchId, userId);
    if (!match) return res.status(404).json({ error: "Матч не найден" });

    const after = req.query.after || "";
    const messages = after
      ? db
          .prepare(
            `SELECT * FROM messages WHERE match_id = ? AND created_at > (
               SELECT created_at FROM messages WHERE id = ?
             ) ORDER BY created_at ASC`
          )
          .all(matchId, after)
      : db
          .prepare("SELECT * FROM messages WHERE match_id = ? ORDER BY created_at ASC")
          .all(matchId);

    res.json(
      messages.map((m) => ({
        id: m.id,
        senderId: m.sender_id,
        body: m.body,
        createdAt: m.created_at,
        mine: m.sender_id === userId,
      }))
    );
  });

  app.post("/api/matches/:matchId/messages", (req, res) => {
    const userId = getUserId(req);
    const { matchId } = req.params;
    const body = String(req.body?.text || "").trim().slice(0, 500);
    if (!userId) return res.status(401).json({ error: "Нужен X-User-Id" });
    if (!body) return res.status(400).json({ error: "Пустое сообщение" });

    const match = getMatchForUser(matchId, userId);
    if (!match) return res.status(404).json({ error: "Матч не найден" });

    const id = randomUUID();
    db.prepare(
      "INSERT INTO messages (id, match_id, sender_id, body) VALUES (?, ?, ?, ?)"
    ).run(id, matchId, userId, body);

    if (match.peer_type === "profile") {
      const replies = [
        "Привет! Рада знакомству 😊",
        "Классно, давай пообщаемся!",
        "Спасибо за сообщение!",
      ];
      const reply = replies[Math.floor(Math.random() * replies.length)];
      db.prepare(
        "INSERT INTO messages (id, match_id, sender_id, body) VALUES (?, ?, ?, ?)"
      ).run(randomUUID(), matchId, match.peer_id, reply);
    }

    res.status(201).json({ id });
  });

  app.post("/api/calls", (req, res) => {
    const userId = getUserId(req);
    const { matchId } = req.body || {};
    if (!userId) return res.status(401).json({ error: "Нужен X-User-Id" });

    const match = getMatchForUser(matchId, userId);
    if (!match) return res.status(404).json({ error: "Матч не найден" });

    const active = db
      .prepare(
        `SELECT id FROM calls WHERE match_id = ? AND status IN ('ringing', 'active')`
      )
      .get(matchId);
    if (active) return res.status(409).json({ error: "Звонок уже идёт" });

    const callId = randomUUID();
    const calleeId = match.peer_type === "user" ? match.peer_id : `bot:${match.peer_id}`;
    db.prepare(
      `INSERT INTO calls (id, match_id, caller_id, callee_id, status)
       VALUES (?, ?, ?, ?, 'ringing')`
    ).run(callId, matchId, userId, calleeId);

    res.status(201).json({ callId, status: "ringing" });
  });

  app.get("/api/calls/incoming", (req, res) => {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Нужен X-User-Id" });

    const call = db
      .prepare(
        `SELECT c.* FROM calls c
         INNER JOIN matches m ON m.id = c.match_id AND m.user_id = ?
         WHERE c.callee_id = ? AND c.status = 'ringing'
         ORDER BY c.created_at DESC LIMIT 1`
      )
      .get(userId, userId);

    if (!call) return res.json(null);

    const match = enrichMatch(getMatchForUser(call.match_id, userId));
    res.json({ callId: call.id, match, callerId: call.caller_id });
  });

  app.get("/api/calls/:callId", (req, res) => {
    const userId = getUserId(req);
    const call = db.prepare("SELECT * FROM calls WHERE id = ?").get(req.params.callId);
    if (!call) return res.status(404).json({ error: "Звонок не найден" });

    const match = getMatchForUser(call.match_id, userId);
    if (!match && call.caller_id !== userId && call.callee_id !== userId) {
      return res.status(403).json({ error: "Нет доступа" });
    }

    res.json({
      callId: call.id,
      matchId: call.match_id,
      status: call.status,
      callerId: call.caller_id,
      calleeId: call.callee_id,
    });
  });

  app.post("/api/calls/:callId/accept", (req, res) => {
    const userId = getUserId(req);
    const call = db.prepare("SELECT * FROM calls WHERE id = ?").get(req.params.callId);
    if (!call) return res.status(404).json({ error: "Звонок не найден" });
    if (call.status !== "ringing") {
      return res.status(400).json({ error: "Звонок недоступен" });
    }

    db.prepare(
      "UPDATE calls SET status = 'active' WHERE id = ?"
    ).run(call.id);

    res.json({ callId: call.id, status: "active" });
  });

  app.post("/api/calls/:callId/end", (req, res) => {
    const call = db.prepare("SELECT * FROM calls WHERE id = ?").get(req.params.callId);
    if (!call) return res.status(404).json({ error: "Звонок не найден" });

    db.prepare(
      `UPDATE calls SET status = 'ended', ended_at = datetime('now') WHERE id = ?`
    ).run(call.id);

    res.json({ ok: true });
  });

  app.post("/api/calls/:callId/signal", (req, res) => {
    const userId = getUserId(req);
    const { type, payload } = req.body || {};
    if (!userId) return res.status(401).json({ error: "Нужен X-User-Id" });
    if (!type || payload === undefined) {
      return res.status(400).json({ error: "Нужны type и payload" });
    }

    const call = db.prepare("SELECT * FROM calls WHERE id = ?").get(req.params.callId);
    if (!call) return res.status(404).json({ error: "Звонок не найден" });

    db.prepare(
      `INSERT INTO call_signals (call_id, from_user_id, type, payload)
       VALUES (?, ?, ?, ?)`
    ).run(call.id, userId, type, JSON.stringify(payload));

    if (String(call.callee_id).startsWith("bot:") && type === "offer") {
      db.prepare(
        `INSERT INTO call_signals (call_id, from_user_id, type, payload)
         VALUES (?, ?, 'answer', ?)`
      ).run(
        call.id,
        call.callee_id,
        JSON.stringify({ type: "answer", sdp: "bot-simulated" })
      );
      db.prepare("UPDATE calls SET status = 'active' WHERE id = ?").run(call.id);
    }

    res.json({ ok: true });
  });

  app.get("/api/calls/:callId/signals", (req, res) => {
    const userId = getUserId(req);
    const after = Number(req.query.after || 0);
    const call = db.prepare("SELECT * FROM calls WHERE id = ?").get(req.params.callId);
    if (!call) return res.status(404).json({ error: "Звонок не найден" });

    const rows = db
      .prepare(
        `SELECT id, from_user_id, type, payload, created_at
         FROM call_signals WHERE call_id = ? AND id > ?
         ORDER BY id ASC`
      )
      .all(call.id, after);

    res.json(
      rows.map((r) => ({
        id: r.id,
        fromUserId: r.from_user_id,
        type: r.type,
        payload: JSON.parse(r.payload),
      }))
    );
  });

  function seedRatings() {
    const count = db.prepare("SELECT COUNT(*) AS n FROM ratings").get().n;
    if (count > 0) return;

    const profiles = db.prepare("SELECT id FROM profiles").all();
    const insert = db.prepare(
      `INSERT INTO ratings (id, user_id, target_id, target_type, score)
       VALUES (?, 'seed', ?, 'profile', ?)`
    );
    const scores = [5, 4, 5, 3, 4, 5, 4, 3];
    profiles.forEach((p, i) => {
      insert.run(randomUUID(), p.id, scores[i % scores.length]);
    });
  }

  seedRatings();

  return { createMatch, enrichMatch, getRatingStats, toPublicProfile, toPublicPersonFromUser };
}
