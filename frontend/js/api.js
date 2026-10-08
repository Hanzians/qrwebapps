const API_BASE = window.location.origin;

function getCurrentSemesterString() {
  const custom = localStorage.getItem("custom_semester_display");
  if (custom) return custom;
  const d = new Date();
  const m = d.getMonth();
  const y = d.getFullYear();
  let term = "Second Semester";
  let ayStart = y - 1;
  
  if (m >= 7) { 
    term = "First Semester"; 
    ayStart = y; 
  } else if (m >= 5 && m <= 6) {
    term = "Midyear";
    ayStart = y - 1;
  }
  return `${term} AY ${ayStart}–${ayStart + 1}`;
}
window.getCurrentSemesterString = getCurrentSemesterString;

// --- THEME & PREFERENCES ---
function initTheme() {
  if (
    localStorage.theme === "dark" ||
    ((!("theme" in localStorage) && false))
  ) {
    document.documentElement.classList.add("dark");
  } else {
    document.documentElement.classList.remove("dark");
  }
}

function toggleTheme() {
  if (document.documentElement.classList.contains("dark")) {
    document.documentElement.classList.remove("dark");
    localStorage.theme = "light";
  } else {
    document.documentElement.classList.add("dark");
    localStorage.theme = "dark";
  }
}

// Global Date Formatter based on User Settings
function formatDate(isoString) {
  if (!isoString) return "-";
  const date = new Date(isoString);
  const user = JSON.parse(localStorage.getItem("user") || "{}");
  let format = "MM/DD/YYYY";

  if (user.preferences) {
    try {
      const p = JSON.parse(user.preferences);
      if (p.dateFormat) format = p.dateFormat;
    } catch (e) {}
  }

  const d = date.getDate().toString().padStart(2, "0");
  const m = (date.getMonth() + 1).toString().padStart(2, "0");
  const y = date.getFullYear();

  if (format === "DD/MM/YYYY") return `${d}/${m}/${y}`;
  if (format === "YYYY-MM-DD") return `${y}-${m}-${d}`;
  return `${m}/${d}/${y}`; // Default
}

function formatTime(isoString) {
  if (!isoString) return "-";
  const date = new Date(isoString);
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function showToast(msg, type = "success") {
  let displayMsg = msg || "Unknown Error";
  if (msg === "timeout")
    displayMsg = "Request timed out. Please check your connection.";
  else if (msg === "network_error")
    displayMsg = "Network error. Server might be down.";
  else if (msg === "session_expired")
    displayMsg = "Session Expired";
  else if (typeof msg === 'string' && msg.includes('_')) {
    displayMsg = msg.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
  }

  let container = document.getElementById("toast-container");
  if (!container) {
    container = document.createElement("div");
    container.id = "toast-container";
    container.className = "fixed bottom-5 left-1/2 -translate-x-1/2 z-[9999] flex flex-col gap-3 pointer-events-none";
    document.body.appendChild(container);
  }
  const toast = document.createElement("div");
  const isError = type === "error";
  toast.className = `flex items-center gap-3 px-5 py-3.5 rounded-[20px] shadow-[0_8px_30px_rgba(0,0,0,0.12)] text-[11px] font-black uppercase tracking-widest text-white animate-slide-up backdrop-blur-md border ${isError ? "bg-rose-500/90 border-rose-400/50 shadow-rose-500/20" : "bg-emerald-600/90 border-emerald-500/50 shadow-emerald-500/20"}`;
  
  toast.innerHTML =
    isError
      ? `<span class="material-symbols-rounded text-lg">error</span> <span>${displayMsg}</span>`
      : `<span class="material-symbols-rounded text-lg">check_circle</span> <span>${displayMsg}</span>`;
      
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.transition = "all 0.4s cubic-bezier(0.3, 0, 0, 1)";
    toast.style.opacity = "0";
    toast.style.transform = "translateY(20px) scale(0.95)";
    setTimeout(() => toast.remove(), 400);
  }, 3000);
}

// --- NETWORK STATE & DIAGNOSTICS ---
function initNetworkDiagnostics() {
  const container = document.createElement("div");
  container.id = "network-status-banner";
  container.className = "fixed top-0 left-0 right-0 z-[9999] transition-all transform -translate-y-full text-center text-xs font-bold py-1.5 shadow-md flex items-center justify-center gap-2";
  document.body.appendChild(container);

  const updateNetworkStatus = () => {
    if (!navigator.onLine) {
      container.classList.remove("-translate-y-full");
      container.classList.add("bg-amber-500", "text-white");
      container.classList.remove("bg-emerald-500");
      container.innerHTML = '<span class="material-symbols-rounded text-sm">wifi_off</span> Offline Mode - Actions will sync when connected';
    } else {
      if (container.classList.contains("bg-amber-500")) {
        // Was offline, now online
        container.classList.remove("bg-amber-500");
        container.classList.add("bg-emerald-500");
        container.innerHTML = '<span class="material-symbols-rounded text-sm">wifi</span> Connection Restored';
        setTimeout(() => {
          container.classList.add("-translate-y-full");
        }, 3000);
        triggerSync();
        triggerQueuedActions();
      }
    }
  };

  window.addEventListener('online', updateNetworkStatus);
  window.addEventListener('offline', updateNetworkStatus);
  updateNetworkStatus(); // initial check
}

window.addEventListener('load', initNetworkDiagnostics);

function toggleSidebar() {
  const aside = document.querySelector("aside");
  const overlay = document.querySelector(".overlay");
  if (aside) aside.classList.toggle("open");
  if (overlay) overlay.classList.toggle("open");
}

function initSidebar() {
  const user = JSON.parse(localStorage.getItem("user") || "{}");
  const isStudent = user.role === "student";
  const isProfessor = user.role === "professor";
  const isAdmin = user.role === "admin";

  const navAdmin = document.getElementById("nav-admin");
  const navScan = document.getElementById("nav-scan");
  const navReports = document.getElementById("nav-reports");
  const navDash = document.getElementById("nav-dash");
  const navProfile = document.getElementById("nav-profile");

  if (navAdmin) {
    if (isAdmin) {
      navAdmin.classList.remove("hidden");
    } else {
      navAdmin.classList.add("hidden");
    }
  }
  if (navScan) {
    navScan.classList.remove("hidden");
  }
  if (navReports) {
    if (isStudent) navReports.classList.add("hidden");
    else navReports.classList.remove("hidden");
  }
  if (navProfile) {
    if (isStudent) navProfile.classList.remove("hidden");
    else navProfile.classList.add("hidden");
  }
  if (navDash && isStudent) {
    navDash.href = "student-dashboard.html";
  }

  // Highlight Active
  const currentPage = window.location.pathname.split("/").pop() || "index.html";
  document.querySelectorAll("aside nav a").forEach((link) => {
    if (link.getAttribute("href") === currentPage) {
      link.classList.remove("nav-item");
      link.classList.add("nav-active");
    } else {
      link.classList.remove("nav-active");
      link.classList.add("nav-item");
    }
  });
}

initTheme();

// --- SECURITY ---
function getDeviceFingerprint() {
  let fp = localStorage.getItem("device_fingerprint");
  if (!fp) {
    fp =
      "dev_" +
      Math.random().toString(36).substring(2, 15) +
      Date.now().toString(36);
    localStorage.setItem("device_fingerprint", fp);
  }
  return fp;
}

function getSecurityContext() {
  return new Promise((resolve) => {
    const context = {
      device_fingerprint: getDeviceFingerprint(),
      latitude: null,
      longitude: null,
    };

    if (!navigator.geolocation) {
      resolve(context);
      return;
    }

    if (typeof window.showToast === "function") {
      window.showToast("Acquiring secure location...");
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        context.latitude = pos.coords.latitude;
        context.longitude = pos.coords.longitude;
        resolve(context);
      },
      (err) => {
        console.warn("Geolocation failed:", err);
        resolve(context);
      },
      { timeout: 5000, maximumAge: 60000 },
    );
  });
}

// --- AUTH ---
function token() {
  return localStorage.getItem("token");
}
function authHeaders() {
  const t = token();
  return t ? { Authorization: "Bearer " + t } : {};
}

async function verifyToken() {
  try {
    const res = await me();
    if (res && res.error === "invalid_token") {
      logout();
    }
  } catch (e) {
    console.error(e);
  }
}

function checkAuth() {
  if (!token()) {
    window.location.href = "login.html";
    return;
  }
  const user = JSON.parse(localStorage.getItem("user") || "{}");
  const page = window.location.pathname.split("/").pop();

  if (
    user.role === "student" &&
    ["reports.html", "admin.html", "index.html", "class-details.html"].includes(
      page,
    )
  ) {
    window.location.href = "student-dashboard.html";
    return;
  }
  if (user.role === "professor" && ["admin.html"].includes(page)) {
    window.location.href = "index.html";
    return;
  }
  initSidebar();
  verifyToken();
}

function logout() {
  localStorage.clear();
  window.location.href = "login.html";
}

// --- REQUEST CACHING & DEDUPING FOR ULTRA-SMOOTH LOCALHOST PERFORMANCE ---
const _apiGetCache = new Map();
const _apiInFlight = new Map();

function invalidateApiCache() {
  _apiGetCache.clear();
  _apiInFlight.clear();
}
window.invalidateApiCache = invalidateApiCache;

// --- API FUNCTIONS ---
async function apiCall(url, method = "GET", body = null, bypassCache = false) {
  const isGet = method.toUpperCase() === "GET";

  if (!isGet) {
    invalidateApiCache();
  } else if (!bypassCache) {
    // Check in-flight promise deduping
    if (_apiInFlight.has(url)) {
      return _apiInFlight.get(url);
    }
    // Check cached response (3s TTL)
    const cached = _apiGetCache.get(url);
    if (cached && (Date.now() - cached.time < 3000)) {
      return Promise.resolve(JSON.parse(JSON.stringify(cached.data)));
    }
  }

  const fetchPromise = (async () => {
    const options = { method, headers: authHeaders() };
    if (body) {
      options.headers["Content-Type"] = "application/json";
      options.body = JSON.stringify(body);
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);
    options.signal = controller.signal;

    try {
      const res = await fetch(`${API_BASE}${url}`, options);
      clearTimeout(timeoutId);
      if (res.status === 401) {
        if (url === '/api/auth/login' || url === '/api/auth/2fa/verify') {
          const errorData = await res.json().catch(() => ({}));
          return { error: errorData.error || "invalid_credentials", _status: 401 };
        }
        if (!window.location.pathname.endsWith('login.html')) {
          if (typeof showToast === "function") {
            const tContainer = document.getElementById('toast-container');
            if (tContainer) tContainer.innerHTML = '';
            showToast("Session expired. Please log in again.", "error");
          }
          setTimeout(() => logout(), 1500);
        }
        return { error: "session_expired" };
      }
      if (res.status === 403) {
        return { error: "forbidden", _status: 403 };
      }
      if (res.status >= 500) {
        return { error: "Unable to connect. Please check your internet connection.", _status: res.status };
      }
      const data = await res.json();
      if (isGet && !data.error) {
        _apiGetCache.set(url, { data, time: Date.now() });
      }
      return data;
    } catch (e) {
      clearTimeout(timeoutId);
      if (e.name === "AbortError")
        return { error: "Unable to connect. Please check your internet connection." };
      return { error: "Unable to connect. Please check your internet connection." };
    } finally {
      if (isGet) {
        _apiInFlight.delete(url);
      }
    }
  })();

  if (isGet && !bypassCache) {
    _apiInFlight.set(url, fetchPromise);
  }

  return fetchPromise;
}

// User & Auth
async function login(username, password, totp = "") {
  return apiCall("/api/auth/login", "POST", { username, password, totp });
}
async function generate2FA() {
  return apiCall("/api/auth/2fa/generate", "POST");
}
async function verify2FAEndpoint(secret, tokenCode) {
  return apiCall("/api/auth/2fa/verify", "POST", { secret, token: tokenCode });
}
async function disable2FAEndpoint(tokenCode) {
  return apiCall("/api/auth/2fa/disable", "POST", { token: tokenCode });
}
async function me() {
  const data = await apiCall("/api/me");
  if (data && !data.error) {
    localStorage.setItem("user", JSON.stringify(data));
  }
  return data;
}
async function getUsers() {
  return apiCall("/api/users");
}
async function fetchUserByUsername(username) {
  return apiCall(`/api/users/${username}`);
}
async function createUser(data) {
  return apiCall("/api/users", "POST", data);
}
async function adminUpdateUser(id, data) {
  return apiCall(`/api/users/${id}`, "PUT", data);
}
async function deleteUser(id) {
  return apiCall(`/api/users/${id}`, "DELETE");
}
async function updateProfile(data) {
  return apiCall("/api/users/me", "PUT", data);
}
async function updatePreferences(prefs) {
  const user = JSON.parse(localStorage.getItem("user"));
  const current = user.preferences ? JSON.parse(user.preferences) : {};
  const newPrefs = { ...current, ...prefs };

  // Persist locally
  user.preferences = JSON.stringify(newPrefs);
  localStorage.setItem("user", JSON.stringify(user));

  // Send to backend
  await updateProfile({ preferences: JSON.stringify(newPrefs) });
  return { success: true };
}

// Courses
async function fetchMyCourses() {
  return apiCall("/api/users/courses");
}
async function fetchStudentCourses(username) {
  return apiCall(`/api/users/${username}/courses`);
}
async function fetchCourses() {
  return apiCall("/api/courses");
}
async function createCourse(data) {
  return apiCall("/api/courses", "POST", data);
}
async function updateCourse(id, data) {
  return apiCall(`/api/courses/${id}`, "PUT", data);
}
async function deleteCourse(id) {
  return apiCall(`/api/courses/${id}`, "DELETE");
}
async function toggleCourseMode(id, type, val) {
  const body = {};
  body[type] = val;
  return apiCall(`/api/courses/${id}/mode`, "PUT", body);
}

// Rooms & AI
async function fetchRooms() {
  return apiCall("/api/rooms");
}
async function createRoom(data) {
  return apiCall("/api/rooms", "POST", data);
}
async function updateRoom(id, data) {
  return apiCall(`/api/rooms/${id}`, "PUT", data);
}
async function deleteRoom(id) {
  return apiCall(`/api/rooms/${id}`, "DELETE");
}
async function fetchRoomUtilization() {
  return apiCall("/api/reports/room-utilization");
}
async function fetchAIInsights(courseId) {
  return apiCall(`/api/attendance/ai-insights/${courseId}`);
}
async function fetchStudentAIInsights(username) {
  return apiCall(`/api/attendance/ai-insights-student/${username}`);
}

async function fetchCourseAnalytics(courseId) {
  return apiCall(`/api/attendance/analytics/${courseId}`);
}
async function fetchAdminAnalytics() {
  return apiCall(`/api/attendance/analytics-admin`);
}


// Enrollments
async function getEnrollments() {
  return apiCall("/api/enrollments");
}
async function createEnrollment(s, c) {
  return apiCall("/api/enrollments", "POST", {
    student_username: s,
    course_code: c,
  });
}
async function deleteEnrollment(id) {
  return apiCall(`/api/enrollments/${id}`, "DELETE");
}

// Attendance
async function postAttendance(qr, course) {
  const sec = await getSecurityContext();
  return apiCall("/api/attendance", "POST", { qr, course, ...sec });
}
async function fetchAttendance() {
  return apiCall("/api/attendance");
}
async function fetchStats() {
  return apiCall("/api/attendance/stats");
}
async function fetchActiveSessions() {
  return apiCall("/api/attendance/active-sessions");
}
async function fetchMyActiveSessions() {
  return apiCall("/api/attendance/my-active-sessions");
}
async function fetchAttendanceMe() {
  return apiCall("/api/attendance/me");
}
async function fetchStudentAttendance(username) {
  return apiCall(`/api/attendance/student/${username}`);
}
async function updateAttendanceLog(id, s, r) {
  return apiCall(`/api/attendance/${id}`, "PUT", { status: s, remarks: r });
}
async function updateAttendanceReason(id, reason) {
  const res = await apiCall(`/api/attendance/${id}/reason`, "PUT", { reason });
  if (res && res.error && (res.error.includes("Network disconnected") || res.error.includes("timed out"))) {
      enqueueAction("updateAttendanceReason", { id, reason });
      return { offline: true };
  }
  return res;
}
async function deleteAttendanceLog(id) {
  return apiCall(`/api/attendance/${id}`, "DELETE");
}
async function clearAllLogs() {
  return apiCall("/api/attendance", "DELETE");
}
async function onlineCheckIn(courseId) {
  const sec = await getSecurityContext();
  return apiCall(`/api/courses/${courseId}/checkin`, "POST", sec);
}
async function getPrediction(courseId) {
  return apiCall(`/api/attendance/prediction/${courseId}`);
}

// Secure QR & Excuses
async function fetchExcuses() {
  return apiCall("/api/excuses");
}

// Attendance Sessions
async function createSession(
  courseCode,
  roomId,
  mode = "PHYSICAL",
  meetingLink = null,
) {
  const sec = await getSecurityContext();
  return apiCall("/api/attendance/session", "POST", {
    course: courseCode,
    room_id: roomId,
    mode,
    meeting_link: meetingLink,
    ...sec,
  });
}
async function getSessionQR(sessionId) {
  return apiCall(`/api/attendance/session/${sessionId}/qr`);
}
async function getLiveSession(sessionId) {
  return apiCall(`/api/attendance/session/${sessionId}/live`);
}
async function getSessionStudents(sessionId) {
  return apiCall(`/api/attendance/session/${sessionId}/students`);
}
async function manualMarkAttendance(sessionId, studentId) {
  const res = await apiCall(`/api/attendance/session/${sessionId}/manual-mark`, "POST", {
    student_id: studentId,
  });
  if (res && res.error && (res.error.includes("Network disconnected") || res.error.includes("timed out"))) {
      enqueueAction("manualMarkAttendance", { sessionId, studentId });
      return { offline: true };
  }
  return res;
}
async function markRemainingAbsent(sessionId) {
  const res = await apiCall(`/api/attendance/session/${sessionId}/mark-remaining-absent`, "POST");
  if (res && res.error && (res.error.includes("Network disconnected") || res.error.includes("timed out"))) {
      enqueueAction("markRemainingAbsent", { sessionId });
      return { offline: true };
  }
  return res;
}
async function endSession(sessionId) {
  return apiCall(`/api/attendance/session/${sessionId}/end`, "POST");
}
async function joinOnlineSession(sessionId) {
  return apiCall(`/api/attendance/session/${sessionId}/join`, "POST");
}
async function sendSessionHeartbeat(sessionId, reason) {
  return apiCall(`/api/attendance/session/${sessionId}/heartbeat`, "POST", {
    interruption_reason: reason,
  });
}
async function updateInterruptionReason(sessionId, reason) {
  const res = await apiCall(`/api/attendance/session/${sessionId}/reason`, "POST", { reason });
  if (res && res.error && (res.error.includes("Network disconnected") || res.error.includes("timed out"))) {
      enqueueAction("updateInterruptionReason", { sessionId, reason });
      return { offline: true };
  }
  return res;
}
async function postCodeAttendance(code) {
  const sec = await getSecurityContext();
  const res = await apiCall("/api/attendance/code", "POST", { code, ...sec });
  if (res && res.error && (res.error.includes("Network disconnected") || res.error.includes("timed out"))) {
      enqueueAction("postCodeAttendance", { code, ...sec });
      return { offline: true };
  }
  return res;
}

// OFFLINE-RESILIENT SYNC LOGIC
function getPendingSyncs() {
  return JSON.parse(localStorage.getItem("pending_attendance") || "[]");
}

function enqueuePendingScan(qr, sec) {
  const queue = getPendingSyncs();
  queue.push({
    id: Date.now().toString(36) + Math.random().toString(36).substr(2),
    qr,
    scan_timestamp: new Date().toISOString(),
    ...sec,
  });
  localStorage.setItem("pending_attendance", JSON.stringify(queue));
  if (typeof updateSyncUI === "function") updateSyncUI();
}

async function logAttendanceSession(qr) {
  const sec = await getSecurityContext();
  const res = await apiCall("/api/attendance", "POST", { qr, ...sec });
  if (
    res &&
    res.error &&
    (res.error.includes("Network disconnected") ||
      res.error.includes("timed out"))
  ) {
    enqueuePendingScan(qr, sec);
    return { offline: true };
  }
  return res;
}

let isSyncing = false;
async function triggerSync() {
  if (isSyncing) return { success: 0 };
  const queue = getPendingSyncs();
  if (queue.length === 0) return { success: 0 };
  isSyncing = true;
  try {
    const res = await apiCall("/api/attendance/sync", "POST", {
      records: queue,
    });
    if (res && !res.error && res.success !== undefined) {
      if (res.success > 0) showToast(`Synced ${res.success} offline records.`);
      if (res.failed > 0)
        showToast(`${res.failed} offline records failed/expired.`, "error");
      localStorage.setItem("pending_attendance", "[]"); // Clear after attempt
      if (typeof updateSyncUI === "function") updateSyncUI();
      if (typeof loadData === "function") loadData();
    }
    return res;
  } finally {
    isSyncing = false;
  }
}

function exportSyncBackup() {
  const data = localStorage.getItem("pending_attendance") || "[]";
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([data], { type: "application/json" }));
  a.download = `attendance_backup_${new Date().getTime()}.json`;
  a.click();
}

function importSyncBackup(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const arr = JSON.parse(e.target.result);
      if (Array.isArray(arr)) {
        const q = getPendingSyncs();
        localStorage.setItem(
          "pending_attendance",
          JSON.stringify(q.concat(arr)),
        );
        if (typeof updateSyncUI === "function") updateSyncUI();
        showToast("Backup imported! Attempting sync...");
        triggerSync();
      }
    } catch (err) {
      showToast("Invalid backup file", "error");
    }
  };
  reader.readAsText(file);
}

// GENERIC ACTION QUEUE (Excuses, Reason Updates, Code Attendance)
function getPendingActions() {
  return JSON.parse(localStorage.getItem("pending_actions") || "[]");
}

function enqueueAction(actionType, payload) {
  const queue = getPendingActions();
  queue.push({
    id: Date.now().toString(36) + Math.random().toString(36).substr(2),
    type: actionType,
    payload,
    timestamp: new Date().toISOString(),
  });
  localStorage.setItem("pending_actions", JSON.stringify(queue));
  showToast("Action queued offline. Will sync later.", "success");
}

let isSyncingActions = false;
async function triggerQueuedActions() {
  if (isSyncingActions) return;
  const queue = getPendingActions();
  if (queue.length === 0) return;
  isSyncingActions = true;
  
  let successCount = 0;
  const remainingQueue = [];
  
  for (const action of queue) {
    try {
      let res;
      if (action.type === 'createExcuse') {
        res = await apiCall("/api/excuses", "POST", action.payload);
      } else if (action.type === 'updateExcuse') {
        res = await apiCall(`/api/excuses/${action.payload.id}`, "PUT", { status: action.payload.status });
      } else if (action.type === 'updateAttendanceReason') {
        res = await apiCall(`/api/attendance/${action.payload.id}/reason`, "PUT", { reason: action.payload.reason });
      } else if (action.type === 'updateInterruptionReason') {
         res = await apiCall(`/api/attendance/session/${action.payload.sessionId}/reason`, "POST", { reason: action.payload.reason });
      } else if (action.type === 'manualMarkAttendance') {
         res = await apiCall(`/api/attendance/session/${action.payload.sessionId}/manual-mark`, "POST", { student_id: action.payload.studentId, username: action.payload.studentId });
      } else if (action.type === 'markRemainingAbsent') {
         res = await apiCall(`/api/attendance/session/${action.payload.sessionId}/mark-remaining-absent`, "POST");
      } else if (action.type === 'postCodeAttendance') {
         res = await apiCall("/api/attendance/code", "POST", action.payload);
      }
      
      if (res && res.error) {
         if (res.error.includes("Network") || res.error.includes("timed out")) {
             remainingQueue.push(action); // retry later
         } else {
             // Failed for other reasons (e.g. valid business logic rejection), drop it
         }
      } else {
         successCount++;
      }
    } catch (e) {
      remainingQueue.push(action);
    }
  }

  localStorage.setItem("pending_actions", JSON.stringify(remainingQueue));
  isSyncingActions = false;
  
  if (successCount > 0) {
     showToast(`Synced ${successCount} offline actions.`);
     if (typeof loadData === "function") loadData();
  }
}

// Auto-sync every 30 seconds
setInterval(() => {
  if (getPendingSyncs().length > 0) triggerSync();
  if (getPendingActions().length > 0) triggerQueuedActions();
}, 30000);

async function createExcuse(data) {
  const res = await apiCall("/api/excuses", "POST", data);
  if (res && res.error && (res.error.includes("Network disconnected") || res.error.includes("timed out"))) {
      enqueueAction("createExcuse", data);
      return { offline: true };
  }
  return res;
}
async function updateExcuse(id, status) {
  const res = await apiCall(`/api/excuses/${id}`, "PUT", { status });
  if (res && res.error && (res.error.includes("Network disconnected") || res.error.includes("timed out"))) {
      enqueueAction("updateExcuse", { id, status });
      return { offline: true };
  }
  return res;
}

// Misc
async function fetchAuditLogs() {
  return apiCall("/api/audit");
}
async function fetchAnnouncements() {
  return apiCall("/api/announcements");
}
async function createAnnouncement(data) {
  return apiCall("/api/announcements", "POST", data);
}
async function deleteAnnouncement(id) {
  return apiCall(`/api/announcements/${id}`, "DELETE");
}

window.getStatusColor = function (s) {
  if (s === "LATE")
    return "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 border border-amber-200 dark:border-amber-700";
  if (s === "ABSENT")
    return "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300 border border-rose-200 dark:border-rose-700";
  if (s === "EXCUSED")
    return "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300 border border-sky-200 dark:border-sky-700";
  if (s === "REVIEW_REQUIRED" || s === "FLAGGED")
    return "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300 border border-orange-200 dark:border-orange-700";
  if (!s)
    return "bg-slate-100 text-slate-700 dark:bg-slate-900/40 dark:text-slate-300 border border-slate-200 dark:border-slate-700";
  return "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-700";
};

window.getStatusBadge = function (s, recordStr = null) {
  let label = (s || "UNKNOWN").split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
  let baseObj = `<span class="px-2 py-1 rounded-[6px] text-[10px] font-black uppercase tracking-[0.05em] inline-flex items-center justify-center ${window.getStatusColor(s)} shadow-sm">${label}</span>`;
  
  if (s === "REVIEW_REQUIRED" && recordStr) {
      if (!document.getElementById("reviewRequiredModal")) {
          const mod = document.createElement("div");
          mod.id = "reviewRequiredModal";
          mod.className = "fixed inset-0 bg-slate-900/40 dark:bg-slate-950/80 backdrop-blur-sm z-[9999] hidden flex-col items-center justify-center p-4 transition-all opacity-0";
          mod.innerHTML = `
            <div class="bg-white dark:bg-slate-900 w-full max-w-sm rounded-[28px] overflow-hidden shadow-2xl scale-95 transition-transform" id="reviewRequiredModalInner">
               <div class="p-6 sm:p-8">
                  <div class="w-12 h-12 bg-orange-100 dark:bg-orange-900/30 text-orange-500 rounded-2xl flex items-center justify-center mb-6">
                     <span class="material-symbols-rounded text-2xl">warning</span>
                  </div>
                  <h3 class="text-xl font-black mb-2 dark:text-white">Review Required</h3>
                  <p class="text-xs font-bold text-slate-500 dark:text-slate-400 mb-6 uppercase tracking-widest leading-relaxed" id="reviewModalReason">Your attendance was flagged for manual review.</p>
                  
                  <div class="space-y-4 mb-8 bg-slate-50 dark:bg-slate-800/50 p-4 rounded-2xl border border-slate-100 dark:border-slate-800">
                     <div>
                        <div class="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1.5">Class</div>
                        <div class="text-sm font-bold dark:text-slate-200" id="reviewModalCourse"></div>
                     </div>
                     <div>
                        <div class="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1.5">Instructor</div>
                        <div class="text-sm font-bold dark:text-slate-200" id="reviewModalInstructor"></div>
                     </div>
                     <div>
                        <div class="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1.5">Timestamp</div>
                        <div class="text-sm font-bold dark:text-slate-200" id="reviewModalTime"></div>
                     </div>
                  </div>
                  
                  <button onclick="closeReviewModal()" class="w-full bg-slate-900 dark:bg-white text-white dark:text-slate-900 py-4 rounded-xl font-black text-[11px] uppercase tracking-widest hover:scale-[1.02] transition-transform">Understood</button>
               </div>
            </div>
          `;
          document.body.appendChild(mod);
      }
      
      const safeStr = typeof recordStr === 'string' ? recordStr.replace(/'/g, "&#39;").replace(/"/g, "&quot;") : "";
      return `<button onclick="openReviewModal('${safeStr}')" class="hover:scale-105 transition-transform origin-center outline-none focus:ring-2 focus:ring-orange-500 rounded-[6px]">${baseObj}</button>`;
  }
  return baseObj;
};

window.openReviewModal = function(recordStr) {
   try {
       const l = JSON.parse(recordStr.replace(/&quot;/g, '"').replace(/&#39;/g, "'"));
       document.getElementById("reviewModalCourse").innerText = l.course_code || l.course_name || "Unknown Course";
       document.getElementById("reviewModalInstructor").innerText = l.professor_name || "Instructor";
       document.getElementById("reviewModalTime").innerText = window.formatDate ? (window.formatDate(l.timestamp) + " " + window.formatTime(l.timestamp)) : new Date(l.timestamp).toLocaleString();
       
       let reasonText = "Your attendance was flagged for manual review.";
       if (l.remarks || l.reason) {
           reasonText = (l.remarks || l.reason);
           // remove underscores and capitalize
           reasonText = reasonText.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
       }
       document.getElementById("reviewModalReason").innerText = reasonText;

       const m = document.getElementById("reviewRequiredModal");
       m.classList.remove("hidden");
       setTimeout(() => {
          m.classList.remove("opacity-0");
          document.getElementById("reviewRequiredModalInner").classList.remove("scale-95");
       }, 10);
   } catch(e) {}
};

window.closeReviewModal = function() {
   const m = document.getElementById("reviewRequiredModal");
   m.classList.add("opacity-0");
   document.getElementById("reviewRequiredModalInner").classList.add("scale-95");
   setTimeout(() => m.classList.add("hidden"), 300);
};

// PWA Service Worker Registration
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then(reg => {
      console.log('ServiceWorker registered:', reg.scope);
    }).catch(err => {
      console.log('ServiceWorker registration failed:', err);
    });
  });
}

// PWA Install Prompt Handlers
let deferredPrompt;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  
  const installBtns = document.querySelectorAll('.install-app-btn');
  installBtns.forEach(btn => {
    btn.classList.remove('hidden');
    
    // Check if we need to set specific display for non-block elements (like flex)
    if(btn.dataset.displayClass) {
        btn.classList.add(btn.dataset.displayClass);
    }

    btn.addEventListener('click', async () => {
      if(!deferredPrompt) return;
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') {
        deferredPrompt = null;
        installBtns.forEach(b => {
            b.classList.add('hidden');
            if(b.dataset.displayClass) b.classList.remove(b.dataset.displayClass);
        });
      }
    });
  });
});

// Announcements API
async function fetchStudentAnnouncements() {
  return apiCall(`/api/announcements/student`);
}
async function fetchCourseAnnouncements(courseId) {
  return apiCall(`/api/announcements/course/${courseId}`);
}
async function createCourseAnnouncement(courseId, announcement) {
  return apiCall(`/api/announcements/course/${courseId}`, "POST", announcement);
}
async function updateAnnouncement(id, announcement) {
  return apiCall(`/api/announcements/${id}`, "PUT", announcement);
}
async function deleteAnnouncement(id) {
  return apiCall(`/api/announcements/${id}`, "DELETE");
}

async function fetchProfessorNotes(studentId) {
  return apiCall(`/api/notes/${studentId}`);
}
async function saveProfessorNote(studentId, noteText, tag = '') {
  return apiCall(`/api/notes/${studentId}`, "POST", { note_text: noteText, tag });
}
async function updateProfessorNote(noteId, noteText, tag = '') {
  return apiCall(`/api/notes/${noteId}`, "PUT", { note_text: noteText, tag });
}
async function deleteProfessorNote(noteId) {
  return apiCall(`/api/notes/${noteId}`, "DELETE");
}