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

const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'registrations.json');

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

// ---------- ชั้นเก็บข้อมูล: PostgreSQL ----------
function createPgStore(url) {
  const { Pool } = require('pg');
  const useSSL = /sslmode=require/.test(url) || process.env.PGSSL === 'true';
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
          created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
        )`);
      // กันอีเมล/เบอร์โทรซ้ำระดับฐานข้อมูล (กันกรณีลงทะเบียนพร้อมกัน)
      await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS uniq_sem_email
        ON seminar_registrations (lower(email))`);
      await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS uniq_sem_phone
        ON seminar_registrations (phone_norm)`);
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
           questions, name_english, consent_media, consent_data, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
        [rec.id, rec.fullName, rec.studentId, rec.institution, rec.yearLevel, rec.email, rec.phone,
         normPhone(rec.phone), rec.status, rec.attendMode, JSON.stringify(rec.heardFrom), rec.heardFromOther,
         JSON.stringify(rec.expectations), rec.expectationsOther, rec.questions, rec.nameEnglish,
         rec.consentMedia, rec.consentData, rec.createdAt]);
    },
    async remove(id) {
      await pool.query(`DELETE FROM seminar_registrations WHERE id=$1`, [id]);
      const { rows } = await pool.query(`SELECT COUNT(*)::int AS c FROM seminar_registrations`);
      return rows[0].c;
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
    async remove(id) { const l = read().filter(r => r.id !== id); write(l); return l.length; },
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
    const url = new URL(req.url, `http://${req.headers.host}`);
    const p = url.pathname;

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

    // --- API: ดึงรายชื่อทั้งหมด (ต้องมีรหัสผ่าน) ---
    if (req.method === 'GET' && p === '/api/registrations') {
      if (!isAuthed(req, url)) return sendJson(res, 401, { ok: false, error: 'รหัสผ่านไม่ถูกต้อง' });
      return sendJson(res, 200, { ok: true, data: await store.all() });
    }

    // --- API: ลบทีละรายการ (ต้องมีรหัสผ่าน) ---
    if (req.method === 'DELETE' && p.startsWith('/api/registrations/')) {
      if (!isAuthed(req, url)) return sendJson(res, 401, { ok: false, error: 'รหัสผ่านไม่ถูกต้อง' });
      const id = decodeURIComponent(p.split('/').pop());
      const total = await store.remove(id);
      return sendJson(res, 200, { ok: true, total });
    }

    // --- ดาวน์โหลด CSV (ต้องมีรหัสผ่าน) ---
    if (req.method === 'GET' && p === '/api/export.csv') {
      if (!isAuthed(req, url)) { res.writeHead(401); res.end('unauthorized'); return; }
      const list = await store.all();
      const header = ['ลำดับ', 'ชื่อ-นามสกุล', 'รหัสนักศึกษา', 'มหาวิทยาลัย/คณะ/สาขา', 'ชั้นปี',
        'อีเมล', 'เบอร์โทร', 'สถานะ', 'รูปแบบ', 'ทราบข่าวจาก', 'สิ่งที่คาดหวัง',
        'คำถามถึงวิทยากร', 'ชื่อ-สกุล(อังกฤษ)', 'ยินยอมถ่ายภาพ', 'ยินยอมเก็บข้อมูล', 'เวลาลงทะเบียน'];
      const rows = list.map((r, i) => {
        const ch = toArray(r.heardFrom);
        if (ch.includes('อื่น ๆ') && r.heardFromOther) ch[ch.indexOf('อื่น ๆ')] = `อื่น ๆ: ${r.heardFromOther}`;
        const channel = ch.join(', ');
        const exp = Array.isArray(r.expectations) ? r.expectations.join(', ') : (r.expectations || '');
        return [
          i + 1, r.fullName, r.studentId || '', r.institution, r.yearLevel || '',
          r.email, r.phone, r.status, r.attendMode, channel || '', exp,
          r.questions || '', r.nameEnglish, r.consentMedia ? 'ยินยอม' : '', r.consentData ? 'ยินยอม' : '',
          new Date(r.createdAt).toLocaleString('th-TH'),
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
