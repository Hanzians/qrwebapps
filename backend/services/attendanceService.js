const { run, get, all, getNowPH, logAudit } = require('../db');
const { AppError } = require('../utils/errorHandler');
const securityService = require('./securityService'); // Inject security service

class AttendanceService {

  async createSession(req, course_id, room_id, created_by, mode = 'PHYSICAL') {
    const courseRow = await get(`SELECT id FROM courses WHERE id = ?`, [course_id]);
    if (!courseRow) throw new AppError('Course not found', 404);

    const existingActive = await get(`SELECT id FROM attendance_sessions WHERE course_id = ? AND status = 'active'`, [course_id]);
    if (existingActive) throw new AppError('An active session already exists for this course. Please close it first.', 400);

    const now = getNowPH();
    const entry_code = Math.floor(100000 + Math.random() * 900000).toString();
    
    // Security Context
    const { latitude, longitude, meeting_link } = req.body || {};
    let ip_address = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    if (ip_address && ip_address.includes(',')) ip_address = ip_address.split(',')[0].trim();

    const info = await run(
      `INSERT INTO attendance_sessions (course_id, room_id, created_by, created_at, status, entry_code, latitude, longitude, ip_address, mode, meeting_link) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [course_id, room_id || null, created_by, now, 'active', entry_code, latitude || null, longitude || null, ip_address || null, mode, meeting_link || null]
    );

    await logAudit(req, created_by, req.user.username, 'CREATE_SESSION', `Session ${info.lastID} created for course ${course_id} in ${mode} mode with code ${entry_code} from ${ip_address}`, 'INFO');
    return { session_id: info.lastID, entry_code, meeting_link: meeting_link || null };
  }

  async endSession(req, session_id, user_id, user_username) {
    const session = await get(`SELECT s.course_id, s.created_by, c.code, c.name FROM attendance_sessions s JOIN courses c ON s.course_id = c.id WHERE s.id = ?`, [session_id]);
    if (!session) throw new AppError('Session not found', 404);
    if (session.created_by !== user_id && req.user.role !== 'admin') {
      throw new AppError('Permission denied. You did not create this session.', 403);
    }
    
    await run(`UPDATE attendance_sessions SET status = 'closed' WHERE id = ?`, [session_id]);
    await logAudit(req, user_id, user_username, 'END_SESSION', `Session ${session_id} ended`, 'INFO');
    
    const sessionLogs = await all(`SELECT status FROM attendance_logs WHERE session_id = ?`, [session_id]);
    const summary = { code: session.code, name: session.name, present: 0, late: 0, absent: 0, excused: 0, rate: 0 };
    sessionLogs.forEach(l => {
         if (l.status === 'PRESENT') summary.present++;
         else if (l.status === 'LATE') summary.late++;
         else if (l.status === 'ABSENT') summary.absent++;
         else if (l.status === 'EXCUSED') summary.excused++;
    });
    const total = summary.present + summary.late + summary.absent + summary.excused;
    summary.rate = total ? Math.round(((summary.present + summary.late) / total) * 100) : 0;

    const studentsLogs = await all(`
       SELECT al.student_id, al.status, u.full_name, u.username
       FROM attendance_logs al
       JOIN users u ON al.student_id = u.id
       WHERE al.course_id = ?
    `, [session.course_id]);

    const studentMap = {};
    studentsLogs.forEach(l => {
       if(!studentMap[l.student_id]) studentMap[l.student_id] = { id: l.student_id, name: l.full_name, username: l.username, logs: [] };
       studentMap[l.student_id].logs.push(l);
    });

    return { success: true, summary, students: Object.values(studentMap) };
  }

  async getActiveSession(session_id) {
    const session = await get(`
      SELECT s.id, s.course_id, s.room_id, s.status, s.mode, s.meeting_link, s.created_by,
             c.code as course_name, u.full_name as professor_name
      FROM attendance_sessions s
      LEFT JOIN courses c ON s.course_id = c.id
      LEFT JOIN users u ON s.created_by = u.id
      WHERE s.id = ?`, [session_id]);
    if (!session || session.status !== 'active') return null;
    return session;
  }

  async checkExistingAttendance(student_id, course_id, session_id = null) {
    if (session_id) {
      const sessionCheck = await get(`SELECT id FROM attendance_logs WHERE student_id = ? AND session_id = ?`, [student_id, session_id]);
      return !!sessionCheck;
    }
    
    const nowPH = getNowPH();
    const today = nowPH.split('T')[0];
    let query = `SELECT id FROM attendance_logs WHERE student_id = ? AND course_id = ? AND timestamp LIKE ?`;
    let params = [student_id, course_id, `${today}%`];
    
    const existing = await get(query, params);
    return !!existing;
  }

  async markRemainingAbsent(req, session_id, professor_id) {
    const session = await get(`SELECT course_id, room_id, created_by FROM attendance_sessions WHERE id = ?`, [session_id]);
    if (!session) throw new AppError('Session not found', 404);
    if (session.created_by !== professor_id && req.user.role !== 'admin') {
      throw new AppError('Permission denied', 403);
    }
    const students = await all(`
      SELECT u.id
      FROM users u
      JOIN student_courses sc ON u.id = sc.student_id
      LEFT JOIN attendance_logs al ON u.id = al.student_id AND al.session_id = ?
      WHERE sc.course_id = ? AND u.role = 'student' AND al.id IS NULL
    `, [session_id, session.course_id]);

    const nowPH = getNowPH();
    let marked = 0;
    for (const student of students) {
      const existing = await get(`SELECT id FROM attendance_logs WHERE session_id = ? AND student_id = ?`, [session_id, student.id]);
      if (!existing) {
        try {
          await run(
            `INSERT INTO attendance_logs (student_id, course_id, room_id, session_id, student_qr, timestamp, status, remarks, attendance_method, marked_by_professor)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [student.id, session.course_id, session.room_id || null, session_id, 'SYSTEM', nowPH, 'ABSENT', 'Marked absent by bulk action', 'AUTO_ABSENT', professor_id]
          );
          marked++;
        } catch (err) {
          if (err.code !== 'SQLITE_CONSTRAINT') throw err;
        }
      }
    }
    await logAudit(req, professor_id, req.user.username, 'MARK_ABSENT_BULK', `Marked ${marked} remaining students absent in session ${session_id}`, 'INFO');
    return { marked };
  }

  async logAttendance(req, student_id, course_id, room_id, session_id, qr_type, method, remarks) {
    const nowPH = getNowPH();
    
    // Extract Security Context
    const { device_fingerprint, latitude, longitude } = req.body || {};
    let ip_address = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    if (ip_address && ip_address.includes(',')) ip_address = ip_address.split(',')[0].trim();
    
    let risk_score = 'LOW';
    let risk_flags = '';
    let final_status = 'PRESENT';

    try {
      const securityEval = await securityService.assessRiskAndEvaluate(req, student_id, session_id, device_fingerprint, latitude, longitude, ip_address);
      risk_score = securityEval.risk_score;
      risk_flags = securityEval.risk_flags;
      if (securityEval.status_override) {
        final_status = securityEval.status_override;
      }
    } catch (err) {
      if (err instanceof AppError) throw err; // propagate lockouts
      console.warn("Security check soft-fail:", err);
    }
    
    if (final_status === 'REJECTED') {
      await logAudit(req, student_id, req.user.username, 'ATTENDANCE_REJECTED', `Rejected attendance session ${session_id}. Reason: HIGH RISK (${risk_flags})`, 'HIGH');
      // Update lockout for persistent bad actors 
      // If they are rejected multiple times, they get a lockout.
      if (risk_flags.includes('OUT_OF_BOUNDS_LOCATION') || risk_flags.includes('MULTIPLE_DEVICES_DETECTED')) {
         await securityService.updateLockout(student_id, 15); // 15 minute lockout
      }
      throw new AppError('Attendance rejected due to security policy violation. Account locked for 15 minutes.', 403);
    }

    if (final_status === 'PRESENT') {
      const sessionData = await get(`SELECT created_at FROM attendance_sessions WHERE id = ?`, [session_id]);
      if (sessionData && sessionData.created_at) {
        const sessionStart = new Date(sessionData.created_at).getTime();
        const nowTime = new Date(nowPH).getTime();
        const diffMins = (nowTime - sessionStart) / 60000;
        if (diffMins > 5) {
          final_status = 'LATE';
        }
      }
    }

    const compiledRemarks = Array.from(new Set([remarks, risk_flags])).filter(Boolean).join(' | ');

    // Also double check to prevent racing condition right before insert
    if (await this.checkExistingAttendance(student_id, course_id, session_id)) {
      throw new AppError('Attendance already recorded for this session', 400);
    }

    let sessionMode = 'PHYSICAL';
    let meeting_link = null;
    let course_name = null;
    let professor_name = null;
    if (session_id) {
      const sess = await get(`
        SELECT s.mode, s.meeting_link, c.code as course_name, u.full_name as professor_name
        FROM attendance_sessions s
        LEFT JOIN courses c ON s.course_id = c.id
        LEFT JOIN users u ON s.created_by = u.id
        WHERE s.id = ?`, [session_id]);
      if (sess) {
        sessionMode = sess.mode;
        meeting_link = sess.meeting_link;
        course_name = sess.course_name;
        professor_name = sess.professor_name;
      }
    }
    const isOnlineOrHybrid = (sessionMode === 'ONLINE' || sessionMode === 'HYBRID');
    const initialContinuityStatus = isOnlineOrHybrid ? 'Stable' : null;
    const initialLastHeartbeat = isOnlineOrHybrid ? nowPH : null;

    let info;
    try {
      info = await run(
        `INSERT INTO attendance_logs (student_id, course_id, room_id, session_id, student_qr, timestamp, status, remarks, device_fingerprint, latitude, longitude, ip_address, risk_score, risk_flags, attendance_method, continuity_status, last_heartbeat)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [student_id, course_id, room_id, session_id, qr_type, nowPH, final_status, compiledRemarks, device_fingerprint || null, latitude || null, longitude || null, ip_address || null, risk_score, risk_flags, method, initialContinuityStatus, initialLastHeartbeat]
      );
    } catch (err) {
      if (err.code === 'SQLITE_CONSTRAINT') {
        throw new AppError('Attendance already recorded for this session', 400);
      }
      throw err;
    }

    await logAudit(req, student_id, req.user.username, 'ATTENDANCE_EVAL', `Attendance logged (Risk: ${risk_score}, Status: ${final_status}) - Flags: ${risk_flags}`, risk_score === 'LOW' ? 'INFO' : 'MODERATE');
    return { id: info.lastID, timestamp: nowPH, status: final_status, risk_score, session_id, sessionMode, meeting_link, course_name, professor_name };
  }

  async logAttendanceViaCode(req, code, student_id) {
    const session = await get(`SELECT id, course_id, room_id, status, mode, meeting_link FROM attendance_sessions WHERE entry_code = ? AND status = 'active'`, [code.toUpperCase()]);
    if (!session) {
      await logAudit(req, student_id, req.user.username, 'ATTENDANCE_INVALID_CODE', `Attempted invalid/inactive code: ${code}`, 'WARN');
      throw new AppError('Attendance session has ended or code is incorrect.', 400);
    }

    const { id: session_id, course_id, room_id } = session;

    if (await this.checkExistingAttendance(student_id, course_id, session_id)) {
      await logAudit(req, student_id, req.user.username, 'ATTENDANCE_DUPLICATE', `Duplicate attendance attempt for course ${course_id}`, 'WARN');
      throw new AppError('Already logged today', 400);
    }

    return this.logAttendance(req, student_id, course_id, room_id, session_id, 'manual-code', 'code', 'Manual Entry Code');
  }

  async logAttendanceProfessorOverride(req, student_id, course_id, session_id, professor_id) {
    const session = await get(`SELECT room_id, created_by FROM attendance_sessions WHERE id = ?`, [session_id]);
    if (!session) throw new AppError('Session not found', 404);
    if (session.created_by !== professor_id && req.user.role !== 'admin') {
      throw new AppError('Permission denied. You did not create this session.', 403);
    }
    const nowPH = getNowPH();
    
    // Check duplicate
    if (await this.checkExistingAttendance(student_id, course_id, session_id)) {
      throw new AppError('Already logged', 400);
    }

    let info;
    try {
      info = await run(
        `INSERT INTO attendance_logs (student_id, course_id, room_id, session_id, student_qr, timestamp, status, remarks, attendance_method, marked_by_professor)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [student_id, course_id, session ? session.room_id : null, session_id, 'assisted-entry', nowPH, 'PRESENT', 'Assisted Attendance', 'ASSISTED_ENTRY', professor_id]
      );
    } catch (err) {
      if (err.code === 'SQLITE_CONSTRAINT') {
        throw new AppError('Already logged', 400);
      }
      throw err;
    }

    await logAudit(req, professor_id, req.user.username, 'ASSISTED_ENTRY', `Professor manually marked student ${student_id} as present in session ${session_id}`, 'INFO');
    return { id: info.lastID, timestamp: nowPH, status: 'PRESENT' };
  }

}

module.exports = new AttendanceService();
