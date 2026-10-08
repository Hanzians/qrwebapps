const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const speakeasy = require('speakeasy');
const qrcode = require('qrcode');
const { generateToken, authMiddleware } = require('../auth');
const { get, run, logAudit, colExists } = require('../db');

router.post('/login', async (req, res) => {
  const { username, password, totp } = req.body;
  if (!username || !password)
    return res.status(400).json({ error: 'missing_fields' });

  const hasAppUsername = await colExists('users', 'app_username');
  let user;
  if (hasAppUsername) {
    user = await get(
      `SELECT id, username, app_username, password_hash, role, full_name, year, section, totp_secret, avatar, preferences
       FROM users WHERE username = ? OR app_username = ?`,
      [username, username.toLowerCase()]
    );
  } else {
    user = await get(
      `SELECT id, username, password_hash, role, full_name, year, section, totp_secret, avatar, preferences
       FROM users WHERE username = ?`,
      [username]
    );
  }

  if (!user) {
    await logAudit(req, null, username, 'LOGIN_FAILED', 'User not found', 'WARN');
    return res.status(401).json({ error: 'invalid_credentials' });
  }

  const ok = bcrypt.compareSync(password, user.password_hash);
  if (!ok) {
    await logAudit(req, user.id, username, 'LOGIN_FAILED', 'Invalid password', 'WARN');
    return res.status(401).json({ error: 'invalid_credentials' });
  }

  // 2FA check
  if (user.totp_secret) {
    if (!totp) {
      // Prompt client for 2FA
      return res.status(200).json({ require_2fa: true });
    }
    const verified = speakeasy.totp.verify({
      secret: user.totp_secret,
      encoding: 'base32',
      token: totp,
      window: 1
    });
    if (!verified) {
      await logAudit(req, user.id, username, 'LOGIN_FAILED', 'Invalid 2FA code', 'WARN');
      return res.status(401).json({ error: 'invalid_2fa' });
    }
  }

  const token = generateToken({
    id: user.id,
    username: user.username,
    role: user.role
  });

  await logAudit(req, user.id, username, 'LOGIN_SUCCESS', 'User logged in', 'INFO');

  res.json({
    token,
    user: {
      id: user.id,
      username: user.username,
      app_username: hasAppUsername ? user.app_username : null,
      full_name: user.full_name,
      role: user.role,
      year: user.year,
      section: user.section,
      avatar: user.avatar,
      preferences: user.preferences,
      totp_enabled: !!user.totp_secret
    }
  });
});

router.post('/2fa/generate', authMiddleware, async (req, res) => {
  const secret = speakeasy.generateSecret({ name: `PUPSAS (${req.user.username})` });
  const dataURL = await qrcode.toDataURL(secret.otpauth_url);
  res.json({ secret: secret.base32, qrcode: dataURL });
});

router.post('/2fa/verify', authMiddleware, async (req, res) => {
  const { token, secret } = req.body;
  if (!token || !secret) return res.status(400).json({ error: 'missing_fields' });
  
  const verified = speakeasy.totp.verify({
    secret: secret,
    encoding: 'base32',
    token: token,
    window: 1
  });

  if (verified) {
    await run(`UPDATE users SET totp_secret = ? WHERE id = ?`, [secret, req.user.id]);
    await logAudit(req, req.user.id, req.user.username, '2FA_ENABLED', 'User enabled 2FA', 'INFO');
    res.json({ success: true });
  } else {
    res.status(400).json({ error: 'invalid_token' });
  }
});

router.post('/2fa/disable', authMiddleware, async (req, res) => {
  const { token } = req.body;
  const user = await get(`SELECT totp_secret FROM users WHERE id = ?`, [req.user.id]);
  if (!user || !user.totp_secret) return res.status(400).json({ error: 'not_enabled' });

  const verified = speakeasy.totp.verify({
    secret: user.totp_secret,
    encoding: 'base32',
    token: token,
    window: 1
  });

  if (verified) {
    await run(`UPDATE users SET totp_secret = NULL WHERE id = ?`, [req.user.id]);
    await logAudit(req, req.user.id, req.user.username, '2FA_DISABLED', 'User disabled 2FA', 'INFO');
    res.json({ success: true });
  } else {
    res.status(400).json({ error: 'invalid_token' });
  }
});

module.exports = router;
