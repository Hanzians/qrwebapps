const fs = require('fs');
const files = [
  'frontend/help.html',
  'frontend/calendar.html',
  'frontend/index.html',
  'frontend/student-dashboard.html',
  'frontend/settings.html',
  'frontend/admin.html',
  'frontend/student-profile.html',
  'frontend/class-details.html'
];
for(let file of files) {
  let text = fs.readFileSync(file, 'utf8');
  text = text.replace(/Scan Mode/g, 'Attendance Hub');
  fs.writeFileSync(file, text);
}
