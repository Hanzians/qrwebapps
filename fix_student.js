const fs = require('fs');
let code = fs.readFileSync('frontend/student-dashboard.html', 'utf8');
const target = /async function submitExcuse\(\) \{\s+const c=document.getElementById\('ex_course'\).value, d=document.getElementById\('ex_date'\).value, r=document.getElementById\('ex_reason'\).value;\s+if\(!c\|\|!d\|\|!r\) return showToast\("Please fill all fields", 'error'\);\s+const res = await createExcuse\(\{course_code:c, date:d, reason:r\}\);\s+if\(res.success\) \{ showToast\("Request submitted"\); document.getElementById\('excuseModal'\).classList.add\('hidden'\); loadData\(\); \}\s+else showToast\("Error submitting", 'error'\);\s+\}/;

const replacement = `async function submitExcuse() {
    const btn = document.querySelector('#excuseModal .btn-primary');
    const oldText = btn.innerHTML;
    const c=document.getElementById('ex_course').value, d=document.getElementById('ex_date').value, r=document.getElementById('ex_reason').value;
    if(!c||!d||!r) return showToast("Please fill all fields", 'error');

    btn.disabled = true;
    btn.innerHTML = '<span class="material-symbols-rounded animate-spin">progress_activity</span>';

    try {
      const res = await createExcuse({course_code:c, date:d, reason:r});
      if(res.success) { showToast("Request submitted"); document.getElementById('excuseModal').classList.add('hidden'); loadData(); }
      else showToast(res.error || "Error submitting", 'error');
    } finally {
      btn.disabled = false;
      btn.innerHTML = oldText;
    }
  }`;

fs.writeFileSync('frontend/student-dashboard.html', code.replace(target, replacement));
