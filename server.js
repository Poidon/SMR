// ระบบลงทะเบียนเข้าร่วมงานสัมมนา - Backend (Node.js)
// ค่าเริ่มต้น: เก็บข้อมูลลงไฟล์ JSON ในเครื่อง (data/registrations.json)
// ถ้ากำหนด DATABASE_URL จะเก็บลง PostgreSQL แทน (เช่นบน Railway)
//
// รันด้วย: node server.js
// เปิดหน้าลงทะเบียน:  http://localhost:3000
// เปิดหน้าหลังบ้าน:   http://localhost:3000/admin

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
// รหัสผ่านเข้าหน้าหลังบ้าน (กำหนดผ่าน env: ADMIN_KEY)
const ADMIN_KEY = process.env.ADMIN_KEY || 'admin123';
const DATABASE_URL = process.env.DATABASE_URL || '';
// บังคับยืนยัน OTP ก่อนลงทะเบียนหรือไม่ (ค่าเริ่มต้น: ไม่บังคับ = ลงทะเบียนตรง ๆ)
const REQUIRE_OTP = process.env.REQUIRE_OTP === 'true';
// ช่องทางส่ง OTP: 'sms' (ThaiBulkSMS/Twilio) หรือ 'email' (ค่าเริ่มต้น)
const OTP_CHANNEL = process.env.OTP_CHANNEL === 'sms' ? 'sms' : 'email';

const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'registrations.json');
const FEEDBACK_FILE = path.join(DATA_DIR, 'feedback.json');

// หัวข้อของแบบประเมินความพึงพอใจ (ให้คะแนน 1-5)
const FEEDBACK_ITEMS = [
  { key: 'content', label: 'เนื้อหาของการสัมมนา' },
  { key: 'speaker', label: 'วิทยากร / ผู้บรรยาย' },
  { key: 'organization', label: 'การจัดงานและสถานที่' },
  { key: 'benefit', label: 'ความรู้ที่ได้รับและการนำไปใช้ประโยชน์' },
  { key: 'overall', label: 'ความพึงพอใจโดยรวม' },
];
const validRating = n => Number.isInteger(n) && n >= 1 && n <= 5;

// ---------- ตัวเลือกของแต่ละหัวข้อ (ใช้ตรวจสอบให้ตรงกับฟอร์ม) ----------
const STATUSES = ['นักศึกษา', 'อาจารย์', 'บุคคลภายนอก'];
const MODES = ['On-site', 'Online'];
const CHANNELS = ['Facebook', 'Instagram', 'Line', 'เพื่อนแนะนำ', 'อาจารย์ประชาสัมพันธ์', 'อื่น ๆ'];
const EXPECTATIONS = ['ได้รับความรู้เพิ่มเติม', 'แนวทางการทำงานในอนาคต', 'แลกเปลี่ยนประสบการณ์', 'อื่น ๆ'];

// ---------- ตรวจสอบข้อมูล ----------
function validEmail(v) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v); }
function validPhone(v) { return /^[0-9]{9,10}$/.test(String(v).replace(/[\s-]/g, '')); }
const normPhone = s => String(s).replace(/[\s-]/g, '');
// แปลงค่าที่อ่านจากฐานข้อมูลให้เป็น array (รองรับทั้ง array, JSON string, และค่าเดี่ยวแบบเก่า)
function toArray(v) {
  if (Array.isArray(v)) return v;
  if (v == null || v === '') return [];
  try { const p = JSON.parse(v); return Array.isArray(p) ? p : (v ? [String(v)] : []); }
  catch { return [String(v)]; }
}
const MAX_TEXT = 2000; // จำกัดความยาวข้อความยาว ๆ
const genToken = () => require('crypto').randomBytes(16).toString('hex');
const attLabel = a => a === 'yes' ? 'มา' : a === 'no' ? 'ไม่มา' : 'ยังไม่ระบุ';

// ---------- อีเมล (เตรียมระบบไว้ ยังไม่ต้องผูก provider ก็ได้) ----------
// ตั้งค่าเปิดใช้งานจริงภายหลังผ่าน env: RESEND_API_KEY, EMAIL_FROM, PUBLIC_URL
function buildRsvpEmail(rec, baseUrl) {
  const base = String(baseUrl).replace(/\/+$/, ''); // ตัด / ท้ายกัน // ในลิงก์
  const link = `${base}/rsvp?token=${rec.rsvpToken}`;
  const subject = 'ยืนยันการเข้าร่วมงานสัมมนา THINK WITH DATA, DECIDE WITH AI';
  const html = `<div style="font-family:'Segoe UI',sans-serif;line-height:1.7;color:#1e293b;max-width:520px;margin:auto">
    <h2 style="color:#4338ca">เรียน คุณ${rec.fullName}</h2>
    <p>ขอบคุณที่ลงทะเบียนเข้าร่วมงานสัมมนา <b>THINK WITH DATA, DECIDE WITH AI</b><br>
    วันที่ 3 เมษายน 2569 เวลา 13:00–16:00 ณ Siam University (Building 19, Hall Of Fame)</p>
    <p>กรุณายืนยันการเข้าร่วมของท่านโดยคลิกปุ่มด้านล่าง:</p>
    <p><a href="${link}" style="display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;padding:12px 26px;border-radius:10px;font-weight:bold">ยืนยันการเข้าร่วม (มา / ไม่มา)</a></p>
    <p style="color:#64748b;font-size:13px">หากปุ่มกดไม่ได้ ให้คัดลอกลิงก์นี้ไปเปิดในเบราว์เซอร์:<br>${link}</p>
  </div>`;
  const text = `เรียน คุณ${rec.fullName}\nกรุณายืนยันการเข้าร่วมงานสัมมนา: ${link}`;
  return { subject, html, text };
}
// ตั้งค่าอีเมลไว้แล้วหรือยัง (Brevo / Gmail SMTP / Resend)
function emailConfigured() {
  return !!process.env.BREVO_API_KEY
    || !!(process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD)
    || !!process.env.RESEND_API_KEY;
}
async function sendEmail(to, subject, html, text) {
  // 1) Brevo (HTTP API — ฟรี ไม่ต้องมีโดเมน ใช้ verified single sender; ไม่โดน Render บล็อก)
  if (process.env.BREVO_API_KEY) {
    try {
      const from = process.env.EMAIL_FROM || process.env.GMAIL_USER || '';
      const r = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: { 'api-key': process.env.BREVO_API_KEY, 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({
          sender: { email: from, name: 'ลงทะเบียนงานสัมมนา' },
          to: [{ email: to }],
          subject, htmlContent: html, textContent: text || subject,
        }),
      });
      if (!r.ok) {
        const t = await r.text().catch(() => '');
        console.error('❌ Brevo ส่งไม่สำเร็จ:', r.status, t.slice(0, 300));
        return { sent: false, reason: 'Brevo ' + r.status + (t ? ' ' + t.slice(0, 160) : '') };
      }
      return { sent: true, provider: 'brevo' };
    } catch (e) { console.error('❌ Brevo error:', e && e.message); return { sent: false, reason: 'เชื่อมต่อ Brevo ไม่ได้' }; }
  }
  // 2) Gmail SMTP (มักใช้ไม่ได้บน Render เพราะ SMTP ถูกบล็อก)
  if (process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD) {
    try {
      const nodemailer = require('nodemailer');
      const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD },
        connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000, // กันค้างถ้าพอร์ต SMTP ถูกบล็อก
      });
      await transporter.sendMail({
        from: process.env.EMAIL_FROM || process.env.GMAIL_USER,
        to, subject, html, text,
      });
      return { sent: true, provider: 'gmail' };
    } catch (e) {
      console.error('❌ Gmail ส่งไม่สำเร็จ:', (e && e.message) || e);
      return { sent: false, reason: 'ส่งผ่าน Gmail ไม่สำเร็จ: ' + (e && e.message) };
    }
  }
  // 2) Resend (ต้อง verify โดเมน)
  if (process.env.RESEND_API_KEY) {
    try {
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: process.env.EMAIL_FROM || 'onboarding@resend.dev', to: [to], subject, html, text }),
      });
      if (!r.ok) return { sent: false, reason: 'ส่งไม่สำเร็จ (Resend ' + r.status + ')' };
      return { sent: true, provider: 'resend' };
    } catch { return { sent: false, reason: 'เชื่อมต่อผู้ให้บริการอีเมลไม่ได้' }; }
  }
  // TODO: เพิ่ม SendGrid / SMTP ได้ที่นี่ในอนาคต
  return { sent: false, reason: 'ยังไม่ได้ตั้งค่าการส่งอีเมล (ยังไม่มี provider)' };
}
// ส่งอีเมลยืนยันแบบอัตโนมัติ (เรียกแบบไม่บล็อก; ถ้ายังไม่ตั้ง provider จะไม่ส่ง)
async function autoSendRsvp(rec, req) {
  if (process.env.AUTO_EMAIL === 'false') return;        // ปิดการส่งอัตโนมัติได้ด้วย env
  const proto = req.headers['x-forwarded-proto'] || 'http';
  const baseUrl = process.env.PUBLIC_URL || `${proto}://${req.headers.host}`;
  const { subject, html, text } = buildRsvpEmail(rec, baseUrl);
  const result = await sendEmail(rec.email, subject, html, text);
  if (result.sent) { try { await store.markEmailSent(rec.id); } catch {} }
  else console.error('❌ อีเมลยืนยันไม่ถูกส่ง:', result.reason);
}

// ---------- OTP ยืนยันเบอร์โทร (เก็บชั่วคราวในหน่วยความจำ) ----------
const otpStore = new Map();       // phone_norm -> { code, expires, attempts }
const verifiedStore = new Map();  // phone_norm -> { token, expires }
const OTP_TTL = 5 * 60 * 1000;    // รหัสหมดอายุใน 5 นาที
const VERIFIED_TTL = 30 * 60 * 1000; // ยืนยันแล้วใช้ได้ 30 นาที
const genOtp = () => String(Math.floor(100000 + Math.random() * 900000));

// ตั้งค่า SMS ไว้แล้วหรือยัง (ThaiBulkSMS หรือ Twilio)
function smsConfigured() {
  return !!(process.env.THAIBULKSMS_KEY && process.env.THAIBULKSMS_SECRET && process.env.THAIBULKSMS_SENDER)
    || !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && (process.env.TWILIO_FROM || process.env.TWILIO_MESSAGING_SERVICE_SID));
}
async function sendSms(phone, message) {
  // 1) ThaiBulkSMS (HTTP API — ส่งเข้าเบอร์ไทย ไม่โดน Render บล็อก)
  if (process.env.THAIBULKSMS_KEY && process.env.THAIBULKSMS_SECRET && process.env.THAIBULKSMS_SENDER) {
    try {
      const auth = Buffer.from(`${process.env.THAIBULKSMS_KEY}:${process.env.THAIBULKSMS_SECRET}`).toString('base64');
      const body = new URLSearchParams({
        msisdn: phone, message, sender: process.env.THAIBULKSMS_SENDER,
        force: process.env.THAIBULKSMS_TYPE || 'standard',
      });
      const r = await fetch('https://api-v2.thaibulksms.com/sms', {
        method: 'POST',
        headers: { Authorization: 'Basic ' + auth, 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
        body,
      });
      if (!r.ok) {
        const t = await r.text().catch(() => '');
        console.error('❌ ThaiBulkSMS ส่งไม่สำเร็จ:', r.status, t.slice(0, 200));
        return { sent: false, configured: true, reason: 'ThaiBulkSMS ' + r.status + (t ? ' ' + t.slice(0, 140) : '') };
      }
      return { sent: true, configured: true };
    } catch (e) { console.error('❌ ThaiBulkSMS error:', e && e.message); return { sent: false, configured: true, reason: 'เชื่อมต่อ ThaiBulkSMS ไม่ได้' }; }
  }
  // 2) Twilio (ทางเลือกสำรอง)
  const SID = process.env.TWILIO_ACCOUNT_SID, TOKEN = process.env.TWILIO_AUTH_TOKEN;
  const FROM = process.env.TWILIO_FROM, MSID = process.env.TWILIO_MESSAGING_SERVICE_SID;
  if (SID && TOKEN && (FROM || MSID)) {
    try {
      const to = /^0\d{8,9}$/.test(phone) ? '+66' + phone.slice(1) : phone; // เบอร์ไทย 0xxxxxxxxx → +66
      const params = { To: to, Body: message };
      if (MSID) params.MessagingServiceSid = MSID; else params.From = FROM;
      const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${SID}/Messages.json`, {
        method: 'POST',
        headers: { Authorization: 'Basic ' + Buffer.from(`${SID}:${TOKEN}`).toString('base64'),
          'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(params),
      });
      if (!r.ok) { console.error('❌ Twilio ส่งไม่สำเร็จ:', r.status); return { sent: false, configured: true, reason: 'Twilio ' + r.status }; }
      return { sent: true, configured: true };
    } catch { return { sent: false, configured: true, reason: 'เชื่อมต่อ Twilio ไม่ได้' }; }
  }
  return { sent: false, configured: false };
}
// normalize คีย์ OTP: อีเมล → ตัวพิมพ์เล็ก, เบอร์ → ตัดอักขระ (มี @ = อีเมล)
function otpNorm(v) { v = String(v || '').trim(); return v.includes('@') ? v.toLowerCase() : normPhone(v); }
function verifyOtpToken(id, token) {
  const v = verifiedStore.get(otpNorm(id));
  return !!(v && token && v.token === token && Date.now() <= v.expires);
}
function buildOtpEmail(code) {
  const subject = 'รหัสยืนยัน (OTP) ลงทะเบียนงานสัมมนา';
  const html = `<div style="font-family:'Segoe UI',sans-serif;line-height:1.7;color:#1e293b;max-width:480px;margin:auto">
    <h2 style="color:#4338ca">รหัสยืนยันการลงทะเบียน</h2>
    <p>รหัส OTP สำหรับลงทะเบียนงานสัมมนา THINK WITH DATA, DECIDE WITH AI ของคุณคือ</p>
    <p style="font-size:34px;font-weight:800;letter-spacing:8px;color:#c6981f;margin:14px 0">${code}</p>
    <p style="color:#64748b;font-size:13px">รหัสนี้หมดอายุใน 5 นาที · หากคุณไม่ได้ทำรายการนี้ กรุณาเพิกเฉยต่ออีเมลฉบับนี้</p>
  </div>`;
  const text = `รหัส OTP ลงทะเบียนงานสัมมนา: ${code} (หมดอายุใน 5 นาที)`;
  return { subject, html, text };
}

// ---------- ชั้นเก็บข้อมูล: PostgreSQL ----------
function createPgStore(url) {
  const { Pool } = require('pg');
  // เปิด SSL อัตโนมัติเมื่อต่อฐานข้อมูลที่ไม่ใช่ในเครื่อง (เช่น Render/Railway ที่บังคับ SSL)
  // บังคับเปิด/ปิดเองได้ด้วย env PGSSL=true/false
  const isLocal = /@(localhost|127\.0\.0\.1)/.test(url);
  const useSSL = process.env.PGSSL === 'true' ? true
    : process.env.PGSSL === 'false' ? false
    : (/sslmode=require/.test(url) || !isLocal);
  const pool = new Pool({
    connectionString: url,
    ssl: useSSL ? { rejectUnauthorized: false } : false,
  });

  const mapRow = r => ({
    id: r.id,
    fullName: r.full_name,
    studentId: r.student_id || '',
    institution: r.institution,
    yearLevel: r.year_level || '',
    email: r.email,
    phone: r.phone,
    status: r.status,
    attendMode: r.attend_mode,
    heardFrom: toArray(r.heard_from),
    heardFromOther: r.heard_from_other || '',
    expectations: Array.isArray(r.expectations) ? r.expectations.join(', ') : (r.expectations == null ? '' : String(r.expectations)),
    expectationsOther: r.expectations_other || '',
    questions: r.questions || '',
    nameEnglish: r.name_english,
    consentMedia: !!r.consent_media,
    consentData: !!r.consent_data,
    attendance: r.attendance || '',
    absenceReason: r.absence_reason || '',
    attendanceSource: r.attendance_source || '',
    rsvpToken: r.rsvp_token || '',
    rsvpAt: r.rsvp_at ? ((r.rsvp_at instanceof Date) ? r.rsvp_at.toISOString() : r.rsvp_at) : null,
    emailSentAt: r.email_sent_at ? ((r.email_sent_at instanceof Date) ? r.email_sent_at.toISOString() : r.email_sent_at) : null,
    createdAt: (r.created_at instanceof Date) ? r.created_at.toISOString() : r.created_at,
  });

  return {
    async init() {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS seminar_registrations (
          id                 TEXT PRIMARY KEY,
          full_name          TEXT NOT NULL,
          student_id         TEXT,
          institution        TEXT NOT NULL,
          year_level         TEXT,
          email              TEXT NOT NULL,
          phone              TEXT NOT NULL,
          phone_norm         TEXT NOT NULL,
          status             TEXT NOT NULL,
          attend_mode        TEXT NOT NULL,
          heard_from         TEXT,
          heard_from_other   TEXT,
          expectations       JSONB,
          expectations_other TEXT,
          questions          TEXT,
          name_english       TEXT NOT NULL,
          consent_media      BOOLEAN NOT NULL DEFAULT FALSE,
          consent_data       BOOLEAN NOT NULL DEFAULT FALSE,
          attendance         TEXT NOT NULL DEFAULT '',
          absence_reason     TEXT,
          attendance_source  TEXT,
          rsvp_token         TEXT,
          rsvp_at            TIMESTAMPTZ,
          email_sent_at      TIMESTAMPTZ,
          created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
        )`);
      // เผื่อตารางเดิมยังไม่มีคอลัมน์ที่เพิ่มภายหลัง
      await pool.query(`ALTER TABLE seminar_registrations ADD COLUMN IF NOT EXISTS attendance TEXT NOT NULL DEFAULT ''`);
      await pool.query(`ALTER TABLE seminar_registrations ADD COLUMN IF NOT EXISTS absence_reason TEXT`);
      await pool.query(`ALTER TABLE seminar_registrations ADD COLUMN IF NOT EXISTS attendance_source TEXT`);
      await pool.query(`ALTER TABLE seminar_registrations ADD COLUMN IF NOT EXISTS rsvp_token TEXT`);
      await pool.query(`ALTER TABLE seminar_registrations ADD COLUMN IF NOT EXISTS rsvp_at TIMESTAMPTZ`);
      await pool.query(`ALTER TABLE seminar_registrations ADD COLUMN IF NOT EXISTS email_sent_at TIMESTAMPTZ`);
      // กันอีเมล/เบอร์โทรซ้ำระดับฐานข้อมูล (กันกรณีลงทะเบียนพร้อมกัน)
      await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS uniq_sem_email
        ON seminar_registrations (lower(email))`);
      await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS uniq_sem_phone
        ON seminar_registrations (phone_norm)`);
      await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS uniq_sem_token
        ON seminar_registrations (rsvp_token)`);
      // ตารางแบบประเมินความพึงพอใจ (ไม่ระบุตัวตน)
      await pool.query(`
        CREATE TABLE IF NOT EXISTS seminar_feedback (
          id           TEXT PRIMARY KEY,
          content      INT, speaker INT, organization INT, benefit INT, overall INT,
          suggestions  TEXT, topics TEXT,
          created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
        )`);
    },
    async all() {
      const { rows } = await pool.query(
        `SELECT * FROM seminar_registrations ORDER BY created_at ASC`);
      return rows.map(mapRow);
    },
    async emailExists(email) {
      const { rows } = await pool.query(
        `SELECT 1 FROM seminar_registrations WHERE lower(email)=lower($1) LIMIT 1`, [email]);
      return rows.length > 0;
    },
    async phoneExists(phone) {
      const { rows } = await pool.query(
        `SELECT 1 FROM seminar_registrations WHERE phone_norm=$1 LIMIT 1`, [normPhone(phone)]);
      return rows.length > 0;
    },
    async insert(rec) {
      await pool.query(
        `INSERT INTO seminar_registrations
          (id, full_name, student_id, institution, year_level, email, phone, phone_norm,
           status, attend_mode, heard_from, heard_from_other, expectations, expectations_other,
           questions, name_english, consent_media, consent_data, created_at, rsvp_token)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
        [rec.id, rec.fullName, rec.studentId, rec.institution, rec.yearLevel, rec.email, rec.phone,
         normPhone(rec.phone), rec.status, rec.attendMode, JSON.stringify(rec.heardFrom), rec.heardFromOther,
         JSON.stringify(rec.expectations), rec.expectationsOther, rec.questions, rec.nameEnglish,
         rec.consentMedia, rec.consentData, rec.createdAt, rec.rsvpToken]);
    },
    async getById(id) {
      const { rows } = await pool.query(`SELECT * FROM seminar_registrations WHERE id=$1 LIMIT 1`, [id]);
      return rows[0] ? mapRow(rows[0]) : null;
    },
    async getByToken(token) {
      const { rows } = await pool.query(`SELECT * FROM seminar_registrations WHERE rsvp_token=$1 LIMIT 1`, [token]);
      return rows[0] ? mapRow(rows[0]) : null;
    },
    async setAttendance(id, attendance, reason, source) {
      const { rowCount } = await pool.query(
        `UPDATE seminar_registrations
           SET attendance=$2, absence_reason=$3, attendance_source=$4,
               rsvp_at = CASE WHEN $4='self' THEN now() ELSE rsvp_at END
         WHERE id=$1`, [id, attendance, reason, source]);
      return rowCount > 0;
    },
    async setAttendanceByToken(token, attendance, reason) {
      const { rows } = await pool.query(
        `UPDATE seminar_registrations
           SET attendance=$2, absence_reason=$3, attendance_source='self', rsvp_at=now()
         WHERE rsvp_token=$1 RETURNING id`, [token, attendance, reason]);
      return rows.length > 0;
    },
    async markEmailSent(id) {
      await pool.query(`UPDATE seminar_registrations SET email_sent_at=now() WHERE id=$1`, [id]);
    },
    async remove(id) {
      await pool.query(`DELETE FROM seminar_registrations WHERE id=$1`, [id]);
      const { rows } = await pool.query(`SELECT COUNT(*)::int AS c FROM seminar_registrations`);
      return rows[0].c;
    },
    async clearRegistrations() { await pool.query(`DELETE FROM seminar_registrations`); },
    async clearFeedback() { await pool.query(`DELETE FROM seminar_feedback`); },
    // ---- แบบประเมินความพึงพอใจ ----
    async insertFeedback(rec) {
      await pool.query(
        `INSERT INTO seminar_feedback (id, content, speaker, organization, benefit, overall, suggestions, topics, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [rec.id, rec.content, rec.speaker, rec.organization, rec.benefit, rec.overall, rec.suggestions, rec.topics, rec.createdAt]);
    },
    async allFeedback() {
      const { rows } = await pool.query(`SELECT * FROM seminar_feedback ORDER BY created_at ASC`);
      return rows.map(r => ({
        id: r.id, content: r.content, speaker: r.speaker, organization: r.organization,
        benefit: r.benefit, overall: r.overall, suggestions: r.suggestions || '', topics: r.topics || '',
        createdAt: (r.created_at instanceof Date) ? r.created_at.toISOString() : r.created_at,
      }));
    },
  };
}

// ---------- ชั้นเก็บข้อมูล: ไฟล์ JSON (ค่าเริ่มต้น สำหรับเก็บในเครื่อง) ----------
function createFileStore() {
  function ensure() {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, '[]', 'utf8');
  }
  function read() { try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')) || []; } catch { return []; } }
  function write(list) { fs.writeFileSync(DATA_FILE, JSON.stringify(list, null, 2), 'utf8'); }
  return {
    async init() { ensure(); },
    async all() { return read(); },
    async emailExists(email) { return read().some(r => r.email.toLowerCase() === email.toLowerCase()); },
    async phoneExists(phone) { return read().some(r => normPhone(r.phone) === normPhone(phone)); },
    async insert(rec) { const l = read(); l.push(rec); write(l); },
    async getById(id) { return read().find(r => r.id === id) || null; },
    async getByToken(token) { return read().find(r => r.rsvpToken === token) || null; },
    async setAttendance(id, attendance, reason, source) {
      const l = read(); const r = l.find(x => x.id === id); if (!r) return false;
      r.attendance = attendance; r.absenceReason = reason; r.attendanceSource = source;
      if (source === 'self') r.rsvpAt = new Date().toISOString();
      write(l); return true;
    },
    async setAttendanceByToken(token, attendance, reason) {
      const l = read(); const r = l.find(x => x.rsvpToken === token); if (!r) return false;
      r.attendance = attendance; r.absenceReason = reason; r.attendanceSource = 'self'; r.rsvpAt = new Date().toISOString();
      write(l); return true;
    },
    async markEmailSent(id) {
      const l = read(); const r = l.find(x => x.id === id); if (r) { r.emailSentAt = new Date().toISOString(); write(l); }
    },
    async remove(id) { const l = read().filter(r => r.id !== id); write(l); return l.length; },
    async clearRegistrations() { write([]); },
    async clearFeedback() { fs.writeFileSync(FEEDBACK_FILE, '[]', 'utf8'); },
    // ---- แบบประเมินความพึงพอใจ ----
    async insertFeedback(rec) {
      let l = []; try { l = JSON.parse(fs.readFileSync(FEEDBACK_FILE, 'utf8')) || []; } catch {}
      l.push(rec); fs.writeFileSync(FEEDBACK_FILE, JSON.stringify(l, null, 2), 'utf8');
    },
    async allFeedback() {
      try { return JSON.parse(fs.readFileSync(FEEDBACK_FILE, 'utf8')) || []; } catch { return []; }
    },
  };
}

let store; // ถูกกำหนดค่าตอนเริ่มเซิร์ฟเวอร์

// ---------- ตัวช่วย HTTP ----------
function sendJson(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', c => {
      data += c;
      if (data.length > 4e6) { reject(new Error('payload too large')); req.destroy(); }
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}
function serveFile(res, filePath, contentType) {
  fs.readFile(filePath, (err, buf) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(buf);
  });
}
function isAuthed(req, url) {
  const key = req.headers['x-admin-key'] || url.searchParams.get('key');
  return key === ADMIN_KEY;
}
function csvEscape(v) { return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"'; }
const clip = (s, n = MAX_TEXT) => String(s == null ? '' : s).trim().slice(0, n);

// ---------- Router ----------
const server = http.createServer(async (req, res) => {
  try {
    // แก้กรณี URL ขึ้นต้นด้วย // (จะถูกตีความเป็น host) แล้วรวมสแลชซ้อนใน path ให้ route ตรงเสมอ
    const url = new URL(req.url.replace(/^\/{2,}/, '/'), `http://${req.headers.host}`);
    const p = url.pathname.replace(/\/{2,}/g, '/');

    // --- API: ลงทะเบียน ---
    if (req.method === 'POST' && p === '/api/register') {
      const body = await readBody(req);
      let data;
      try { data = JSON.parse(body); } catch { return sendJson(res, 400, { ok: false, error: 'รูปแบบข้อมูลไม่ถูกต้อง' }); }

      const fullName = clip(data.fullName, 200);
      const studentId = clip(data.studentId, 50);
      const institution = clip(data.institution, 300);
      const yearLevel = clip(data.yearLevel, 50);
      const email = clip(data.email, 200);
      const phone = clip(data.phone, 30);
      const status = clip(data.status, 50);
      const attendMode = clip(data.attendMode, 30);
      let heardFrom = Array.isArray(data.heardFrom) ? data.heardFrom.map(x => clip(x, 50))
        : (data.heardFrom ? [clip(data.heardFrom, 50)] : []);
      heardFrom = heardFrom.filter(x => CHANNELS.includes(x));
      const heardFromOther = clip(data.heardFromOther, 300);
      const expectations = clip(data.expectations);   // ข้อ 10 เป็นข้อความอิสระ
      const expectationsOther = '';
      const questions = clip(data.questions);
      const nameEnglish = clip(data.nameEnglish, 200);
      const consentMedia = data.consentMedia === true;
      const consentData = data.consentData === true;

      // ตรวจสอบข้อมูลที่จำเป็น
      if (!fullName) return sendJson(res, 400, { ok: false, error: 'กรุณากรอกชื่อ-นามสกุล' });
      if (!institution) return sendJson(res, 400, { ok: false, error: 'กรุณากรอกมหาวิทยาลัย / คณะ / สาขา' });
      if (!validEmail(email)) return sendJson(res, 400, { ok: false, error: 'อีเมลไม่ถูกต้อง' });
      if (!validPhone(phone)) return sendJson(res, 400, { ok: false, error: 'เบอร์โทรไม่ถูกต้อง (9-10 หลัก)' });
      if (REQUIRE_OTP && !verifyOtpToken(OTP_CHANNEL === 'sms' ? phone : email, String(data.otpToken || ''))) {
        return sendJson(res, 403, { ok: false, error: (OTP_CHANNEL === 'sms' ? 'กรุณายืนยันเบอร์โทร' : 'กรุณายืนยันอีเมล') + 'ด้วยรหัส OTP ก่อนลงทะเบียน' });
      }
      if (!STATUSES.includes(status)) return sendJson(res, 400, { ok: false, error: 'กรุณาเลือกสถานะผู้เข้าร่วม' });
      if (!MODES.includes(attendMode)) return sendJson(res, 400, { ok: false, error: 'กรุณาเลือกรูปแบบการเข้าร่วม' });
      if (!nameEnglish) return sendJson(res, 400, { ok: false, error: 'กรุณากรอกชื่อ-นามสกุล (ภาษาอังกฤษ) สำหรับออกเกียรติบัตร' });
      if (!consentMedia) return sendJson(res, 400, { ok: false, error: 'กรุณายินยอมให้บันทึกภาพ/วิดีโอภายในงาน' });
      if (!consentData) return sendJson(res, 400, { ok: false, error: 'กรุณายินยอมให้เก็บข้อมูลเพื่อใช้ในการจัดกิจกรรม' });

      if (await store.emailExists(email)) return sendJson(res, 409, { ok: false, error: 'อีเมลนี้ถูกใช้ลงทะเบียนแล้ว', field: 'email' });
      if (await store.phoneExists(phone)) return sendJson(res, 409, { ok: false, error: 'เบอร์โทรนี้ถูกใช้ลงทะเบียนแล้ว', field: 'phone' });

      const record = {
        id: Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36),
        fullName, studentId, institution, yearLevel, email, phone,
        status, attendMode, heardFrom, heardFromOther,
        expectations, expectationsOther, questions, nameEnglish,
        consentMedia, consentData,
        attendance: '', absenceReason: '', attendanceSource: '',
        rsvpToken: genToken(), rsvpAt: null, emailSentAt: null,
        createdAt: new Date().toISOString(),
      };
      try {
        await store.insert(record);
      } catch (e) {
        if (e && e.code === '23505') { // unique violation (ลงพร้อมกันพอดี)
          const isPhone = /phone/.test(e.constraint || '');
          return sendJson(res, 409, isPhone
            ? { ok: false, error: 'เบอร์โทรนี้ถูกใช้ลงทะเบียนแล้ว', field: 'phone' }
            : { ok: false, error: 'อีเมลนี้ถูกใช้ลงทะเบียนแล้ว', field: 'email' });
        }
        throw e;
      }
      verifiedStore.delete(otpNorm(OTP_CHANNEL === 'sms' ? phone : email)); // ใช้สิทธิ์ OTP แล้ว ป้องกันนำ token ไปใช้ซ้ำ
      // ส่งอีเมลยืนยันอัตโนมัติ (ไม่บล็อกการตอบกลับ; ไม่ให้ error ของเมลกระทบการลงทะเบียน)
      autoSendRsvp(record, req).catch(e => console.error('ส่งอีเมลอัตโนมัติไม่สำเร็จ:', e && e.message));
      const total = (await store.all()).length;
      return sendJson(res, 201, { ok: true, id: record.id, total });
    }

    // --- API: ตรวจว่าอีเมล/เบอร์ซ้ำไหม (เรียกตอนกรอกฟอร์ม) ---
    if (req.method === 'GET' && p === '/api/check') {
      const email = String(url.searchParams.get('email') || '').trim();
      const phone = String(url.searchParams.get('phone') || '').trim();
      const emailTaken = email ? await store.emailExists(email) : false;
      const phoneTaken = phone ? await store.phoneExists(phone) : false;
      return sendJson(res, 200, { ok: true, emailTaken, phoneTaken });
    }

    // --- API: ค่าตั้งค่าสำหรับหน้าเว็บ (เช่น บังคับ OTP ไหม) ---
    if (req.method === 'GET' && p === '/api/config') {
      return sendJson(res, 200, { ok: true, requireOtp: REQUIRE_OTP, otpChannel: OTP_CHANNEL });
    }

    // --- API: ขอรหัส OTP (ทางอีเมลหรือ SMS ตาม OTP_CHANNEL) ---
    if (req.method === 'POST' && p === '/api/otp/request') {
      const body = await readBody(req);
      let d; try { d = JSON.parse(body); } catch { return sendJson(res, 400, { ok: false, error: 'ข้อมูลไม่ถูกต้อง' }); }
      const id = clip(d.identifier, 200);
      const code = genOtp();

      if (OTP_CHANNEL === 'sms') {
        if (!validPhone(id)) return sendJson(res, 400, { ok: false, error: 'เบอร์โทรไม่ถูกต้อง (9-10 หลัก)' });
        if (await store.phoneExists(id)) return sendJson(res, 409, { ok: false, error: 'เบอร์นี้ถูกใช้ลงทะเบียนแล้ว' });
        otpStore.set(otpNorm(id), { code, expires: Date.now() + OTP_TTL, attempts: 0 });
        const r = await sendSms(id, `รหัส OTP ลงทะเบียนงานสัมมนา: ${code} (หมดอายุใน 5 นาที)`);
        if (r.sent) return sendJson(res, 200, { ok: true, sent: true });
        if (smsConfigured()) { console.error('❌ ส่ง OTP (SMS) ไม่สำเร็จ:', r.reason); return sendJson(res, 502, { ok: false, error: 'ส่ง SMS ไม่สำเร็จ: ' + (r.reason || 'ไม่ทราบสาเหตุ') }); }
        return sendJson(res, 200, { ok: true, sent: false, devCode: code });
      }

      // email (ค่าเริ่มต้น)
      if (!validEmail(id)) return sendJson(res, 400, { ok: false, error: 'อีเมลไม่ถูกต้อง' });
      if (await store.emailExists(id)) return sendJson(res, 409, { ok: false, error: 'อีเมลนี้ถูกใช้ลงทะเบียนแล้ว' });
      otpStore.set(otpNorm(id), { code, expires: Date.now() + OTP_TTL, attempts: 0 });
      const { subject, html, text } = buildOtpEmail(code);
      const r = await sendEmail(id, subject, html, text);
      if (r.sent) return sendJson(res, 200, { ok: true, sent: true });
      if (emailConfigured()) { console.error('❌ ส่ง OTP ไม่สำเร็จ:', r.reason); return sendJson(res, 502, { ok: false, error: 'ส่งอีเมลไม่สำเร็จ: ' + (r.reason || 'ไม่ทราบสาเหตุ') }); }
      return sendJson(res, 200, { ok: true, sent: false, devCode: code }); // โหมดทดสอบ: ยังไม่ตั้งค่า provider
    }

    // --- API: ยืนยันรหัส OTP ---
    if (req.method === 'POST' && p === '/api/otp/verify') {
      const body = await readBody(req);
      let d; try { d = JSON.parse(body); } catch { return sendJson(res, 400, { ok: false, error: 'ข้อมูลไม่ถูกต้อง' }); }
      const id = clip(d.identifier, 200);
      const code = String(d.code || '').trim();
      const key = otpNorm(id);
      const rec = otpStore.get(key);
      if (!rec || Date.now() > rec.expires) { otpStore.delete(key); return sendJson(res, 400, { ok: false, error: 'รหัสหมดอายุ กรุณาขอรหัสใหม่' }); }
      rec.attempts++;
      if (rec.attempts > 5) { otpStore.delete(key); return sendJson(res, 429, { ok: false, error: 'ยืนยันผิดหลายครั้ง กรุณาขอรหัสใหม่' }); }
      if (code !== rec.code) return sendJson(res, 400, { ok: false, error: 'รหัส OTP ไม่ถูกต้อง' });
      otpStore.delete(key);
      const token = genToken();
      verifiedStore.set(key, { token, expires: Date.now() + VERIFIED_TTL });
      return sendJson(res, 200, { ok: true, token, identifier: id });
    }

    // --- API: ดึงรายชื่อทั้งหมด (ต้องมีรหัสผ่าน) ---
    if (req.method === 'GET' && p === '/api/registrations') {
      if (!isAuthed(req, url)) return sendJson(res, 401, { ok: false, error: 'รหัสผ่านไม่ถูกต้อง' });
      return sendJson(res, 200, { ok: true, data: await store.all() });
    }

    // --- API: ล้างรายชื่อผู้ลงทะเบียนทั้งหมด (ต้องมีรหัสผ่าน) ---
    if (req.method === 'DELETE' && p === '/api/registrations') {
      if (!isAuthed(req, url)) return sendJson(res, 401, { ok: false, error: 'รหัสผ่านไม่ถูกต้อง' });
      await store.clearRegistrations();
      return sendJson(res, 200, { ok: true, total: 0 });
    }

    // --- API: ล้างผลแบบประเมินทั้งหมด (ต้องมีรหัสผ่าน) ---
    if (req.method === 'DELETE' && p === '/api/feedback') {
      if (!isAuthed(req, url)) return sendJson(res, 401, { ok: false, error: 'รหัสผ่านไม่ถูกต้อง' });
      await store.clearFeedback();
      return sendJson(res, 200, { ok: true });
    }

    // --- API: ลบทีละรายการ (ต้องมีรหัสผ่าน) ---
    if (req.method === 'DELETE' && p.startsWith('/api/registrations/')) {
      if (!isAuthed(req, url)) return sendJson(res, 401, { ok: false, error: 'รหัสผ่านไม่ถูกต้อง' });
      const id = decodeURIComponent(p.split('/').pop());
      const total = await store.remove(id);
      return sendJson(res, 200, { ok: true, total });
    }

    // --- API: ข้อมูลสำหรับหน้า RSVP (สาธารณะ ใช้ token) ---
    if (req.method === 'GET' && p === '/api/rsvp') {
      const token = String(url.searchParams.get('token') || '').trim();
      const rec = token ? await store.getByToken(token) : null;
      if (!rec) return sendJson(res, 404, { ok: false, error: 'ลิงก์ไม่ถูกต้องหรือหมดอายุ' });
      return sendJson(res, 200, {
        ok: true, fullName: rec.fullName,
        attendance: rec.attendance || '', absenceReason: rec.absenceReason || '',
      });
    }

    // --- API: ผู้ลงทะเบียนยืนยันการเข้าร่วมเอง (สาธารณะ ใช้ token) ---
    if (req.method === 'POST' && p === '/api/rsvp') {
      const body = await readBody(req);
      let d; try { d = JSON.parse(body); } catch { return sendJson(res, 400, { ok: false, error: 'ข้อมูลไม่ถูกต้อง' }); }
      const token = String(d.token || '').trim();
      const attendance = (d.attendance === 'yes' || d.attendance === 'no') ? d.attendance : '';
      const reason = attendance === 'no' ? clip(d.absenceReason, 500) : '';
      if (!token) return sendJson(res, 400, { ok: false, error: 'ลิงก์ไม่ถูกต้อง' });
      if (!attendance) return sendJson(res, 400, { ok: false, error: 'กรุณาเลือกว่าจะเข้าร่วมหรือไม่' });
      const ok = await store.setAttendanceByToken(token, attendance, reason);
      if (!ok) return sendJson(res, 404, { ok: false, error: 'ลิงก์ไม่ถูกต้องหรือหมดอายุ' });
      return sendJson(res, 200, { ok: true });
    }

    // --- API: แอดมินมาร์คสถานะการเข้าร่วม (ต้องมีรหัสผ่าน) ---
    if (req.method === 'POST' && p.startsWith('/api/attendance/')) {
      if (!isAuthed(req, url)) return sendJson(res, 401, { ok: false, error: 'รหัสผ่านไม่ถูกต้อง' });
      const id = decodeURIComponent(p.split('/').pop());
      const body = await readBody(req);
      let d; try { d = JSON.parse(body); } catch { return sendJson(res, 400, { ok: false, error: 'ข้อมูลไม่ถูกต้อง' }); }
      const attendance = (d.attendance === 'yes' || d.attendance === 'no') ? d.attendance : '';
      const reason = attendance === 'no' ? clip(d.absenceReason, 500) : '';
      const ok = await store.setAttendance(id, attendance, reason, 'admin');
      if (!ok) return sendJson(res, 404, { ok: false, error: 'ไม่พบรายการนี้' });
      return sendJson(res, 200, { ok: true });
    }

    // --- API: ส่งอีเมลเชิญยืนยัน (ต้องมีรหัสผ่าน) ---
    if (req.method === 'POST' && p.startsWith('/api/send-email/')) {
      if (!isAuthed(req, url)) return sendJson(res, 401, { ok: false, error: 'รหัสผ่านไม่ถูกต้อง' });
      const id = decodeURIComponent(p.split('/').pop());
      const rec = await store.getById(id);
      if (!rec) return sendJson(res, 404, { ok: false, error: 'ไม่พบรายการนี้' });
      const proto = req.headers['x-forwarded-proto'] || 'http';
      const baseUrl = process.env.PUBLIC_URL || `${proto}://${req.headers.host}`;
      const { subject, html, text } = buildRsvpEmail(rec, baseUrl);
      const result = await sendEmail(rec.email, subject, html, text);
      const rsvpLink = `${baseUrl.replace(/\/+$/, '')}/rsvp?token=${rec.rsvpToken}`;
      if (result.sent) { await store.markEmailSent(id); return sendJson(res, 200, { ok: true, sent: true }); }
      // ยังไม่ได้ตั้งค่า provider → ส่งลิงก์ RSVP กลับไปให้แอดมินคัดลอกส่งเองได้
      return sendJson(res, 200, { ok: false, sent: false, error: result.reason, rsvpLink });
    }

    // --- API: สร้าง QR code เป็นรูป PNG ---
    if (req.method === 'GET' && p === '/api/qr') {
      const text = String(url.searchParams.get('text') || '');
      let size = parseInt(url.searchParams.get('size') || '320', 10);
      size = Math.min(1000, Math.max(120, Number.isFinite(size) ? size : 320));
      if (!text || text.length > 1000) { res.writeHead(400); res.end('bad text'); return; }
      let QR; try { QR = require('qrcode'); } catch { res.writeHead(501); res.end('qr module not installed'); return; }
      try {
        const buf = await QR.toBuffer(text, { width: size, margin: 1, errorCorrectionLevel: 'M' });
        res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=3600' });
        res.end(buf);
      } catch { res.writeHead(500); res.end('qr error'); }
      return;
    }

    // --- API: ส่งแบบประเมินความพึงพอใจ (สาธารณะ ไม่ระบุตัวตน) ---
    if (req.method === 'POST' && p === '/api/feedback') {
      const body = await readBody(req);
      let d; try { d = JSON.parse(body); } catch { return sendJson(res, 400, { ok: false, error: 'ข้อมูลไม่ถูกต้อง' }); }
      const rec = { id: Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36) };
      for (const it of FEEDBACK_ITEMS) {
        const n = parseInt(d[it.key], 10);
        if (!validRating(n)) return sendJson(res, 400, { ok: false, error: `กรุณาให้คะแนน "${it.label}"` });
        rec[it.key] = n;
      }
      rec.suggestions = clip(d.suggestions, 1000);
      rec.topics = clip(d.topics, 500);
      rec.createdAt = new Date().toISOString();
      await store.insertFeedback(rec);
      return sendJson(res, 201, { ok: true });
    }

    // --- API: ดึงผลแบบประเมิน (ต้องมีรหัสผ่าน) ---
    if (req.method === 'GET' && p === '/api/feedback') {
      if (!isAuthed(req, url)) return sendJson(res, 401, { ok: false, error: 'รหัสผ่านไม่ถูกต้อง' });
      return sendJson(res, 200, { ok: true, data: await store.allFeedback() });
    }

    // --- ดาวน์โหลด CSV แบบประเมิน (ต้องมีรหัสผ่าน) ---
    if (req.method === 'GET' && p === '/api/feedback.csv') {
      if (!isAuthed(req, url)) { res.writeHead(401); res.end('unauthorized'); return; }
      const list = await store.allFeedback();
      const header = ['ลำดับ', ...FEEDBACK_ITEMS.map(it => it.label), 'ข้อเสนอแนะ', 'หัวข้อครั้งต่อไป', 'เวลา'];
      const rows = list.map((r, i) => [
        i + 1, ...FEEDBACK_ITEMS.map(it => r[it.key]), r.suggestions || '', r.topics || '',
        new Date(r.createdAt).toLocaleString('th-TH'),
      ]);
      const csv = [header, ...rows].map(row => row.map(csvEscape).join(',')).join('\r\n');
      res.writeHead(200, {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="seminar-feedback.csv"',
      });
      res.end('﻿' + csv);
      return;
    }

    // --- ดาวน์โหลด CSV (ต้องมีรหัสผ่าน) ---
    if (req.method === 'GET' && p === '/api/export.csv') {
      if (!isAuthed(req, url)) { res.writeHead(401); res.end('unauthorized'); return; }
      const list = await store.all();
      const header = ['ลำดับ', 'ชื่อ-นามสกุล', 'รหัสนักศึกษา', 'มหาวิทยาลัย/คณะ/สาขา', 'ชั้นปี',
        'อีเมล', 'เบอร์โทร', 'สถานะ', 'รูปแบบ', 'ทราบข่าวจาก', 'สิ่งที่คาดหวัง',
        'คำถามถึงวิทยากร', 'ชื่อ-สกุล(อังกฤษ)', 'ยินยอมถ่ายภาพ', 'ยินยอมเก็บข้อมูล', 'เวลาลงทะเบียน',
        'สถานะเข้าร่วม', 'เหตุผลที่ไม่มา', 'ยืนยันโดย', 'ยืนยันเมื่อ', 'ส่งอีเมลเมื่อ'];
      const rows = list.map((r, i) => {
        const ch = toArray(r.heardFrom);
        if (ch.includes('อื่น ๆ') && r.heardFromOther) ch[ch.indexOf('อื่น ๆ')] = `อื่น ๆ: ${r.heardFromOther}`;
        const channel = ch.join(', ');
        const exp = Array.isArray(r.expectations) ? r.expectations.join(', ') : (r.expectations || '');
        const srcLabel = r.attendanceSource === 'self' ? 'ผู้ลงทะเบียน' : r.attendanceSource === 'admin' ? 'แอดมิน' : '';
        return [
          i + 1, r.fullName, r.studentId || '', r.institution, r.yearLevel || '',
          r.email, r.phone, r.status, r.attendMode, channel || '', exp,
          r.questions || '', r.nameEnglish, r.consentMedia ? 'ยินยอม' : '', r.consentData ? 'ยินยอม' : '',
          new Date(r.createdAt).toLocaleString('th-TH'),
          attLabel(r.attendance), r.absenceReason || '', srcLabel,
          r.rsvpAt ? new Date(r.rsvpAt).toLocaleString('th-TH') : '',
          r.emailSentAt ? new Date(r.emailSentAt).toLocaleString('th-TH') : '',
        ];
      });
      const csv = [header, ...rows].map(row => row.map(csvEscape).join(',')).join('\r\n');
      res.writeHead(200, {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="seminar-registrations.csv"',
      });
      res.end('﻿' + csv); // BOM เพื่อให้ Excel อ่านภาษาไทยถูกต้อง
      return;
    }

    // --- หน้าเว็บ ---
    if (req.method === 'GET' && (p === '/' || p === '/index.html')) {
      return serveFile(res, path.join(PUBLIC_DIR, 'index.html'), 'text/html; charset=utf-8');
    }
    if (req.method === 'GET' && (p === '/admin' || p === '/admin.html')) {
      return serveFile(res, path.join(PUBLIC_DIR, 'admin.html'), 'text/html; charset=utf-8');
    }
    if (req.method === 'GET' && (p === '/rsvp' || p === '/rsvp.html')) {
      return serveFile(res, path.join(PUBLIC_DIR, 'rsvp.html'), 'text/html; charset=utf-8');
    }
    if (req.method === 'GET' && (p === '/survey' || p === '/survey.html')) {
      return serveFile(res, path.join(PUBLIC_DIR, 'survey.html'), 'text/html; charset=utf-8');
    }
    if (req.method === 'GET' && (p === '/admin/feedback' || p === '/admin-feedback' || p === '/admin-feedback.html')) {
      return serveFile(res, path.join(PUBLIC_DIR, 'admin-feedback.html'), 'text/html; charset=utf-8');
    }
    if (req.method === 'GET' && (p === '/admin/qr' || p === '/admin-qr' || p === '/admin-qr.html')) {
      return serveFile(res, path.join(PUBLIC_DIR, 'admin-qr.html'), 'text/html; charset=utf-8');
    }

    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 Not Found');
  } catch (e) {
    console.error('เกิดข้อผิดพลาด:', e);
    if (!res.headersSent) sendJson(res, 500, { ok: false, error: 'เกิดข้อผิดพลาดในระบบ' });
  }
});

// เปิดให้เทสต์ import ฟังก์ชันได้ (ไม่เริ่มเซิร์ฟเวอร์ตอน require)
module.exports = { createPgStore, createFileStore, validEmail, validPhone, normPhone };

// ---------- เริ่มเซิร์ฟเวอร์ ----------
async function start() {
  const usingPg = !!DATABASE_URL;
  store = usingPg ? createPgStore(DATABASE_URL) : createFileStore();
  try {
    await store.init();
  } catch (e) {
    console.error('เชื่อมต่อฐานข้อมูลไม่สำเร็จ:', e.message);
    process.exit(1);
  }
  server.listen(PORT, () => {
    console.log('=================================================');
    console.log(' ระบบลงทะเบียนงานสัมมนาเริ่มทำงานแล้ว');
    console.log(' หน้าลงทะเบียน:  http://localhost:' + PORT);
    console.log(' หน้าหลังบ้าน:   http://localhost:' + PORT + '/admin');
    console.log(' รหัสผ่านหลังบ้าน: ' + ADMIN_KEY);
    if (usingPg) {
      console.log(' เก็บข้อมูลใน: PostgreSQL (ผ่าน DATABASE_URL)');
    } else {
      console.log(' เก็บข้อมูลใน: ไฟล์ ' + DATA_FILE);
      console.log(' (โหมดเก็บในเครื่อง — ภายหลังเพิ่ม DATABASE_URL เพื่อใช้ PostgreSQL ได้)');
    }
    console.log('=================================================');
  });
}

// รันเซิร์ฟเวอร์เฉพาะเมื่อสั่งไฟล์นี้โดยตรง (ไม่รันตอนถูก require เข้าไปเทสต์)
if (require.main === module) start();
