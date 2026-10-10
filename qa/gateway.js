// Local stand-in for the Supabase API gateway: /rest/v1 goes to PostgREST,
// /auth/v1 is a small fake of GoTrue (sessions with real JWTs, refresh,
// logout that revokes, magic-link verify), /functions/v1 stubs the edge
// functions the Test tab and chat use.
const http = require('http');
const crypto = require('crypto');
const { Pool } = require('pg');

const SECRET = 'local-test-secret-local-test-secret-1234';
const pool = new Pool({ host: 'localhost', port: 5433, user: 'postgres', database: 'limen' });
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
function sign(payload) {
  const h = b64({ alg: 'HS256', typ: 'JWT' });
  const p = b64(payload);
  const s = crypto.createHmac('sha256', SECRET).update(`${h}.${p}`).digest('base64url');
  return `${h}.${p}.${s}`;
}
function verify(token) {
  try {
    const [h, p, s] = token.split('.');
    const exp = crypto.createHmac('sha256', SECRET).update(`${h}.${p}`).digest('base64url');
    if (exp !== s) return null;
    const payload = JSON.parse(Buffer.from(p, 'base64url').toString());
    if (payload.exp && payload.exp * 1000 < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}
const ANON = sign({ role: 'anon', iss: 'local', exp: 4102444800 });
module.exports.ANON = ANON;

// refresh token -> { userId, sessionId, revoked }
const refreshTokens = new Map();
const log = [];

async function userRow(id) {
  const { rows } = await pool.query('select id, phone, email, created_at from auth.users where id = $1', [id]);
  return rows[0];
}
function userJson(u) {
  return { id: u.id, aud: 'authenticated', role: 'authenticated', phone: (u.phone || '').replace(/^\+/, ''), email: u.email || '', app_metadata: { provider: 'phone' }, user_metadata: {}, created_at: u.created_at };
}
async function newSession(userId, sessionId = crypto.randomUUID()) {
  const u = await userRow(userId);
  const now = Math.floor(Date.now() / 1000);
  const access = sign({ sub: userId, role: 'authenticated', aud: 'authenticated', session_id: sessionId, exp: now + 3600, iat: now, phone: u.phone });
  const rt = `rt_${crypto.randomBytes(9).toString('hex')}`;
  refreshTokens.set(rt, { userId, sessionId, revoked: false });
  await pool.query('update auth.users set last_sign_in_at = now() where id = $1', [userId]);
  return { access_token: access, token_type: 'bearer', expires_in: 3600, expires_at: now + 3600, refresh_token: rt, user: userJson(u) };
}

const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS,HEAD',
  'access-control-expose-headers': 'content-range, content-profile, x-total-count',
};
function send(res, status, body) {
  res.writeHead(status, { ...cors, 'content-type': 'application/json' });
  res.end(body === undefined ? '' : JSON.stringify(body));
}
function readBody(req) {
  return new Promise((r) => {
    let d = '';
    req.on('data', (c) => (d += c));
    req.on('end', () => r(d));
  });
}

const SEED_PHONES = new Set(['+15555500101', '+15555500102', '+15555500103', '+15555500104', '+15555500105', '+15555500106', '+15555500107', '+15555500108', '+15555500109']);

http
  .createServer(async (req, res) => {
    if (req.method === 'OPTIONS') return send(res, 204);
    const url = new URL(req.url, 'http://x');
    const p = url.pathname;
    const bearer = (req.headers.authorization || '').replace(/^Bearer /, '');
    const claims = verify(bearer);
    try {
      if (p.startsWith('/rest/v1/')) {
        const body = await readBody(req);
        const headers = { ...req.headers, host: 'localhost:3000' };
        delete headers['content-length'];
        if (!claims) headers.authorization = `Bearer ${ANON}`;
        const up = http.request({ host: 'localhost', port: 3000, path: req.url.replace('/rest/v1', ''), method: req.method, headers }, (r) => {
          const h = { ...r.headers, ...cors };
          res.writeHead(r.statusCode, h);
          r.pipe(res);
        });
        up.on('error', (e) => send(res, 502, { message: e.message }));
        if (body) up.write(body);
        up.end();
        return;
      }
      if (p === '/auth/v1/user') {
        if (!claims || !claims.sub) return send(res, 401, { msg: 'invalid JWT' });
        const u = await userRow(claims.sub);
        return u ? send(res, 200, userJson(u)) : send(res, 404, { msg: 'User not found' });
      }
      if (p === '/auth/v1/token') {
        const body = JSON.parse((await readBody(req)) || '{}');
        if (url.searchParams.get('grant_type') === 'refresh_token') {
          const t = refreshTokens.get(body.refresh_token);
          log.push(`refresh ${t ? (t.revoked ? 'REVOKED' : 'ok') : 'unknown'}`);
          if (!t || t.revoked) return send(res, 400, { error: 'invalid_grant', error_description: 'Invalid Refresh Token: Refresh Token Not Found', code: 'refresh_token_not_found' });
          t.revoked = true; // rotation
          return send(res, 200, await newSession(t.userId, t.sessionId));
        }
        return send(res, 400, { error: 'unsupported_grant_type' });
      }
      if (p === '/auth/v1/logout') {
        // GoTrue revokes the caller's session (scope=local) or all of the user's sessions (global).
        const scope = url.searchParams.get('scope') || 'global';
        if (claims) {
          for (const t of refreshTokens.values()) {
            if (scope === 'others' ? t.userId === claims.sub && t.sessionId !== claims.session_id : scope === 'global' ? t.userId === claims.sub : t.sessionId === claims.session_id) t.revoked = true;
          }
          log.push(`logout ${scope} ${claims.sub}`);
        }
        return send(res, 204);
      }
      if (p === '/auth/v1/otp') return send(res, 200, {});
      if (p === '/auth/v1/verify') {
        const body = JSON.parse((await readBody(req)) || '{}');
        if (body.token_hash && body.token_hash.startsWith('th_')) return send(res, 200, await newSession(body.token_hash.slice(3)));
        if (body.phone && body.token === '123456') {
          const phone = body.phone.startsWith('+') ? body.phone : `+${body.phone}`;
          let { rows } = await pool.query('select id from auth.users where phone = $1', [phone]);
          if (!rows[0]) ({ rows } = await pool.query("insert into auth.users (instance_id, aud, role, phone, phone_confirmed_at) values ('00000000-0000-0000-0000-000000000000','authenticated','authenticated',$1, now()) returning id", [phone]));
          return send(res, 200, await newSession(rows[0].id));
        }
        return send(res, 403, { msg: 'Token has expired or is invalid' });
      }
      if (p === '/functions/v1/dev-create-session') {
        const body = JSON.parse((await readBody(req)) || '{}');
        if (!claims) return send(res, 401, { error: 'Not signed in' });
        const { rows: me } = await pool.query('select u.is_admin, a.phone from public.users u join auth.users a on a.id = u.id where u.id = $1', [claims.sub]);
        if (!me[0] || !(me[0].is_admin || SEED_PHONES.has(me[0].phone))) return send(res, 403, { error: 'Only admins can use test accounts.' });
        if (!SEED_PHONES.has(body.phone)) return send(res, 403, { error: 'This phone number is not a recognized seed test account' });
        const { rows } = await pool.query('select id from auth.users where phone = $1', [body.phone]);
        return send(res, 200, { tokenHash: `th_${rows[0].id}` });
      }
      if (p === '/__test/session') {
        // Test harness only: a fresh session for a user id.
        return send(res, 200, await newSession(url.searchParams.get('user')));
      }
      if (p === '/__test/log') return send(res, 200, log);
      if (p.startsWith('/functions/v1/')) return send(res, 200, { error: 'Not available in the local test copy' });
      if (p.startsWith('/storage/v1/')) return send(res, 404, { error: 'not found' });
      return send(res, 404, { error: 'not found' });
    } catch (e) {
      return send(res, 500, { message: String(e.message || e) });
    }
  })
  .listen(54321, () => console.log('gateway on 54321'));
