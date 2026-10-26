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
      if (p === '/functions/v1/generate-match-suggestions') {
        // Local stand-in (2026-10-10): same database rules as the real
        // function, simple ranking, plain written reason.
        if (!claims) return send(res, 401, { error: 'Not authenticated' });
        const body = JSON.parse((await readBody(req)) || '{}');
        const { rows } = await pool.query(
          `select candidate_id from public.discover_next_candidates($1, $2)
           order by case when ghosting_penalized then 3 when previously_suggested then 2 when interested_in_viewer then 0 else 1 end, candidate_id
           limit 1`,
          [claims.sub, body.tz ?? null]
        );
        if (!rows[0]) return send(res, 200, { added: false });
        const { rows: added } = await pool.query(
          `select public.discover_add($1, $2, 'You might enjoy getting to know each other.', null, $3) as ok`,
          [claims.sub, rows[0].candidate_id, body.tz ?? null]
        );
        return send(res, 200, { added: added[0].ok === true });
      }
      // 2026-10-17: ZIP lookup stand-in for the joining walk (qa-onboard).
      if (p === '/functions/v1/geocode-city') return send(res, 200, { city: 'Los Angeles', state: 'CA', lat: 34.0522, lng: -118.2437 });
      if (p.startsWith('/functions/v1/')) return send(res, 200, { error: 'Not available in the local test copy' });
      // 2026-10-26: private bucket friend-photos. Every access is checked
      // against the real storage.objects row-level rules, run as the
      // signed-in person, the way Supabase Storage does it.
      const priv = p.match(/^\/storage\/v1\/object\/(sign\/)?(friend-photos)\/(.+)$/);
      if (priv || (p === '/storage/v1/object/friend-photos' && req.method === 'DELETE')) {
        const fs = require('fs'); const path = require('path');
        const dir = path.join(__dirname, '.local', 'storage', 'friend-photos');
        const asUser = async (fn) => {
          const c = await pool.connect();
          try {
            await c.query('begin');
            await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims || { role: 'anon' })]);
            await c.query(`set local role ${claims && claims.role === 'authenticated' ? 'authenticated' : 'anon'}`);
            const r = await fn(c);
            await c.query('commit');
            return r;
          } catch (e) {
            await c.query('rollback').catch(() => {});
            return { error: String(e.message || e) };
          } finally {
            c.release();
          }
        };
        if (!priv) {
          // remove: body { prefixes: [...] }
          const body = JSON.parse((await readBody(req)) || '{}');
          const out = await asUser(async (c) => {
            const removed = [];
            for (const name of body.prefixes || []) {
              const r = await c.query("delete from storage.objects where bucket_id = 'friend-photos' and name = $1 returning name", [name]);
              if (r.rowCount) removed.push(name);
            }
            return { removed };
          });
          if (out.error) return send(res, 400, { error: out.error });
          for (const name of out.removed) fs.rmSync(path.join(dir, name.replace(/\.\./g, '')), { force: true });
          return send(res, 200, out.removed.map((name) => ({ name })));
        }
        const isSign = Boolean(priv[1]);
        const name = decodeURIComponent(priv[3]).replace(/\.\./g, '');
        const file = path.join(dir, name);
        const tokenFor = (n, exp) => crypto.createHmac('sha256', SECRET).update(`friend-photos/${n}:${exp}`).digest('hex');
        if (isSign && req.method === 'POST') {
          const out = await asUser((c) => c.query("select 1 from storage.objects where bucket_id = 'friend-photos' and name = $1", [name]));
          if (out.error || !out.rowCount) return send(res, 400, { statusCode: '404', error: 'not_found', message: 'Object not found' });
          const body = JSON.parse((await readBody(req)) || '{}');
          const exp = Math.floor(Date.now() / 1000) + Number(body.expiresIn || 60);
          return send(res, 200, { signedURL: `/object/sign/friend-photos/${encodeURIComponent(name).replace(/%2F/g, '/')}?token=${tokenFor(name, exp)}&exp=${exp}` });
        }
        if (isSign && req.method === 'GET') {
          const exp = Number(url.searchParams.get('exp'));
          if (!exp || exp * 1000 < Date.now() || url.searchParams.get('token') !== tokenFor(name, exp) || !fs.existsSync(file)) {
            return send(res, 400, { statusCode: '400', error: 'invalid', message: 'Invalid or expired link' });
          }
          res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Access-Control-Allow-Origin': '*' });
          return res.end(fs.readFileSync(file));
        }
        if (!isSign && (req.method === 'POST' || req.method === 'PUT')) {
          const chunks = []; for await (const ch of req) chunks.push(ch);
          const out = await asUser(async (c) => {
            await c.query("delete from storage.objects where bucket_id = 'friend-photos' and name = $1", [name]);
            await c.query("insert into storage.objects (bucket_id, name, owner) values ('friend-photos', $1, $2)", [name, claims ? claims.sub : null]);
            return { ok: true };
          });
          if (out.error) return send(res, 403, { statusCode: '403', error: 'Unauthorized', message: 'new row violates row-level security policy' });
          fs.mkdirSync(path.dirname(file), { recursive: true });
          fs.writeFileSync(file, Buffer.concat(chunks));
          return send(res, 200, { Key: `friend-photos/${name}`, Id: name });
        }
        // A private bucket is never readable without a signed link.
        return send(res, 400, { statusCode: '400', error: 'private', message: 'Bucket not found' });
      }
      // 2026-10-17: tiny storage stand-in (photo and selfie uploads) for the joining walk.
      if (p.startsWith('/storage/v1/object/')) {
        const fs = require('fs'); const path = require('path');
        const dir = path.join(__dirname, '.local', 'storage');
        let rel = p.slice('/storage/v1/object/'.length).replace(/^(public|sign|authenticated)\//, '');
        const file = path.join(dir, decodeURIComponent(rel).replace(/\.\./g, ''));
        if (req.method === 'POST' || req.method === 'PUT') {
          const chunks = []; for await (const c of req) chunks.push(c);
          fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, Buffer.concat(chunks));
          return send(res, 200, { Key: rel, Id: rel });
        }
        if (fs.existsSync(file)) { res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Access-Control-Allow-Origin': '*' }); return res.end(fs.readFileSync(file)); }
        return send(res, 404, { error: 'not found' });
      }
      if (p.startsWith('/storage/v1/')) return send(res, 404, { error: 'not found' });
      return send(res, 404, { error: 'not found' });
    } catch (e) {
      return send(res, 500, { message: String(e.message || e) });
    }
  })
  .listen(54321, () => console.log('gateway on 54321'));
