// Smart Class Scheduling System

// Helper to parse existing class schedules "T/TH 07:30AM-09:00AM" or "MWF 1:00 PM - 2:30 PM"
function parseSchedule(scheduleStr) {
  if (!scheduleStr) return null;

  const timeRegex = /([0-9]{1,2}:[0-9]{2}\s*[apAP][mM])\s*(?:-|to)\s*([0-9]{1,2}:[0-9]{2}\s*[apAP][mM])/i;
  const timeMatch = scheduleStr.match(timeRegex);

  if (!timeMatch) return null;

  const startTime = timeMatch[1].trim();
  const endTime = timeMatch[2].trim();
  
  const daysStr = scheduleStr.replace(timeMatch[0], "").toUpperCase().trim();
  const activeDays = [];
  
  if (daysStr.includes('M') || daysStr.includes('MON')) activeDays.push(1);
  if (daysStr.includes('T ') || daysStr.includes('T/') || daysStr.includes('TUE') || daysStr.match(/\bT\b/) || (daysStr.includes('T') && !daysStr.includes('TH'))) activeDays.push(2);
  if (daysStr.includes('W') || daysStr.includes('WED')) activeDays.push(3);
  if (daysStr.includes('TH') || daysStr.includes('THU')) activeDays.push(4);
  if (daysStr.includes('F') || daysStr.includes('FRI')) activeDays.push(5);
  if (daysStr.includes('S ') || daysStr.includes('S/') || daysStr.includes('SAT') || daysStr.match(/\bS\b/) || (daysStr.includes('S') && !daysStr.includes('SUN') && !daysStr.includes('SAT'))) activeDays.push(6);
  if (daysStr.includes('SU') || daysStr.includes('SUN')) activeDays.push(0);

  return { activeDays, startTime, endTime, original: scheduleStr };
}

// Convert 07:30 AM to minutes since midnight
function timeToMinutes(timeStr) {
    const timeMatch = timeStr.match(/([0-9]{1,2}):([0-9]{2})\s*([apAP][mM])/);
    if (!timeMatch) return -1;
    let hours = parseInt(timeMatch[1]);
    const minutes = parseInt(timeMatch[2]);
    const meridian = timeMatch[3].toUpperCase();
    
    if (meridian === 'PM' && hours < 12) hours += 12;
    if (meridian === 'AM' && hours === 12) hours = 0;
    
    return hours * 60 + minutes;
}

// Check if a course is happening today and upcoming
function getScheduleStatus(scheduleObj) {
    if (!scheduleObj) return null;
    
    const now = new Date();
    const currentDay = now.getDay();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    
    if (!scheduleObj.activeDays.includes(currentDay)) return null;
    
    const startMins = timeToMinutes(scheduleObj.startTime);
    const endMins = timeToMinutes(scheduleObj.endTime);
    
    if (startMins === -1 || endMins === -1) return null;
    
    if (currentMinutes >= startMins - 15 && currentMinutes <= endMins) {
       return { state: "smart_suggest", minutesToStart: startMins - currentMinutes };
    }
    
    if (currentMinutes < startMins) {
       return { state: "upcoming", minutesToStart: startMins - currentMinutes };
    }
    
    return null; // past
}

// Render the Smart Schedule UI
async function loadSmartSchedule(passedCourses = null) {
    const container = document.getElementById("smartScheduleContainer");
    if (!container) return;
    
    try {
        const user = JSON.parse(localStorage.getItem("user"));
        if (!user) return;
        
        let courses = passedCourses || (await fetchCourses());
        if (!courses || courses.length === 0) return;
        
        let allSchedules = [];
        
        for (const course of courses) {
             const sched = parseSchedule(course.schedule);
             if (sched) {
                 const status = getScheduleStatus(sched);
                 if (status) {
                     allSchedules.push({ course, sched, status });
                 }
             }
        }
        
        // Sort by how soon it starts
        allSchedules.sort((a, b) => a.status.minutesToStart - b.status.minutesToStart);
        
        if (allSchedules.length > 0) {
            container.innerHTML = "";
            container.classList.remove("hidden");
            
            // Build UI
            allSchedules.forEach(item => {
                 let cardHtml = "";
                 if (item.status.state === "smart_suggest" && user.role === "professor") {
                      cardHtml = `
                        <div class="card bg-maroon/5 dark:bg-maroon/20 border border-maroon/20 dark:border-maroon/40 p-6 flex flex-col sm:flex-row items-center justify-between gap-6 relative overflow-hidden group shadow-lg mb-4">
                           <div class="absolute inset-0 bg-maroon/[0.02] dark:bg-white/5 opacity-0 group-hover:opacity-100 transition-opacity"></div>
                           <div class="relative z-10 flex flex-col items-center sm:items-start text-center sm:text-left">
                               <div class="flex items-center gap-2 text-maroon dark:text-rose-400 font-black uppercase tracking-[0.25em] text-[10px] mb-2">
                                  <span class="material-symbols-rounded text-sm animate-pulse text-rose-500 dark:text-rose-400">sensors</span>
                                  Start Attendance Session?
                               </div>
                               <h2 class="text-2xl font-black text-slate-800 dark:text-slate-100 tracking-tight">${item.course.code}</h2>
                               <p class="text-sm text-slate-600 dark:text-slate-300 font-medium">${item.course.name}</p>
                               <div class="mt-2 text-xs font-bold text-slate-500 dark:text-slate-400 bg-black/5 dark:bg-black/20 px-2 py-1 rounded inline-block">
                                  ${item.sched.startTime} - ${item.sched.endTime}
                               </div>
                           </div>
                           <div class="relative z-10 flex w-full sm:w-auto gap-3">
                               <button onclick="dismissSmartSchedule(this)" class="flex-1 sm:flex-none px-4 py-3 rounded-xl bg-white dark:bg-slate-800 text-slate-500 dark:text-slate-300 font-bold text-xs uppercase tracking-widest hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors border dark:border-slate-700 shadow-sm">Dismiss</button>
                               <button onclick="quickStartSession('${item.course.code}')" class="flex-1 sm:flex-none px-6 py-3 rounded-xl bg-maroon text-white hover:text-maroon hover:bg-pup-gold shadow-md shadow-maroon/20 font-black text-xs uppercase tracking-widest transition-all hover:scale-105 active:scale-95 flex items-center justify-center gap-2">
                                  <span>Start Session</span>
                                  <span class="material-symbols-rounded text-sm">rocket_launch</span>
                               </button>
                           </div>
                        </div>
                      `;
                 } else {
                      // Just Upcoming class
                      cardHtml = `
                        <div class="card dark:bg-slate-800/80 border dark:border-slate-700/50 p-6 flex flex-col sm:flex-row items-center justify-between gap-6 shadow-sm mb-4">
                           <div class="flex flex-col items-center sm:items-start text-center sm:text-left">
                               <div class="flex items-center gap-2 text-indigo-500 dark:text-indigo-400 font-black uppercase tracking-[0.2em] text-[10px] mb-2">
                                  <span class="material-symbols-rounded text-sm">schedule</span>
                                  Upcoming Class
                               </div>
                               <h2 class="text-xl font-black text-slate-800 dark:text-white tracking-tight">${item.course.code}</h2>
                               <p class="text-sm text-slate-600 dark:text-slate-400 font-medium">${item.course.name}</p>
                               <div class="mt-2 text-xs font-bold text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-900/50 px-2 py-1 rounded inline-block">
                                  Today • ${item.sched.startTime} - ${item.sched.endTime}
                               </div>
                           </div>
                           ${user.role === "professor" ? `
                           <div class="flex w-full sm:w-auto">
                               <button onclick="quickStartSession('${item.course.code}')" class="w-full sm:w-auto px-6 py-3 rounded-xl bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600 font-bold text-xs uppercase tracking-widest transition-colors flex items-center justify-center gap-2">
                                  <span>Start Attendance</span>
                                  <span class="material-symbols-rounded text-sm">arrow_forward</span>
                               </button>
                           </div>
                           ` : ''}
                        </div>
                      `;
                 }
                 container.innerHTML += cardHtml;
            });
        }
    } catch(e) {
        console.error("Smart schedule load error", e);
    }
}

window.dismissSmartSchedule = function(btn) {
    const card = btn.closest('.card');
    card.style.opacity = '0';
    setTimeout(() => {
        card.remove();
        const container = document.getElementById("smartScheduleContainer");
        if (container.children.length === 0) {
            container.classList.add("hidden");
        }
    }, 300);
}

window.quickStartSession = function(courseCode) {
    // Navigate straight to scan page with pre-filled course
    window.location.href = `scan.html?course=${encodeURIComponent(courseCode)}&autostart=1`;
}
