const { get, run, getNowPH, logAudit } = require('../db');
const { AppError } = require('../utils/errorHandler');

class SecurityService {

  // Distance calculating formula
  calculateDistance(lat1, lon1, lat2, lon2) {
    if (!lat1 || !lon1 || !lat2 || !lon2) return null;
    const R = 6371e3; // metres
    const φ1 = lat1 * Math.PI/180;
    const φ2 = lat2 * Math.PI/180;
    const Δφ = (lat2-lat1) * Math.PI/180;
    const Δλ = (lon2-lon1) * Math.PI/180;

    const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
            Math.cos(φ1) * Math.cos(φ2) *
            Math.sin(Δλ/2) * Math.sin(Δλ/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

    return R * c; // in metres
  }

  async checkAbuseLockout(req, student_id) {
    const user = await get(`SELECT lockout_until FROM users WHERE id = ?`, [student_id]);
    if (user && user.lockout_until) {
      if (new Date() < new Date(user.lockout_until)) {
        await logAudit(req, student_id, req.user.username, 'ATTENDANCE_LOCKED', `Locked out until ${user.lockout_until}`, 'HIGH');
        throw new AppError('Account temporarily locked due to suspicious activity. Please try again later or contact the administrator.', 403);
      }
    }
  }

  async updateLockout(student_id, minutes) {
    const lockoutUntil = new Date(Date.now() + minutes * 60000).toISOString();
    await run(`UPDATE users SET lockout_until = ? WHERE id = ?`, [lockoutUntil, student_id]);
  }

  // Returns { risk_score, risk_flags, status_override }
  async assessRiskAndEvaluate(req, student_id, session_id, device_fingerprint, latitude, longitude, ip_address) {
    
    // First, check basic lockouts
    await this.checkAbuseLockout(req, student_id);

    let riskScoreDetails = 'LOW';
    let flags = [];
    let statusOverride = null;

    const session = await get(`SELECT latitude, longitude, ip_address, mode FROM attendance_sessions WHERE id = ?`, [session_id]);
    const mode = session ? session.mode : 'PHYSICAL';
    
    // Analyze Recent Devices for student across all sessions in the last 2 hours
    const recentLogs = await get(`
      SELECT COUNT(DISTINCT device_fingerprint) as deviceCount 
      FROM attendance_logs 
      WHERE student_id = ? AND timestamp >= datetime('now', '-2 hours')
      AND device_fingerprint NOT LIKE 'seeded_fp_%'
    `, [student_id]);

    if (recentLogs && recentLogs.deviceCount >= 2) {
      riskScoreDetails = 'HIGH';
      flags.push('MULTIPLE_DEVICES_DETECTED');
      statusOverride = 'REJECTED';
    }

    // Identify if the student already successfully logged into this session. (duplicate)
    // Wait, the AttendanceService duplicate check catches duplicates first. But maybe they were flagged? 

    // Device validation
    // Is this a newly introduced device fingerprint for the student?
    const hasAnyRealLogs = await get(`SELECT id FROM attendance_logs WHERE student_id = ? AND device_fingerprint NOT LIKE 'seeded_fp_%' LIMIT 1`, [student_id]);
    if (hasAnyRealLogs) {
      const previousDevice = await get(`SELECT id FROM attendance_logs WHERE student_id = ? AND device_fingerprint = ? LIMIT 1`, [student_id, device_fingerprint]);
      if (!previousDevice) {
        flags.push('NEW_DEVICE_FINGERPRINT');
        if (riskScoreDetails !== 'HIGH') riskScoreDetails = 'MEDIUM';
      }
    }

    // Network / IP validation
    if (mode === 'PHYSICAL' && session && session.ip_address && ip_address) {
      if (session.ip_address !== ip_address) {
         flags.push('MISMATCHED_NETWORK');
         // Network mismatch treated as LOW risk telemetry due to mobile data/hotspot usage
      }
    }

    // Geolocation Validation
    if (mode !== 'ONLINE' && session && session.latitude && session.longitude) {
      if (!latitude || !longitude) {
        flags.push('MISSING_GPS');
        // For HYBRID, missing GPS is a warning
        if (mode === 'HYBRID') {
          if (riskScoreDetails === 'LOW') riskScoreDetails = 'MEDIUM';
        } else {
          // PHYSICAL
          if (riskScoreDetails !== 'HIGH') riskScoreDetails = 'MEDIUM';
          statusOverride = 'REVIEW_REQUIRED';
        }
      } else {
        const distance = this.calculateDistance(latitude, longitude, session.latitude, session.longitude);
        const physicalThreshold = 200; // 200 meters
        const hybridThreshold = 5000; // 5km for "local-ish" hybrid

        const threshold = mode === 'HYBRID' ? hybridThreshold : physicalThreshold;

        if (distance > threshold) {
          flags.push('OUT_OF_BOUNDS_LOCATION');
          if (distance > threshold * 5) {
            riskScoreDetails = 'HIGH';
            statusOverride = 'FLAGGED'; // Prevent instant REJECTED to avoid lockouts on bad GPS
          } else {
            riskScoreDetails = 'MEDIUM';
            statusOverride = 'REVIEW_REQUIRED';
          }
        }
      }
    } else if (mode === 'ONLINE') {
        // For ONLINE, we strictly verify login integrity and device fingerprint
        if (riskScoreDetails === 'LOW' && flags.length === 0) {
            // All good
        }
    }

    if (riskScoreDetails === 'HIGH' && statusOverride !== 'REJECTED') {
      // E.g., multiple devices
      statusOverride = 'REVIEW_REQUIRED';
    }

    return {
      risk_score: riskScoreDetails,
      risk_flags: flags.join(','),
      status_override: statusOverride
    };
  }

}

module.exports = new SecurityService();
