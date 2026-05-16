import express from "express";
import Database from "better-sqlite3";
import { randomUUID, scryptSync, timingSafeEqual } from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import multer from "multer";
import { registerSocialRoutes } from "./social.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const UPLOADS_DIR = path.join(DATA_DIR, "uploads");
const DEFAULT_PHOTO = "/icons/icon-192.png";

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const app = express();
app.use(express.json());

const db = new Database(path.join(DATA_DIR, "tinderu.db"));
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS profiles (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    age INTEGER NOT NULL,
    bio TEXT NOT NULL,
    photo TEXT NOT NULL,
    gender TEXT NOT NULL DEFAULT 'female'
  );

  CREATE TABLE IF NOT EXISTS swipes (
    user_id TEXT NOT NULL,
    profile_id TEXT NOT NULL,
    liked INTEGER NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, profile_id)
  );

  CREATE TABLE IF NOT EXISTS profile_likes (
    profile_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (profile_id, user_id),
    FOREIGN KEY (profile_id) REFERENCES profiles(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
`);

function migrateUsers() {
  const cols = db.prepare("PRAGMA table_info(users)").all();
  if (cols.length === 0) {
    db.exec(`
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        login TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        name TEXT NOT NULL,
        date_of_birth TEXT NOT NULL,
        gender TEXT NOT NULL,
        bio TEXT NOT NULL DEFAULT '',
        photo TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now'))
      );
    `);
    return;
  }
  if (!cols.some((c) => c.name === "login")) {
    db.exec(`
      CREATE TABLE users_new (
        id TEXT PRIMARY KEY,
        login TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        name TEXT NOT NULL,
        date_of_birth TEXT NOT NULL,
        gender TEXT NOT NULL DEFAULT 'male',
        bio TEXT NOT NULL DEFAULT '',
        photo TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now'))
      );
      DROP TABLE users;
      ALTER TABLE users_new RENAME TO users;
    `);
    return;
  }
  if (!cols.some((c) => c.name === "gender")) {
    db.exec(`ALTER TABLE users ADD COLUMN gender TEXT NOT NULL DEFAULT 'male'`);
  }
  if (!cols.some((c) => c.name === "bio")) {
    db.exec(`ALTER TABLE users ADD COLUMN bio TEXT NOT NULL DEFAULT ''`);
  }
}

function migrateProfilesGender() {
  const cols = db.prepare("PRAGMA table_info(profiles)").all();
  if (!cols.some((c) => c.name === "gender")) {
    db.exec(`ALTER TABLE profiles ADD COLUMN gender TEXT NOT NULL DEFAULT 'female'`);
  }
  db.prepare(
    `UPDATE profiles SET gender = 'female' WHERE name IN ('Аня', 'Лена', 'София', 'Катя')`
  ).run();
  db.prepare(
    `UPDATE profiles SET gender = 'male' WHERE name IN ('Макс', 'Игорь', 'Дима', 'Олег')`
  ).run();
}

migrateUsers();
migrateProfilesGender();

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOADS_DIR,
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase() || ".jpg";
      cb(null, `${randomUUID()}${ext}`);
    },
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = ["image/jpeg", "image/png", "image/webp"].includes(file.mimetype);
    cb(ok ? null : new Error("Только JPEG, PNG или WebP"), ok);
  },
});

function hashPassword(password) {
  const salt = randomUUID();
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const a = Buffer.from(hash, "hex");
  const b = scryptSync(password, salt, 64);
  return a.length === b.length && timingSafeEqual(a, b);
}

function calcAge(dateOfBirth) {
  const born = new Date(dateOfBirth);
  const today = new Date();
  let age = today.getFullYear() - born.getFullYear();
  const m = today.getMonth() - born.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < born.getDate())) age--;
  return age;
}

function validateGender(gender) {
  return gender === "male" || gender === "female";
}

function oppositeGender(gender) {
  return gender === "male" ? "female" : "male";
}

function genderLabel(gender) {
  return gender === "male" ? "Мужской" : "Женский";
}

function toPublicUser(row, rating) {
  return {
    id: row.id,
    login: row.login,
    name: row.name,
    dateOfBirth: row.date_of_birth,
    age: calcAge(row.date_of_birth),
    gender: row.gender,
    genderLabel: genderLabel(row.gender),
    bio: row.bio || "",
    photo: row.photo,
    ratingAvg: rating?.ratingAvg ?? 0,
    ratingCount: rating?.ratingCount ?? 0,
  };
}

function normalizeLogin(login) {
  return String(login || "")
    .trim()
    .toLowerCase();
}

function validateLogin(login) {
  return /^[a-z0-9_]{3,32}$/.test(login);
}

function validateDateOfBirth(dob) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dob)) return false;
  const date = new Date(dob);
  if (Number.isNaN(date.getTime())) return false;
  const age = calcAge(dob);
  return age >= 18 && age <= 120;
}

function deleteUpload(photoPath) {
  if (!photoPath || !photoPath.startsWith("/uploads/")) return;
  const file = path.join(DATA_DIR, photoPath.replace(/^\/uploads\//, "uploads/"));
  if (fs.existsSync(file)) fs.unlinkSync(file);
}

function seedProfileLikes(userId, userGender) {
  const targetGender = oppositeGender(userGender);
  const likers = db
    .prepare(
      "SELECT id FROM profiles WHERE gender = ? ORDER BY RANDOM() LIMIT 2"
    )
    .all(targetGender);
  const likeBack = db.prepare(
    "INSERT OR IGNORE INTO profile_likes (profile_id, user_id) VALUES (?, ?)"
  );
  for (const p of likers) likeBack.run(p.id, userId);
}

function seedProfiles() {
  const count = db.prepare("SELECT COUNT(*) AS n FROM profiles").get().n;
  if (count > 0) return;

  const profiles = [
    { name: "Аня", age: 24, bio: "Кофе, прогулки и хорошие сериалы.", photo: "https://picsum.photos/seed/anya/600/800", gender: "female" },
    { name: "Макс", age: 27, bio: "Бегаю по утрам, готовлю по вечерам.", photo: "https://picsum.photos/seed/max/600/800", gender: "male" },
    { name: "Лена", age: 22, bio: "Дизайн, музеи и спонтанные поездки.", photo: "https://picsum.photos/seed/lena/600/800", gender: "female" },
    { name: "Игорь", age: 29, bio: "Настолки, джаз и длинные разговоры.", photo: "https://picsum.photos/seed/igor/600/800", gender: "male" },
    { name: "София", age: 26, bio: "Йога, книги и море.", photo: "https://picsum.photos/seed/sofia/600/800", gender: "female" },
    { name: "Дима", age: 25, bio: "Фото, велосипед и street food.", photo: "https://picsum.photos/seed/dima/600/800", gender: "male" },
    { name: "Катя", age: 23, bio: "Танцы, театр и домашние растения.", photo: "https://picsum.photos/seed/katya/600/800", gender: "female" },
    { name: "Олег", age: 30, bio: "Горы, кемпинг и хороший кофе.", photo: "https://picsum.photos/seed/oleg/600/800", gender: "male" },
  ];

  const insert = db.prepare(
    "INSERT INTO profiles (id, name, age, bio, photo, gender) VALUES (?, ?, ?, ?, ?, ?)"
  );
  const insertMany = db.transaction((rows) => {
    for (const p of rows) {
      insert.run(randomUUID(), p.name, p.age, p.bio, p.photo, p.gender);
    }
  });
  insertMany(profiles);
}

function seedDemoUsers() {
  const demos = [
    {
      login: "demo_anna",
      password: "demo123",
      name: "Анна",
      dateOfBirth: "1998-03-15",
      gender: "female",
      bio: "Демо-аккаунт для теста",
    },
    {
      login: "demo_ivan",
      password: "demo123",
      name: "Иван",
      dateOfBirth: "1995-07-20",
      gender: "male",
      bio: "Демо-аккаунт для теста",
    },
  ];

  const exists = db.prepare("SELECT 1 FROM users WHERE login = ?");
  const insert = db.prepare(
    `INSERT INTO users (id, login, password_hash, name, date_of_birth, gender, bio, photo)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );

  for (const d of demos) {
    if (exists.get(d.login)) continue;
    const id = randomUUID();
    insert.run(
      id,
      d.login,
      hashPassword(d.password),
      d.name,
      d.dateOfBirth,
      d.gender,
      d.bio,
      DEFAULT_PHOTO
    );
    seedProfileLikes(id, d.gender);
  }
}

seedProfiles();
seedDemoUsers();

const social = registerSocialRoutes(app, db, {
  getUserId: (req) => req.headers["x-user-id"] || req.body?.userId,
  getCurrentUser,
  oppositeGender,
  validateGender,
  calcAge,
  genderLabel,
  toPublicUser: (row) => {
    const stats = db
      .prepare(
        `SELECT ROUND(AVG(score), 1) AS ratingAvg, COUNT(*) AS ratingCount
         FROM ratings WHERE target_id = ? AND target_type = 'user'`
      )
      .get(row.id);
    return toPublicUser(row, {
      ratingAvg: stats?.ratingAvg ?? 0,
      ratingCount: stats?.ratingCount ?? 0,
    });
  },
});

function getUserId(req) {
  return req.headers["x-user-id"] || req.body?.userId;
}

function getCurrentUser(userId) {
  return db.prepare("SELECT * FROM users WHERE id = ?").get(userId);
}

app.get("/api/health", (_req, res) => {
  const profiles = db.prepare("SELECT COUNT(*) AS n FROM profiles").get().n;
  res.json({ ok: true, profiles });
});

app.post("/api/auth/register", (req, res) => {
  upload.single("photo")(req, res, (err) => {
    if (err) {
      return res.status(400).json({ error: err.message || "Ошибка загрузки фото" });
    }

    const login = normalizeLogin(req.body?.login);
    const password = String(req.body?.password || "");
    const name = String(req.body?.name || "").trim();
    const dateOfBirth = String(req.body?.dateOfBirth || "").trim();
    const gender = String(req.body?.gender || "").trim();
    const bio = String(req.body?.bio || "").trim().slice(0, 200);

    if (!validateLogin(login)) {
      if (req.file) fs.unlinkSync(req.file.path);
      return res.status(400).json({
        error: "Логин: 3–32 символа, латиница, цифры и _",
      });
    }
    if (password.length < 4) {
      if (req.file) fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: "Пароль минимум 4 символа" });
    }
    if (!name || name.length > 40) {
      if (req.file) fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: "Укажите имя (до 40 символов)" });
    }
    if (!validateDateOfBirth(dateOfBirth)) {
      if (req.file) fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: "Дата рождения: вам должно быть 18+" });
    }
    if (!validateGender(gender)) {
      if (req.file) fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: "Укажите пол" });
    }
    const exists = db.prepare("SELECT 1 FROM users WHERE login = ?").get(login);
    if (exists) {
      if (req.file) fs.unlinkSync(req.file.path);
      return res.status(409).json({ error: "Такой логин уже занят" });
    }

    const id = randomUUID();
    const photo = req.file ? `/uploads/${req.file.filename}` : DEFAULT_PHOTO;
    db.prepare(
      `INSERT INTO users (id, login, password_hash, name, date_of_birth, gender, bio, photo)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, login, hashPassword(password), name, dateOfBirth, gender, bio, photo);

    seedProfileLikes(id, gender);
    const user = db.prepare("SELECT * FROM users WHERE id = ?").get(id);
    res.status(201).json(social.toPublicPersonFromUser(user));
  });
});

app.post("/api/auth/login", (req, res) => {
  const login = normalizeLogin(req.body?.login);
  const password = String(req.body?.password || "");

  if (!login || !password) {
    return res.status(400).json({ error: "Введите логин и пароль" });
  }

  const row = db.prepare("SELECT * FROM users WHERE login = ?").get(login);
  if (!row || !verifyPassword(password, row.password_hash)) {
    return res.status(401).json({ error: "Неверный логин или пароль" });
  }

  res.json(social.toPublicPersonFromUser(row));
});

app.get("/api/auth/me", (req, res) => {
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ error: "Нужен X-User-Id" });

  const row = getCurrentUser(userId);
  if (!row) return res.status(404).json({ error: "Пользователь не найден" });
  res.json(social.toPublicPersonFromUser(row));
});

app.patch("/api/auth/me", (req, res) => {
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ error: "Нужен X-User-Id" });

  const current = getCurrentUser(userId);
  if (!current) return res.status(404).json({ error: "Пользователь не найден" });

  upload.single("photo")(req, res, (err) => {
    if (err) {
      return res.status(400).json({ error: err.message || "Ошибка загрузки фото" });
    }

    const name = String(req.body?.name ?? current.name).trim();
    const dateOfBirth = String(req.body?.dateOfBirth ?? current.date_of_birth).trim();
    const gender = String(req.body?.gender ?? current.gender).trim();
    const bio = String(req.body?.bio ?? current.bio).trim().slice(0, 200);

    if (!name || name.length > 40) {
      if (req.file) fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: "Укажите имя (до 40 символов)" });
    }
    if (!validateDateOfBirth(dateOfBirth)) {
      if (req.file) fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: "Дата рождения: вам должно быть 18+" });
    }
    if (!validateGender(gender)) {
      if (req.file) fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: "Укажите пол" });
    }

    let photo = current.photo;
    if (req.file) {
      deleteUpload(current.photo);
      photo = `/uploads/${req.file.filename}`;
    }

    db.prepare(
      `UPDATE users SET name = ?, date_of_birth = ?, gender = ?, bio = ?, photo = ?
       WHERE id = ?`
    ).run(name, dateOfBirth, gender, bio, photo, userId);

    const row = getCurrentUser(userId);
    res.json(social.toPublicPersonFromUser(row));
  });
});

app.get("/api/cards", (req, res) => {
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ error: "Нужен X-User-Id" });

  const me = getCurrentUser(userId);
  if (!me) return res.status(404).json({ error: "Пользователь не найден" });
  if (!validateGender(me.gender)) {
    return res.status(400).json({ error: "Укажите пол в профиле" });
  }

  const targetGender = oppositeGender(me.gender);

  const cards = db
    .prepare(
      `SELECT p.id, p.name, p.age, p.bio, p.photo, p.gender
       FROM profiles p
       WHERE p.gender = ?
         AND p.id NOT IN (SELECT profile_id FROM swipes WHERE user_id = ?)
       ORDER BY RANDOM()
       LIMIT 20`
    )
    .all(targetGender, userId);

  res.json(cards);
});

app.post("/api/swipe", (req, res) => {
  const userId = getUserId(req);
  const { profileId, liked } = req.body || {};
  if (!userId) return res.status(401).json({ error: "Нужен X-User-Id" });
  if (!profileId) return res.status(400).json({ error: "Нужен profileId" });

  const me = getCurrentUser(userId);
  const profile = db.prepare("SELECT id, gender FROM profiles WHERE id = ?").get(profileId);
  if (!profile) return res.status(404).json({ error: "Профиль не найден" });
  if (profile.gender === me.gender) {
    return res.status(400).json({ error: "Нельзя свайпать профиль своего пола" });
  }

  db.prepare(
    `INSERT INTO swipes (user_id, profile_id, liked)
     VALUES (?, ?, ?)
     ON CONFLICT(user_id, profile_id) DO UPDATE SET liked = excluded.liked`
  ).run(userId, profileId, liked ? 1 : 0);

  let match = false;
  if (liked) {
    const mutual = db
      .prepare("SELECT 1 FROM profile_likes WHERE profile_id = ? AND user_id = ?")
      .get(profileId, userId);
    if (mutual) {
      match = true;
      db.prepare(
        "DELETE FROM profile_likes WHERE profile_id = ? AND user_id = ?"
      ).run(profileId, userId);
      social.createMatch(userId, profileId, "profile");
    }
  }

  res.json({ match });
});

app.use("/uploads", express.static(UPLOADS_DIR, { maxAge: "7d", etag: true }));

const publicDir = path.join(__dirname, "..", "public");
app.use(
  express.static(publicDir, {
    etag: true,
    maxAge: "7d",
    setHeaders(res, filePath) {
      if (/\.(html|js|css|webmanifest)$/.test(filePath)) {
        res.setHeader("Cache-Control", "no-cache");
      }
    },
  })
);

app.use((req, res, next) => {
  if (req.method !== "GET" || req.path.startsWith("/api")) return next();
  res.sendFile(path.join(publicDir, "index.html"));
});

app.listen(PORT, () => {
  const profiles = db.prepare("SELECT COUNT(*) AS n FROM profiles").get().n;
  console.log(`Tinderu listening on :${PORT}, seed profiles: ${profiles}`);
});
