const sqlite3 = require("sqlite3").verbose();
const path = require("path");
const fs = require("fs");

const dbFile = path.join(__dirname, "..", "data", "attendance.db");
const dataDir = path.dirname(dbFile);
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new sqlite3.Database(dbFile);

function rawRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

// Enable foreign keys and WAL mode for concurrency
db.serialize(() => {
  db.run('PRAGMA foreign_keys = ON;');
  db.run('PRAGMA journal_mode = WAL;');
  db.run('PRAGMA synchronous = NORMAL;');
  db.run('PRAGMA temp_store = MEMORY;');
  db.run('PRAGMA busy_timeout = 5000;');
});

function rawGet(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, function (err, row) {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function rawAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, function (err, rows) {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

let initPromise = null;

async function run(sql, params = []) {
  await initPromise;
  return rawRun(sql, params);
}

async function get(sql, params = []) {
  await initPromise;
  return rawGet(sql, params);
}

async function all(sql, params = []) {
  await initPromise;
  return rawAll(sql, params);
}

async function colExists(table, column) {
  await initPromise;
  return rawColExists(table, column);
}

// Timezone Helper (UTC+8)
function getNowPH() {
  const d = new Date();
  const offset = 8 * 60; 
  const local = new Date(d.getTime() + (offset * 60 * 1000));
  return local.toISOString().replace('Z', ''); 
}

async function rawColExists(table, column) {
  try {
    const rows = await rawAll(`PRAGMA table_info(${table})`);
    return rows.some(r => r.name === column);
  } catch (e) {
    return false;
  }
}

async function init() {
  // Ensure tables exist first
  await rawRun(`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE, password_hash TEXT, role TEXT, full_name TEXT, year TEXT, section TEXT, avatar TEXT, preferences TEXT, totp_secret TEXT, lockout_until TEXT)`);
  
  if (!(await rawColExists('users', 'totp_secret'))) {
    try {
      await rawRun(`ALTER TABLE users ADD COLUMN totp_secret TEXT`);
    } catch(e) {}
  }
  
  // FIX: Added UNIQUE constraint to 'code' to prevent duplicate courses
  await rawRun(`CREATE TABLE IF NOT EXISTS courses (id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT UNIQUE, name TEXT, schedule TEXT, assigned_faculty TEXT, is_online INTEGER DEFAULT 0)`);
  
  await rawRun(`CREATE TABLE IF NOT EXISTS student_courses (id INTEGER PRIMARY KEY AUTOINCREMENT, student_id INTEGER, course_id INTEGER, FOREIGN KEY(student_id) REFERENCES users(id) ON DELETE CASCADE, FOREIGN KEY(course_id) REFERENCES courses(id) ON DELETE CASCADE)`);
  
  await rawRun(`CREATE TABLE IF NOT EXISTS attendance_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, student_id INTEGER, course_id INTEGER, room_id INTEGER, session_id INTEGER, student_qr TEXT, timestamp TEXT, status TEXT, remarks TEXT, reason TEXT, marked_by_professor INTEGER, attendance_method TEXT, FOREIGN KEY(student_id) REFERENCES users(id) ON DELETE CASCADE, FOREIGN KEY(course_id) REFERENCES courses(id) ON DELETE CASCADE, FOREIGN KEY(session_id) REFERENCES attendance_sessions(id) ON DELETE CASCADE)`);
  
  await rawRun(`CREATE TABLE IF NOT EXISTS attendance_sessions (id INTEGER PRIMARY KEY AUTOINCREMENT, course_id INTEGER, room_id INTEGER, created_by INTEGER, created_at TEXT, expires_at TEXT, status TEXT, entry_code TEXT, mode TEXT DEFAULT 'PHYSICAL', FOREIGN KEY(course_id) REFERENCES courses(id) ON DELETE CASCADE)`);
  
  if (!(await rawColExists('attendance_sessions', 'entry_code'))) {
    try { await rawRun(`ALTER TABLE attendance_sessions ADD COLUMN entry_code TEXT`); } catch (e) {}
  }
  if (!(await rawColExists('attendance_sessions', 'mode'))) {
    try { await rawRun(`ALTER TABLE attendance_sessions ADD COLUMN mode TEXT DEFAULT 'PHYSICAL'`); } catch (e) {}
  }

  // Add room_id, reason, session_id if they don't exist (for existing DBs)
  if (!(await rawColExists('attendance_logs', 'room_id'))) {
    try {
      await rawRun(`ALTER TABLE attendance_logs ADD COLUMN room_id INTEGER`);
    } catch (e) {}
  }
  if (!(await rawColExists('attendance_logs', 'reason'))) {
    try {
      await rawRun(`ALTER TABLE attendance_logs ADD COLUMN reason TEXT`);
    } catch (e) {}
  }
  if (!(await rawColExists('attendance_logs', 'session_id'))) {
    try {
      await rawRun(`ALTER TABLE attendance_logs ADD COLUMN session_id INTEGER`);
    } catch (e) {}
  }

  if (!(await rawColExists('attendance_logs', 'marked_by_professor'))) {
    try { await rawRun(`ALTER TABLE attendance_logs ADD COLUMN marked_by_professor INTEGER`); } catch (e) {}
  }
  if (!(await rawColExists('attendance_logs', 'attendance_method'))) {
    try { await rawRun(`ALTER TABLE attendance_logs ADD COLUMN attendance_method TEXT`); } catch (e) {}
  }
  
  await rawRun(`CREATE TABLE IF NOT EXISTS rooms (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, type TEXT, capacity INTEGER)`);
  
  await rawRun(`CREATE TABLE IF NOT EXISTS excuses (id INTEGER PRIMARY KEY AUTOINCREMENT, student_id INTEGER, course_code TEXT, date TEXT, reason TEXT, status TEXT, timestamp TEXT, FOREIGN KEY(student_id) REFERENCES users(id) ON DELETE CASCADE)`);
  
  await rawRun(`CREATE TABLE IF NOT EXISTS audit_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, username TEXT, action TEXT, details TEXT, severity TEXT, ip_address TEXT, user_agent TEXT, timestamp TEXT, FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE)`);
  
  if (!(await rawColExists('audit_logs', 'severity'))) {
    try { await rawRun(`ALTER TABLE audit_logs ADD COLUMN severity TEXT`); } catch (e) {}
  }
  if (!(await rawColExists('audit_logs', 'ip_address'))) {
    try { await rawRun(`ALTER TABLE audit_logs ADD COLUMN ip_address TEXT`); } catch (e) {}
  }
  if (!(await rawColExists('audit_logs', 'user_agent'))) {
    try { await rawRun(`ALTER TABLE audit_logs ADD COLUMN user_agent TEXT`); } catch (e) {}
  }

  // Security & Trust additions
  if (!(await rawColExists('attendance_sessions', 'latitude'))) {
    try { await rawRun(`ALTER TABLE attendance_sessions ADD COLUMN latitude REAL`); } catch (e) {}
  }
  if (!(await rawColExists('attendance_sessions', 'longitude'))) {
    try { await rawRun(`ALTER TABLE attendance_sessions ADD COLUMN longitude REAL`); } catch (e) {}
  }
  if (!(await rawColExists('attendance_sessions', 'ip_address'))) {
    try { await rawRun(`ALTER TABLE attendance_sessions ADD COLUMN ip_address TEXT`); } catch (e) {}
  }
  if (!(await rawColExists('attendance_sessions', 'meeting_link'))) {
    try { await rawRun(`ALTER TABLE attendance_sessions ADD COLUMN meeting_link TEXT`); } catch (e) {}
  }
  
  if (!(await rawColExists('attendance_logs', 'device_fingerprint'))) {
    try { await rawRun(`ALTER TABLE attendance_logs ADD COLUMN device_fingerprint TEXT`); } catch (e) {}
  }
  if (!(await rawColExists('attendance_logs', 'latitude'))) {
    try { await rawRun(`ALTER TABLE attendance_logs ADD COLUMN latitude REAL`); } catch (e) {}
  }
  if (!(await rawColExists('attendance_logs', 'longitude'))) {
    try { await rawRun(`ALTER TABLE attendance_logs ADD COLUMN longitude REAL`); } catch (e) {}
  }
  if (!(await rawColExists('attendance_logs', 'ip_address'))) {
    try { await rawRun(`ALTER TABLE attendance_logs ADD COLUMN ip_address TEXT`); } catch (e) {}
  }
  if (!(await rawColExists('attendance_logs', 'risk_score'))) {
    try { await rawRun(`ALTER TABLE attendance_logs ADD COLUMN risk_score TEXT`); } catch (e) {}
  }
  if (!(await rawColExists('attendance_logs', 'risk_flags'))) {
    try { await rawRun(`ALTER TABLE attendance_logs ADD COLUMN risk_flags TEXT`); } catch (e) {}
  }
  if (!(await rawColExists('attendance_logs', 'session_joined_at'))) {
    try { await rawRun(`ALTER TABLE attendance_logs ADD COLUMN session_joined_at TEXT`); } catch (e) {}
  }
  if (!(await rawColExists('attendance_logs', 'last_heartbeat'))) {
    try { await rawRun(`ALTER TABLE attendance_logs ADD COLUMN last_heartbeat TEXT`); } catch (e) {}
  }
  if (!(await rawColExists('attendance_logs', 'continuity_status'))) {
    try { await rawRun(`ALTER TABLE attendance_logs ADD COLUMN continuity_status TEXT`); } catch (e) {}
  }
  if (!(await rawColExists('attendance_logs', 'interruption_reason'))) {
    try { await rawRun(`ALTER TABLE attendance_logs ADD COLUMN interruption_reason TEXT`); } catch (e) {}
  }

  // Ensure faculty_code exists in users before referencing it
  if (!(await rawColExists('users', 'faculty_code'))) {
    try { await rawRun(`ALTER TABLE users ADD COLUMN faculty_code TEXT UNIQUE`); } catch (e) {}
  }

  // Ensure faculty_code exists in courses before referencing it
  if (!(await rawColExists('courses', 'faculty_code'))) {
    try { await rawRun(`ALTER TABLE courses ADD COLUMN faculty_code TEXT`); } catch (e) {}
  }

  // Ensure app_username exists in users before referencing it
  if (!(await rawColExists('users', 'app_username'))) {
    try { await rawRun(`ALTER TABLE users ADD COLUMN app_username TEXT UNIQUE`); } catch (e) {}
  }

  // App Username migration for existing users
  try {
    const colExistsAppUsername = await rawColExists('users', 'app_username');
    if (colExistsAppUsername) {
      const usersWithoutAppUsername = await rawAll(`SELECT id, full_name, username FROM users WHERE app_username IS NULL`);
      for (const u of usersWithoutAppUsername) {
        let baseName = '';
        if (u.username === 'admin') baseName = 'admin';
        else if (u.full_name) baseName = u.full_name.toLowerCase().replace(/[^a-z0-9]/g, ' ').trim().replace(/\s+/g, '.');
        else baseName = u.username.toLowerCase().replace(/[^a-z0-9]/g, '');
        
        if (!baseName) baseName = 'user' + u.id;
        
        let candidate = baseName;
        let counter = 1;
        while (true) {
          const check = await rawGet(`SELECT id FROM users WHERE app_username = ? AND id != ?`, [candidate, u.id]);
          if (!check) break;
          counter++;
          candidate = `${baseName}${counter}`;
        }
        await rawRun(`UPDATE users SET app_username = ? WHERE id = ?`, [candidate, u.id]);
      }
    }
  } catch(e) {
    console.error("Migration Error for app username", e);
  }

  // Faculty Code migration for existing professors
  try {
    const colExistsFacultyCodeUsers = await rawColExists('users', 'faculty_code');
    const colExistsFacultyCodeCourses = await rawColExists('courses', 'faculty_code');
    
    if (colExistsFacultyCodeUsers && colExistsFacultyCodeCourses) {
      const profs = await rawAll(`SELECT id, username, full_name, faculty_code FROM users WHERE role = 'professor'`);
      for (const p of profs) {
        if (!p.faculty_code) {
          const code = `P-${p.id.toString().padStart(4, '0')}`;
          await rawRun(`UPDATE users SET faculty_code = ? WHERE id = ?`, [code, p.id]);
          
          let facultyMatch = p.full_name ? `%${p.full_name.split(' ').pop()}%` : '%XXX%';
          if (p.full_name && p.full_name.includes(',')) {
              facultyMatch = `%${p.full_name.split(',')[0]}%`;
          }
          await rawRun(`UPDATE courses SET faculty_code = ? WHERE (assigned_faculty LIKE ? OR assigned_faculty = ?) AND faculty_code IS NULL`, [code, facultyMatch, p.username]);
          // catch "COSTALES, JEFFERSON" matching specifically since seed DB uses this format
          if (p.full_name && p.full_name.toLowerCase().includes('costales')) {
               await rawRun(`UPDATE courses SET faculty_code = ? WHERE assigned_faculty LIKE '%COSTALES%' AND faculty_code IS NULL`, [code]);
          }
        }
      }
    }
  } catch (e) {
    console.error("Migration Error for faculty code", e);
  }
  
  // FIX: Enforce attendance uniqueness at the database level
  // First, clean up existing duplicates to ensure index creation succeeds
  try {
    await rawRun(`DELETE FROM attendance_logs WHERE rowid NOT IN (SELECT min(rowid) FROM attendance_logs WHERE session_id IS NOT NULL GROUP BY student_id, session_id) AND session_id IS NOT NULL`);
  } catch (e) {
    console.error("Cleanup session logs error:", e);
  }
  try {
    await rawRun(`DELETE FROM attendance_logs WHERE rowid NOT IN (SELECT min(rowid) FROM attendance_logs WHERE session_id IS NULL GROUP BY student_id, course_id, substr(timestamp, 1, 10)) AND session_id IS NULL`);
  } catch (e) {
    console.error("Cleanup course logs error:", e);
  }

  // HARD INTEGRITY FIX: Try making them unique constraints on the table if possible, 
  // but since table exists, we use UNIQUE INDEXes. We must ensure they are created.
  try {
    await rawRun(`CREATE UNIQUE INDEX IF NOT EXISTS unq_attendance_session ON attendance_logs(student_id, session_id) WHERE session_id IS NOT NULL`);
  } catch (e) {
     console.error("Failed to create unq_attendance_session index. This is critical for data integrity.", e);
  }
  try {
    // For online/NULL session check-ins, only one per day per course
    await rawRun(`CREATE UNIQUE INDEX IF NOT EXISTS unq_attendance_course_date ON attendance_logs(student_id, course_id, substr(timestamp, 1, 10)) WHERE session_id IS NULL`);
  } catch (e) {
     console.error("Failed to create unq_attendance_course_date index.", e);
  }

  // Performance Indexes for Fast Lookups & Sub-millisecond Queries
  try {
    await rawRun(`CREATE INDEX IF NOT EXISTS idx_att_student ON attendance_logs(student_id)`);
    await rawRun(`CREATE INDEX IF NOT EXISTS idx_att_course ON attendance_logs(course_id)`);
    await rawRun(`CREATE INDEX IF NOT EXISTS idx_att_session ON attendance_logs(session_id)`);
    await rawRun(`CREATE INDEX IF NOT EXISTS idx_att_status ON attendance_logs(status)`);
    await rawRun(`CREATE INDEX IF NOT EXISTS idx_att_time ON attendance_logs(timestamp)`);
    await rawRun(`CREATE INDEX IF NOT EXISTS idx_sc_student ON student_courses(student_id)`);
    await rawRun(`CREATE INDEX IF NOT EXISTS idx_sc_course ON student_courses(course_id)`);
    await rawRun(`CREATE INDEX IF NOT EXISTS idx_as_course ON attendance_sessions(course_id)`);
  } catch (e) {
    console.error("Performance indexes creation error:", e);
  }
  
  if (!(await rawColExists('users', 'lockout_until'))) {
    try { await rawRun(`ALTER TABLE users ADD COLUMN lockout_until TEXT`); } catch (e) {}
  }
  
  await rawRun(`CREATE TABLE IF NOT EXISTS announcements (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, content TEXT, type TEXT, created_by TEXT, timestamp TEXT)`);
  try { await rawRun(`ALTER TABLE announcements ADD COLUMN course_id INTEGER`); } catch (e) {}
  try { await rawRun(`ALTER TABLE announcements ADD COLUMN is_pinned INTEGER DEFAULT 0`); } catch (e) {}

  await rawRun(`CREATE TABLE IF NOT EXISTS professor_notes (id INTEGER PRIMARY KEY AUTOINCREMENT, professor_id INTEGER, student_id INTEGER, note_text TEXT, tag TEXT, updated_at TEXT, FOREIGN KEY(professor_id) REFERENCES users(id) ON DELETE CASCADE, FOREIGN KEY(student_id) REFERENCES users(id) ON DELETE CASCADE)`);

  const roomsCheck = await rawGet(`SELECT COUNT(*) AS c FROM rooms`);
  if (roomsCheck.c === 0) {
     const roomsList = [
       { name: "Room 101", type: "Lecture Hall", capacity: 50 },
       { name: "Lab A", type: "Computer Lab", capacity: 30 },
       { name: "Room 205", type: "Classroom", capacity: 40 }
     ];
     for (const r of roomsList) {
       await rawRun(`INSERT OR IGNORE INTO rooms (name, type, capacity) VALUES (?, ?, ?)`, [r.name, r.type, r.capacity]);
     }
  }

  const row = await rawGet(`SELECT COUNT(*) AS c FROM users`);
  if (row.c === 0) {
    console.log("Seeding database...");
    const bcrypt = require("bcryptjs");
    const users = [
      { username: "admin", password: "adminpassword", role: "admin", full_name: "System Admin" },
      { username: "faculty", password: "profpass", role: "professor", full_name: "Prof. Jefferson Costales" },
      { username: "2023-00164-PQ-0", password: "student1", role: "student", full_name: "Julian Student", year: "3", section: "BSIT 3-1" },
      { username: "2023-00212-PQ-0", password: "student2", role: "student", full_name: "Jillian Student", year: "3", section: "BSCpE 3-1" }
    ];

    const hasAppUser = await rawColExists('users', 'app_username');
    const hasFacCode = await rawColExists('users', 'faculty_code');

    for (const u of users) {
      let hash = bcrypt.hashSync(u.password, 10);
      
      let cols = ["username", "password_hash", "role", "full_name", "year", "section", "avatar", "preferences"];
      let vals = [u.username, hash, u.role, u.full_name, u.year || null, u.section || null, 'default', '{"dateFormat":"MM/DD/YYYY","timeFormat":"12h"}'];
      
      if (hasAppUser) {
        cols.push("app_username");
        let appUser = u.username === 'admin' ? 'admin' : (u.username === 'faculty' ? 'faculty' : u.full_name.toLowerCase().replace(/[^a-z0-9]/g, '.'));
        vals.push(appUser);
      }
      
      if (hasFacCode) {
        cols.push("faculty_code");
        if (u.role === 'professor') {
          vals.push("P-0001");
        } else {
          vals.push(null);
        }
      }
      
      const sql = `INSERT INTO users (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`;
      await rawRun(sql, vals);
    }

    const subjects = [
      { code: "COMP 015", name: "Fundamentals of Research", sched: "F 10:30AM-01:30PM" },
      { code: "COMP 016", name: "Web Development", sched: "T/T 09:00AM-02:00PM" }
    ];

    const hasCourseFacCode = await rawColExists('courses', 'faculty_code');

    for (const s of subjects) { 
      if (hasCourseFacCode) {
        await rawRun(`INSERT OR IGNORE INTO courses (code, name, schedule, assigned_faculty, faculty_code) VALUES (?, ?, ?, ?, ?)`, [s.code, s.name, s.sched, "Prof. Jefferson Costales", "P-0001"]);
      } else {
        await rawRun(`INSERT OR IGNORE INTO courses (code, name, schedule, assigned_faculty) VALUES (?, ?, ?, ?)`, [s.code, s.name, s.sched, "Prof. Jefferson Costales"]);
      }
    }

    try {
      const s1 = (await rawGet(`SELECT id FROM users WHERE username='2023-00164-PQ-0'`)).id;
      const s2 = (await rawGet(`SELECT id FROM users WHERE username='2023-00212-PQ-0'`)).id;
      const c1 = (await rawGet(`SELECT id FROM courses WHERE code='COMP 016'`)).id;
      await rawRun(`INSERT INTO student_courses (student_id, course_id) VALUES (?, ?)`, [s1, c1]);
      await rawRun(`INSERT INTO student_courses (student_id, course_id) VALUES (?, ?)`, [s2, c1]);
    } catch(e) {}
    console.log("Seeding complete.");
  }
}

async function logAudit(req, userId, username, action, details, severity = 'INFO') {
  try {
    let ip = req ? (req.headers['x-forwarded-for'] || req.socket.remoteAddress) : 'system';
    if (ip && ip.includes(',')) ip = ip.split(',')[0].trim();
    const ua = req ? req.headers['user-agent'] : 'system';
    await run(
      `INSERT INTO audit_logs (user_id, username, action, details, severity, ip_address, user_agent, timestamp) VALUES (?,?,?,?,?,?,?,?)`, 
      [userId, username, action, details, severity, ip, ua, getNowPH()]
    );
  } catch (e) {
    console.error("Audit Error", e);
  }
}

initPromise = init().catch(e => {
  console.error("Critical: Database initialization failed:", e);
});

module.exports = { db, run, get, all, getNowPH, logAudit, colExists };