const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { run, get, all, colExists } = require('../db');
const { authMiddleware } = require('../auth');

const { errorHandler, asyncHandler, AppError } = require('../utils/errorHandler');

// Create User
router.post('/', authMiddleware, asyncHandler(async (req, res) => {
  if (req.user.role !== 'admin' && req.user.role !== 'professor') throw new AppError('forbidden', 403);
  
  const { username, password, role, full_name, year, section, faculty_code, app_username } = req.body;
  if (!username || !password || !role) throw new AppError('missing_fields', 400);

  // Professor constraint: can only create students
  if (req.user.role === 'professor' && role !== 'student') {
    throw new AppError('Professors can only create student accounts', 403);
  }
  
  // Clean app_username
  let finalAppUser = app_username ? app_username.toLowerCase().trim() : null;
  
  const hash = bcrypt.hashSync(password, 10);
  try {
    const hasAppUsername = await colExists('users', 'app_username');
    const hasFacultyCode = await colExists('users', 'faculty_code');

    let cols = ["username", "password_hash", "role", "full_name", "year", "section", "avatar", "preferences"];
    let vals = [username, hash, role, full_name || null, year || null, section || null, 'default', '{}'];
    if (hasAppUsername) {
      cols.push("app_username");
      vals.push(finalAppUser);
    }

    const sql = `INSERT INTO users (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`;
    const info = await run(sql, vals);
    
    if (role === 'professor' && hasFacultyCode) {
        const generatedCode = faculty_code || `P-${info.lastID.toString().padStart(4, '0')}`;
        await run(`UPDATE users SET faculty_code = ? WHERE id = ?`, [generatedCode, info.lastID]);
    }
    
    res.json({ success: true, id: info.lastID });
  } catch (err) {
    console.error('Create User DB Error:', err);
    if (err.message.includes('UNIQUE constraint failed')) {
      throw new AppError('Username already exists', 400);
    }
    throw new AppError('database_error', 500);
  }
}));

// Update Self (Profile)
router.put('/me', authMiddleware, asyncHandler(async (req, res) => {
  const { full_name, password, avatar, preferences } = req.body;
  const userId = req.user.id;
  if (full_name) await run(`UPDATE users SET full_name = ? WHERE id = ?`, [full_name, userId]);
  if (avatar) await run(`UPDATE users SET avatar = ? WHERE id = ?`, [avatar, userId]);
  if (preferences) await run(`UPDATE users SET preferences = ? WHERE id = ?`, [preferences, userId]);
  if (password) {
    const hash = bcrypt.hashSync(password, 10);
    await run(`UPDATE users SET password_hash = ? WHERE id = ?`, [hash, userId]);
  }
  res.json({ success: true });
}));

// Admin / Professor Update User
router.put('/:id', authMiddleware, asyncHandler(async (req, res) => {
  const user = req.user;
  const targetId = req.params.id;

  if (user.role !== 'admin' && user.role !== 'professor') throw new AppError('forbidden', 403);

  // If professor, verify target is a student in their course
  if (user.role === 'professor') {
    const target = await get(`
      SELECT u.id, u.role FROM users u
      JOIN student_courses sc ON u.id = sc.student_id
      JOIN courses c ON sc.course_id = c.id
      WHERE u.id = ? AND c.faculty_code = ? AND u.role = 'student'
    `, [targetId, user.faculty_code]);

    if (!target) {
        throw new AppError('You can only update students enrolled in your courses', 403);
    }
  }

  const { full_name, username, role, password, year, section, preferences, faculty_code, app_username, avatar } = req.body;
  const userId = req.params.id;

  // Professors cannot change roles
  if (user.role === 'professor' && role && role !== 'student') {
    throw new AppError('Cannot change role to non-student', 403);
  }

  const hasAppUsername = await colExists('users', 'app_username');
  const hasFacultyCode = await colExists('users', 'faculty_code');

  if (full_name) await run('UPDATE users SET full_name=? WHERE id=?', [full_name, userId]);
  if (username) await run('UPDATE users SET username=? WHERE id=?', [username, userId]);
  if (app_username && hasAppUsername) await run('UPDATE users SET app_username=? WHERE id=?', [app_username.toLowerCase().trim(), userId]);
  if (role) await run('UPDATE users SET role=? WHERE id=?', [role, userId]);
  if (year !== undefined) await run('UPDATE users SET year=? WHERE id=?', [year, userId]);
  if (section !== undefined) await run('UPDATE users SET section=? WHERE id=?', [section, userId]);
  if (preferences) await run('UPDATE users SET preferences=? WHERE id=?', [preferences, userId]);
  if (faculty_code && role === 'professor' && hasFacultyCode) await run('UPDATE users SET faculty_code=? WHERE id=?', [faculty_code, userId]);
  if (avatar) await run('UPDATE users SET avatar=? WHERE id=?', [avatar, userId]);
  if (password && password.trim() !== "") {
    const hash = bcrypt.hashSync(password, 10);
    await run('UPDATE users SET password_hash=? WHERE id=?', [hash, userId]);
  }
  res.json({ success: true });
}));

// GET My Courses
router.get('/courses', authMiddleware, asyncHandler(async (req, res) => { 
  const hasCourseFacultyCode = await colExists('courses', 'faculty_code');
  let selectFields = ['c.id', 'c.code', 'c.name', 'c.schedule', 'c.assigned_faculty', 'c.is_online'];
  if (hasCourseFacultyCode) selectFields.push('c.faculty_code');

  const r = await all(`
    SELECT ${selectFields.join(', ')} 
    FROM student_courses sc 
    JOIN courses c ON sc.course_id = c.id 
    WHERE sc.student_id = ?`, 
    [req.user.id]
  ); 
  res.json(r); 
}));

// Get User by Username
router.get('/:username', authMiddleware, asyncHandler(async (req, res) => {
  const hasAppUsername = await colExists('users', 'app_username');
  const hasFacultyCode = await colExists('users', 'faculty_code');
  
  let selectFields = ['id', 'username', 'role', 'full_name', 'year', 'section', 'avatar'];
  if (hasAppUsername) selectFields.push('app_username');
  if (hasFacultyCode) selectFields.push('faculty_code');
  
  let user;
  if (hasAppUsername) {
    user = await get(`SELECT ${selectFields.join(', ')} FROM users WHERE username = ? OR app_username = ?`, [req.params.username, req.params.username.toLowerCase()]);
  } else {
    user = await get(`SELECT ${selectFields.join(', ')} FROM users WHERE username = ?`, [req.params.username]);
  }

  if (!user) throw new AppError('user_not_found', 404);
  res.json(user);
}));

// GET courses for a specific student
router.get('/:username/courses', authMiddleware, asyncHandler(async (req, res) => {
  if (req.user.role === 'student' && req.user.username !== req.params.username && req.user.app_username !== req.params.username.toLowerCase()) throw new AppError('forbidden', 403);
  
  const hasAppUsername = await colExists('users', 'app_username');
  const hasCourseFacultyCode = await colExists('courses', 'faculty_code');

  let user;
  if (hasAppUsername) {
    user = await get(`SELECT id FROM users WHERE username = ? OR app_username = ?`, [req.params.username, req.params.username.toLowerCase()]);
  } else {
    user = await get(`SELECT id FROM users WHERE username = ?`, [req.params.username]);
  }

  if (!user) throw new AppError('User not found', 404);

  let selectFields = ['c.id', 'c.code', 'c.name', 'c.schedule', 'c.assigned_faculty', 'c.is_online'];
  if (hasCourseFacultyCode) selectFields.push('c.faculty_code');

  const r = await all(`
    SELECT ${selectFields.join(', ')} 
    FROM student_courses sc 
    JOIN courses c ON sc.course_id = c.id 
    WHERE sc.student_id = ?`, 
    [user.id]
  ); 
  res.json(r); 
}));

// List Users
router.get('/', authMiddleware, asyncHandler(async (req, res) => { 
  const user = req.user;
  const hasAppUsername = await colExists('users', 'app_username');
  const hasFacultyCode = await colExists('users', 'faculty_code');

  if (user.role === 'admin') {
    let selectFields = ['id', 'username', 'role', 'full_name', 'year', 'section', 'avatar'];
    if (hasAppUsername) selectFields.push('app_username');
    if (hasFacultyCode) selectFields.push('faculty_code');

    const users = await all(`SELECT ${selectFields.join(', ')} FROM users ORDER BY id DESC`); 
    res.json(users); 
  } else if (user.role === 'professor') {
    // Return students enrolled in their courses
    let facultyQuery = '';
    let params = [];
    if (hasFacultyCode) {
      facultyQuery = 'WHERE c.faculty_code = ? AND u.role = \'student\'';
      params.push(user.faculty_code);
    } else {
      facultyQuery = 'WHERE u.role = \'student\'';
    }

    let selectFields = ['DISTINCT u.id', 'u.username', 'u.role', 'u.full_name', 'u.year', 'u.section', 'u.avatar'];
    if (hasAppUsername) selectFields.push('u.app_username');

    const users = await all(`
      SELECT ${selectFields.join(', ')} 
      FROM users u
      JOIN student_courses sc ON u.id = sc.student_id
      JOIN courses c ON sc.course_id = c.id
      ${facultyQuery}
      ORDER BY u.full_name ASC
    `, params);
    res.json(users);
  } else {
    let selectFields = ['id', 'username', 'role', 'full_name', 'year', 'section', 'avatar'];
    if (hasAppUsername) selectFields.push('app_username');

    const users = await all(`SELECT ${selectFields.join(', ')} FROM users WHERE id = ?`, [user.id]);
    res.json(users);
  }
}));

// Delete User (CASCADE)
router.delete('/:id', authMiddleware, asyncHandler(async (req, res) => { 
  if (req.user.role !== 'admin') throw new AppError('forbidden', 403); 
  const id = req.params.id;
  // Cascade delete related records
  await run('DELETE FROM attendance_logs WHERE student_id = ?', [id]);
  await run('DELETE FROM student_courses WHERE student_id = ?', [id]);
  await run('DELETE FROM excuses WHERE student_id = ?', [id]);
  await run('DELETE FROM audit_logs WHERE user_id = ?', [id]);
  await run('DELETE FROM users WHERE id = ?', [id]);
  res.json({ success: true }); 
}));

module.exports = router;
