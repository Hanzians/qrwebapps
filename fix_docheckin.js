const fs = require('fs');
let code = fs.readFileSync('frontend/student-dashboard.html', 'utf8');

// Replace doCheckIn definition
let target = `  async function doCheckIn(id) {
    const res = await onlineCheckIn(id);
    if (res.success) { showToast("Checked in successfully!"); loadData(); }
    else showToast(res.error, "error");
  }`;

let replacement = `  async function doCheckIn(id, btn) {
    const oldText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<span class="material-symbols-rounded animate-spin">progress_activity</span>';
    try {
      const res = await onlineCheckIn(id);
      if (res.success) { showToast("Checked in successfully!"); loadData(); }
      else showToast(res.error || "Error", "error");
    } finally {
      btn.disabled = false;
      btn.innerHTML = oldText;
    }
  }`;

code = code.replace(target, replacement);

// Also replace the onclick attribute inside checkOnlineClasses
target = `onclick="doCheckIn(\${c.id})"`;
replacement = `onclick="doCheckIn(\${c.id}, this)"`;
code = code.replace(target, replacement);

fs.writeFileSync('frontend/student-dashboard.html', code);
