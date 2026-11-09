/**
 * HTTP API tests against a freshly reset demo database, through the real
 * Express app and the real student_app / admin_app database roles.
 * Run with: npm run test:api
 */
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { startServer, Client, testImage, STUDENT_PW, ADMIN_PW } from './helpers.js';
import { resolveUpload } from '../src/services/imageService.js';

let srv;
const c = {};                 // named sessions
const ids = {};               // ids discovered along the way

before(async () => {
  srv = await startServer();
  for (const [name, email, admin] of [
    ['aarav', 'aarav.mehta@college.edu'], ['meghana', 'meghana.joshi@college.edu'],
    ['farhan', 'farhan.khan@college.edu'], ['ishita', 'ishita.verma@college.edu'],
    ['admin', 'admin@campusfind.edu', true],
  ]) {
    c[name] = new Client(srv.base);
    await c[name].login(email, admin ? ADMIN_PW : STUDENT_PW, admin);
  }
  c.anon = new Client(srv.base);
});
after(async () => srv?.stop());

// =============================================================================
describe('Authentication and sessions', () => {
  test('session cookie is HttpOnly and SameSite=Strict', async () => {
    const s = new Client(srv.base);
    await s.login('diya.sharma@college.edu', STUDENT_PW);
    const cookie = s.lastSetCookie.join(';');
    assert.match(cookie, /cf_session=/);
    assert.match(cookie, /HttpOnly/i);
    assert.match(cookie, /SameSite=Strict/i);
  });

  test('wrong password and unknown email give the same 401', async () => {
    const a = await c.anon.post('/auth/login', { email: 'aarav.mehta@college.edu', password: 'nope' });
    const b = await c.anon.post('/auth/login', { email: 'nobody@college.edu', password: 'nope' });
    assert.equal(a.status, 401);
    assert.equal(b.status, 401);
    assert.equal(a.data.error, b.data.error);
  });

  test('a student cannot log in through the admin portal, and an admin cannot use the student portal', async () => {
    assert.equal((await c.anon.post('/admin/auth/login', { email: 'aarav.mehta@college.edu', password: STUDENT_PW })).status, 401);
    assert.equal((await c.anon.post('/auth/login', { email: 'admin@campusfind.edu', password: ADMIN_PW })).status, 401);
  });

  test('registration always creates a student, even if the body asks for admin', async () => {
    const s = new Client(srv.base);
    const r = await s.post('/auth/register', {
      fullName: 'Test Student', email: 'test.student@college.edu', rollNo: '24cs099', password: 'Passw0rd!', role: 'admin',
    });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    assert.equal(r.data.user.role, 'student');
    assert.equal(r.data.user.rollNo, '24CS099');
    assert.equal((await s.get('/admin/dashboard')).status, 403);
    assert.equal((await s.get('/me/dashboard')).status, 200);
  });

  test('duplicate email is rejected (409) and weak passwords fail validation (422)', async () => {
    const dup = await c.anon.post('/auth/register', {
      fullName: 'Dup', email: 'AARAV.MEHTA@college.edu', rollNo: 'ZZ001', password: 'Passw0rd!' });
    assert.equal(dup.status, 409);
    assert.match(dup.data.error, /already exists/);
    const weak = await c.anon.post('/auth/register', {
      fullName: 'Weak', email: 'weak@college.edu', rollNo: 'ZZ002', password: 'short' });
    assert.equal(weak.status, 422);
  });

  test('unauthenticated requests are rejected', async () => {
    for (const p of ['/me/dashboard', '/admin/dashboard', '/photos/1', '/lost-reports/mine', '/notifications', '/lookups']) {
      assert.equal((await c.anon.get(p)).status, 401, p);
    }
  });

  test('a forged / tampered token is rejected', async () => {
    const s = new Client(srv.base);
    s.cookie = 'cf_session=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIiwicm9sZSI6ImFkbWluIn0.invalidsignature';
    assert.equal((await s.get('/admin/dashboard')).status, 401);
  });

  test('logout clears the session', async () => {
    const s = new Client(srv.base);
    await s.login('diya.sharma@college.edu', STUDENT_PW);
    await s.post('/auth/logout');
    assert.equal((await s.get('/auth/me')).status, 401);
  });
});

// =============================================================================
describe('Role separation', () => {
  test('students get 403 on every admin route', async () => {
    for (const p of ['/admin/dashboard', '/admin/found-items', '/admin/claims', '/admin/audit-log', '/admin/photos/1/original', '/admin/users']) {
      assert.equal((await c.aarav.get(p)).status, 403, p);
    }
    assert.equal((await c.aarav.post('/admin/claims/1/approve', { reason: 'x', pickupInstructions: 'y', pickupDeadline: new Date() })).status, 403);
  });

  test('admins get 403 on student-only routes', async () => {
    assert.equal((await c.admin.get('/me/dashboard')).status, 403);
    assert.equal((await c.admin.post('/claims', { reportId: 1, itemId: 1 })).status, 403);
  });

  test('uploads are not publicly served', async () => {
    const res = await fetch(srv.base.replace('/api', '') + '/uploads/originals/seed-i01.jpg');
    assert.equal(res.status, 404);
    assert.equal((await c.aarav.get('/photos/..%2F..%2F.env')).status, 404);
  });
});

// =============================================================================
describe('Student: lost reports and candidates', () => {
  test('lookups load for a student', async () => {
    const r = await c.aarav.get('/lookups');
    assert.equal(r.status, 200);
    assert.ok(r.data.categories.length >= 10 && r.data.colours.length && r.data.locations.length);
    ids.lookups = r.data;
  });

  test('filing a report with a proof photo returns a locked reference', async () => {
    const cat = ids.lookups.categories.find((x) => x.name === 'Backpack / Bag').id;
    const col = ids.lookups.colours.find((x) => x.name === 'Maroon').id;
    const form = new FormData();
    form.set('categoryId', String(cat));
    form.set('colourId', String(col));
    form.set('brand', 'Skybags');
    form.set('description', 'Maroon Skybags backpack with a laptop compartment and a water bottle pocket');
    form.set('features', 'torn left strap');
    form.set('lostAt', new Date(Date.now() - 3 * 3600e3).toISOString());
    form.set('proofPhoto', new Blob([await testImage('#6E1F2A')], { type: 'image/jpeg' }), 'bag.jpg');
    const r = await c.meghana.postForm('/lost-reports', form);
    assert.equal(r.status, 201, JSON.stringify(r.data));
    assert.match(r.data.report.reference_code, /^LR-\d{5}$/);
    assert.equal(r.data.report.status, 'ACTIVE');
    assert.ok(r.data.report.locked_at);
    ids.meghanaReport = r.data.report.report_id;
  });

  test('report validation: short description 422, future loss time 422 from PostgreSQL', async () => {
    const short = new FormData();
    short.set('categoryId', '1'); short.set('description', 'too short'); short.set('lostAt', new Date().toISOString());
    assert.equal((await c.meghana.postForm('/lost-reports', short)).status, 422);

    const future = new FormData();
    future.set('categoryId', '1');
    future.set('description', 'A phone that I will apparently lose tomorrow afternoon');
    future.set('lostAt', new Date(Date.now() + 86400e3).toISOString());
    const r = await c.meghana.postForm('/lost-reports', future);
    assert.equal(r.status, 422);
    assert.match(r.data.error, /future/);
  });

  test('a non-image file disguised as a JPEG is rejected', async () => {
    const form = new FormData();
    form.set('categoryId', '1');
    form.set('description', 'Phone lost in the canteen with a cracked screen');
    form.set('lostAt', new Date().toISOString());
    form.set('proofPhoto', new Blob([Buffer.from('this is not an image')], { type: 'image/jpeg' }), 'x.jpg');
    assert.equal((await c.meghana.postForm('/lost-reports', form)).status, 422);
  });

  test('my reports list only my own; another student\'s report is 404', async () => {
    const mine = await c.aarav.get('/lost-reports/mine');
    assert.equal(mine.status, 200);
    assert.ok(mine.data.reports.length >= 3);
    ids.aaravPhoneReport = mine.data.reports.find((r) => /iPhone 13/.test(r.description)).report_id;
    assert.equal((await c.meghana.get(`/lost-reports/${ids.aaravPhoneReport}`)).status, 404);
    assert.equal((await c.meghana.get(`/lost-reports/${ids.aaravPhoneReport}/candidates`)).status, 404);
  });

  test('candidates: ranked, student-safe fields only', async () => {
    const r = await c.aarav.get(`/lost-reports/${ids.aaravPhoneReport}/candidates`);
    assert.equal(r.status, 200);
    const cand = r.data.candidates[0];
    assert.equal(cand.item_ref, 'FI-00001');
    assert.ok(cand.score > 90);
    for (const banned of ['storage_location', 'visible_marks', 'serial_no', 'hidden_marks', 'finder_name', 'brand', 'original_path', 'blurred_path']) {
      assert.ok(!(banned in cand), `candidate exposes ${banned}`);
    }
    ids.iphoneItem = cand.item_id;
    ids.iphonePhoto = cand.photo_ids[0];
  });

  test('blurred photo: visible to the matched student, 404 for anyone else; original is admin-only', async () => {
    const ok = await c.aarav.get(`/photos/${ids.iphonePhoto}`);
    assert.equal(ok.status, 200);
    assert.equal(ok.type, 'image/jpeg');
    assert.equal((await c.meghana.get(`/photos/${ids.iphonePhoto}`)).status, 404);
    const orig = await c.admin.get(`/admin/photos/${ids.iphonePhoto}/original`);
    assert.equal(orig.status, 200);
    assert.notEqual(Buffer.compare(orig.data, ok.data), 0, 'student must not receive the original');
  });

  test('candidate detail returns questions but never expected answers', async () => {
    const r = await c.aarav.get(`/lost-reports/${ids.aaravPhoneReport}/candidates/${ids.iphoneItem}`);
    assert.equal(r.status, 200);
    assert.equal(r.data.questions.length, 2);
    assert.ok(!JSON.stringify(r.data).includes('mountains'));
    ids.iphoneQuestions = r.data.questions;
  });

  test('locked report: there is no edit endpoint, withdrawing is logged', async () => {
    assert.equal((await c.meghana.put(`/lost-reports/${ids.meghanaReport}`, { description: 'x' })).status, 404);
    const w = await c.meghana.post(`/lost-reports/${ids.meghanaReport}/withdraw`, { reason: 'Found it at home' });
    assert.equal(w.status, 200);
    const again = await c.meghana.post(`/lost-reports/${ids.meghanaReport}/withdraw`, { reason: 'Found it at home' });
    assert.equal(again.status, 409);
    const d = await c.meghana.get(`/lost-reports/${ids.meghanaReport}`);
    assert.equal(d.data.report.status, 'WITHDRAWN');
    assert.equal(d.data.report.history.at(-1).new_status, 'WITHDRAWN');
  });
});

// =============================================================================
describe('Admin intake and matching', () => {
  test('intake rejects publishing without photos', async () => {
    const form = new FormData();
    form.set('data', JSON.stringify({
      item: { categoryId: 1, colourId: 1, publicDescription: 'Black phone found', foundLocationId: 1, foundAt: new Date().toISOString(), storageLocation: 'A-9' },
      finder: { finderName: 'Some Finder', foundWhere: 'Main building' }, publish: true,
    }));
    const r = await c.admin.postForm('/admin/found-items', form);
    assert.equal(r.status, 422);
  });

  test('intake creates item + private details + finder + photos + questions and publishes in one request; matching notifies the owner', async () => {
    const L = ids.lookups;
    const before = await c.farhan.get('/notifications');
    const form = new FormData();
    form.set('data', JSON.stringify({
      item: {
        categoryId: L.categories.find((x) => x.name === 'Keys').id, brand: 'Godrej',
        colourId: L.colours.find((x) => x.name === 'Red').id,
        visibleMarks: 'red bottle opener keychain, three keys', publicDescription: 'Set of keys on a keychain',
        foundLocationId: L.locations.find((x) => x.name === 'Parking Area').id, foundAt: new Date(Date.now() - 3600e3).toISOString(),
        storageLocation: 'Locker C-9',
      },
      private: { hiddenMarks: 'small locker key numbered 47', serialNo: '' },
      finder: { finderName: 'Guard Ravi', foundWhere: 'Bike parking row 2', circumstances: 'Found near bikes' },
      questions: [{ questionText: 'What number is on the small key?', expectedAnswer: '47' }],
      publish: true,
      primaryIndex: 1,
    }));
    form.append('photos', new Blob([await testImage('#C8372D')], { type: 'image/jpeg' }), 'a.jpg');
    form.append('photos', new Blob([await testImage('#E8C547', 'png')], { type: 'image/png' }), 'b.png');
    const r = await c.admin.postForm('/admin/found-items', form);
    assert.equal(r.status, 201, JSON.stringify(r.data));
    assert.equal(r.data.status, 'IN_CUSTODY');
    assert.ok(r.data.candidates >= 1, 'should match Farhan\'s keys report');
    ids.newItem = r.data.itemId;

    const detail = await c.admin.get(`/admin/found-items/${ids.newItem}`);
    assert.equal(detail.status, 200);
    assert.equal(detail.data.item.photos.length, 2);
    assert.equal(detail.data.item.photos.filter((p) => p.is_primary).length, 1);
    assert.equal(detail.data.item.private.hidden_marks, 'small locker key numbered 47');
    assert.equal(detail.data.item.finderStatements[0].finder_name, 'Guard Ravi');
    assert.equal(detail.data.item.questions.length, 1);

    const after = await c.farhan.get('/notifications');
    assert.ok(after.data.unreadCount > before.data.unreadCount, 'owner notified of new match');
  });

  test('draft lifecycle: save draft (not matched), publish later, published items cannot be deleted', async () => {
    const form = new FormData();
    form.set('data', JSON.stringify({
      item: { categoryId: 1, colourId: 1, publicDescription: 'Black phone, draft entry', foundLocationId: 1, foundAt: new Date().toISOString(), storageLocation: 'A-9' },
      finder: { finderName: 'Draft Finder', foundWhere: 'Main building lobby' },
    }));
    const d = await c.admin.postForm('/admin/found-items', form);
    assert.equal(d.status, 201);
    assert.equal(d.data.status, 'DRAFT');
    assert.equal((await c.admin.post(`/admin/found-items/${d.data.itemId}/publish`)).status, 422);   // no photo yet
    const pf = new FormData();
    pf.append('photos', new Blob([await testImage('#1F2328')], { type: 'image/jpeg' }), 'p.jpg');
    assert.equal((await c.admin.postForm(`/admin/found-items/${d.data.itemId}/photos`, pf)).status, 201);
    assert.equal((await c.admin.post(`/admin/found-items/${d.data.itemId}/publish`)).status, 200);
    assert.equal((await c.admin.del(`/admin/found-items/${d.data.itemId}`)).status, 409);
  });

  test('a draft can be deleted and its files are removed', async () => {
    const form = new FormData();
    form.set('data', JSON.stringify({
      item: { categoryId: 2, colourId: 1, publicDescription: 'Draft laptop to delete', foundLocationId: 1, foundAt: new Date().toISOString(), storageLocation: 'B-1' },
      finder: { finderName: 'Someone', foundWhere: 'Lab' },
    }));
    form.append('photos', new Blob([await testImage()], { type: 'image/jpeg' }), 'x.jpg');
    const d = await c.admin.postForm('/admin/found-items', form);
    const detail = await c.admin.get(`/admin/found-items/${d.data.itemId}`);
    const photoId = detail.data.item.photos[0].photo_id;
    const orig = await c.admin.get(`/admin/photos/${photoId}/original`);
    assert.equal(orig.status, 200);
    assert.equal((await c.admin.del(`/admin/found-items/${d.data.itemId}`)).status, 200);
    assert.equal((await c.admin.get(`/admin/photos/${photoId}/original`)).status, 404);
  });

  test('inventory filters and audit logging of private views', async () => {
    const r = await c.admin.get('/admin/found-items?status=IN_CUSTODY,CLAIM_PENDING&q=keys');
    assert.equal(r.status, 200);
    assert.ok(r.data.items.every((i) => ['IN_CUSTODY', 'CLAIM_PENDING'].includes(i.status)));
    const audit = await c.admin.get('/admin/audit-log?action=PRIVATE_VIEW,PHOTO_VIEW_ORIGINAL');
    assert.ok(audit.data.entries.length >= 2);
  });

  test('matches list includes below-threshold pairs for the admin', async () => {
    const r = await c.admin.get('/admin/matches?visibility=below&limit=5');
    assert.equal(r.status, 200);
    assert.ok(r.data.matches.length > 0);
    assert.ok(r.data.matches.every((m) => m.score < r.data.threshold));
  });
});

// =============================================================================
describe('Claims, review, approval and handover', () => {
  test('claim requires answers to all questions', async () => {
    const r = await c.aarav.post('/claims', { reportId: ids.aaravPhoneReport, itemId: ids.iphoneItem, answers: {} });
    assert.equal(r.status, 422);
  });

  test('student submits a claim; duplicates are refused', async () => {
    const [q1, q2] = ids.iphoneQuestions;
    const body = { reportId: ids.aaravPhoneReport, itemId: ids.iphoneItem,
      answers: { [q1.question_id]: 'my metro card', [q2.question_id]: 'snowy mountains' } };
    const r = await c.aarav.post('/claims', body);
    assert.equal(r.status, 201, JSON.stringify(r.data));
    assert.equal(r.data.claim.status, 'PENDING');
    ids.claim = r.data.claim.claim_id;
    assert.equal((await c.aarav.post('/claims', body)).status, 409);
  });

  test('evidence upload is stored and only the owner (or an admin) can open it', async () => {
    const form = new FormData();
    form.set('evidenceType', 'PHOTO');
    form.set('note', 'Photo of me with the phone last month');
    form.append('files', new Blob([await testImage('#2F6FD0')], { type: 'image/jpeg' }), 'me.jpg');
    form.append('files', new Blob([Buffer.from('%PDF-1.4\n%fake but signed\n')], { type: 'application/pdf' }), 'bill.pdf');
    const r = await c.aarav.postForm(`/claims/${ids.claim}/evidence`, form);
    assert.equal(r.status, 201, JSON.stringify(r.data));
    assert.equal(r.data.evidenceIds.length, 2);
    const evId = r.data.evidenceIds[0];
    assert.equal((await c.aarav.get(`/claims/${ids.claim}/evidence/${evId}`)).status, 200);
    assert.equal((await c.meghana.get(`/claims/${ids.claim}/evidence/${evId}`)).status, 404);
    assert.equal((await c.admin.get(`/admin/evidence/${evId}`)).status, 200);
  });

  test('claim detail shows locked report and answers, not expected answers', async () => {
    const r = await c.aarav.get(`/claims/${ids.claim}`);
    assert.equal(r.status, 200);
    assert.equal(r.data.claim.report.report_id, ids.aaravPhoneReport);
    assert.equal(r.data.claim.responses.length, 2);
    assert.equal(r.data.claim.evidence.length, 2);
    assert.ok(!JSON.stringify(r.data).includes('expected'));
  });

  test('admin side-by-side review contains private details, finder statement and verification guidance', async () => {
    const r = await c.admin.get(`/admin/claims/${ids.claim}`);
    assert.equal(r.status, 200);
    const cl = r.data.claim;
    assert.equal(cl.private_serial_no, 'IMEI 356789104455662');
    assert.equal(cl.finder_statements[0].finder_name, 'Neha Kulkarni');
    assert.equal(cl.verification.serial.result, 'PARTIAL');
    assert.ok(['STRONG', 'MODERATE'].includes(cl.verification.overall));
    assert.ok(cl.score_breakdown.category.points > 0);
  });

  test('approval validates input; a past deadline is rejected by PostgreSQL', async () => {
    assert.equal((await c.admin.post(`/admin/claims/${ids.claim}/approve`, { reason: '', pickupInstructions: 'Desk', pickupDeadline: new Date() })).status, 422);
    const past = await c.admin.post(`/admin/claims/${ids.claim}/approve`, {
      reason: 'Partial IMEI and both answers match', pickupInstructions: 'Lost & Found desk', pickupDeadline: new Date(Date.now() - 3600e3).toISOString() });
    assert.equal(past.status, 422);
    assert.match(past.data.error, /future/);
  });

  test('approve -> student notified with pickup -> handover requires ID -> RETURNED / COMPLETED / RESOLVED', async () => {
    const ok = await c.admin.post(`/admin/claims/${ids.claim}/approve`, {
      reason: 'Partial IMEI and both answers match the intake record',
      pickupInstructions: 'Lost & Found desk, Main Building, 10:00-16:00',
      pickupDeadline: new Date(Date.now() + 2 * 86400e3).toISOString() });
    assert.equal(ok.status, 200, JSON.stringify(ok.data));

    const s = await c.aarav.get(`/claims/${ids.claim}`);
    assert.equal(s.data.claim.status, 'APPROVED');
    assert.match(s.data.claim.pickup_instructions, /Main Building/);
    const pend = await c.admin.get('/admin/handovers/pending');
    assert.ok(pend.data.pending.some((p) => p.claim_id === ids.claim));

    assert.equal((await c.admin.post(`/admin/handover/${ids.claim}`, { idDocument: 'College ID', idVerified: false })).status, 422);
    const h = await c.admin.post(`/admin/handover/${ids.claim}`, { idDocument: 'College ID card 21CS001', idVerified: true, notes: 'All good' });
    assert.equal(h.status, 201, JSON.stringify(h.data));

    const done = await c.aarav.get(`/claims/${ids.claim}`);
    assert.equal(done.data.claim.status, 'COMPLETED');
    assert.ok(done.data.claim.handed_at);
    assert.equal(done.data.claim.report.status, 'RESOLVED');
    const item = await c.admin.get(`/admin/found-items/${ids.iphoneItem}`);
    assert.equal(item.data.item.status, 'RETURNED');
    assert.deepEqual(item.data.item.history.map((x) => x.new_status), ['DRAFT', 'IN_CUSTODY', 'CLAIM_PENDING', 'RETURNED']);
  });

  test('reject with reason -> queued claim promoted; rejected student can appeal exactly once', async () => {
    const claims = await c.admin.get('/admin/claims?status=PENDING');
    const earbuds = claims.data.claims.find((x) => x.item_ref === 'FI-00004');
    const rej = await c.admin.post(`/admin/claims/${earbuds.claim_id}/reject`, { reason: 'Answer did not match' });
    assert.equal(rej.status, 200);
    const after = await c.admin.get('/admin/claims?status=PENDING');
    assert.ok(after.data.claims.some((x) => x.item_ref === 'FI-00004' && x.student_name === 'Rohan Gupta'), 'Rohan promoted');

    const mine = await c.ishita.get('/claims/mine');
    const rejected = mine.data.claims.find((x) => x.status === 'REJECTED' && x.can_appeal);
    const a1 = await c.ishita.post(`/claims/${rejected.claim_id}/appeal`, { statement: 'I had changed the watch face to my dog photo the week before.' });
    assert.equal(a1.status, 201, JSON.stringify(a1.data));
    const a2 = await c.ishita.post(`/claims/${rejected.claim_id}/appeal`, { statement: 'Trying a second appeal on the same claim.' });
    assert.equal(a2.status, 409);
  });

  test("'None of these' and dismiss work and are idempotent-safe", async () => {
    const priya = new Client(srv.base);
    await priya.login('priya.das@college.edu', STUDENT_PW);
    const reps = await priya.get('/lost-reports/mine');
    const rep = reps.data.reports.find((r) => /iPhone 14/.test(r.description));
    const cands = await priya.get(`/lost-reports/${rep.report_id}/candidates`);
    assert.ok(cands.data.candidates.length >= 2);
    assert.equal((await priya.post(`/lost-reports/${rep.report_id}/candidates/${cands.data.candidates[0].item_id}/dismiss`)).status, 200);
    const none = await priya.post(`/lost-reports/${rep.report_id}/none-of-these`);
    assert.equal(none.status, 200);
    assert.equal((await priya.get(`/lost-reports/${rep.report_id}/candidates`)).data.candidates.length, 0);
  });
});

// =============================================================================
describe('Admin system functions', () => {
  test('dashboard stats', async () => {
    const r = await c.admin.get('/admin/dashboard');
    assert.equal(r.status, 200);
    assert.ok(r.data.stats.items_in_custody > 0);
    assert.ok(Array.isArray(r.data.byCategory));
  });

  test('deactivating a student locks out their existing session immediately', async () => {
    const users = await c.admin.get('/admin/users?q=meghana');
    const id = users.data.users[0].user_id;
    assert.equal((await c.admin.patch(`/admin/users/${id}`, { isActive: false })).status, 200);
    assert.equal((await c.meghana.get('/me/dashboard')).status, 401);
    assert.equal((await c.anon.post('/auth/login', { email: 'meghana.joshi@college.edu', password: STUDENT_PW })).status, 403);
    assert.equal((await c.admin.patch(`/admin/users/${id}`, { isActive: true })).status, 200);
  });

  test('config: weights must still sum to 100', async () => {
    const r = await c.admin.patch('/admin/config/weight_category', { value: 30 });
    assert.equal(r.status, 422);
    assert.match(r.data.error, /sum to 100/);
    assert.equal((await c.admin.patch('/admin/config/top_n', { value: 4 })).status, 200);
  });

  test('maintenance and notifications', async () => {
    const m = await c.admin.post('/admin/maintenance/archive');
    assert.equal(m.status, 200);
    assert.ok('items_archived' in m.data);
    const n = await c.admin.get('/notifications');
    assert.equal(n.status, 200);
    assert.ok(n.data.notifications.every((x) => typeof x.title === 'string'));
    assert.equal((await c.admin.post('/notifications/read-all')).status, 200);
    assert.equal((await c.admin.get('/notifications')).data.unreadCount, 0);
  });

  test('no generated file paths leak to students in any JSON response', async () => {
    const bodies = await Promise.all([
      c.aarav.get('/me/dashboard'), c.aarav.get('/claims/mine'), c.aarav.get('/lost-reports/mine'),
    ]);
    for (const b of bodies) assert.ok(!/originals\/|blurred\/|proofs\//.test(JSON.stringify(b.data)));
    assert.ok(fs.existsSync(resolveUpload('blurred/seed-i01.jpg')));
  });
});
