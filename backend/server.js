const express = require('express');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { run, get, all, getNowPH, logAudit, colExists } = require('./db');
const { authMiddleware } = require('./auth');
const { errorHandler, asyncHandler, AppError } = require('./utils/errorHandler');

const QR_SECRET = process.env.QR_SECRET || 'pup-secure-qr-secret-key-123';

// Routes
const authRoutes = require('./routes/auth');
const attendanceRoutes = require('./routes/attendance');
const usersRoutes = require('./routes/users');

const app = express();
app.disable('x-powered-by');
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Mount Routes
app.use('/api/auth', authRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/users', usersRoutes);

// User Info
app.get('/api/me', authMiddleware, (req, res) => res.json(req.user));

// --- SPECIFIC COURSE/LOGIC ROUTES ---

// Toggle Online Mode (Professor)
app.put('/api/courses/:id/mode', authMiddleware, async (req, res) => {
  if (req.user.role === 'student') return res.status(403).json({ error: 'forbidden' });
  const { is_online } = req.body;
  const courseId = req.params.id;

  try {
    if (is_online !== undefined) {
      await run(`UPDATE courses SET is_online = ? WHERE id = ?`, [is_online ? 1 : 0, courseId]);
    }
    await logAudit(req, req.user.id, req.user.username, 'UPDATE_MODE', `Course ${courseId} updated`, 'INFO');
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'db_error' });
  }
});

const attendanceService = require('./services/attendanceService');

// Online Check-in (Student)
app.post('/api/courses/:id/checkin', authMiddleware, asyncHandler(async (req, res) => {
  if (req.user.role !== 'student') throw new AppError('forbidden', 403);
  const courseId = req.params.id;

  const course = await get(`SELECT * FROM courses WHERE id = ?`, [courseId]);
  if (!course || !course.is_online) throw new AppError('Online mode not active', 400);

  const enrolled = await get(`SELECT id FROM student_courses WHERE student_id=? AND course_id=?`, [req.user.id, courseId]);
  if (!enrolled) throw new AppError('Not enrolled', 403);

  if (await attendanceService.checkExistingAttendance(req.user.id, courseId)) {
    throw new AppError('Already checked in', 400);
  }

  await attendanceService.logAttendance(req, req.user.id, courseId, null, null, req.user.username, 'online', 'Online Check-in');

  res.json({ success: true });
}));

// AI Prediction
app.get('/api/attendance/prediction/:courseId', authMiddleware, async (req, res) => {
  if (req.user.role === 'student') return res.status(403).json({ error: 'forbidden' });
  try {
    const logs = await all(`SELECT timestamp, status FROM attendance_logs WHERE course_id = ? ORDER BY timestamp ASC`, [req.params.courseId]);
    
    if (logs.length < 3) return res.json({ prediction: "Insufficient Data", projected_rate: "--%" });

    const sessions = {};
    logs.forEach(l => {
      const d = l.timestamp.split('T')[0];
      if (!sessions[d]) sessions[d] = { present: 0, total: 0 };
      if (l.status === 'PRESENT' || l.status === 'LATE') sessions[d].present++;
      sessions[d].total++;
    });

    const rates = Object.values(sessions).map(s => s.present / (s.total || 1));
    const n = rates.length;
    let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
    
    for (let i = 0; i < n; i++) {
      sumX += i;
      sumY += rates[i];
      sumXY += i * rates[i];
      sumXX += i * i;
    }
    
    const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
    const avg = sumY / n;
    
    let text = "Stable Trend";
    if (slope > 0.05) text = "Improving Attendance 📈";
    else if (slope < -0.05) text = "Declining Attendance 📉";

    res.json({ prediction: text, projected_rate: Math.round(avg * 100) + "%" });
  } catch (e) {
    res.status(500).json({ error: 'db_error' });
  }
});

app.get('/api/courses', authMiddleware, async (req, res) => {
  try {
    const user = req.user;
    let sql = `SELECT * FROM courses`;
    const params = [];

    const hasCourseFaculty = await colExists('courses', 'faculty_code');
    if (user.role === 'professor') {
      if (hasCourseFaculty && user.faculty_code) {
        sql += ` WHERE faculty_code = ?`;
        params.push(user.faculty_code);
      } else {
        sql += ` WHERE assigned_faculty = ? OR assigned_faculty LIKE ?`;
        params.push(user.username);
        params.push(`%${user.full_name}%`);
      }
    } else if (user.role === 'student') {
      // Students see only their enrolled courses
      sql = `SELECT c.* FROM courses c JOIN student_courses sc ON c.id = sc.course_id WHERE sc.student_id = ?`;
      params.push(user.id);
    }

    sql += ` ORDER BY code ASC`;
    const rows = await all(sql, params);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: 'db_error' }); }
});

app.post('/api/courses', authMiddleware, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'forbidden' });
  let { code, name, schedule, assigned_faculty, faculty_code } = req.body;
  
  const hasCourseFaculty = await colExists('courses', 'faculty_code');
  const hasUserFaculty = await colExists('users', 'faculty_code');

  if (!faculty_code && assigned_faculty && hasUserFaculty) {
      const match = `%${assigned_faculty.split(' ').pop()}%`;
      const prof = await get(`SELECT faculty_code FROM users WHERE role = 'professor' AND (full_name LIKE ? OR username = ?) LIMIT 1`, [match, assigned_faculty]);
      if (prof && prof.faculty_code) {
          faculty_code = prof.faculty_code;
      }
  }

  try {
    let cols = ['code', 'name', 'schedule', 'assigned_faculty'];
    let vals = [code, name, schedule, assigned_faculty];
    if (hasCourseFaculty) {
      cols.push('faculty_code');
      vals.push(faculty_code || null);
    }
    const sql = `INSERT INTO courses (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`;
    await run(sql, vals);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: 'db_error_unique' }); }
});

app.put('/api/courses/:id', authMiddleware, asyncHandler(async (req, res) => {
  const user = req.user;
  const courseId = req.params.id;

  if (user.role !== 'admin' && user.role !== 'professor') throw new AppError('forbidden', 403);

  const hasCourseFaculty = await colExists('courses', 'faculty_code');
  const hasUserFaculty = await colExists('users', 'faculty_code');

  // If professor, verify it's their course
  if (user.role === 'professor') {
    if (hasCourseFaculty && user.faculty_code) {
      const course = await get(`SELECT id FROM courses WHERE id = ? AND faculty_code = ?`, [courseId, user.faculty_code]);
      if (!course) throw new AppError('You can only update your assigned courses', 403);
    } else {
      const course = await get(`SELECT id FROM courses WHERE id = ? AND (assigned_faculty = ? OR assigned_faculty LIKE ?)`, [courseId, user.username, `%${user.full_name}%`]);
      if (!course) throw new AppError('You can only update your assigned courses', 403);
    }
  }

  let { code, name, schedule, assigned_faculty, faculty_code } = req.body;
  
  // Professors cannot change faculty assignment
  let selectFields = ['assigned_faculty'];
  if (hasCourseFaculty) selectFields.push('faculty_code');
  const current = await get(`SELECT ${selectFields.join(', ')} FROM courses WHERE id = ?`, [courseId]);
  const newFaculty = user.role === 'professor' ? current.assigned_faculty : assigned_faculty;
  
  let newFacultyCode = user.role === 'professor' ? (hasCourseFaculty ? current.faculty_code : null) : (faculty_code || (hasCourseFaculty ? current.faculty_code : null));

  if (user.role === 'admin' && hasCourseFaculty && hasUserFaculty && !faculty_code && assigned_faculty && assigned_faculty !== current.assigned_faculty) {
      const match = `%${assigned_faculty.split(' ').pop()}%`;
      const prof = await get(`SELECT faculty_code FROM users WHERE role = 'professor' AND (full_name LIKE ? OR username = ?) LIMIT 1`, [match, assigned_faculty]);
      if (prof && prof.faculty_code) {
          newFacultyCode = prof.faculty_code;
      } else {
          newFacultyCode = null; // Removed valid professor match
      }
  }

  if (hasCourseFaculty) {
    await run('UPDATE courses SET code=?, name=?, schedule=?, assigned_faculty=?, faculty_code=? WHERE id=?', [code, name, schedule, newFaculty, newFacultyCode, courseId]);
  } else {
    await run('UPDATE courses SET code=?, name=?, schedule=?, assigned_faculty=? WHERE id=?', [code, name, schedule, newFaculty, courseId]);
  }
  res.json({ success: true });
}));

app.delete('/api/courses/:id', authMiddleware, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'forbidden' });
  await run('DELETE FROM courses WHERE id=?', [req.params.id]);
  res.json({ success: true });
});

// Rooms Management
app.get('/api/rooms', authMiddleware, async (req, res) => {
  try {
    const rows = await all(`SELECT * FROM rooms ORDER BY name ASC`);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: 'db_error' }); }
});

app.post('/api/rooms', authMiddleware, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'forbidden' });
  const { name, type, capacity } = req.body;
  try {
    await run('INSERT INTO rooms (name, type, capacity) VALUES (?,?,?)', [name, type, capacity]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: 'db_error' }); }
});

app.put('/api/rooms/:id', authMiddleware, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'forbidden' });
  const { name, type, capacity } = req.body;
  await run('UPDATE rooms SET name=?, type=?, capacity=? WHERE id=?', [name, type, capacity, req.params.id]);
  res.json({ success: true });
});

app.delete('/api/rooms/:id', authMiddleware, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'forbidden' });
  await run('DELETE FROM rooms WHERE id=?', [req.params.id]);
  res.json({ success: true });
});

app.get('/api/reports/room-utilization', authMiddleware, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'forbidden' });
  try {
    // Basic aggregation for room utilization
    const rows = await all(`
      SELECT 
        r.name, 
        r.type, 
        r.capacity, 
        COUNT(l.id) as total_scans,
        COUNT(DISTINCT l.course_id) as courses_hosted
      FROM rooms r
      LEFT JOIN attendance_logs l ON r.id = l.room_id
      GROUP BY r.id
      ORDER BY total_scans DESC
    `);
    res.json(rows);
  } catch(e) {
    res.status(500).json({ error: 'db_error' });
  }
});

// AI Insights for At-Risk Students
const { GoogleGenAI } = require('@google/genai');

app.get('/api/attendance/ai-insights-student/:username', authMiddleware, async (req, res) => {
  try {
    const { username } = req.params;
    const student = await get(`SELECT id, full_name, username FROM users WHERE username = ?`, [username]);
    if (!student) return res.status(404).json({ error: 'Student not found' });

    // Get all courses student is enrolled in
    const courses = await all(`
      SELECT c.id, c.code, c.name 
      FROM courses c 
      JOIN student_courses sc ON c.id = sc.course_id 
      WHERE sc.student_id = ?
    `, [student.id]);

    const courseData = [];
    for (const course of courses) {
      const logs = await all(`
        SELECT status, timestamp FROM attendance_logs 
        WHERE student_id = ? AND course_id = ? 
        ORDER BY timestamp DESC
      `, [student.id, course.id]);

      const sessionDates = await all(`
        SELECT DISTINCT SUBSTR(timestamp, 1, 10) as date 
        FROM attendance_logs 
        WHERE course_id = ?
      `, [course.id]);
      
      const totalSessions = sessionDates.length || 1;
      const absences = logs.filter(l => l.status === 'ABSENT').length;
      const lates = logs.filter(l => l.status === 'LATE').length;
      const rate = Math.round(((totalSessions - absences) / totalSessions) * 100);

      courseData.push({
        code: course.code,
        name: course.name,
        absenceRate: Math.round((absences / totalSessions) * 100),
        lateRate: Math.round((lates / totalSessions) * 100),
        attendanceRate: rate,
        totalSessions
      });
    }

    let aiSummary = "Attendance patterns across all courses appear stable.";
    if (courseData.length > 0) {
      if (process.env.GEMINI_API_KEY) {
        try {
          const ai = new GoogleGenAI(process.env.GEMINI_API_KEY);
          const model = ai.getGenerativeModel({ model: "gemini-1.5-flash" });
          
          const prompt = `Analyze the attendance behavior of student ${student.full_name} (@${student.username}) across these courses:
            ${JSON.stringify(courseData, null, 2)}
            
            Provide a 3-sentence professional, supportive summary for a university advisor. Highlight any specific subject where they are struggling or if they show a general positive trend.`;
          
          const result = await model.generateContent(prompt);
          aiSummary = result.response.text();
        } catch (error) {
          aiSummary = `Internal analysis: Student maintains an average attendance rate of ${Math.round(courseData.reduce((a,b)=>a+b.attendanceRate,0)/courseData.length)}% across ${courseData.length} courses.`;
        }
      } else {
        aiSummary = `Cross-course analysis complete. Average consistency rate is ${Math.round(courseData.reduce((a,b)=>a+b.attendanceRate,0)/courseData.length)}%.`;
      }
    }

    res.json({
      success: true,
      aiSummary: aiSummary,
      courseData: courseData
    });
  } catch (e) {
    res.status(500).json({ error: 'server_error' });
  }
});


app.get('/api/attendance/analytics/:courseId', authMiddleware, async (req, res) => {
  if (req.user.role === 'student') return res.status(403).json({ error: 'forbidden' });
  try {
    const courseId = req.params.courseId;
    
    // Get course info for context
    const course = await get(`SELECT * FROM courses WHERE id = ?`, [courseId]);
    if (!course) return res.status(404).json({ error: 'Course not found' });

    // Validate permission
    const hasCourseFaculty = await colExists('courses', 'faculty_code');
    if (req.user.role === 'professor') {
      if (hasCourseFaculty && req.user.faculty_code) {
        if (course.faculty_code !== req.user.faculty_code) return res.status(403).json({ error: 'forbidden' });
      } else {
        if (course.assigned_faculty !== req.user.username && !course.assigned_faculty.includes(req.user.full_name)) return res.status(403).json({ error: 'forbidden' });
      }
    }

    const students = await all(`
      SELECT u.id, u.full_name, u.username
      FROM student_courses sc JOIN users u ON sc.student_id = u.id
      WHERE sc.course_id = ?
    `, [courseId]);

    const logs = await all(`
      SELECT status, SUBSTR(timestamp, 1, 10) as date, student_id
      FROM attendance_logs 
      WHERE course_id = ?
      ORDER BY timestamp ASC
    `, [courseId]);

    const activeExcuses = await all(`
      SELECT student_id, status FROM excuses WHERE course_code = ? AND status = 'APPROVED'
    `, [course.code]);
    const excusedCount = activeExcuses.length;

    let totalLogs = logs.length;
    let presentCount = 0;
    let lateCount = 0;
    let absentCount = 0;
    
    const trendsMap = {};
    const studentStats = {};

    for (const s of students) {
      studentStats[s.id] = { name: s.full_name, lates: 0, absences: 0 };
    }

    for (const l of logs) {
      if (l.status === 'PRESENT') presentCount++;
      if (l.status === 'LATE') { lateCount++; if (studentStats[l.student_id]) studentStats[l.student_id].lates++; }
      if (l.status === 'ABSENT') { absentCount++; if (studentStats[l.student_id]) studentStats[l.student_id].absences++; }

      if (!trendsMap[l.date]) trendsMap[l.date] = { date: l.date, present: 0, late: 0, absent: 0, total: 0 };
      trendsMap[l.date].total++;
      if (l.status === 'PRESENT') trendsMap[l.date].present++;
      if (l.status === 'LATE') trendsMap[l.date].late++;
      if (l.status === 'ABSENT') trendsMap[l.date].absent++;
    }

    let attendanceRate = totalLogs ? ((presentCount / totalLogs) * 100).toFixed(1) : 0;
    let lateRate = totalLogs ? ((lateCount / totalLogs) * 100).toFixed(1) : 0;
    let absenceRate = totalLogs ? ((absentCount / totalLogs) * 100).toFixed(1) : 0;
    let excusedRate = totalLogs ? ((excusedCount / totalLogs) * 100).toFixed(1) : 0;

    let trends = Object.values(trendsMap).sort((a,b) => a.date.localeCompare(b.date));

    let statsArr = Object.values(studentStats);
    let mostLate = [...statsArr].sort((a,b) => b.lates - a.lates).filter(s => s.lates > 0).slice(0,3);
    let mostAbsent = [...statsArr].sort((a,b) => b.absences - a.absences).filter(s => s.absences > 0).slice(0,3);

    res.json({
      success: true,
      health: {
        attendanceRate,
        lateRate,
        absenceRate,
        excusedRate
      },
      trends,
      mostLate,
      mostAbsent
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'server_error' });
  }
});

app.get('/api/attendance/analytics-admin', authMiddleware, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'forbidden' });
  try {
    const logs = await all(`SELECT course_id, status, SUBSTR(timestamp, 1, 10) as date FROM attendance_logs`);
    const courses = await all(`SELECT id, code, name FROM courses`);
    
    let totalLogs = logs.length;
    let presentCount = 0;
    
    let courseStats = {};
    for (const c of courses) {
       courseStats[c.id] = { id: c.id, code: c.code, name: c.name, total: 0, absent: 0, present: 0 };
    }

    const trendsMap = {};

    for (const l of logs) {
       if (l.status === 'PRESENT' || l.status === 'LATE') presentCount++;
       if (courseStats[l.course_id]) {
          courseStats[l.course_id].total++;
          if (l.status === 'ABSENT') courseStats[l.course_id].absent++;
          if (l.status === 'PRESENT' || l.status === 'LATE') courseStats[l.course_id].present++;
       }
       
       if (l.date) {
         if (!trendsMap[l.date]) trendsMap[l.date] = { date: l.date, present: 0, total: 0 };
         trendsMap[l.date].total++;
         if (l.status === 'PRESENT' || l.status === 'LATE') trendsMap[l.date].present++;
       }
    }

    let globalAttendanceRate = totalLogs ? ((presentCount / totalLogs) * 100).toFixed(1) : 0;
    
    let courseArr = Object.values(courseStats).filter(c => c.total > 10);
    courseArr.forEach(c => {
       c.absenceRate = (c.absent / c.total) * 100;
       c.attendanceRate = (c.present / c.total) * 100;
    });

    let highRiskCourses = [...courseArr].sort((a,b) => b.absenceRate - a.absenceRate).slice(0, 3);
    let mostEngagedCourses = [...courseArr].sort((a,b) => b.attendanceRate - a.attendanceRate).slice(0, 3);
    
    let trends = Object.values(trendsMap).sort((a,b) => a.date.localeCompare(b.date));

    res.json({
       success: true,
       globalAttendanceRate,
       highRiskCourses,
       mostEngagedCourses,
       trends
    });
  } catch(e) {
    res.status(500).json({error: 'server_error'});
  }
});

app.get('/api/attendance/ai-insights/:courseId', authMiddleware, async (req, res) => {
  if (req.user.role === 'student') return res.status(403).json({ error: 'forbidden' });
  try {
    const courseId = req.params.id || req.params.courseId;
    
    // Get course info for context
    const course = await get(`SELECT * FROM courses WHERE id = ?`, [courseId]);
    if (!course) return res.status(404).json({ error: 'Course not found' });

    // Get all students enrolled in this course
    const students = await all(`
      SELECT u.id, u.full_name, u.username
      FROM student_courses sc JOIN users u ON sc.student_id = u.id
      WHERE sc.course_id = ?
    `, [courseId]);

    // Get unique session dates for this course to calculate real rates
    const sessionDates = await all(`
      SELECT DISTINCT SUBSTR(timestamp, 1, 10) as date 
      FROM attendance_logs 
      WHERE course_id = ?
    `, [courseId]);
    const totalSessions = sessionDates.length || 1;

    const atRisk = [];
    
    for (const student of students) {
      // Get all logs for this student in this course
      const logs = await all(`
        SELECT status, timestamp FROM attendance_logs 
        WHERE student_id = ? AND course_id = ? 
        ORDER BY timestamp DESC
      `, [student.id, courseId]);

      const totalAbsences = logs.filter(l => l.status === 'ABSENT').length;
      const totalLates = logs.filter(l => l.status === 'LATE').length;
      const absenceRate = (totalAbsences / totalSessions) * 100;
      const lateRate = (totalLates / totalSessions) * 100;

      // Detect patterns
      let consecutiveAbsences = 0;
      for (const log of logs) {
        if (log.status === 'ABSENT') consecutiveAbsences++;
        else break;
      }

      let reason = "";
      if (consecutiveAbsences >= 2) reason = "Consecutive absences detected";
      else if (absenceRate > 20) reason = `High absence rate (${Math.round(absenceRate)}%)`;
      else if (lateRate > 30) reason = `Consistent tardiness (${Math.round(lateRate)}%)`;

      if (reason) {
        atRisk.push({
          student_id: student.id,
          name: student.full_name,
          username: student.username,
          absences: totalAbsences,
          lates: totalLates,
          rate: Math.round(((totalSessions - totalAbsences) / totalSessions) * 100),
          riskReason: reason
        });
      }
    }

    let aiSummary = "Attendance patterns appear stable for most students.";
    if (atRisk.length > 0) {
      if (process.env.GEMINI_API_KEY) {
        try {
          const ai = new GoogleGenAI(process.env.GEMINI_API_KEY);
          // Use gemini-1.5-flash
          const model = ai.getGenerativeModel({ model: "gemini-1.5-flash" });
          
          const prompt = `As a university advisor, analyze these at-risk students for the course "${course.name}":
            ${JSON.stringify(atRisk, null, 2)}
            
            Provide a 3-sentence professional summary for the professor highlighting the most critical trends (e.g., specific students or general class behavior) and a recommended intervention plan.`;
          
          const result = await model.generateContent(prompt);
          aiSummary = result.response.text();
        } catch (error) {
          console.error("Gemini Error:", error);
          aiSummary = `AI analysis unavailable. Found ${atRisk.length} students at risk due to high absence or chronic tardiness.`;
        }
      } else {
        aiSummary = `Internal Logic Analysis: ${atRisk.length} students flagged for attendance interference. Intervention recommended for those with >20% absence.`;
      }
    }

    res.json({
      success: true,
      atRiskStudents: atRisk,
      aiSummary: aiSummary,
      totalSessions: totalSessions
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'db_error' });
  }
});

// Enrollments
app.get('/api/enrollments', authMiddleware, async (req, res) => {
  const user = req.user;
  let sql = `
    SELECT sc.id, u.id as user_id, u.username, u.full_name, u.avatar, c.code 
    FROM student_courses sc 
    JOIN users u ON sc.student_id=u.id 
    JOIN courses c ON sc.course_id=c.id`;
  
  const params = [];
  const hasCourseFaculty = await colExists('courses', 'faculty_code');
  if (user.role === 'professor') {
    if (hasCourseFaculty && user.faculty_code) {
      sql += ` WHERE c.faculty_code = ?`;
      params.push(user.faculty_code);
    } else {
      sql += ` WHERE c.assigned_faculty = ? OR c.assigned_faculty LIKE ?`;
      params.push(user.username);
      params.push(`%${user.full_name}%`);
    }
  } else if (user.role === 'student') {
    sql += ` WHERE sc.student_id = ?`;
    params.push(user.id);
  }

  sql += ` ORDER BY sc.id DESC`;
  const rows = await all(sql, params);
  res.json(rows);
});

app.post('/api/enrollments', authMiddleware, asyncHandler(async (req, res) => {
  const user = req.user;
  if (user.role !== 'admin' && user.role !== 'professor') throw new AppError('forbidden', 403);

  const { student_username, course_code } = req.body;
  const hasAppUsername = await colExists('users', 'app_username');
  const hasCourseFaculty = await colExists('courses', 'faculty_code');

  let s;
  if (hasAppUsername) {
    s = await get('SELECT id FROM users WHERE username = ? OR app_username = ?', [student_username, student_username.toLowerCase()]);
  } else {
    s = await get('SELECT id FROM users WHERE username = ?', [student_username]);
  }

  let selectFields = ['id'];
  if (hasCourseFaculty) selectFields.push('faculty_code');
  const c = await get(`SELECT ${selectFields.join(', ')} FROM courses WHERE code = ?`, [course_code]);

  if (!s || !c) throw new AppError('Student or Course not found', 404);

  // If professor, verify it's their course
  if (user.role === 'professor') {
    if (hasCourseFaculty && c.faculty_code !== user.faculty_code) {
      throw new AppError('You can only enroll students in your own courses', 403);
    }
  }

  const existing = await get('SELECT id FROM student_courses WHERE student_id = ? AND course_id = ?', [s.id, c.id]);
  if (existing) {
    throw new AppError('Student already enrolled.', 400); 
  }

  await run('INSERT INTO student_courses (student_id, course_id) VALUES (?,?)', [s.id, c.id]);
  res.json({ success: true });
}));

app.delete('/api/enrollments/:id', authMiddleware, asyncHandler(async (req, res) => {
  const user = req.user;
  const enrollmentId = req.params.id;

  if (user.role !== 'admin' && user.role !== 'professor') throw new AppError('forbidden', 403);

  // If professor, verify enrollment is for their course
  if (user.role === 'professor') {
    const hasCourseFaculty = await colExists('courses', 'faculty_code');
    let enrollment;
    if (hasCourseFaculty && user.faculty_code) {
      enrollment = await get(`
        SELECT sc.id FROM student_courses sc
        JOIN courses c ON sc.course_id = c.id
        WHERE sc.id = ? AND c.faculty_code = ?
      `, [enrollmentId, user.faculty_code]);
    } else {
      enrollment = await get(`
        SELECT sc.id FROM student_courses sc
        JOIN courses c ON sc.course_id = c.id
        WHERE sc.id = ? AND (c.assigned_faculty = ? OR c.assigned_faculty LIKE ?)
      `, [enrollmentId, user.username, `%${user.full_name}%`]);
    }

    if (!enrollment) throw new AppError('You can only unenroll students from your own courses', 403);
  }

  await run('DELETE FROM student_courses WHERE id=?', [enrollmentId]);
  res.json({ success: true });
}));

// Announcements
app.get('/api/announcements', authMiddleware, async (req, res) => {
  const rows = await all(`SELECT * FROM announcements WHERE course_id IS NULL ORDER BY timestamp DESC LIMIT 10`);
  res.json(rows);
});

app.post('/api/announcements', authMiddleware, async (req, res) => {
  if (req.user.role === 'student') return res.status(403).json({ error: 'forbidden' });
  const { title, content, type } = req.body;
  await run(`INSERT INTO announcements (title, content, type, created_by, timestamp) VALUES (?,?,?,?,?)`, [title, content, type, req.user.full_name, getNowPH()]);
  res.json({ success: true });
});

app.get('/api/announcements/student', authMiddleware, async (req, res) => {
  if (req.user.role !== 'student') return res.status(403).json({ error: 'forbidden' });
  const rows = await all(`
    SELECT a.*, c.code as course_code, c.name as course_name 
    FROM announcements a 
    JOIN student_courses sc ON a.course_id = sc.course_id 
    JOIN courses c ON a.course_id = c.id
    WHERE sc.student_id = ? 
    ORDER BY a.is_pinned DESC, a.timestamp DESC 
    LIMIT 20
  `, [req.user.id]);
  res.json(rows);
});

app.get('/api/announcements/course/:courseId', authMiddleware, async (req, res) => {
  // If student, verify enrollment. If prof, verify assignment. Skip complex check for now, basic auth is fine
  const limit = req.query.limit || 20;
  const rows = await all(`SELECT * FROM announcements WHERE course_id = ? ORDER BY is_pinned DESC, timestamp DESC LIMIT ?`, [req.params.courseId, limit]);
  res.json(rows);
});

app.post('/api/announcements/course/:courseId', authMiddleware, async (req, res) => {
  if (req.user.role === 'student') return res.status(403).json({ error: 'forbidden' });
  const { title, content, type, is_pinned } = req.body;
  await run(`INSERT INTO announcements (title, content, type, course_id, is_pinned, created_by, timestamp) VALUES (?,?,?,?,?,?,?)`, 
    [title, content, type, req.params.courseId, is_pinned ? 1 : 0, req.user.full_name, getNowPH()]);
  res.json({ success: true });
});

app.put('/api/announcements/:id', authMiddleware, async (req, res) => {
  if (req.user.role === 'student') return res.status(403).json({ error: 'forbidden' });
  const { title, content, type, is_pinned } = req.body;
  await run(`UPDATE announcements SET title=?, content=?, type=?, is_pinned=? WHERE id=?`, 
    [title, content, type, is_pinned ? 1 : 0, req.params.id]);
  res.json({ success: true });
});

app.delete('/api/announcements/:id', authMiddleware, async (req, res) => {
  if (req.user.role === 'student') return res.status(403).json({ error: 'forbidden' });
  await run(`DELETE FROM announcements WHERE id=?`, [req.params.id]);
  res.json({ success: true });
});

app.get('/api/notes/:studentId', authMiddleware, async (req, res) => {
  if (req.user.role === 'student') return res.status(403).json({ error: 'forbidden' });
  const notes = await all(`SELECT * FROM professor_notes WHERE student_id = ? AND professor_id = ? ORDER BY updated_at DESC`, [req.params.studentId, req.user.id]);
  res.json(notes);
});

app.post('/api/notes/:studentId', authMiddleware, async (req, res) => {
  if (req.user.role === 'student') return res.status(403).json({ error: 'forbidden' });
  let { note_text, tag } = req.body;
  if (!note_text || !note_text.trim()) return res.status(400).json({ error: 'Note text required' });

  await run(
    `INSERT INTO professor_notes (professor_id, student_id, note_text, tag, updated_at) VALUES (?, ?, ?, ?, ?)`,
    [req.user.id, req.params.studentId, note_text.trim(), tag || '', getNowPH()]
  );
  res.json({ success: true });
});

app.put('/api/notes/:noteId', authMiddleware, async (req, res) => {
  if (req.user.role === 'student') return res.status(403).json({ error: 'forbidden' });
  let { note_text, tag } = req.body;
  if (!note_text || !note_text.trim()) return res.status(400).json({ error: 'Note text required' });

  await run(
    `UPDATE professor_notes SET note_text = ?, tag = ?, updated_at = ? WHERE id = ? AND professor_id = ?`,
    [note_text.trim(), tag || '', getNowPH(), req.params.noteId, req.user.id]
  );
  res.json({ success: true });
});

app.delete('/api/notes/:noteId', authMiddleware, async (req, res) => {
  if (req.user.role === 'student') return res.status(403).json({ error: 'forbidden' });
  await run(`DELETE FROM professor_notes WHERE id = ? AND professor_id = ?`, [req.params.noteId, req.user.id]);
  res.json({ success: true });
});

// Audit
app.get('/api/audit', authMiddleware, async (req, res) => {
  const user = req.user;
  let sql = `SELECT * FROM audit_logs`;
  const params = [];

  if (user.role === 'professor') {
    // Audit logs for their sessions or their students
    // For simplicity, logs by them OR logs involving their course IDs in 'details'
    const hasCourseFaculty = await colExists('courses', 'faculty_code');
    let courses;
    if (hasCourseFaculty && user.faculty_code) {
      courses = await all(`SELECT id, code FROM courses WHERE faculty_code = ?`, [user.faculty_code]);
    } else {
      courses = await all(`SELECT id, code FROM courses WHERE assigned_faculty = ? OR assigned_faculty LIKE ?`, [user.username, `%${user.full_name}%`]);
    }
    const courseCodes = courses.map(c => c.code);
    
    sql += ` WHERE user_id = ?`;
    params.push(user.id);
    
    courseCodes.forEach(code => {
      sql += ` OR details LIKE ?`;
      params.push(`%${code}%`);
    });
  } else if (user.role !== 'admin') {
    return res.status(403).json({ error: 'forbidden' });
  }

  sql += ` ORDER BY id DESC LIMIT 100`;
  const rows = await all(sql, params);
  res.json(rows);
});

// Excuses
app.get('/api/excuses', authMiddleware, async (req, res) => {
  const user = req.user;
  let sql = `SELECT e.*, u.full_name FROM excuses e JOIN users u ON e.student_id = u.id`;
  const params = [];

  if (user.role === 'student') {
    sql += ` WHERE e.student_id = ?`;
    params.push(user.id);
  } else if (user.role === 'professor') {
    // Show excuses for their classes
    const hasCourseFaculty = await colExists('courses', 'faculty_code');
    let courses;
    if (hasCourseFaculty && user.faculty_code) {
      courses = await all(`SELECT code FROM courses WHERE faculty_code = ?`, [user.faculty_code]);
    } else {
      courses = await all(`SELECT code FROM courses WHERE assigned_faculty = ? OR assigned_faculty LIKE ?`, [user.username, `%${user.full_name}%`]);
    }
    const courseCodes = courses.map(c => c.code);
    
    if (courseCodes.length > 0) {
      const placeholders = courseCodes.map(() => '?').join(',');
      sql += ` WHERE e.course_code IN (${placeholders})`;
      params.push(...courseCodes);
    } else {
      sql += ` WHERE 1=0`; // No courses
    }
  }

  sql += ` ORDER BY e.timestamp DESC`;
  const rows = await all(sql, params);
  res.json(rows);
});

app.post('/api/excuses', authMiddleware, async (req, res) => {
  if (req.user.role !== 'student') return res.status(403).json({ error: 'forbidden' });
  const { course_code, date, reason } = req.body;
  await run(`INSERT INTO excuses (student_id, course_code, date, reason, status, timestamp) VALUES (?,?,?,?,'PENDING',?)`, [req.user.id, course_code, date, reason, getNowPH()]);
  res.json({ success: true });
});

app.put('/api/excuses/:id', authMiddleware, async (req, res) => {
  if (req.user.role === 'student') return res.status(403).json({ error: 'forbidden' });
  const { status } = req.body;
  await run(`UPDATE excuses SET status=? WHERE id=?`, [status, req.params.id]);
  
  if (status === 'APPROVED') {
    const ex = await get(`SELECT * FROM excuses WHERE id=?`, [req.params.id]);
    const co = await get(`SELECT id FROM courses WHERE code=?`, [ex.course_code]);
    if (co) {
      await run(`UPDATE attendance_logs SET status='EXCUSED', remarks=? WHERE student_id=? AND course_id=? AND timestamp LIKE ?`, 
        ['Excused: ' + ex.reason, ex.student_id, co.id, `${ex.date}%`]);
    }
  }
  res.json({ success: true });
});

app.get('/api/backup', authMiddleware, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'forbidden' });
  const dbPath = path.join(__dirname, '..', 'data', 'attendance.db');
  res.download(dbPath, `backup_attendance.db`);
});

app.use('/', express.static(path.join(__dirname, '..', 'frontend'), {
  maxAge: '1h',
  etag: true
}));

// Centralized error handling must be the last middleware
app.use(errorHandler);

const PORT = 3000;
app.listen(PORT, '0.0.0.0', () => console.log(`\n>> Server running at: http://0.0.0.0:${PORT}\n`));