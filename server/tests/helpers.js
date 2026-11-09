import sharp from 'sharp';
import { createApp } from '../src/app.js';
import { closePools } from '../src/config/db.js';

/** Start the real app on an ephemeral port. */
export async function startServer() {
  const server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  return {
    base,
    async stop() {
      await new Promise((r) => server.close(r));
      await closePools();
    },
  };
}

/** Minimal HTTP client with a cookie jar (one session per instance). */
export class Client {
  constructor(base) {
    this.base = base;
    this.cookie = '';
    this.lastSetCookie = [];
  }

  async req(method, path, { json, form } = {}) {
    const headers = {};
    if (this.cookie) headers.cookie = this.cookie;
    let body;
    if (json !== undefined) {
      headers['content-type'] = 'application/json';
      body = JSON.stringify(json);
    } else if (form) {
      body = form;
    }
    const res = await fetch(this.base + path, { method, headers, body, redirect: 'manual' });
    this.lastSetCookie = res.headers.getSetCookie();
    for (const c of this.lastSetCookie) {
      const kv = c.split(';')[0];
      this.cookie = kv.endsWith('=') ? '' : kv;
    }
    const type = res.headers.get('content-type') || '';
    const data = type.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer());
    return { status: res.status, data, type };
  }

  get(p) { return this.req('GET', p); }
  post(p, json) { return this.req('POST', p, { json: json ?? {} }); }
  put(p, json) { return this.req('PUT', p, { json }); }
  patch(p, json) { return this.req('PATCH', p, { json }); }
  del(p) { return this.req('DELETE', p); }
  postForm(p, form) { return this.req('POST', p, { form }); }

  async login(email, password, admin = false) {
    const r = await this.post(admin ? '/admin/auth/login' : '/auth/login', { email, password });
    if (r.status !== 200) throw new Error(`login failed for ${email}: ${r.status} ${JSON.stringify(r.data)}`);
    return r.data.user;
  }
}

export async function testImage(color = '#2F6FD0', format = 'jpeg') {
  return sharp({ create: { width: 320, height: 240, channels: 3, background: color } })[format]().toBuffer();
}

export const STUDENT_PW = 'Student@123';
export const ADMIN_PW = 'Admin@123';
