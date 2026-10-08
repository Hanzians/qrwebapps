const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('backend/database.sqlite');
db.all(`
      SELECT u.id
      FROM users u
      JOIN student_courses sc ON u.id = sc.student_id
      LEFT JOIN attendance_logs al ON u.id = al.student_id AND al.session_id = ?
      WHERE sc.course_id = ? AND u.role = 'student' AND al.id IS NULL
      `, [1, 1], (err, rows) => {
  if (err) console.error(err);
  console.log('UNCHECKED STUDENTS', rows);
});

db.all('SELECT * FROM attendance_sessions', (err, rows) => {
  console.log('SESSIONS', rows);
});
