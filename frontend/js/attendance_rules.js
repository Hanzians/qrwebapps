const CHED_ATTENDANCE_RULES = {
  MAX_ABSENCE_PERCENT: 20,
  LATES_PER_ABSENCE: 3,
  DEFAULT_TOTAL_MEETINGS: 40 // Example configuration: 40 scheduled meetings per semester
};

function calculateAttendanceStanding(logs, totalMeetings = CHED_ATTENDANCE_RULES.DEFAULT_TOTAL_MEETINGS) {
  let present = 0;
  let late = 0;
  let absent = 0;
  let excused = 0;

  logs.forEach(l => {
    if (l.status === 'PRESENT') present++;
    else if (l.status === 'LATE') late++;
    else if (l.status === 'ABSENT') absent++;
    else if (l.status === 'EXCUSED') excused++;
  });

  const unexcusedAbsences = absent;
  const equivalentFromLates = Math.floor(late / CHED_ATTENDANCE_RULES.LATES_PER_ABSENCE);
  const remainingLates = late % CHED_ATTENDANCE_RULES.LATES_PER_ABSENCE;
  const totalEquivalentAbsences = unexcusedAbsences + equivalentFromLates;
  
  const limit = Math.floor(totalMeetings * (CHED_ATTENDANCE_RULES.MAX_ABSENCE_PERCENT / 100));

  let status = 'Good Standing';
  let badgeColor = 'emerald';
  let level = 0; // 0: Good, 1: Warning, 2: Near Limit, 3: Limit Reached

  if (totalEquivalentAbsences >= limit) {
    status = 'Recommended for Attendance Review';
    badgeColor = 'rose';
    level = 3;
  } else if (totalEquivalentAbsences >= Math.floor(limit * 0.9)) {
    status = 'Near Attendance Limit';
    badgeColor = 'orange';
    level = 2;
  } else if (totalEquivalentAbsences >= Math.floor(limit * 0.75)) {
    status = 'Attendance Warning';
    badgeColor = 'amber';
    level = 1;
  }

  return {
    equivalentAbsences: totalEquivalentAbsences,
    remainingLates,
    limit,
    status,
    badgeColor,
    level,
    breakdown: { present, late, absent, excused }
  };
}

function getStandingStyles(level) {
    switch (level) {
        case 3: return { color: "rose", bgClasses: "bg-rose-50 text-rose-700 border-rose-200/50 dark:bg-rose-950/30 dark:text-rose-400 dark:border-rose-800/50", plainColor: "#e11d48", icon: "error", label: "Review Recommended" };
        case 2: return { color: "orange", bgClasses: "bg-orange-50 text-orange-700 border-orange-200/50 dark:bg-orange-950/30 dark:text-orange-400 dark:border-orange-800/50", plainColor: "#f97316", icon: "warning", label: "Near Limit" };
        case 1: return { color: "amber", bgClasses: "bg-amber-50 text-amber-700 border-amber-200/50 dark:bg-amber-950/30 dark:text-amber-400 dark:border-amber-800/50", plainColor: "#d97706", icon: "warning", label: "Warning" };
        default: return { color: "emerald", bgClasses: "bg-emerald-50 text-emerald-700 border-emerald-200/50 dark:bg-emerald-950/30 dark:text-emerald-400 dark:border-emerald-800/50", plainColor: "#10b981", icon: "check_circle", label: "Good Standing" };
    }
}

function renderStandingBadge(standing) {
  const style = getStandingStyles(standing.level);
  let title = `Absences: ${standing.equivalentAbsences}/${standing.limit} (${standing.remainingLates} lates)`;
  if (standing.level === 3) title = `Exceeded attendance threshold. Faculty discretion applies. (${title})`;
  
  return `<span class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest border shadow-sm ${style.bgClasses}" title="${title}">
    <span class="material-symbols-rounded text-[14px]">${style.icon}</span> ${style.label}
  </span>`;
}

function renderHeatmap(containerId, trends, cardId) {
   if (!trends || trends.length === 0) return;
   const container = document.getElementById(containerId);
   if (!container) return;
   
   const html = trends.map(t => {
      const total = t.total;
      const presentCount = t.present + (t.late || 0); // Include lates as part of present if split
      const rate = total ? (presentCount / total) : 0;
      let bgColor = "bg-rose-500 shadow-rose-500/20";
      if (rate >= 0.85) bgColor = "bg-emerald-500 shadow-emerald-500/20";
      else if (rate >= 0.60) bgColor = "bg-amber-500 shadow-amber-500/20";
      else if (total === 0) bgColor = "bg-slate-200 dark:bg-slate-700 shadow-none";

      const rPct = Math.round(rate*100);
      return `<div class="w-[20px] h-[20px] sm:w-[24px] sm:h-[24px] rounded-[6px] shrink-0 ${bgColor} shadow-sm hover:scale-[1.3] hover:shadow-lg hover:z-20 relative transition-all cursor-pointer border border-white/20 dark:border-black/20" title="${t.date}&#10;Health: ${rPct}% (${presentCount}/${total})"></div>`;
   }).join('');
   
   container.innerHTML = html;
   if (cardId) document.getElementById(cardId).classList.remove('hidden');
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        CHED_ATTENDANCE_RULES,
        calculateAttendanceStanding,
        getStandingStyles,
        renderStandingBadge
    };
}
