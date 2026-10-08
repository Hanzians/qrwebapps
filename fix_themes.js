const fs = require('fs');
const files = [
  'frontend/js/api.js', 'frontend/scan.html', 'frontend/index.html',
  'frontend/class-details.html', 'frontend/help.html', 'frontend/admin.html',
  'frontend/settings.html', 'frontend/student-dashboard.html',
  'frontend/calendar.html', 'frontend/login.html'
];
files.forEach(f => {
  let txt = fs.readFileSync(f, 'utf8');
  txt = txt.replace(/(!\("theme" in localStorage\) &&\s*window\.matchMedia\("\(prefers-color-scheme: dark\)"\)\.matches)/g, '(!("theme" in localStorage) && false)');
  fs.writeFileSync(f, txt);
});
