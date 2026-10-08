const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const { run, get, all, getNowPH, logAudit, colExists } = require('../db');
const { authMiddleware } = require('../auth');
const attendanceService = require('../services/attendanceService');
const { asyncHandler, AppError } = require('../utils/errorHandler');

const QR_SECRET = process.env.QR_SECRET || 'pup-secure-qr-secret-key-123';

function getDiffMinutes(t1, t2) {
  if (!t1 || !t2) return 0;
  const d1 = new Date(t1.replace(' ', 'T'));
  const d2 = new Date(t2.replace(' ', 'T'));
  return Math.abs(d2.getTime() - d1.getTime()) / 60000;
}

function resolveContinuityStatus(log, now) {
  if (!log.last_heartbeat) {
    if (log.timestamp) {
      const diffMins = getDiffMinutes(log.timestamp, now);
      if (diffMins >= 10) return 'Interrupted';
      if (diffMins >= 5) return 'Temporarily Interrupted';
    }
    return log.continuity_status || 'Stable';
  }

  const diffMins = getDiffMinutes(log.last_heartbeat, now);
  if (diffMins >= 10) {
    return 'Interrupted';
  }
  if (diffMins >= 5) {
    return 'Temporarily Interrupted';
  }
  return log.continuity_status || 'Stable';
}

// POST /api/attendance/session — Create a session
router.post('/session', authMiddleware, asyncHandler(async (req, res) => {
  if (req.user.role === 'student') throw new AppError('forbidden', 403);
  const { course, room_id, mode } = req.body;
  if (!course) throw new AppError('missing_course', 400);
  if (mode && !['PHYSICAL', 'ONLINE', 'HYBRID'].includes(mode)) throw new AppError('Invalid mode', 400);

  const courseRow = await get(`SELECT id FROM courses WHERE code = ?`, [course]);
  if (!courseRow) throw new AppError('Course not found', 404);

  const data = await attendanceService.createSession(req, courseRow.id, room_id, req.user.id, mode || 'PHYSICAL');
  res.json({ success: true, ...data });
}));

// GET /api/attendance/session/:id/qr — Generate temporary signed JWT
router.get('/session/:id/qr', authMiddleware, asyncHandler(async (req, res) => {
  if (req.user.role === 'student') throw new AppError('forbidden', 403);
  const session = await attendanceService.getActiveSession(req.params.id);
  
  if (!session) {
    throw new AppError('Invalid or inactive session', 400);
  }

  const token = jwt.sign({ session_id: session.id, c: session.course_id }, QR_SECRET, { expiresIn: '10s' });
  res.json({ qr_data: token });
}));

// POST /api/attendance/session/:id/end — End a session
router.post('/session/:id/end', authMiddleware, asyncHandler(async (req, res) => {
  if (req.user.role === 'student') throw new AppError('forbidden', 403);
  const result = await attendanceService.endSession(req, req.params.id, req.user.id, req.user.username);
  res.json(result);
}));

// GET /api/attendance/active-sessions — Get active sessions for student 
router.get('/active-sessions', authMiddleware, asyncHandler(async (req, res) => {
  if (req.user.role !== 'student') throw new AppError('Students only', 403);
  
  // Find sessions for courses the student is enrolled in
  const sessions = await all(`
    SELECT asess.id, asess.entry_code, asess.mode, asess.meeting_link, c.code as course_code, c.name as course_name, u.full_name as professor_name,
           al.id as log_id, al.status as attendance_status, al.session_joined_at, al.continuity_status, al.interruption_reason, al.last_heartbeat
    FROM attendance_sessions asess
    JOIN courses c ON asess.course_id = c.id
    JOIN users u ON asess.created_by = u.id
    JOIN student_courses sc ON sc.course_id = c.id
    LEFT JOIN attendance_logs al ON al.session_id = asess.id AND al.student_id = ?
    WHERE sc.student_id = ? AND asess.status = 'active'
    ORDER BY asess.created_at DESC
  `, [req.user.id, req.user.id]);
  
  res.json(sessions);
}));

// GET /api/attendance/session/:id/live — Get live participant count
router.get('/my-active-sessions', authMiddleware, asyncHandler(async (req, res) => {
  if (req.user.role === 'student') return res.status(403).json([]);
  const sessions = await all(`
    SELECT asess.id, asess.entry_code, asess.mode, c.code as course_code
    FROM attendance_sessions asess
    JOIN courses c ON asess.course_id = c.id
    WHERE asess.created_by = ? AND asess.status = 'active'
    ORDER BY asess.created_at DESC
  `, [req.user.id]);
  res.json(sessions);
}));

router.get('/session/:id/live', authMiddleware, asyncHandler(async (req, res) => {
  if (req.user.role === 'student') throw new AppError('forbidden', 403);
  
  const sessionId = req.params.id;
  const session = await get(`SELECT course_id, mode FROM attendance_sessions WHERE id = ?`, [sessionId]);
  if (!session) throw new AppError('Session not found', 404);

  const totalEnrolled = (await get(`SELECT COUNT(*) as count FROM student_courses sc JOIN users u ON sc.student_id = u.id WHERE sc.course_id = ? AND u.role = 'student'`, [session.course_id])).count || 0;
  
  const presentCount = (await get(`SELECT COUNT(*) as count FROM attendance_logs WHERE session_id = ? AND status = 'PRESENT'`, [sessionId])).count || 0;
  const lateCount = (await get(`SELECT COUNT(*) as count FROM attendance_logs WHERE session_id = ? AND status = 'LATE'`, [sessionId])).count || 0;
  const absentCount = (await get(`SELECT COUNT(*) as count FROM attendance_logs WHERE session_id = ? AND status = 'ABSENT'`, [sessionId])).count || 0;

  const totalMarked = presentCount + lateCount + absentCount;
  const remaining = Math.max(0, totalEnrolled - totalMarked);

  const countRow = await get(`SELECT COUNT(*) as count FROM attendance_logs WHERE session_id = ?`, [sessionId]);
  const recentLogs = await all(`
    SELECT al.id, u.full_name as student_name, al.timestamp, al.status
    FROM attendance_logs al 
    JOIN users u ON al.student_id = u.id 
    WHERE al.session_id = ? 
    ORDER BY al.timestamp DESC LIMIT 10`, [sessionId]);

  let continuityCounts = null;
  if (session.mode === 'ONLINE' || session.mode === 'HYBRID') {
    const logs = await all(`SELECT status, timestamp, last_heartbeat, continuity_status FROM attendance_logs WHERE session_id = ?`, [sessionId]);
    const nowLocal = getNowPH();
    let stable = 0;
    let reconnected = 0;
    let interrupted = 0;
    logs.forEach(lg => {
      if (lg.status && lg.status !== 'ABSENT') {
        const cStatus = resolveContinuityStatus(lg, nowLocal);
        if (cStatus === 'Stable') stable++;
        else if (cStatus === 'Reconnected' || cStatus === 'Temporarily Interrupted') reconnected++;
        else if (cStatus === 'Interrupted') interrupted++;
      }
    });
    continuityCounts = { stable, reconnected, interrupted };
  }

  res.json({ 
    count: countRow ? countRow.count : 0, 
    present: presentCount,
    late: lateCount,
    absent: absentCount,
    remaining,
    total: totalEnrolled,
    recent: recentLogs,
    continuity: continuityCounts
  });
}));

// GET /api/attendance/session/:id/unmarked-students — Get students enrolled but not yet marked
router.get('/session/:id/students', authMiddleware, asyncHandler(async (req, res) => {
  if (req.user.role === 'student') throw new AppError('forbidden', 403);
  
  const sessionId = req.params.id;
  const session = await get(`SELECT course_id, mode FROM attendance_sessions WHERE id = ?`, [sessionId]);
  if (!session) throw new AppError('Session not found', 404);

  // Get all students enrolled in the course, and their attendance status for this session
  const students = await all(`
    SELECT u.id, u.username, u.full_name, u.section, u.year, al.status, al.timestamp, al.last_heartbeat, al.continuity_status, al.interruption_reason, al.session_joined_at
    FROM users u
    JOIN student_courses sc ON u.id = sc.student_id
    LEFT JOIN attendance_logs al ON u.id = al.student_id AND al.session_id = ?
    WHERE sc.course_id = ? AND u.role = 'student'
    ORDER BY u.full_name ASC
  `, [sessionId, session.course_id]);

  const now = getNowPH();
  const processedStudents = students.map(st => {
    if (session.mode === 'ONLINE' || session.mode === 'HYBRID') {
      if (st.status && st.status !== 'ABSENT') {
        const liveStatus = resolveContinuityStatus(st, now);
        return {
          ...st,
          continuity_status: liveStatus
        };
      }
    }
    return st;
  });

  res.json(processedStudents);
}));

// POST /api/attendance/session/:id/join — Student clicking "Join Online Session"
router.post('/session/:id/join', authMiddleware, asyncHandler(async (req, res) => {
  if (req.user.role !== 'student') throw new AppError('Students only', 403);
  const sessionId = req.params.id;
  const now = getNowPH();
  
  await run(`UPDATE attendance_logs SET session_joined_at = ? WHERE session_id = ? AND student_id = ?`, [now, sessionId, req.user.id]);
  res.json({ success: true, session_joined_at: now });
}));

// POST /api/attendance/session/:id/heartbeat — Heartbeat ping and status check for student
router.post('/session/:id/heartbeat', authMiddleware, asyncHandler(async (req, res) => {
  if (req.user.role !== 'student') throw new AppError('Students only', 403);
  const sessionId = req.params.id;
  const { interruption_reason } = req.body;
  const now = getNowPH();

  // Find the student's log for this session
  const log = await get(`SELECT id, last_heartbeat, continuity_status FROM attendance_logs WHERE session_id = ? AND student_id = ?`, [sessionId, req.user.id]);
  if (!log) {
    return res.json({ success: false, error: 'no_attendance_log' });
  }

  let nextStatus = log.continuity_status || 'Stable';
  let reconnectTriggered = false;

  if (log.last_heartbeat) {
    const diffMins = getDiffMinutes(log.last_heartbeat, now);
    if (diffMins >= 10) {
      nextStatus = 'Reconnected';
      reconnectTriggered = true;
    } else if (diffMins >= 5) {
      nextStatus = 'Reconnected';
    } else if (log.continuity_status === 'Interrupted' || log.continuity_status === 'Temporarily Interrupted') {
      nextStatus = 'Reconnected';
    }
  }

  // Update last_heartbeat, continuity_status, and optionally interruption_reason
  const params = [now, nextStatus];
  let updateSql = `UPDATE attendance_logs SET last_heartbeat = ?, continuity_status = ?`;
  if (interruption_reason) {
    updateSql += `, interruption_reason = ?`;
    params.push(interruption_reason);
  }
  updateSql += ` WHERE id = ?`;
  params.push(log.id);

  await run(updateSql, params);
  res.json({ success: true, continuity_status: nextStatus, prompt_reason: reconnectTriggered });
}));

// POST /api/attendance/session/:id/reason — Post student justification / interruption reason
router.post('/session/:id/reason', authMiddleware, asyncHandler(async (req, res) => {
  if (req.user.role !== 'student') throw new AppError('Students only', 403);
  const sessionId = req.params.id;
  const { reason } = req.body;

  await run(`UPDATE attendance_logs SET interruption_reason = ? WHERE session_id = ? AND student_id = ?`, [reason || null, sessionId, req.user.id]);
  res.json({ success: true });
}));

// POST /api/attendance/session/:id/mark-remaining-absent — Mark all remaining students absent
router.post('/session/:id/mark-remaining-absent', authMiddleware, asyncHandler(async (req, res) => {
  if (req.user.role === 'student') throw new AppError('forbidden', 403);
  const result = await attendanceService.markRemainingAbsent(req, req.params.id, req.user.id);
  res.json({ success: true, ...result });
}));

// POST /api/attendance/session/:id/manual-mark — Professor manual override
router.post('/session/:id/manual-mark', authMiddleware, asyncHandler(async (req, res) => {
  if (req.user.role === 'student') throw new AppError('forbidden', 403);
  
  let { student_id, username } = req.body;
  if (!student_id && !username) throw new AppError('Missing student identifier', 400);

  if (!student_id && username) {
    const hasAppUsername = await colExists('users', 'app_username');
    let s;
    if (hasAppUsername) {
      s = await get(`SELECT id FROM users WHERE (username = ? OR app_username = ?) AND role = 'student'`, [username, username.toLowerCase()]);
    } else {
      s = await get(`SELECT id FROM users WHERE username = ? AND role = 'student'`, [username]);
    }
    if (!s) throw new AppError('Student not found', 404);
    student_id = s.id;
  }

  const sessionId = req.params.id;
  const session = await get(`SELECT course_id FROM attendance_sessions WHERE id = ?`, [sessionId]);
  if (!session) throw new AppError('Session not found', 404);

  const result = await attendanceService.logAttendanceProfessorOverride(req, student_id, session.course_id, sessionId, req.user.id);
  res.json({ success: true, record: result });
}));

// POST /api/attendance/code — Log attendance via 6-digit entry code
router.post('/code', authMiddleware, asyncHandler(async (req, res) => {
  const { code } = req.body;
  if (!code) throw new AppError('missing_code', 400);
  if (req.user.role !== 'student') throw new AppError('Students only', 403);

  const student_name = req.user.full_name;
  const result = await attendanceService.logAttendanceViaCode(req, code, req.user.id);
  result.student_name = student_name;

  return res.json({ success: true, record: result });
}));

// POST /api/attendance — Log attendance (Student scanning Professor's QR)
router.post('/', authMiddleware, asyncHandler(async (req, res) => {
  const { qr } = req.body;
  if (!qr) throw new AppError('missing_qr', 400);
  if (req.user.role !== 'student') throw new AppError('Students only', 403);

  let parsedToken;
  try {
    parsedToken = jwt.verify(qr, QR_SECRET, { clockTolerance: 30 });
  } catch (e) {
    if (e.name === 'TokenExpiredError') {
      await logAudit(req, req.user.id, req.user.username, 'ATTENDANCE_EXPIRED', `Expired JWT scan`, 'WARN');
      throw new AppError('QR refreshed. Please scan again.', 400);
    }
    await logAudit(req, req.user.id, req.user.username, 'ATTENDANCE_FORGED', `Invalid or tampered JWT`, 'ERROR');
    throw new AppError('Invalid or forged QR Code', 400);
  }

  const session_id = parsedToken.session_id;
  if (!session_id) {
    await logAudit(req, req.user.id, req.user.username, 'ATTENDANCE_TAMPERED', `Missing session_id in JWT`, 'ERROR');
    throw new AppError('Malformed QR Code logic', 400);
  }

  const session = await attendanceService.getActiveSession(session_id);
  if (!session) {
    await logAudit(req, req.user.id, req.user.username, 'ATTENDANCE_CLOSED', `Scanned closed session ${session_id}`, 'WARN');
    throw new AppError('Attendance session has ended.', 400);
  }

  if (await attendanceService.checkExistingAttendance(req.user.id, session.course_id, session_id)) {
    await logAudit(req, req.user.id, req.user.username, 'ATTENDANCE_DUPLICATE', `Duplicate attendance attempt for course ${session.course_id}`, 'WARN');
    throw new AppError('Already logged today', 400);
  }

  const result = await attendanceService.logAttendance(req, req.user.id, session.course_id, session.room_id, session_id, 'device-qr', 'scan', 'Dynamic Session QR');
  result.student_name = req.user.full_name;

  return res.json({ success: true, record: result });
}));

// POST /api/attendance/sync — Bulk Sync Pending Offline Records
router.post('/sync', authMiddleware, asyncHandler(async (req, res) => {
  if (req.user.role !== 'student') throw new AppError('Students only', 403);
  const { records } = req.body;
  if (!Array.isArray(records)) throw new AppError('Invalid format', 400);

  const results = { success: 0, failed: 0, errors: [] };
  const student_id = req.user.id;

  for (const record of records) {
    try {
      if (!record.qr) throw new Error('Missing QR');
      
      const parsedToken = jwt.verify(record.qr, QR_SECRET, { ignoreExpiration: true });
      const session_id = parsedToken.session_id;
      if (!session_id) throw new Error('Malformed Session QR');

      const session = await get(`SELECT id, course_id, room_id FROM attendance_sessions WHERE id = ?`, [session_id]);
      if (!session) throw new Error('Session not found');

      if (!(await attendanceService.checkExistingAttendance(student_id, session.course_id, session_id))) {
        const logTime = record.scan_timestamp || getNowPH();
        try {
          await run(
            `INSERT INTO attendance_logs (student_id, course_id, room_id, session_id, student_qr, timestamp, status, remarks)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [student_id, session.course_id, session.room_id, session_id, 'offline-qr', logTime, 'PRESENT', 'Offline Sync Recovery']
          );
          results.success++;
        } catch (e) {
          if (e.code === 'SQLITE_CONSTRAINT') {
            // It was a duplicate inserted in parallel, count it as success
            results.success++;
          } else {
            throw e;
          }
        }
      } else {
        results.success++;
      }
    } catch (e) {
      results.failed++;
      results.errors.push({ qr: record.qr, error: e.message });
      await logAudit(req, req.user.id, req.user.username, 'SYNC_ATTENDANCE_FAILED', `Failed offline sync: ${e.message}`, 'WARN');
    }
  }

  if (results.success > 0 || results.failed > 0) {
    await logAudit(req, req.user.id, req.user.username, 'SYNC_ATTENDANCE', `Synced offline records: ${results.success} successes, ${results.failed} failures`, 'INFO');
  }

  res.json(results);
}));

router.put('/:id', authMiddleware, async (req, res) => {
  if (req.user.role !== 'admin' && req.user.role !== 'professor') return res.status(403).json({ error: 'forbidden' });
  try {
    const { status, remarks } = req.body;
    await run('UPDATE attendance_logs SET status=?, remarks=? WHERE id=?', [status, remarks || '', req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'db_error' }); }
});

router.put('/:id/reason', authMiddleware, async (req, res) => {
  if (req.user.role !== 'student') return res.status(403).json({ error: 'forbidden' });
  try {
    const { reason } = req.body;
    const log = await get(`SELECT student_id, status FROM attendance_logs WHERE id = ?`, [req.params.id]);
    
    if (!log) return res.status(404).json({ error: 'Log not found' });
    if (log.student_id !== req.user.id) return res.status(403).json({ error: 'forbidden' });
    if (log.status !== 'ABSENT' && log.status !== 'EXCUSED') {
      return res.status(400).json({ error: 'Reason can only be set for ABSENT or EXCUSED status' });
    }

    await run('UPDATE attendance_logs SET reason=? WHERE id=?', [reason, req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'db_error' }); }
});

router.delete('/:id', authMiddleware, async (req, res) => {
  if (req.user.role !== 'admin' && req.user.role !== 'professor') return res.status(403).json({ error: 'forbidden' });
  try { await run('DELETE FROM attendance_logs WHERE id=?', [req.params.id]); res.json({ success: true }); } catch (err) { res.status(500).json({ error: 'db_error' }); }
});

router.delete('/', authMiddleware, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'admins_only' });
  try {
    await run('DELETE FROM attendance_logs'); 
    try { await run('DELETE FROM sqlite_sequence WHERE name="attendance_logs"'); } catch(e) {}
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'db_error' }); }
});

router.get('/stats', authMiddleware, asyncHandler(async (req, res) => {
  const user = req.user;
  let totalClasses, students, totalLogs, presentLogs, chartData;

  if (user.role === 'admin') {
    totalClasses = (await get(`SELECT COUNT(*) as c FROM courses`)).c;
    students = (await get(`SELECT COUNT(*) as c FROM users WHERE role='student'`)).c;
    totalLogs = (await get(`SELECT COUNT(*) as c FROM attendance_logs`)).c;
    presentLogs = (await get(`SELECT COUNT(*) as c FROM attendance_logs WHERE status='PRESENT'`)).c;
    
    chartData = await all(`
      SELECT substr(timestamp, 1, 10) as date, COUNT(*) as count 
      FROM attendance_logs GROUP BY date ORDER BY date DESC LIMIT 7
    `);
  } else if (user.role === 'professor') {
    // Filter by assigned professor
    const hasCourseFaculty = await colExists('courses', 'faculty_code');
    let courses;
    if (hasCourseFaculty && user.faculty_code) {
      courses = await all(`SELECT id FROM courses WHERE faculty_code = ?`, [user.faculty_code]);
    } else {
      courses = await all(`SELECT id FROM courses WHERE assigned_faculty = ? OR assigned_faculty LIKE ?`, [user.username, `%${user.full_name}%`]);
    }
    const courseIds = courses.map(c => c.id);
    const courseIdsStr = courseIds.length > 0 ? courseIds.join(',') : '-1';

    totalClasses = courseIds.length;
    students = (await get(`SELECT COUNT(DISTINCT student_id) as c FROM student_courses WHERE course_id IN (${courseIdsStr})`)).c;
    totalLogs = (await get(`SELECT COUNT(*) as c FROM attendance_logs WHERE course_id IN (${courseIdsStr})`)).c;
    presentLogs = (await get(`SELECT COUNT(*) as c FROM attendance_logs WHERE course_id IN (${courseIdsStr}) AND status='PRESENT'`)).c;
    
    chartData = await all(`
      SELECT substr(timestamp, 1, 10) as date, COUNT(*) as count 
      FROM attendance_logs 
      WHERE course_id IN (${courseIdsStr})
      GROUP BY date ORDER BY date DESC LIMIT 7
    `);
  } else {
    // Student stats
    totalClasses = (await get(`SELECT COUNT(*) as c FROM student_courses WHERE student_id = ?`, [user.id])).c;
    students = 1;
    totalLogs = (await get(`SELECT COUNT(*) as c FROM attendance_logs WHERE student_id = ?`, [user.id])).c;
    presentLogs = (await get(`SELECT COUNT(*) as c FROM attendance_logs WHERE student_id = ? AND status='PRESENT'`, [user.id])).c;
    
    chartData = await all(`
      SELECT substr(timestamp, 1, 10) as date, COUNT(*) as count 
      FROM attendance_logs 
      WHERE student_id = ?
      GROUP BY date ORDER BY date DESC LIMIT 7
    `, [user.id]);
  }

  const rate = totalLogs > 0 ? Math.round((presentLogs / totalLogs) * 100) : 0;
  res.json({ classes: totalClasses, students: students, rate: rate + "%", chart: chartData.reverse() });
}));

router.get('/', authMiddleware, asyncHandler(async (req, res) => {
  const user = req.user;
  let sql = `
    SELECT al.id, al.student_id, u.username AS student_username, u.full_name AS student_name, u.section AS student_section,
           al.student_qr, c.code AS course_code, c.name AS course_name, al.timestamp, 
           al.status, al.remarks, al.reason, al.risk_score, al.risk_flags,
           al.continuity_status, al.interruption_reason, al.session_joined_at,
           asess.mode AS session_mode
    FROM attendance_logs al 
    LEFT JOIN users u ON al.student_id = u.id 
    LEFT JOIN courses c ON al.course_id = c.id
    LEFT JOIN attendance_sessions asess ON al.session_id = asess.id`;
  
  const params = [];
  if (user.role === 'student') {
    sql += ` WHERE al.student_id = ?`;
    params.push(user.id);
  } else if (user.role === 'professor') {
    const hasCourseFaculty = await colExists('courses', 'faculty_code');
    if (hasCourseFaculty && user.faculty_code) {
      sql += ` WHERE c.faculty_code = ?`;
      params.push(user.faculty_code);
    } else {
      sql += ` WHERE c.assigned_faculty = ? OR c.assigned_faculty LIKE ?`;
      params.push(user.username);
      params.push(`%${user.full_name}%`);
    }
  }

  sql += ` ORDER BY al.timestamp DESC`;
  const rows = await all(sql, params);
  res.json(rows);
}));

router.get('/me', authMiddleware, async (req, res) => {
  try {
    const user = req.user;
    if (user.role !== 'student') return res.status(403).json({ error: 'not_student' });
    const rows = await all(`SELECT al.id, c.code AS course_code, c.name AS course_name, al.timestamp, al.status, al.remarks, al.reason FROM attendance_logs al LEFT JOIN courses c ON al.course_id = c.id WHERE al.student_id = ? ORDER BY al.timestamp DESC`, [user.id]);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: 'server_error' }); }
});

router.get('/student/:username', authMiddleware, asyncHandler(async (req, res) => {
  if (req.user.role === 'student' && req.user.username !== req.params.username && req.user.app_username !== req.params.username.toLowerCase()) throw new AppError('forbidden', 403);
  
  const hasAppUsername = await colExists('users', 'app_username');
  let user;
  if (hasAppUsername) {
    user = await get(`SELECT id FROM users WHERE username = ? OR app_username = ?`, [req.params.username, req.params.username.toLowerCase()]);
  } else {
    user = await get(`SELECT id FROM users WHERE username = ?`, [req.params.username]);
  }
  if (!user) throw new AppError('User not found', 404);

  const rows = await all(`
    SELECT al.id, c.code AS course_code, c.name AS course_name, al.timestamp, al.status, al.remarks, al.reason 
    FROM attendance_logs al 
    LEFT JOIN courses c ON al.course_id = c.id 
    WHERE al.student_id = ? 
    ORDER BY al.timestamp DESC`, 
    [user.id]
  );
  res.json(rows);
}));

module.exports = router;