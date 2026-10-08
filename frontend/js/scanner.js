// frontend/js/scanner.js

let scanner = null;
let isScanning = false;
let scannedCodes = new Set();
let lastScanTime = 0;
const SCAN_COOLDOWN = 1500;
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

let currentSessionId = null;
let currentQRData = null;
let currentSessionMode = "PHYSICAL";
let currentEntryCode = "";
let sessionQRInterval = null;
let timerInterval = null;

// DOM Elements
const els = {
  courseSelect: document.getElementById("courseSelect"),
  roomSelect: document.getElementById("roomSelect"),
  startBtn: document.getElementById("startBtn"),
  endSessionBtn: document.getElementById("endSessionBtn"),
  startScanBtn: document.getElementById("startScanBtn"),
  stopScanBtn: document.getElementById("stopScanBtn"),
  statusMsg: document.getElementById("scan-status"),
  scannedCount: document.getElementById("scannedCount"),
  recentList: document.getElementById("recentList"),
  sessionCourse: document.getElementById("sessionCourse"),
  adminArea: document.getElementById("adminControlsArea"),
  studentArea: document.getElementById("studentScannerArea"),
  qrDisplayArea: document.getElementById("qrDisplayArea"),
  qrcode: document.getElementById("qrcode"),
  onlineCodeDisplay: document.getElementById("onlineCodeDisplay"),
  largeSessionCode: document.getElementById("largeSessionCode"),
  secureTimer: document.getElementById("secureTimer"),
  modeSelect: document.getElementById("modeSelect"),
};

const user = JSON.parse(localStorage.getItem("user") || "{}");

function playBeep() {
  if (audioCtx.state === "suspended") audioCtx.resume();
  const o = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  o.connect(g);
  g.connect(audioCtx.destination);
  o.type = "sine";
  o.frequency.value = 880;
  g.gain.value = 0.1;
  o.start();
  setTimeout(() => o.stop(), 100);
}

// Initialize Page Based on Role
async function initScannerPage() {
  if (user.role === "student") {
    els.studentArea.classList.remove("hidden");
    els.sessionCourse.innerText = "Camera Mode";
    const mmTitle = document.getElementById("manualModalTitle");
    const mmLabel = document.getElementById("manualModalLabel");
    if (mmTitle) mmTitle.innerText = "Join via Session Code";
    if (mmLabel) mmLabel.innerText = "6-Digit Entry Code";
    const btnText = document.getElementById("manualModalBtnText");
    if (btnText) btnText.innerText = "Enter Session Code";
    document.getElementById("manualInput").placeholder = "Enter code...";

    // Make live monitor compact for students
    const grid = document.querySelector('.lg\\:grid-cols-2');
    if (grid) {
      grid.classList.remove('lg:grid-cols-2', 'lg:min-h-[75vh]');
      grid.classList.add('max-w-xl', 'mx-auto');
      const rightCol = grid.children[1];
      if (rightCol) {
         rightCol.id = "studentLiveMonitorCol";
         rightCol.classList.add('hidden'); // hidden until scan
         
         const header = rightCol.querySelector('.border-b');
         if (header) header.classList.add('hidden'); // hide big header
         
         const actLogTitle = rightCol.querySelector('.mb-6.flex.items-center.justify-between');
         if (actLogTitle) actLogTitle.classList.add('hidden'); // hide activity log lines
         
         const emptyLi = document.querySelector('#recentList li.text-slate-400.italic');
         if (emptyLi) emptyLi.style.display = 'none';
         
         const scC = document.getElementById("simpleScannedContainer");
         if (scC && scC.children.length > 0) {
            scC.children[0].classList.add('hidden'); // hide total scans block
            scC.classList.remove('mt-2', 'sm:mt-0', 'sm:items-end');
            scC.classList.add('mt-0', 'items-center', 'justify-center', 'w-full', 'mb-4');
         }
      }
    }
  } else {
    els.adminArea.classList.remove("hidden");
    const mmTitle = document.getElementById("manualModalTitle");
    const mmLabel = document.getElementById("manualModalLabel");
    if (mmTitle) mmTitle.innerText = "Assisted Attendance";
    if (mmLabel) mmLabel.innerText = "Student Username";
    const btnText = document.getElementById("manualModalBtnText");
    if (btnText) btnText.innerText = "Assisted Attendance";
    document.getElementById("manualInput").placeholder = "e.g. 2023-00164-PQ-0";
    try {
      const recoveryDataRaw = localStorage.getItem("active_session_recovery");
      let recoveryData = recoveryDataRaw ? JSON.parse(recoveryDataRaw) : null;
      
      const activeSessions = await fetchMyActiveSessions();
      
      if (activeSessions && Array.isArray(activeSessions) && activeSessions.length > 0) {
        const sess = activeSessions[0];
        
        if (!recoveryData || recoveryData.id !== sess.id) {
           recoveryData = {
              id: sess.id,
              course_code: sess.course_code,
              mode: sess.mode,
              entry_code: sess.entry_code,
              start_time: sess.created_at || Date.now()
           };
           localStorage.setItem("active_session_recovery", JSON.stringify(recoveryData));
        }

        showRecoveryPrompt(recoveryData);
        return; // wait for user choice
      } else if (activeSessions && activeSessions.error && (activeSessions.error.includes("Network") || activeSessions.error.includes("timed out"))) {
         // Network is disconnected. But we can still offer recovery if we have the cache!
         if (recoveryData) {
             showRecoveryPrompt(recoveryData);
             return;
         }
      } else if (recoveryData) {
         // Actual response was empty array (no active sessions), so clear stale cache
         localStorage.removeItem("active_session_recovery");
      }

      await loadInitialAdminData();
    } catch (e) {
      showToast("Failed to load initial data", "error");
    }
  }
}

async function loadInitialAdminData() {
  const courses = await fetchCourses();
  const rooms = await fetchRooms();

  if (courses && courses.length > 0) {
    els.courseSelect.innerHTML =
      '<option value="" disabled selected>Select a Course</option>' +
      courses
        .map(
          (c) => `<option value="${c.code}">${c.code} — ${c.name}</option>`,
        )
        .join("");
        
    const urlParams = new URLSearchParams(window.location.search);
    const urlCourse = urlParams.get("course");
    let isSelectedOnline = false;
    
    if (urlCourse) {
      els.courseSelect.value = urlCourse;
      const c = courses.find(x => x.code === urlCourse);
      if (c && c.is_online) isSelectedOnline = true;
    }
        
    els.startBtn.disabled = false;
  } else {
    els.courseSelect.innerHTML =
      "<option disabled>No courses available</option>";
    els.startBtn.disabled = true;
  }

  if (rooms && rooms.length > 0) {
    els.roomSelect.innerHTML =
      '<option value="" disabled selected>Select Room / Online</option><option value="null">Online / No Room</option>' +
      rooms
        .map(
          (r) => `<option value="${r.id}">${r.name} (${r.type})</option>`,
        )
        .join("");
        
    if (isSelectedOnline) {
       els.roomSelect.value = "null";
       const modeSelect = document.getElementById("modeSelect");
       if (modeSelect) modeSelect.value = "ONLINE";
    }
    
    // Auto-start if requested
    const autostart = urlParams.get("autostart");
    if (autostart === '1') {
        setTimeout(() => {
            if (!els.startBtn.disabled) {
                els.startBtn.click();
            }
        }, 500);
    }
  } else {
    els.roomSelect.innerHTML =
      '<option value="null">No rooms defined</option>';
  }

  // Attendance Mode Logic
  const modeSelect = document.getElementById("modeSelect");
  const linkWrapper = document.getElementById("meetingLinkWrapper");
  if (modeSelect) {
    modeSelect.addEventListener("change", (e) => {
      const val = e.target.value;
      if (val === "ONLINE") {
        if (linkWrapper) linkWrapper.classList.remove("hidden");
        els.roomSelect.value = "null";
        els.roomSelect.disabled = true;
      } else if (val === "PHYSICAL") {
        if (linkWrapper) linkWrapper.classList.add("hidden");
        // Force them to pick a room if they currently have null selected
        if (els.roomSelect.value === "null") {
          els.roomSelect.value = "";
        }
        els.roomSelect.disabled = false;
      } else if (val === "HYBRID") {
        if (linkWrapper) linkWrapper.classList.remove("hidden");
        if (els.roomSelect.value === "null") {
          els.roomSelect.value = "";
        }
        els.roomSelect.disabled = false;
      }
    });
    // Trigger once on init
    modeSelect.dispatchEvent(new Event("change"));
  }
}

function showRecoveryPrompt(sess) {
  const modalHtml = `
    <div id="recoveryModal" class="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div class="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"></div>
      <div class="relative w-full max-w-sm bg-white rounded-3xl shadow-[0_32px_64px_-16px_rgba(0,0,0,0.2)] overflow-hidden flex flex-col transform transition-all p-6">
        <h3 class="text-xl font-bold text-slate-800 mb-2">Restore Active Session?</h3>
        <p class="text-slate-600 text-sm mb-4 leading-relaxed">
          You have an active attendance session for:
          <br/><br/>
          <strong class="text-indigo-700 bg-indigo-50 px-2 py-1 rounded inline-block mb-1">${sess.course_code}</strong>
          <br/>
          <span class="text-xs font-bold uppercase tracking-wider text-slate-400">Mode: ${sess.mode}</span>
          <br/>
          <span class="text-xs text-slate-500">Code: ${sess.entry_code || "N/A"}</span>
          <br/><br/>
          <span class="text-xs font-bold text-slate-700">Started: ${new Date(sess.start_time).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
        </p>
        <div class="flex gap-3 w-full">
            <button onclick="dismissRecoveryPrompt()" class="flex-1 py-3 px-4 rounded-xl font-bold text-sm bg-slate-100 hover:bg-slate-200 text-slate-600 transition-colors uppercase tracking-widest">Dismiss</button>
            <button onclick="acceptRecoveryPrompt('${sess.id}', '${sess.course_code}', '${sess.mode}', '${sess.entry_code || ""}', '${sess.start_time}')" class="flex-1 py-3 px-4 rounded-xl font-bold text-sm bg-maroon text-white hover:bg-pup-gold hover:text-maroon transition-colors uppercase tracking-widest shadow-md">Restore</button>
        </div>
      </div>
    </div>
  `;
  document.body.insertAdjacentHTML('beforeend', modalHtml);
}

window.dismissRecoveryPrompt = async function() {
  const modal = document.getElementById("recoveryModal");
  if(modal) modal.remove();
  
  localStorage.removeItem("active_session_recovery");
  const activeSessions = await fetchMyActiveSessions();
  if (activeSessions && activeSessions.length > 0) {
      try {
        await endSession(activeSessions[0].id);
        showToast("Previous session ended.", "success");
      } catch(e) {
        showToast("Error ending prev session.", "error");
      }
  }
  
  await loadInitialAdminData();
};

window.acceptRecoveryPrompt = function(id, course, mode, entry_code, start_time) {
  const modal = document.getElementById("recoveryModal");
  if(modal) modal.remove();
  resumeSessionUI(id, course, mode, entry_code, parseInt(start_time));
  showToast("Session restored successfully.");
};


/* ========================================================
   ADMIN / PROFESSOR FLOW (CREATE SESSION & SHOW QR)
   ======================================================== */
let nextQRUpdateTime = 0;

function updateLiveStatsUI(live) {
  if (!live) return;
  if (els.scannedCount) els.scannedCount.innerText = live.count;
  if (document.getElementById("presentCount"))
    document.getElementById("presentCount").innerText = live.present || 0;
  if (document.getElementById("lateCount"))
    document.getElementById("lateCount").innerText = live.late || 0;
  if (document.getElementById("remainingCount"))
    document.getElementById("remainingCount").innerText = live.remaining || 0;

  const widget = document.getElementById("continuityOverviewWidget");
  if (live.continuity) {
    if (widget) {
      widget.classList.remove("hidden");
      if (document.getElementById("contStableCount"))
        document.getElementById("contStableCount").innerText =
          live.continuity.stable || 0;
      if (document.getElementById("contReconnectedCount"))
        document.getElementById("contReconnectedCount").innerText =
          live.continuity.reconnected || 0;
      if (document.getElementById("contInterruptedCount"))
        document.getElementById("contInterruptedCount").innerText =
          live.continuity.interrupted || 0;
    }
  } else {
    if (widget) widget.classList.add("hidden");
  }
}

function startSessionIntervals() {
  if (sessionQRInterval) clearInterval(sessionQRInterval);
  if (timerInterval) clearInterval(timerInterval);

  updateSessionQR();
  nextQRUpdateTime = Date.now() + 9000;

  sessionQRInterval = setInterval(() => {
    updateSessionQR();
    nextQRUpdateTime = Date.now() + 9000;
  }, 9000);

  timerInterval = setInterval(async () => {
    const timeLeft = Math.max(
      1,
      Math.ceil((nextQRUpdateTime - Date.now()) / 1000),
    );
    if (els.secureTimer)
      els.secureTimer.innerText = `Refreshing in ${timeLeft}s...`;
    const largeTimer = document.getElementById("largeQRTimer");
    if (largeTimer) largeTimer.innerText = `Refreshing in ${timeLeft}s...`;

    // Update live count and recent scans every 3 seconds to reduce load
    if (timeLeft % 3 === 0) {
      try {
        const live = await getLiveSession(currentSessionId);
        if (live && live.count !== undefined) {
          if (els.secureTimer) {
             els.secureTimer.classList.remove("text-amber-500");
             els.secureTimer.classList.add("text-emerald-500");
          }
          if (document.getElementById("largeQRTimer")) {
             document.getElementById("largeQRTimer").classList.remove("text-amber-500");
          }
          updateLiveStatsUI(live);

          if (live.recent && live.recent.length > 0) {
            els.recentList.innerHTML = live.recent
              .map((l) => {
                let badge = `<div class="w-8 h-8 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center"><span class="material-symbols-rounded text-sm">check</span></div>`;
                if (l.status === "LATE")
                  badge = `<div class="w-8 h-8 rounded-full bg-amber-100 text-amber-600 flex items-center justify-center"><span class="material-symbols-rounded text-sm">schedule</span></div>`;
                if (l.status === "ABSENT")
                  badge = `<div class="w-8 h-8 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center"><span class="material-symbols-rounded text-sm">close</span></div>`;
                return `
                <li class="flex justify-between items-center bg-white dark:bg-slate-800 p-4 rounded-xl shadow-sm border border-slate-100 dark:border-slate-700">
                  <div class="flex items-center gap-3">
                    ${badge}
                    <div class="font-bold text-slate-800 dark:text-white text-xs">${l.student_name}</div>
                  </div>
                  <div class="text-[10px] text-slate-400 font-mono">${formatTime(l.timestamp)}</div>
                </li>
              `;
              })
              .join("");
          } else {
            els.recentList.innerHTML = `<li class="text-slate-600 dark:text-slate-400 text-center italic mt-20 font-medium whitespace-pre-wrap"><span class="material-symbols-rounded text-4xl opacity-50 mb-2">radar</span><br/>Waiting for students to check in...</li>`;
          }
        } else if (live && live.error && (live.error.includes("Network") || live.error.includes("timed out"))) {
            // Retain last good state but show reconnecting indicator
            if (els.secureTimer) {
               els.secureTimer.innerText = "Reconnecting...";
               els.secureTimer.classList.remove("text-emerald-500");
               els.secureTimer.classList.add("text-amber-500");
            }
            if (document.getElementById("largeQRTimer")) {
               document.getElementById("largeQRTimer").innerText = "Reconnecting...";
               document.getElementById("largeQRTimer").classList.add("text-amber-500");
            }
        }

        // Live refresh of assisted roster list if modal is shown
        const modal = document.getElementById("manualModal");
        if (
          modal &&
          !modal.classList.contains("hidden") &&
          user.role === "professor" &&
          currentSessionId
        ) {
          loadSessionStudents(true);
        }
      } catch (e) {}
    }
  }, 1000);
}

function resumeSessionUI(session_id, courseCode, mode, entry_code, start_time = null) {
  currentSessionId = session_id;
  currentSessionMode = mode;
  currentEntryCode = entry_code;

  let existingStart = Date.now();
  try {
     const raw = localStorage.getItem("active_session_recovery");
     if(raw) {
         const obj = JSON.parse(raw);
         if(obj.id === session_id && obj.start_time) existingStart = obj.start_time;
     }
  } catch(e) {}

  localStorage.setItem("active_session_recovery", JSON.stringify({
    id: session_id,
    course_code: courseCode,
    mode: mode,
    entry_code: entry_code,
    start_time: start_time || existingStart
  }));

  let modeBadge = "";
  if (mode === "PHYSICAL")
    modeBadge =
      '<span class="bg-emerald-100 text-emerald-700 font-bold px-3 py-1 rounded-full whitespace-nowrap">🎓 PHYSICAL</span>';
  else if (mode === "ONLINE")
    modeBadge =
      '<span class="bg-blue-100 text-blue-700 font-bold px-3 py-1 rounded-full whitespace-nowrap">🌐 ONLINE</span>';
  else if (mode === "HYBRID")
    modeBadge =
      '<span class="bg-amber-100 text-amber-700 font-bold px-3 py-1 rounded-full whitespace-nowrap">🌓 HYBRID</span>';

  els.sessionCourse.innerHTML = `<span class="whitespace-nowrap">Subject Active: ${courseCode}</span> ${modeBadge} <span class="bg-indigo-100 text-indigo-700 font-bold px-3 py-1 rounded-full whitespace-nowrap">CODE: ${entry_code}</span>`;

  // UI Swap
  els.startBtn.classList.add("hidden");
  els.endSessionBtn.classList.remove("hidden");
  els.endSessionBtn.disabled = false;
  const refreshBtn = document.getElementById("refreshQRBtn");
  if (refreshBtn) {
    refreshBtn.classList.remove("hidden");
    refreshBtn.disabled = false;
  }

  document.getElementById("liveStatsContainer").style.display = "flex";
  document.getElementById("simpleScannedContainer").style.display = "none";
  document.getElementById("markAbsentBtn").classList.remove("hidden");

  els.courseSelect.disabled = true;
  els.roomSelect.disabled = true;
  if (els.modeSelect) els.modeSelect.disabled = true;
  els.qrDisplayArea.classList.remove("hidden");
  els.qrDisplayArea.classList.add("flex");

  if (mode === "ONLINE") {
    els.qrcode.classList.add("hidden");
    els.onlineCodeDisplay.classList.remove("hidden");
    els.onlineCodeDisplay.classList.add("flex");
    if (els.secureTimer) els.secureTimer.classList.add("hidden");
    els.largeSessionCode.innerText = entry_code;
    els.qrDisplayArea.classList.remove("flex-row", "gap-12");
    els.qrDisplayArea.classList.add("flex-col");
  } else if (mode === "HYBRID") {
    els.qrcode.classList.remove("hidden");
    els.onlineCodeDisplay.classList.remove("hidden");
    els.onlineCodeDisplay.classList.add("flex");
    if (els.secureTimer) els.secureTimer.classList.remove("hidden");
    els.largeSessionCode.innerText = entry_code;
    // Align them side-by-side on desktop
    els.qrDisplayArea.classList.remove("flex-col");
    els.qrDisplayArea.classList.add("flex-row", "gap-12");
  } else {
    // PHYSICAL
    els.qrcode.classList.remove("hidden");
    els.onlineCodeDisplay.classList.add("hidden");
    els.onlineCodeDisplay.classList.remove("flex");
    if (els.secureTimer) els.secureTimer.classList.remove("hidden");
    els.qrDisplayArea.classList.remove("flex-row", "gap-12");
    els.qrDisplayArea.classList.add("flex-col");
  }

  startSessionIntervals();
}

async function startSession() {
  if (els.startBtn.disabled) return;
  els.startBtn.disabled = true;
  const originalText = '<span class="material-symbols-rounded text-lg">play_arrow</span> Start Session';
  els.startBtn.innerHTML =
    '<span class="material-symbols-rounded animate-spin">progress_activity</span> Starting...';

  const courseCode = els.courseSelect.value;
  const roomId = els.roomSelect.value === "null" ? null : els.roomSelect.value;
  const mode = els.modeSelect ? els.modeSelect.value : "PHYSICAL";

  const linkInput = document.getElementById("meetingLinkInput");
  const meetingLink =
    linkInput && (mode === "ONLINE" || mode === "HYBRID")
      ? linkInput.value.trim()
      : null;

  if (!courseCode) {
    els.startBtn.disabled = false;
    els.startBtn.innerHTML = originalText;
    return showToast("Select a course first", "error");
  }

  if ((mode === "PHYSICAL" || mode === "HYBRID") && (!roomId || roomId === "null")) {
    els.startBtn.disabled = false;
    els.startBtn.innerHTML = originalText;
    return showToast("A Room is required for physical and hybrid modes", "error");
  }

  if (
    meetingLink &&
    !meetingLink.startsWith("http://") &&
    !meetingLink.startsWith("https://")
  ) {
    els.startBtn.disabled = false;
    els.startBtn.innerHTML = originalText;
    return showToast(
      "Meeting link must start with http:// or https://",
      "error",
    );
  }

  try {
    const res = await createSession(courseCode, roomId, mode, meetingLink);
    if (!res.success) {
      throw new Error(res.error || "Failed to create session");
    }

    resumeSessionUI(res.session_id, courseCode, mode, res.entry_code);
    showToast("Session started successfully!");
  } catch (e) {
    console.error(e);
    els.startBtn.disabled = false;
    els.startBtn.innerHTML = originalText;
    showToast(e.message || "Network issue. Please retry.", "error");
  }
}

async function updateSessionQR() {
  if (!currentSessionId) return;
  const isOnlineMode = currentSessionMode === "ONLINE";

  try {
    const res = await getSessionQR(currentSessionId);
    if (res.qr_data) {
      currentQRData = res.qr_data;

      if (!isOnlineMode) {
        renderAdaptiveQR(els.qrcode, res.qr_data, false);
      }

      const qrModal = document.getElementById("qrModal");
      if (qrModal && !qrModal.classList.contains("hidden")) {
        window.openQRModal();
      }
    }
  } catch (e) {
    console.error("QR Fetch Error", e);
  }
}

function renderAdaptiveQR(container, text, isFullscreen = false, isCode = false, codeString = "") {
  container.innerHTML = "";
  if (isCode) {
    // High contrast code scaling for projector visibility from back of the room
    container.innerHTML = `
      <div class="w-full flex items-center justify-center p-4">
        <span class="font-black text-slate-900 tracking-[0.15em] sm:tracking-[0.2em] leading-none break-all text-center" 
              style="font-size: ${isFullscreen ? 'min(16vw, 25vh)' : 'clamp(3rem, 10vw, 6rem)'};">
           ${codeString}
        </span>
      </div>`;
    return;
  }

  // Adaptive QR Size Calculation for projector glare and mobile rotation
  let edgeSize = 256;
  if (isFullscreen) {
     const w = window.innerWidth;
     const h = window.innerHeight;
     const isPortrait = h > w;
     // Maximize usage of screen while leaving safe margin for full screen modal padding
     edgeSize = isPortrait ? (w * 0.85) : (h * 0.70);
     edgeSize = Math.max(256, Math.min(Math.floor(edgeSize), 1024));
  }

  // High contrast M-Level QR for classroom distance scanning
  new QRCode(container, {
    text: text,
    width: edgeSize,
    height: edgeSize,
    colorDark: "#000000",
    colorLight: "#ffffff",
    correctLevel: QRCode.CorrectLevel.M // 15% error correction for projector glare
  });

  const imgOrCanvas = container.firstChild;
  if (imgOrCanvas) {
    imgOrCanvas.style.width = `${edgeSize}px`;
    imgOrCanvas.style.height = `${edgeSize}px`;
    imgOrCanvas.style.maxWidth = '100%';
    imgOrCanvas.style.maxHeight = '100%';
    imgOrCanvas.style.objectFit = 'contain';
  }
}

let _qrResizeTimer;
window.addEventListener('resize', () => {
    clearTimeout(_qrResizeTimer);
    _qrResizeTimer = setTimeout(() => {
        const qrModal = document.getElementById("qrModal");
        if (qrModal && !qrModal.classList.contains("hidden") && currentSessionId) {
            window.openQRModal();
        }
    }, 200);
});


async function terminateSession() {
  if (!currentSessionId) return;
  if (els.endSessionBtn.disabled) return;

  const remCountEl = document.getElementById("remainingCount");
  const remaining = remCountEl ? parseInt(remCountEl.innerText || "0") : 0;

  if (remaining > 0) {
    if (
      confirm(
        `There are ${remaining} unmarked students remaining. Mark them as ABSENT before ending?`,
      )
    ) {
      els.endSessionBtn.disabled = true;
      els.endSessionBtn.innerHTML =
        '<span class="material-symbols-rounded animate-spin">progress_activity</span> Marking...';
      try {
        await markRemainingAbsent(currentSessionId);
        showToast("Remaining students marked absent.", "success");
      } catch (e) {
        els.endSessionBtn.disabled = false;
        els.endSessionBtn.innerHTML =
          '<span class="material-symbols-rounded">lock</span> End Session';
        showToast("Failed to mark absent.", "error");
        return;
      }
    }
  } else {
    if (!confirm("Are you sure you want to end this attendance session?"))
      return;
  }

  els.endSessionBtn.disabled = true;
  els.endSessionBtn.innerHTML =
    '<span class="material-symbols-rounded animate-spin">progress_activity</span> Closing...';

  const isOnlineOrHybrid =
    currentSessionMode === "ONLINE" || currentSessionMode === "HYBRID";
  const stable = isOnlineOrHybrid
    ? parseInt(document.getElementById("contStableCount")?.innerText || "0")
    : 0;
  const reconnected = isOnlineOrHybrid
    ? parseInt(
        document.getElementById("contReconnectedCount")?.innerText || "0",
      )
    : 0;
  const interrupted = isOnlineOrHybrid
    ? parseInt(
        document.getElementById("contInterruptedCount")?.innerText || "0",
      )
    : 0;

  let sessionResult = null;
  if (currentSessionId) {
    try {
      sessionResult = await endSession(currentSessionId);
    } catch (e) {
      console.warn("Failed to end session cleanly", e);
    }
    window._lastFinishedSessionId = currentSessionId;
    currentSessionId = null;
    currentQRData = null;
  }
  localStorage.removeItem("active_session_recovery");
  clearInterval(sessionQRInterval);
  clearInterval(timerInterval);
  els.qrcode.innerHTML = "";

  try {
    // UI Swap
    els.qrDisplayArea.classList.add("hidden");
    els.qrDisplayArea.classList.remove("flex");
    els.qrcode.classList.remove("hidden");
    document.getElementById("liveStatsContainer").style.display = "none";
    document.getElementById("simpleScannedContainer").style.display = "block";
    document.getElementById("markAbsentBtn").classList.add("hidden");
    if (document.getElementById("presentCount"))
      document.getElementById("presentCount").innerText = "0";
    if (document.getElementById("lateCount"))
      document.getElementById("lateCount").innerText = "0";
    if (document.getElementById("remainingCount"))
      document.getElementById("remainingCount").innerText = "0";
    els.scannedCount.innerText = "0";
    els.recentList.innerHTML = `<li class="text-slate-400 dark:text-slate-500 text-center italic mt-24 font-medium flex flex-col items-center gap-4"><span class="material-symbols-rounded text-4xl opacity-50">pause_circle</span>No active sessions right now...</li>`;

    if (els.onlineCodeDisplay) {
      els.onlineCodeDisplay.classList.add("hidden");
      els.onlineCodeDisplay.classList.remove("flex");
    }
    if (els.secureTimer) els.secureTimer.classList.remove("hidden");
  } catch (err) {
    console.error("UI Reset Error:", err);
  }

  // ALWAYS restore the buttons safely
  els.endSessionBtn.classList.add("hidden");
  els.endSessionBtn.disabled = true;
  els.endSessionBtn.innerHTML = '<span class="material-symbols-rounded">lock</span> End Session';
  els.startBtn.innerHTML = '<span class="material-symbols-rounded text-lg">play_arrow</span> Start Session';
  els.startBtn.classList.remove("hidden");
  els.startBtn.disabled = false;
  els.courseSelect.disabled = false;
  els.roomSelect.disabled = false;
  if (els.modeSelect) els.modeSelect.disabled = false;
  els.sessionCourse.innerText = "Pending Selection";

  if (isOnlineOrHybrid) {
    document.getElementById("summStableCount").innerText =
      `${stable} student${stable === 1 ? "" : "s"}`;
    document.getElementById("summReconnectedCount").innerText =
      `${reconnected} student${reconnected === 1 ? "" : "s"}`;
    document.getElementById("summInterruptedCount").innerText =
      `${interrupted} student${interrupted === 1 ? "" : "s"}`;

    const warnMsg = document.getElementById("continuityWarningMsg");
    if (reconnected > 0 || interrupted > 0) {
      if (warnMsg) warnMsg.classList.remove("hidden");
    } else {
      if (warnMsg) warnMsg.classList.add("hidden");
    }
    document
      .getElementById("continuitySummaryModal")
      .classList.remove("hidden");
  }

  const psm = document.getElementById("postSessionModal");
  if (sessionResult && sessionResult.summary) {
    document.getElementById("psm_course").innerText = sessionResult.summary.code;
    document.getElementById("psm_course_name").innerText = sessionResult.summary.name;
    document.getElementById("psm_rate").innerText = sessionResult.summary.rate + "%";
    document.getElementById("psm_present").innerText = sessionResult.summary.present;
    document.getElementById("psm_late").innerText = sessionResult.summary.late;
    document.getElementById("psm_absent").innerText = sessionResult.summary.absent;
    document.getElementById("psm_excused").innerText = sessionResult.summary.excused;
    
    if (sessionResult.students && typeof calculateAttendanceStanding === "function") {
      const attList = document.getElementById("psm_attention_list");
      let attentionHtml = "";
      sessionResult.students.forEach(s => {
         const standing = calculateAttendanceStanding(s.logs);
         if (standing.level > 0) {
            const style = getStandingStyles(standing.level);
            attentionHtml += `
              <div class="flex flex-col sm:flex-row sm:items-center justify-between p-3 bg-slate-50 dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-xl gap-2">
                <div>
                   <div class="text-xs font-bold text-slate-800 dark:text-white">${s.name}</div>
                   <div class="text-[9px] text-slate-400 font-mono">@${s.username}</div>
                </div>
                ${renderStandingBadge(standing)}
              </div>
            `;
         }
      });
      attList.innerHTML = attentionHtml || `<div class="flex items-center justify-center h-full text-emerald-500 text-xs font-bold p-6 text-center"><span class="material-symbols-rounded mr-2">check_circle</span>All students in good standing!</div>`;
    }
  }

  psm.classList.remove("hidden");
  showToast("Session ended.");
}

/* ========================================================
   STUDENT FLOW (SCAN QR)
   ======================================================== */

window.openQRModal = function () {
  if (!currentSessionId) return;
  const mode = currentSessionMode;
  const modalLargeContainer = document.getElementById("largeQRContainer");
  const modalLabel = document.getElementById("qrModalLabelText");

  if (mode === "ONLINE") {
    modalLabel.innerText = "ONLINE SESSION CODE";
    renderAdaptiveQR(modalLargeContainer, currentQRData, true, true, currentEntryCode);
  } else if (mode === "HYBRID") {
    if (!currentQRData) return;
    modalLabel.innerText = "HYBRID SESSION - CODE & QR";
    // Show both horizontally
    modalLargeContainer.innerHTML = '';
    
    // QR
    const qrDiv = document.createElement("div");
    new QRCode(qrDiv, {
       text: currentQRData,
       width: window.innerWidth > 768 ? 400 : 256,
       height: window.innerWidth > 768 ? 400 : 256,
       correctLevel: QRCode.CorrectLevel.M
    });
    const qrImg = qrDiv.firstChild;
    if (qrImg) {
       qrImg.style.width = '100%';
       qrImg.style.height = '100%';
       qrImg.style.maxWidth = '400px';
       qrImg.style.maxHeight = '400px';
       qrImg.style.objectFit = 'contain';
    }
    
    // Code
    const codeDiv = document.createElement("div");
    codeDiv.innerHTML = `<span class="font-black text-slate-900 tracking-widest text-7xl sm:text-8xl md:text-9xl">${currentEntryCode}</span>`;
    
    modalLargeContainer.className = "bg-white/95 backdrop-blur-xl p-8 sm:p-12 rounded-[40px] shadow-[0_0_80px_rgba(99,102,241,0.15)] shrink max-w-[95vw] md:max-w-[90vw] max-h-[90vh] overflow-hidden flex flex-col md:flex-row items-center justify-center pointer-events-auto border border-white/20 z-10 animate-modal gap-12 md:gap-24";
    
    modalLargeContainer.appendChild(qrDiv);
    modalLargeContainer.appendChild(codeDiv);

  } else {
    // PHYSICAL
    if (!currentQRData) return;
    modalLabel.innerText = "DYNAMIC SESSION QR";
    modalLargeContainer.className = "bg-white/95 backdrop-blur-xl p-8 sm:p-12 rounded-[40px] shadow-[0_0_80px_rgba(99,102,241,0.15)] shrink max-w-[90vw] max-h-[70vh] overflow-hidden flex items-center justify-center pointer-events-auto border border-white/20 z-10 animate-modal";
    renderAdaptiveQR(modalLargeContainer, currentQRData, true, false, "");
  }
  document.getElementById("qrModal").classList.remove("hidden");
};

window.closeQRModal = function () {
  document.getElementById("qrModal").classList.add("hidden");
};

window.markRemainingAsAbsent = async function () {
  if (!currentSessionId) return;
  const btn = document.getElementById("markAbsentBtn");
  if (btn.disabled) return;

  if (
    !confirm(
      "Are you sure you want to mark all remaining unchecked students as absent?",
    )
  )
    return;

  btn.disabled = true;
  const originalText = btn.innerText;
  btn.innerText = "Marking...";

  try {
    const res = await markRemainingAbsent(currentSessionId);
    if (res.success) {
      showToast(`Marked ${res.marked} students as absent`, "success");
      const live = await getLiveSession(currentSessionId);
      if (live && live.count !== undefined) {
        updateLiveStatsUI(live);
      }
    }
  } catch (e) {
    showToast(e.message || "Failed to mark remaining absent.", "error");
  } finally {
    btn.disabled = false;
    btn.innerText = originalText;
  }
};

// Global UI Updater for Sync Logic
window.updateSyncUI = function () {
  const q = getPendingSyncs();
  const syncBanner = document.getElementById("offlineSyncBanner");
  const syncCount = document.getElementById("syncQueueCount");
  if (syncBanner && syncCount) {
    if (q.length > 0) {
      syncBanner.classList.remove("hidden");
      syncCount.innerText = q.length;
    } else {
      syncBanner.classList.add("hidden");
    }
  }
};

async function onScanSuccess(decodedText) {
  const now = Date.now();
  if (now - lastScanTime < SCAN_COOLDOWN) return;
  lastScanTime = now;

  playBeep();

  // UI Update (Optimistic)
  const displayId = "Session Key";
  const li = document.createElement("li");
  li.className =
    "flex justify-between items-center bg-white dark:bg-slate-800 p-4 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700 animate-fade group cursor-default tracking-widest";
  li.innerHTML = `
    <div class="flex items-center gap-3">
      <div class="w-10 h-10 rounded-xl bg-blue-50 dark:bg-blue-900/20 flex items-center justify-center text-blue-500" id="icon-container-${now}">
        <span class="material-symbols-rounded text-xl animate-spin" id="icon-${now}">progress_activity</span>
      </div>
      <div>
        <div class="font-bold text-slate-800 dark:text-white capitalize text-xs" id="name-${now}">Verifying...</div>
      </div>
    </div>
  `;
  els.recentList.prepend(li);

  // Send to Backend
  const res = await logAttendanceSession(decodedText);

  const icon = document.getElementById(`icon-${now}`);
  const iconContainer = document.getElementById(`icon-container-${now}`);
  const nameEl = document.getElementById(`name-${now}`);

  if (res.error) {
    if (icon) {
      icon.className =
        "material-symbols-rounded text-xl text-amber-500 animate-none";
      icon.innerHTML = "error";
    }
    if (iconContainer)
      iconContainer.className =
        "w-10 h-10 rounded-xl bg-amber-50 dark:bg-amber-900/20 flex items-center justify-center";
    if (
      res.error.toLowerCase().includes("already logged") ||
      res.error.toLowerCase().includes("already recorded")
    ) {
      nameEl.innerText = "Attendance already recorded";
    } else {
      nameEl.innerText = res.error;
    }
    showToast(nameEl.innerText, "error");
  } else if (res.offline) {
    if (icon) {
      icon.className =
        "material-symbols-rounded text-xl text-amber-500 animate-none scale-125 transition-transform";
      icon.innerHTML = "cloud_off";
    }
    if (iconContainer)
      iconContainer.className =
        "w-10 h-10 rounded-xl bg-amber-50 dark:bg-amber-900/20 flex items-center justify-center";
    nameEl.innerText = "Saved Offline.";
    showToast("Network unavilable. Saved locally.");

    scannedCodes.add(now);
    els.scannedCount.innerText = scannedCodes.size;
  } else {
    const isReview = res.record && res.record.status === "REVIEW_REQUIRED";
    const msg = isReview
      ? "Flagged for Review (Verify Location)"
      : "Check-in Successful!";

    // Check if we have course info to render the dashboard-style card
    if (!isReview && res.record && res.record.course_name) {
      let modeLabel = "🎓 PHYSICAL";
      let modeColor = "emerald";
      if (res.record.sessionMode === "ONLINE") {
        modeLabel = "🌐 ONLINE";
        modeColor = "blue";
      }
      if (res.record.sessionMode === "HYBRID") {
        modeLabel = "🌓 HYBRID";
        modeColor = "amber";
      }

      let classLaunchHtml = "";
      if (
        (res.record.sessionMode === "ONLINE" ||
          res.record.sessionMode === "HYBRID") &&
        res.record.meeting_link
      ) {
        classLaunchHtml = `
          <button onclick="onLaunchClassroom(${res.record.session_id}, '${res.record.meeting_link}')" class="px-4 py-2 mt-4 w-full bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white rounded-xl text-xs font-black uppercase tracking-wider shadow-lg shadow-blue-500/10 flex items-center justify-center gap-1.5 transition-all">
            <span class="material-symbols-rounded text-sm">video_camera_front</span> Launch Classroom
          </button>
        `;

        if (
          typeof sendHeartbeatPing === "function" &&
          typeof activeHeartbeats !== "undefined"
        ) {
          if (!activeHeartbeats[res.record.session_id]) {
            sendHeartbeatPing(res.record.session_id);
            activeHeartbeats[res.record.session_id] = setInterval(
              () => sendHeartbeatPing(res.record.session_id),
              30000,
            );
          }
        } else {
          window.activeHeartbeats = window.activeHeartbeats || {};
          if (!window.activeHeartbeats[res.record.session_id]) {
            const ping = async () => {
              if (typeof sendSessionHeartbeat !== "undefined") {
                try {
                  await sendSessionHeartbeat(res.record.session_id);
                } catch (e) {}
              }
            };
            ping();
            window.activeHeartbeats[res.record.session_id] = setInterval(
              ping,
              30000,
            );
          }
        }
      }

      li.className =
        "flex flex-col bg-white dark:bg-slate-800 p-5 rounded-[24px] border-2 border-emerald-500 shadow-sm animate-fade";

      const timeStr = new Date().toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });

      li.innerHTML = `
        <div class="flex items-center gap-4">
          <div class="w-12 h-12 rounded-2xl bg-emerald-500/10 flex items-center justify-center text-emerald-500">
            <span class="material-symbols-rounded text-2xl">check_circle</span>
          </div>
          <div class="flex-1">
            <div class="flex items-center gap-2 mb-0.5">
              <span class="text-[10px] font-black uppercase tracking-widest text-emerald-500 bg-emerald-500/5 px-2 py-0.5 rounded-full">Attendance Recorded</span>
              <span class="text-[10px] font-bold text-slate-400 uppercase tracking-widest">${timeStr}</span>
            </div>
            <div class="font-black text-slate-800 dark:text-white text-sm tracking-tight">${res.record.course_name}</div>
            <div class="text-[10px] text-slate-500 font-bold uppercase tracking-widest">${res.record.professor_name || ""} &bull; ${modeLabel}</div>
          </div>
        </div>
        ${classLaunchHtml}
      `;
    } else {
      const color = isReview ? "orange" : "emerald";
      const iName = isReview ? "warning" : "check_circle";

      if (icon) {
        icon.className = `material-symbols-rounded text-xl text-${color}-500 animate-none scale-125 transition-transform`;
        icon.innerHTML = iName;
      }
      if (iconContainer)
        iconContainer.className = `w-10 h-10 rounded-xl bg-${color}-50 dark:bg-${color}-900/20 flex items-center justify-center`;
      if (nameEl) nameEl.innerText = msg;
    }

    showToast(msg, isReview ? "error" : "success"); // Error toast style stands out

    // update real-time counter client-side
    scannedCodes.add(now);
    els.scannedCount.innerText = scannedCodes.size;
  }
}

let studentCountdownInterval = null;

async function startClientScanning() {
  if (isScanning) return;
  if (audioCtx.state === "suspended") await audioCtx.resume();

  // Swap Buttons
  if (els.startScanBtn) els.startScanBtn.classList.add("hidden");
  if (els.stopScanBtn) {
    els.stopScanBtn.classList.remove("hidden");
    els.stopScanBtn.disabled = false;
  }

  els.statusMsg.innerText = "Camera active. Point at Professor's Session QR.";

  const countdownEl = document.getElementById("sessionCountdown");
  if (countdownEl) {
    countdownEl.classList.remove("hidden");
    const endTime = Date.now() + 900 * 1000; // 15 mins from now
    clearInterval(studentCountdownInterval);
    studentCountdownInterval = setInterval(() => {
      const timeLeft = Math.floor((endTime - Date.now()) / 1000);
      if (timeLeft <= 0) {
        clearInterval(studentCountdownInterval);
        countdownEl.innerText = "Scan timeout. Please restart camera.";
        stopClientScanning();
      } else {
        const m = Math.floor(timeLeft / 60)
          .toString()
          .padStart(2, "0");
        const s = (timeLeft % 60).toString().padStart(2, "0");
        countdownEl.innerText = `Active Session: Ends in ${m}:${s}`;
      }
    }, 1000);
  }

  scanner = new Html5Qrcode("reader");
  try {
    await scanner.start(
      { facingMode: "environment" },
      { fps: 10, qrbox: { width: 250, height: 250 } },
      onScanSuccess,
      () => {
        /* ignore frame parse */
      },
    );
    isScanning = true;
  } catch (err) {
    console.error(err);
    showToast("Camera access denied or failed", "error");
    stopClientScanning();
    // Auto-fallback to code entry on error
    openManualModal();
  }
}

async function stopClientScanning() {
  if (scanner && isScanning) {
    try {
      await scanner.stop();
      scanner.clear();
    } catch (e) {}
    isScanning = false;
  }
  clearInterval(studentCountdownInterval);
  const countdownEl = document.getElementById("sessionCountdown");
  if (countdownEl) countdownEl.classList.add("hidden");

  if (els.startScanBtn) els.startScanBtn.classList.remove("hidden");
  if (els.stopScanBtn) {
    els.stopScanBtn.classList.add("hidden");
    els.stopScanBtn.disabled = true;
  }
  els.statusMsg.innerText = "Ready to start.";
}

// Helper to prepend success/error UI during scanning
function appendScanResult(
  success,
  msg,
  isOffline = false,
  isReview = false,
  record = null,
) {
  const now = new Date();
  const timeStr = now.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const li = document.createElement("li");
  li.className =
    "flex justify-between items-center bg-white/60 dark:bg-slate-800/40 p-5 rounded-[24px] border border-slate-100 dark:border-slate-800/50 animate-fade group cursor-default transition-all hover:bg-white dark:hover:bg-slate-800 shadow-sm";

  if (msg.toLowerCase().includes("already logged")) {
    msg = "Attendance already recorded for this session";
    success = false;
    isOffline = false;
    isReview = false;
  }

  let icon = "check_circle",
    color = "emerald",
    label = "Success";
  if (!success) {
    icon = "error";
    color = "amber";
    label = "Alert";
  }
  if (isOffline) {
    icon = "cloud_off";
    color = "amber";
    label = "Cached";
  }
  if (isReview) {
    icon = "warning";
    color = "orange";
    label = "Flagged";
  }

  if (success && !isReview && !isOffline) {
    msg = "ATTENDANCE RECORDED";
    li.style.border = "2px solid #10b981";
  }

  if (success && !isReview && !isOffline && record && record.course_name) {
    let modeLabel = "🎓 PHYSICAL";
    let modeColor = "emerald";
    if (record.sessionMode === "ONLINE") {
      modeLabel = "🌐 ONLINE";
      modeColor = "blue";
    }
    if (record.sessionMode === "HYBRID") {
      modeLabel = "🌓 HYBRID";
      modeColor = "amber";
    }

    let classLaunchHtml = "";
    if (
      (record.sessionMode === "ONLINE" || record.sessionMode === "HYBRID") &&
      record.meeting_link
    ) {
      classLaunchHtml = `
        <button onclick="onLaunchClassroom(${record.session_id}, '${record.meeting_link}')" class="px-4 py-2 mt-4 w-full bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white rounded-xl text-xs font-black uppercase tracking-wider shadow-lg shadow-blue-500/10 flex items-center justify-center gap-1.5 transition-all">
          <span class="material-symbols-rounded text-sm">video_camera_front</span> Launch Classroom
        </button>
      `;

      if (
        typeof sendHeartbeatPing === "function" &&
        typeof activeHeartbeats !== "undefined"
      ) {
        if (!activeHeartbeats[record.session_id]) {
          sendHeartbeatPing(record.session_id);
          activeHeartbeats[record.session_id] = setInterval(
            () => sendHeartbeatPing(record.session_id),
            30000,
          );
        }
      } else {
        // Define activeHeartbeats in this scope if missing
        window.activeHeartbeats = window.activeHeartbeats || {};
        if (!window.activeHeartbeats[record.session_id]) {
          const ping = async () => {
            if (typeof sendSessionHeartbeat !== "undefined") {
              try {
                await sendSessionHeartbeat(record.session_id);
              } catch (e) {}
            }
          };
          ping();
          window.activeHeartbeats[record.session_id] = setInterval(ping, 30000);
        }
      }
    }

    li.className =
      "flex flex-col bg-white dark:bg-slate-800 p-5 rounded-[24px] border-2 border-emerald-500 shadow-sm animate-fade";
    li.innerHTML = `
      <div class="flex items-center gap-4">
        <div class="w-12 h-12 rounded-2xl bg-emerald-500/10 flex items-center justify-center text-emerald-500">
          <span class="material-symbols-rounded text-2xl">check_circle</span>
        </div>
        <div class="flex-1">
          <div class="flex items-center gap-2 mb-0.5">
            <span class="text-[10px] font-black uppercase tracking-widest text-emerald-500 bg-emerald-500/5 px-2 py-0.5 rounded-full">Attendance Recorded</span>
            <span class="text-[10px] font-bold text-slate-400 uppercase tracking-widest">${timeStr}</span>
          </div>
          <div class="font-black text-slate-800 dark:text-white text-sm tracking-tight">${record.course_name}</div>
          <div class="text-[10px] text-slate-500 font-bold uppercase tracking-widest">${record.professor_name || ""} &bull; ${modeLabel}</div>
        </div>
      </div>
      ${classLaunchHtml}
    `;
  } else {
    li.innerHTML = `
      <div class="flex items-center gap-4">
        <div class="w-12 h-12 rounded-2xl bg-${color}-500/10 flex items-center justify-center text-${color}-500 group-hover:scale-110 transition-transform">
          <span class="material-symbols-rounded text-2xl">${icon}</span>
        </div>
        <div>
          <div class="flex items-center gap-2 mb-0.5">
            <span class="text-[10px] font-black uppercase tracking-widest text-${color}-500 bg-${color}-500/5 px-2 py-0.5 rounded-full">${label}</span>
            <span class="text-[10px] font-bold text-slate-400 uppercase tracking-widest">${timeStr}</span>
          </div>
          <div class="font-black text-slate-800 dark:text-white text-xs tracking-tight">${msg}</div>
        </div>
      </div>
      <div class="text-[10px] font-black text-slate-300 dark:text-slate-600 uppercase tracking-widest group-hover:text-slate-400 transition-colors">SIG_REC</div>
    `;
  }

  if (
    els.recentList.children.length > 0 &&
    els.recentList.children[0].innerText.includes("Listening")
  ) {
    els.recentList.innerHTML = "";
  }

  els.recentList.prepend(li);
  
  if (user.role === 'student') {
     const studentMonitor = document.getElementById("studentLiveMonitorCol");
     if (studentMonitor) {
         studentMonitor.classList.remove('hidden');
         studentMonitor.classList.replace('h-full', 'h-auto');
         document.getElementById('simpleScannedContainer').style.display = 'block';
         // hide the scanner
         els.studentArea.classList.add('hidden');
     }
  }

  if (success && !isOffline && !isReview) {
    els.scannedCount.classList.add("animate-success");
    setTimeout(
      () => els.scannedCount.classList.remove("animate-success"),
      1500,
    );
  }
}

// Manual Entry Logic
let sessionStudents = [];

async function openManualModal() {
  if (user.role === "professor" && !currentSessionId) {
    return showToast("Start an attendance session first.", "error");
  }

  const modal = document.getElementById("manualModal");
  const searchArea = document.getElementById("studentSearchArea");
  const basicArea = document.getElementById("basicManualEntry");

  modal.classList.remove("hidden");

  if (user.role === "professor" && currentSessionId) {
    searchArea.classList.remove("hidden");
    basicArea.classList.add("hidden");
    loadSessionStudents();
  } else {
    searchArea.classList.add("hidden");
    basicArea.classList.remove("hidden");
  }
}

function closeManualModal() {
  document.getElementById("manualModal").classList.add("hidden");
  document.getElementById("studentSearch").value = "";
}

async function loadSessionStudents(isSilent = false) {
  if (!currentSessionId) return;
  const list = document.getElementById("studentList");
  if (!isSilent || !sessionStudents.length) {
    list.innerHTML =
      '<div class="text-center py-10"><span class="material-symbols-rounded animate-spin text-maroon">progress_activity</span></div>';
  }

  try {
    const students = await getSessionStudents(currentSessionId);
    if (students && Array.isArray(students)) {
      sessionStudents = students;
      renderStudentList(sessionStudents);
    } else if (!isSilent || !sessionStudents.length) {
      list.innerHTML =
        '<div class="text-center py-10 text-slate-400 italic">No students found</div>';
    }
  } catch (e) {
    if (!isSilent || !sessionStudents.length) {
      list.innerHTML =
        '<div class="text-center py-10 text-slate-400 italic">Failed to load</div>';
    }
  }
}

function getContinuityBadge(status) {
  if (!status) return "";
  if (status === "Stable") {
    return `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-black bg-emerald-100 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400 tracking-wider">🟢 STABLE</span>`;
  }
  if (status === "Temporarily Interrupted") {
    return `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-black bg-amber-100 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400 tracking-wider">🟡 TEMP UNSTABLE</span>`;
  }
  if (status === "Reconnected") {
    return `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-black bg-teal-100 text-teal-700 dark:bg-teal-950/30 dark:text-teal-400 tracking-wider">🟢 RECONNECTED</span>`;
  }
  if (status === "Interrupted") {
    return `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-black bg-rose-100 text-rose-700 dark:bg-rose-950/30 dark:text-rose-400 tracking-wider">🔴 INTERRUPTED</span>`;
  }
  return "";
}

function renderStudentList(students) {
  const list = document.getElementById("studentList");
  const query = document.getElementById("studentSearch").value.toLowerCase();

  const filtered = students.filter((s) => {
    const match =
      s.full_name.toLowerCase().includes(query) ||
      s.username.toLowerCase().includes(query) ||
      (s.section && s.section.toLowerCase().includes(query));
    return match;
  });

  if (filtered.length === 0) {
    list.innerHTML = `<div class="text-center py-10 text-slate-400 italic">No matching students</div>`;
    return;
  }

  list.innerHTML = filtered
    .map((s) => {
      const isMarked = !!s.status;
      const showContinuity =
        isMarked &&
        s.status !== "ABSENT" &&
        (currentSessionMode === "ONLINE" || currentSessionMode === "HYBRID");
      return `
    <div class="flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-900 rounded-2xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors border border-slate-100 dark:border-slate-700/50 ${isMarked && !showContinuity ? "opacity-60" : ""}">
      <div class="flex items-center gap-4">
        <div class="w-10 h-10 rounded-full bg-maroon/10 text-maroon flex items-center justify-center font-black text-xs">
          ${s.full_name
            .split(" ")
            .map((n) => n[0])
            .join("")}
        </div>
        <div>
          <div class="font-bold text-slate-800 dark:text-white text-sm tracking-tight flex flex-wrap items-center gap-2">
            <span>${s.full_name}</span>
            ${showContinuity ? getContinuityBadge(s.continuity_status) : ""}
          </div>
          <div class="text-[10px] text-slate-400 font-bold uppercase tracking-widest">${s.section || "No Section"} • ${s.username}</div>
          ${
            showContinuity && s.interruption_reason
              ? `
            <div class="text-[10px] mt-1 text-slate-500 dark:text-slate-400 italic bg-amber-500/5 max-w-xs p-1.5 rounded-lg border border-amber-500/10 flex items-start gap-1">
              <span class="material-symbols-rounded text-xs mt-0.5 text-amber-500">chat_bubble</span>
              <span>Reason: "${s.interruption_reason}"</span>
            </div>
          `
              : ""
          }
        </div>
      </div>
      ${
        isMarked
          ? `
        <div class="px-3 py-1 bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400 rounded-full text-[10px] font-black uppercase tracking-widest">
          Recorded
        </div>
      `
          : `
        <button onclick="markStudentManual(${s.id})" class="p-2 bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl shadow-lg shadow-emerald-500/20 transition-all">
          <span class="material-symbols-rounded">person_check</span>
        </button>
      `
      }
    </div>
  `;
    })
    .join("");
}

function handleSearch(e) {
  if (e.key === "Enter") e.preventDefault();
  renderStudentList(sessionStudents);
}

// Attach input listener for real-time search
document
  .getElementById("studentSearch")
  .addEventListener("input", () => renderStudentList(sessionStudents));

async function markStudentManual(studentId) {
  if (!currentSessionId) return;
  const list = document.getElementById("studentList");
  const btn = list.querySelector(
    `button[onclick="markStudentManual(${studentId})"]`,
  );
  if (btn) {
    if (btn.disabled) return;
    btn.disabled = true;
    btn.innerHTML =
      '<span class="material-symbols-rounded animate-spin">progress_activity</span>';
  }

  try {
    const res = await manualMarkAttendance(currentSessionId, studentId);
    if (res.success) {
      showToast("Attendance marked");
      // Remove from local list
      sessionStudents = sessionStudents.map((s) =>
        s.id === studentId ? { ...s, status: "PRESENT" } : s,
      );
      renderStudentList(sessionStudents);

      // Update main counter
      const currentCount = parseInt(els.scannedCount.innerText) || 0;
      els.scannedCount.innerText = currentCount + 1;
    } else {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML =
          '<span class="material-symbols-rounded">person_check</span>';
      }
      showToast(res.error || "Failed to mark attendance", "error");
    }
  } catch (e) {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML =
        '<span class="material-symbols-rounded">person_check</span>';
    }
    showToast("Network error. Try again.", "error");
  }
}

async function submitManual() {
  const btn = document.querySelector("#manualModal button.bg-maroon");
  if (btn && btn.disabled) return;
  const input = document.getElementById("manualInput");
  const val = input.value.trim();
  if (!val) return showToast("Enter a value", "error");

  if (btn) btn.disabled = true;

  try {
    if (user.role === "student") {
      const res = await postCodeAttendance(val);
      document.getElementById("manualModal").classList.add("hidden");
      input.value = "";
      if (res.error) {
        appendScanResult(false, res.error);
        showToast(res.error, "error");
      } else if (res.offline) {
        appendScanResult(true, "Saved Offline.");
        showToast("Network unavilable. Saved locally.");
        scannedCodes.add(Date.now());
        els.scannedCount.innerText = scannedCodes.size;
      } else {
        const isReview = res.record && res.record.status === "REVIEW_REQUIRED";
        const msg = isReview
          ? "Flagged for Review (Verify Location)"
          : "Check-in Successful!";
        appendScanResult(true, msg, false, isReview, res.record);
        showToast(msg, isReview ? "error" : "success");
        scannedCodes.add(Date.now());
        els.scannedCount.innerText = scannedCodes.size;
      }
    } else {
      if (!currentSessionId) {
        showToast("Start a session first.", "error");
        return;
      }
      const originalText = btn.innerText;
      btn.innerText = "Submitting...";
      const res = await apiCall(
        "/api/attendance/session/" + currentSessionId + "/manual-mark",
        "POST",
        { username: val },
      );
      btn.innerText = originalText;
      if (res && res.error) {
        if (res.error.includes("Network") || res.error.includes("timed out")) {
             enqueueAction("manualMarkAttendance", { sessionId: currentSessionId, studentId: val }); 
             showToast("Saved offline. Will sync when connected.", "success");
             document.getElementById("manualModal").classList.add("hidden");
             input.value = "";
             return;
        }
        showToast(res.error, "error");
      } else {
        showToast("Student manually marked present.", "success");
        document.getElementById("manualModal").classList.add("hidden");
        input.value = "";
        if (typeof loadSessionStudents === "function") loadSessionStudents();
      }
    }
  } catch (e) {
    showToast(e.message || "Network error. Try again.", "error");
  } finally {
    if (btn) btn.disabled = false;
  }
}

// Bind Events
if (els.startBtn) els.startBtn.addEventListener("click", startSession);
if (els.endSessionBtn)
  els.endSessionBtn.addEventListener("click", terminateSession);
if (els.startScanBtn)
  els.startScanBtn.addEventListener("click", startClientScanning);
if (els.stopScanBtn)
  els.stopScanBtn.addEventListener("click", stopClientScanning);
const markAbsentBtn = document.getElementById("markAbsentBtn");
if (markAbsentBtn)
  markAbsentBtn.addEventListener("click", markRemainingAsAbsent);
const rQB = document.getElementById("refreshQRBtn");
if (rQB)
  rQB.addEventListener("click", () => {
    updateSessionQR();
    showToast("QR Refreshed manually");
  });

document.addEventListener("visibilitychange", () => {
  if (
    document.visibilityState === "visible" &&
    typeof currentSessionId !== "undefined" &&
    currentSessionId
  ) {
    if (typeof startSessionIntervals === "function") {
      startSessionIntervals(); // Completely rebuild intervals for accurate timing
    }
  }
});

async function onLaunchClassroom(sessionId, link) {
  if (typeof joinOnlineSession === "function") {
    try {
      await joinOnlineSession(sessionId);
    } catch (e) {}
  }
  if (link && link !== "null") window.open(link, "_blank");
}

window.downloadSessionReport = function(type) {
  const courseCode = document.getElementById("courseSelect").value;
  if (!courseCode) {
    showToast("No course selected", "error");
    return;
  }
  
  if (!window._lastFinishedSessionId) {
    showToast("No session to export", "error");
    return;
  }
  
  showToast("Preparing download...", "success");

  const today = new Date().toISOString().split("T")[0];
  const url = `reports.html?course=${encodeURIComponent(courseCode)}&date=${today}&session_id=${window._lastFinishedSessionId}&auto_export=${type}`;
  
  let frame = document.getElementById("hiddenExportFrame");
  if (!frame) {
     frame = document.createElement("iframe");
     frame.id = "hiddenExportFrame";
     frame.style.position = "absolute";
     frame.style.width = "1px";
     frame.style.height = "1px";
     frame.style.left = "-9999px";
     frame.style.opacity = "0";
     frame.style.pointerEvents = "none";
     document.body.appendChild(frame);
  }
  frame.src = url;
};

window.closePostSessionModal = function() {
  const modal = document.getElementById('postSessionModal');
  if (modal) modal.classList.add('hidden');
};
