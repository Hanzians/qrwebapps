const { get, all } = require('./backend/db');
async function run() {
  const profs = await all("SELECT code, assigned_faculty FROM courses");
  console.log("Professors:");
  console.log(profs);
  const students = await get("SELECT count(*) as count FROM users WHERE role = 'student'");
  console.log("Students length:", students);
  const logs = await get("SELECT count(*) as count FROM attendance_logs");
  console.log("Logs length:", logs);
  const sessions = await get("SELECT count(*) as count FROM attendance_sessions");
  console.log("Sessions length:", sessions);
  process.exit(0);
}
run();
