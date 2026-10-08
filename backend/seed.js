const { run, get, all, getNowPH } = require('./db');
const bcrypt = require('bcryptjs');

const firstNames = [
  'Juan', 'Maria', 'Jose', 'Ana', 'Ricardo', 'Liza', 'Antonio', 'Elena', 'Roberto', 'Carmen',
  'Fernando', 'Isabel', 'Manuel', 'Luisa', 'Dante', 'Teresa', 'Angel', 'Sofia', 'Gabriel', 'Rosa',
  'Miguel', 'Cristina', 'Rafael', 'Patricia', 'Emilio', 'Beatriz', 'Javier', 'Dolores', 'Eduardo', 'Gloria',
  'Pietro', 'Bianca', 'Marco', 'Paola', 'Giovanni', 'Francesca', 'Lorenzo', 'Santi', 'Carlos', 'Yolanda',
  'Mateo', 'Valentina', 'Leo', 'Mia', 'Lucas', 'Emma', 'Ethan', 'Olivia', 'Aiden', 'Ava',
  'Logan', 'Sophia', 'James', 'Isabella', 'Jacob', 'Mia', 'Seth', 'Charlotte', 'Noah', 'Amelia',
  'Benjamin', 'Evelyn', 'William', 'Abigail', 'Michael', 'Harper', 'Alexander', 'Emily', 'Daniel', 'Elizabeth',
  'Jeremiah', 'Grace', 'Ezekiel', 'Chloe', 'Joaquin', 'Victoria', 'Leon', 'Luna', 'Emiliano', 'Aurora'
];

const lastNames = [
  'Dela Cruz', 'Garcia', 'Reyes', 'Ramos', 'Mendoza', 'Santos', 'Flores', 'Bautista', 'Villanueva', 'Pagaduan',
  'Pascua', 'Acosta', 'Lopez', 'Santiago', 'Torres', 'Castillo', 'Enriquez', 'Aquino', 'Marquez', 'Sarmiento',
  'Espiritu', 'Bernardo', 'Castaneda', 'Dizon', 'Guevarra', 'Lim', 'Tan', 'Chua', 'Sy', 'Go',
  'Valdez', 'Salvador', 'Rosales', 'Navarro', 'Magno', 'Fajardo', 'Domingo', 'Diaz', 'Alegre', 'Abad',
  'Mercado', 'Luna', 'Legaspi', 'Javier', 'Hermosa', 'Hernandez', 'Francisco', 'Estrella', 'David', 'Cruz'
];

const coursesData = [
  { code: 'ITEC 101', name: 'Introduction to Computing', faculty: 'Dr. Maria Santos' },
  { code: 'ITEC 102', name: 'Computer Programming 1', faculty: 'Prof. Jose Garcia' },
  { code: 'ITEC 103', name: 'Data Structures and Algorithms', faculty: 'Prof. Jefferson Costales' },
  { code: 'ITEC 104', name: 'Information Management', faculty: 'Engr. Manuel Mendoza' },
  { code: 'ITEC 105', name: 'Networking 1', faculty: 'Prof. Roberto Ramos' },
  { code: 'ITEC 106', name: 'Web Development 2', faculty: 'Prof. Jefferson Costales' },
  { code: 'GEED 1001', name: 'Understanding the Self', faculty: 'Dr. Ana Bautista' },
  { code: 'GEED 1002', name: 'Readings in Philippine History', faculty: 'Dr. Juan Flores' }
];

const roomsData = ['Room 301', 'Room 302', 'Lab 1', 'Lab 2', 'AVR 1', 'Gymnasium'];

function getRandomItem(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function generateStudentId(index) {
  const year = 2023 - Math.floor(index / 100);
  const num = (index + 1).toString().padStart(5, '0');
  return `${year}-${num}-PQ-0`;
}

async function colExists(table, column) {
  try {
    const rows = await all(`PRAGMA table_info(${table})`);
    return rows.some(r => r.name === column);
  } catch (e) {
    return false;
  }
}

async function seed() {
  console.log('--- STARTING LARGE SCALE SEEDING ---');

  try {
    const passwordHash = bcrypt.hashSync('password123', 10);
    const hasAppUser = await colExists('users', 'app_username');
    const hasFacCode = await colExists('users', 'faculty_code');

    // 1. Seed Professors / Admin
    console.log('Seeding Canonical Admin & Professors...');
    
    // Admin
    await run(`INSERT OR IGNORE INTO users (username, password_hash, role, full_name, avatar, preferences) VALUES ('admin', ?, 'admin', 'System Admin', 'default', '{}')`, [passwordHash]);
    await run(`UPDATE users SET full_name = 'System Admin', role = 'admin' WHERE username = 'admin'`);

    // Only one single representation of Jefferson Costales
    // We update 'faculty' if he exists, insert otherwise
    await run(`INSERT OR IGNORE INTO users (username, password_hash, role, full_name, avatar, preferences) VALUES ('faculty', ?, 'professor', 'Prof. Jefferson Costales', 'default', '{}')`, [passwordHash]);
    await run(`UPDATE users SET full_name = 'Prof. Jefferson Costales', role = 'professor' WHERE username = 'faculty'`);
    
    // We will delete any other variants if they exised
    await run(`DELETE FROM users WHERE full_name LIKE '%COSTALES%' AND username != 'faculty'`);

    const profIds = [];
    const profFaculty = await get(`SELECT id FROM users WHERE username = 'faculty'`);
    if (profFaculty) profIds.push(profFaculty.id);

    const profProfs = [
      { username: 'prof_santos', full_name: 'Dr. Maria Santos' },
      { username: 'prof_garcia', full_name: 'Prof. Jose Garcia' },
      { username: 'prof_bautista', full_name: 'Dr. Ana Bautista' },
      { username: 'prof_mendoza', full_name: 'Engr. Manuel Mendoza' },
      { username: 'prof_ramos', full_name: 'Prof. Roberto Ramos' },
      { username: 'prof_flores', full_name: 'Dr. Juan Flores' }
    ];

    let profCounter = 2;
    for (const p of profProfs) {
      let cols = ['username', 'password_hash', 'role', 'full_name', 'avatar', 'preferences'];
      let vals = [p.username, passwordHash, 'professor', p.full_name, 'default', '{}'];

      if (hasAppUser) {
        cols.push('app_username');
        vals.push(p.username.toLowerCase());
      }

      if (hasFacCode) {
        cols.push('faculty_code');
        vals.push(`P-${profCounter.toString().padStart(4, '0')}`);
        profCounter++;
      }

      const sql = `INSERT OR IGNORE INTO users (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`;
      await run(sql, vals);
      const user = await get(`SELECT id FROM users WHERE username = ?`, [p.username]);
      if (user) profIds.push(user.id);
    }

    // 2. Seed Rooms
    console.log('Seeding Rooms...');
    const roomIds = [];
    for (const rName of roomsData) {
      await run(`INSERT OR IGNORE INTO rooms (name, type, capacity) VALUES (?, ?, ?)`, [rName, 'General', 40]);
      const room = await get(`SELECT id FROM rooms WHERE name = ?`, [rName]);
      if (room) roomIds.push(room.id);
    }

    // 3. Seed Courses
    console.log('Seeding Courses...');
    const courseIds = [];
    const hasCourseFacCode = await colExists('courses', 'faculty_code');

    for (const c of coursesData) {
      // First check if course exists, if so update faculty name.
      // If we don't do this, multiple duplicates might appear if we run multiple times?
      const existing = await get(`SELECT id FROM courses WHERE code = ?`, [c.code]);
      
      let facCode = "P-0001"; // default to Jefferson 'faculty'
      if (c.faculty === 'Dr. Maria Santos') facCode = "P-0002";
      else if (c.faculty === 'Prof. Jose Garcia') facCode = "P-0003";
      else if (c.faculty === 'Dr. Ana Bautista') facCode = "P-0004";
      else if (c.faculty === 'Engr. Manuel Mendoza') facCode = "P-0005";
      else if (c.faculty === 'Prof. Roberto Ramos') facCode = "P-0006";
      else if (c.faculty === 'Dr. Juan Flores') facCode = "P-0007";

      if (existing) {
         if (hasCourseFacCode) {
           await run(`UPDATE courses SET assigned_faculty = ?, faculty_code = ? WHERE code = ?`, [c.faculty, facCode, c.code]);
         } else {
           await run(`UPDATE courses SET assigned_faculty = ? WHERE code = ?`, [c.faculty, c.code]);
         }
         courseIds.push(existing.id);
      } else {
         let cols = ['code', 'name', 'schedule', 'assigned_faculty'];
         let vals = [c.code, c.name, 'T/Th 09:00AM-12:00PM', c.faculty];
         if (hasCourseFacCode) {
           cols.push('faculty_code');
           vals.push(facCode);
         }
         const sql = `INSERT INTO courses (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`;
         await run(sql, vals);
         const course = await get(`SELECT id FROM courses WHERE code = ?`, [c.code]);
         courseIds.push(course.id);
      }
    }

    // 4. Seed Canonical Students
    await run(`INSERT OR IGNORE INTO users (username, password_hash, role, full_name, year, section, avatar, preferences) VALUES ('2023-00164-PQ-0', ?, 'student', 'Julian Student', '3', 'BSIT 3-1', 'default', '{}')`, [passwordHash]);
    await run(`UPDATE users SET full_name = 'Julian Student' WHERE username = '2023-00164-PQ-0'`);

    await run(`INSERT OR IGNORE INTO users (username, password_hash, role, full_name, year, section, avatar, preferences) VALUES ('2023-00212-PQ-0', ?, 'student', 'Jillian Student', '3', 'BSCpE 3-1', 'default', '{}')`, [passwordHash]);
    await run(`UPDATE users SET full_name = 'Jillian Student' WHERE username = '2023-00212-PQ-0'`);

    const s1 = await get(`SELECT id FROM users WHERE username = '2023-00164-PQ-0'`);
    const s2 = await get(`SELECT id FROM users WHERE username = '2023-00212-PQ-0'`);
    const studentIds = [];
    if (s1) studentIds.push(s1.id);
    if (s2) studentIds.push(s2.id);

    // Enroll canonical students
    if (s1) {
       for (let j = 0; j < Math.min(4, courseIds.length); j++) await run(`INSERT OR IGNORE INTO student_courses (student_id, course_id) VALUES (?, ?)`, [s1.id, courseIds[j]]);
    }
    if (s2) {
       for (let j = 0; j < Math.min(4, courseIds.length); j++) await run(`INSERT OR IGNORE INTO student_courses (student_id, course_id) VALUES (?, ?)`, [s2.id, courseIds[j]]);
    }

    // Seed Random Students (150+)
    console.log('Seeding Large Student Population...');
    for (let i = 0; i < 150; i++) {
        const studentIdNumber = generateStudentId(i + 500); // offset to avoid conflict
        const checkStudent = await get(`SELECT id FROM users WHERE username = ?`, [studentIdNumber]);
        if (checkStudent) {
            studentIds.push(checkStudent.id);
            continue;
        }

        const fName = getRandomItem(firstNames);
        const lName = getRandomItem(lastNames);
        const fullName = `${fName} ${lName}`;
        const year = (1 + Math.floor(Math.random() * 4)).toString();
        const section = `BSIT ${year}-${1 + Math.floor(Math.random() * 5)}`;
        
        let cols = ['username', 'password_hash', 'role', 'full_name', 'year', 'section', 'avatar', 'preferences'];
        let vals = [studentIdNumber, passwordHash, 'student', fullName, year, section, 'default', '{}'];

        if (hasAppUser) {
          cols.push('app_username');
          let appUser = fullName.toLowerCase().replace(/[^a-z0-9]/g, '.');
          const checkUserApp = await get(`SELECT id FROM users WHERE app_username = ?`, [appUser]);
          if (checkUserApp) {
            appUser = appUser + '.' + i;
          }
          vals.push(appUser);
        }

        const sql = `INSERT INTO users (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`;
        await run(sql, vals);
        const student = await get(`SELECT id FROM users WHERE username = ?`, [studentIdNumber]);
        studentIds.push(student.id);

        const numCourses = 2 + Math.floor(Math.random() * 3);
        const shuffledCourses = [...courseIds].sort(() => 0.5 - Math.random());
        for (let j = 0; j < numCourses; j++) {
            await run(`INSERT OR IGNORE INTO student_courses (student_id, course_id) VALUES (?, ?)`, [student.id, shuffledCourses[j]]);
        }
    }

    // 5. Seed Sessions & Logs (Historical Data)
    console.log('Seeding Attendance History...');
    const now = new Date();
    
    for (const courseId of courseIds) {
        const enrolledStudents = await all(`SELECT student_id FROM student_courses WHERE course_id = ?`, [courseId]);
        if (enrolledStudents.length === 0) continue;

        // get proper faculty for this course
        const courseRow = await get(`SELECT assigned_faculty FROM courses WHERE id = ?`, [courseId]);
        const courseProfName = courseRow ? courseRow.assigned_faculty : 'Prof. Jefferson Costales';
        const profRow = await get(`SELECT id FROM users WHERE full_name = ?`, [courseProfName]);
        const sessProfId = profRow ? profRow.id : profFaculty.id;

        // Create 8 previous sessions for this course
        for (let s = 8; s >= 1; s--) {
            const sessionDate = new Date(now.getTime() - (s * 4 * 24 * 60 * 60 * 1000));
            sessionDate.setHours(9, 0, 0, 0); 
            
            const createdAt = sessionDate.toISOString().replace('Z', '');
            const expiresAt = new Date(sessionDate.getTime() + 3 * 60 * 60 * 1000).toISOString().replace('Z', '');
            const entryCode = Math.random().toString(36).substring(2, 8).toUpperCase();
            const sessionRoomId = getRandomItem(roomIds);

            await run(
                `INSERT INTO attendance_sessions (course_id, room_id, created_by, created_at, expires_at, status, entry_code, latitude, longitude, ip_address) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [courseId, sessionRoomId, sessProfId, createdAt, expiresAt, 'closed', entryCode, 14.5995, 120.9842, '192.168.1.100']
            );
            const sessionInfo = await get(`SELECT last_insert_rowid() AS lastID`);
            const sessionId = sessionInfo.lastID;

            for (const student of enrolledStudents) {
                const chance = Math.random();
                let status = 'PRESENT';
                let riskScore = 'LOW';
                let riskFlags = '';
                let remarks = 'System Seeded Data';

                if (chance < 0.05) {
                    status = 'ABSENT';
                } else if (chance < 0.12) {
                    status = 'LATE';
                    remarks = 'Arrived 15 mins late';
                } else if (chance < 0.15) {
                    status = 'REVIEW_REQUIRED';
                    riskScore = 'MEDIUM';
                    riskFlags = 'MISSING_GPS';
                    remarks = 'GPS signature missing';
                }

                if (status === 'ABSENT' && Math.random() > 0.5) continue; // Don't log all absences

                const logTime = new Date(sessionDate.getTime() + (Math.random() * 2 * 60 * 60 * 1000));
                const logTimestamp = logTime.toISOString().replace('Z', '');
                const fingerprint = 'device_fp_' + Math.random().toString(36).substring(2, 10);

                await run(
                    `INSERT INTO attendance_logs (student_id, course_id, room_id, session_id, student_qr, timestamp, status, remarks, device_fingerprint, latitude, longitude, ip_address, risk_score, risk_flags)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [student.student_id, courseId, sessionRoomId, sessionId, 'qr-scan', logTimestamp, status, remarks, fingerprint, 14.5995, 120.9842, '192.168.1.1' + Math.floor(Math.random() * 255), riskScore, riskFlags]
                );
            }
        }
    }

    // 6. Seed Audit Logs
    console.log('Seeding Audit Logs...');
    const allAuditUsers = studentIds.concat(profIds);
    const adminRow = await get(`SELECT id FROM users WHERE username = 'admin'`);
    if (adminRow) allAuditUsers.push(adminRow.id);

    const auditActions = ['LOGIN', 'LOGOUT', 'UPDATE_PROFILE', 'VIEW_REPORTS', 'EXPORT_DATA'];
    for (let i = 0; i < 50; i++) {
        const uId = getRandomItem(allAuditUsers);
        const user = await get(`SELECT username FROM users WHERE id = ?`, [uId]);
        if (!user) continue;
        const action = getRandomItem(auditActions);
        const severity = Math.random() > 0.9 ? 'WARN' : 'INFO';
        const timestamp = new Date(now.getTime() - (Math.random() * 15 * 24 * 60 * 60 * 1000)).toISOString().replace('Z', '');
        
        await run(
            `INSERT INTO audit_logs (user_id, username, action, details, severity, ip_address, user_agent, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [uId, user.username, action, `User performed ${action}`, severity, '127.0.0.1', 'System Seeder', timestamp]
        );
    }

    console.log('--- SEEDING COMPLETED SUCCESSFULLY ---');

  } catch (err) {
    console.error('SEEDING ERROR:', err);
  } finally {
    process.exit();
  }
}

seed();
