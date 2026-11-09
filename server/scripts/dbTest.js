/**
 * CampusFind database test suite:  npm run db:test
 *
 * Every test runs in its own transaction which is ROLLED BACK at the end, so
 * the demo data is never modified. Tests switch to the real application roles
 * (SET LOCAL ROLE student_app / admin_app) and set app.user_id exactly like
 * Express does, so grants, RLS, triggers and functions are tested as the app
 * actually uses them.
 */
import pg from 'pg';
import '../src/config/paths.js';

const env = process.env;
const cfg = {
  host: env.PGHOST || 'localhost',
  port: Number(env.PGPORT || 5432),
  user: env.PG_SUPERUSER || 'postgres',
  password: env.PG_SUPERUSER_PASSWORD,
  database: env.PGDATABASE || 'campusfind',
};

// ---------------------------------------------------------------- helpers
class AssertionError extends Error {}
function assert(cond, msg) {
  if (!cond) throw new AssertionError(msg);
}

function makeCtx(c) {
  const ctx = {
    q: (sql, params) => c.query(sql, params),
    one: async (sql, params) => (await c.query(sql, params)).rows[0],
    val: async (sql, params) => {
      const r = (await c.query(sql, params)).rows[0];
      return r ? Object.values(r)[0] : undefined;
    },
    uid: async (email) => ctx.val('SELECT user_id FROM users WHERE email = $1', [email]),
    /** Become an app role + user, exactly like Express. */
    as: async (role, email) => {
      await c.query('RESET ROLE');
      const id = email ? await ctx.uid(email) : '';
      await c.query(`SELECT set_config('app.user_id', $1, true)`, [String(id ?? '')]);
      if (role !== 'owner') await c.query(`SET LOCAL ROLE ${role}`);
      else await c.query('SET LOCAL ROLE campusfind_owner');
      return id;
    },
    root: async () => {
      await c.query('RESET ROLE');
    },
    /** Expect a statement to fail with a SQLSTATE (or message regex). */
    fails: async (sql, params, expected) => {
      await c.query('SAVEPOINT expect_fail');
      try {
        await c.query(sql, params);
      } catch (err) {
        await c.query('ROLLBACK TO SAVEPOINT expect_fail');
        const ok = expected instanceof RegExp ? expected.test(err.message) : err.code === expected;
        assert(ok, `expected ${expected}, got ${err.code}: ${err.message}`);
        return err;
      }
      await c.query('ROLLBACK TO SAVEPOINT expect_fail');
      throw new AssertionError(`expected failure ${expected}, but the statement succeeded`);
    },
    item: (ref) => ctx.val('SELECT item_id FROM found_items WHERE reference_code = $1', [ref]),
    // seed keys are stable: R01 -> report by description, I01 -> FI-00001
    reportOf: (email, likeText) =>
      ctx.val(
        `SELECT r.report_id FROM lost_reports r JOIN users u ON u.user_id = r.user_id
         WHERE u.email = $1 AND r.description ILIKE $2 ORDER BY r.report_id LIMIT 1`,
        [email, `%${likeText}%`],
      ),
    claimOf: (email, status) =>
      ctx.val(
        `SELECT c.claim_id FROM ownership_claims c JOIN lost_reports r ON r.report_id = c.report_id
         JOIN users u ON u.user_id = r.user_id WHERE u.email = $1 AND c.status = $2 ORDER BY c.claim_id LIMIT 1`,
        [email, status],
      ),
  };
  return ctx;
}

const ADMIN = 'admin@campusfind.edu';
const ADMIN2 = 'desk@campusfind.edu';

// Helper to create + publish an item as admin inside a test.
async function createPublishedItem(t, fields) {
  const admin = await t.as('admin_app', ADMIN);
  const item = await t.one(
    `INSERT INTO found_items (category_id, brand, model, colour_id, visible_marks, public_description,
                              found_location_id, found_at, storage_location)
     VALUES ((SELECT category_id FROM categories WHERE name = $1), $2, $3,
             (SELECT colour_id FROM colours WHERE name = $4), $5, $6,
             (SELECT location_id FROM locations WHERE name = $7), now() - $8::interval, 'Test shelf')
     RETURNING item_id, status`,
    [fields.cat, fields.brand, fields.model, fields.colour, fields.marks, fields.desc, fields.loc, fields.ago || '1 hour'],
  );
  await t.q(`INSERT INTO item_photos (item_id, original_path, blurred_path, mime_type, size_bytes, is_primary)
             VALUES ($1, $2, $3, 'image/jpeg', 1000, true)`,
    [item.item_id, `originals/test-${item.item_id}.jpg`, `blurred/test-${item.item_id}.jpg`]);
  await t.q(`INSERT INTO finder_statements (item_id, finder_name, found_where) VALUES ($1, 'Test Finder', 'Test place')`,
    [item.item_id]);
  if (fields.publish !== false) await t.q('SELECT publish_found_item($1, $2)', [item.item_id, admin]);
  return item.item_id;
}

async function fileReport(t, email, fields) {
  await t.as('student_app', email);
  return t.val(
    `INSERT INTO lost_reports (category_id, brand, model, colour_id, description, features,
                               lost_location_id, lost_at)
     VALUES ((SELECT category_id FROM categories WHERE name = $1), $2, $3,
             (SELECT colour_id FROM colours WHERE name = $4), $5, $6,
             (SELECT location_id FROM locations WHERE name = $7), now() - $8::interval)
     RETURNING report_id`,
    [fields.cat, fields.brand, fields.model, fields.colour, fields.desc, fields.features ?? null, fields.loc, fields.ago || '3 hours'],
  );
}

// ---------------------------------------------------------------- tests
const tests = [
  // ---------- locking --------------------------------------------------
  ['Student role has no UPDATE privilege on lost reports at all', async (t) => {
    await t.as('student_app', 'aarav.mehta@college.edu');
    await t.fails(`UPDATE lost_reports SET description = 'changed description of my item'`, [], '42501');
  }],
  ['Locked report: trigger rejects edits of identifying fields even for the table owner', async (t) => {
    const r = await t.reportOf('aarav.mehta@college.edu', 'iPhone 13');
    await t.as('owner');
    const err = await t.fails(`UPDATE lost_reports SET colour_id = colour_id + 1 WHERE report_id = $1`, [r], 'CF001');
    assert(/locked/.test(err.message), 'message should mention locked');
  }],
  ['Locked report: status change is still allowed (withdraw), logged with reason and history', async (t) => {
    const r = await t.reportOf('aarav.mehta@college.edu', 'JBL');
    await t.as('student_app', 'aarav.mehta@college.edu');
    await t.q(`SELECT withdraw_report($1, 'Found it in my other bag')`, [r]);
    await t.as('owner');
    const row = await t.one('SELECT status, withdrawn_reason FROM lost_reports WHERE report_id = $1', [r]);
    assert(row.status === 'WITHDRAWN', `status ${row.status}`);
    const h = await t.one(`SELECT old_status, new_status, reason FROM report_status_history
                           WHERE report_id = $1 ORDER BY history_id DESC LIMIT 1`, [r]);
    assert(h.old_status === 'ACTIVE' && h.new_status === 'WITHDRAWN' && /other bag/.test(h.reason), 'history row');
    assert(await t.val(`SELECT count(*)::int FROM audit_log WHERE action = 'REPORT_WITHDRAW' AND target_id = $1`, [r]) === 1, 'audit');
  }],
  ['Locked report: locked_at equals submission time and cannot be supplied by the client', async (t) => {
    const id = await fileReport(t, 'arjun.reddy@college.edu', {
      cat: 'Keys', colour: 'Black', desc: 'Two silver keys on a plain black ring', loc: 'Block A' });
    await t.as('owner');
    const r = await t.one('SELECT locked_at, created_at, status FROM lost_reports WHERE report_id = $1', [id]);
    assert(r.locked_at.getTime() === r.created_at.getTime() && r.status === 'ACTIVE', 'locked at submit, ACTIVE');
    await t.as('student_app', 'arjun.reddy@college.edu');
    await t.fails(`INSERT INTO lost_reports (category_id, description, lost_at, locked_at)
                   VALUES (1, 'trying to set locked_at myself here', now(), now() - interval '9 days')`, [], '42501');
  }],
  ['Student exceeds the active report limit: insert rejected (CF002)', async (t) => {
    const email = 'diya.sharma@college.edu';                      // has 1 open report
    for (let i = 0; i < 4; i++) {
      await fileReport(t, email, { cat: 'Stationery', colour: 'Blue', desc: `Blue pen number ${i} lost in class today`, loc: 'Block B' });
    }
    await t.as('student_app', email);
    await t.fails(`INSERT INTO lost_reports (category_id, description, lost_at)
                   VALUES (16, 'one report too many for this student', now())`, [], 'CF002');
  }],
  ['Lost report filed with a future loss time is rejected (CF008)', async (t) => {
    await t.as('student_app', 'arjun.reddy@college.edu');
    await t.fails(`INSERT INTO lost_reports (category_id, description, lost_at)
                   VALUES (1, 'phone lost tomorrow apparently', now() + interval '1 day')`, [], 'CF008');
  }],

  // ---------- matching -------------------------------------------------
  ['Report before any item: stays ACTIVE with no candidates; publishing a matching item creates candidate + notification', async (t) => {
    const r = await fileReport(t, 'arjun.reddy@college.edu', {
      cat: 'Smartwatch', brand: 'Fossil', model: 'Gen 6', colour: 'Brown',
      desc: 'Brown Fossil Gen 6 smartwatch with a leather strap, left it in the library',
      features: 'leather strap with a small tear', loc: 'Central Library' });
    assert(await t.val('SELECT count(*)::int FROM v_student_candidates WHERE report_id = $1', [r]) === 0, 'no candidates yet');
    assert(await t.val('SELECT status FROM v_student_reports WHERE report_id = $1', [r]) === 'ACTIVE', 'ACTIVE');
    await createPublishedItem(t, { cat: 'Smartwatch', brand: 'Fossil', model: 'Gen 6', colour: 'Brown',
      marks: 'leather strap with a small tear', desc: 'Brown smartwatch with leather strap', loc: 'Central Library' });
    await t.as('student_app', 'arjun.reddy@college.edu');
    const cand = await t.one('SELECT score FROM v_student_candidates WHERE report_id = $1', [r]);
    assert(cand && Number(cand.score) >= 70, `expected strong candidate, got ${cand?.score}`);
    assert(await t.val(`SELECT count(*)::int FROM notifications WHERE report_id = $1 AND type = 'NEW_MATCH'`, [r]) === 1, 'notified');
  }],
  ['Found item before report: a later report matches it (trigger on INSERT)', async (t) => {
    await createPublishedItem(t, { cat: 'Umbrella', brand: 'Sun Brand', colour: 'Purple',
      marks: 'wooden handle', desc: 'Purple umbrella with wooden handle', loc: 'Block C' });
    const r = await fileReport(t, 'arjun.reddy@college.edu', {
      cat: 'Umbrella', brand: 'Sun Brand', colour: 'Purple', desc: 'Purple umbrella with a wooden handle, left outside Block C',
      features: 'wooden handle', loc: 'Block C' });
    const n = await t.val('SELECT count(*)::int FROM v_student_candidates WHERE report_id = $1', [r]);
    assert(n === 1, `expected 1 candidate, got ${n}`);
  }],
  ['DRAFT item is never matched; publishing it matches the waiting report and notifies the owner', async (t) => {
    const draft = await t.item('FI-00020');
    await t.as('owner');
    assert(await t.val(`SELECT status FROM found_items WHERE item_id = $1`, [draft]) === 'DRAFT', 'I20 is draft');
    assert(await t.val('SELECT count(*)::int FROM potential_matches WHERE item_id = $1', [draft]) === 0, 'draft unmatched');
    const admin = await t.as('admin_app', ADMIN);
    const n = await t.val('SELECT publish_found_item($1, $2)', [draft, admin]);
    assert(n >= 1, `publishing should create candidates, got ${n}`);
    await t.as('student_app', 'farhan.khan@college.edu');
    const c = await t.one(`SELECT score FROM v_student_candidates WHERE item_ref = 'FI-00020'`);
    assert(c && Number(c.score) >= 80, `farhan should see the laptop (score ${c?.score})`);
    assert(await t.val(`SELECT count(*)::int FROM notifications WHERE type = 'NEW_MATCH' AND NOT is_read`) >= 1, 'notified');
  }],
  ['Multiple similar items produce several ranked candidates (window function rank)', async (t) => {
    // Priya lost a black iPhone 14: the black Samsung and the blue iPhone 13 are both plausible.
    await t.as('student_app', 'priya.das@college.edu');
    const rows = (await t.q(`SELECT item_ref, score, rank FROM v_student_candidates
                              WHERE report_ref = (SELECT reference_code FROM v_student_reports WHERE description ILIKE '%iPhone 14%')
                              ORDER BY rank`)).rows;
    assert(rows.length >= 2, `expected >= 2 candidates, got ${rows.length}`);
    for (let i = 1; i < rows.length; i++) assert(Number(rows[i - 1].score) >= Number(rows[i].score), 'ranked by score');
  }],
  ['Score below threshold: pair is stored for the admin but never shown to the student', async (t) => {
    await t.as('owner');
    const low = await t.one(`SELECT pm.report_id, u.email FROM potential_matches pm
                              JOIN lost_reports r ON r.report_id = pm.report_id JOIN users u ON u.user_id = r.user_id
                             WHERE pm.score < cfg_num('candidate_threshold') AND r.status = 'ACTIVE' LIMIT 1`);
    assert(low, 'seed should contain at least one below-threshold pair');
    await t.as('student_app', low.email);
    const vis = await t.val(`SELECT count(*)::int FROM v_student_candidates WHERE report_id = $1 AND score < 40`, [low.report_id]);
    assert(vis === 0, 'below-threshold pair must not be visible');
  }],
  ['No suitable candidate: report remains ACTIVE with zero candidates', async (t) => {
    await t.as('student_app', 'vikram.singh@college.edu');
    const r = await t.one(`SELECT status, candidate_count FROM v_student_reports WHERE description ILIKE '%badminton racket%'`);
    assert(r.status === 'ACTIVE' && r.candidate_count === 0, JSON.stringify(r));
  }],
  ['Archived item is not matched against new reports', async (t) => {
    const r = await fileReport(t, 'kabir.nair@college.edu', {
      cat: 'Umbrella', colour: 'Black', desc: 'Black folding umbrella with one broken spoke', features: 'one broken spoke', loc: 'Main Gate' });
    await t.as('owner');
    const archived = await t.item('FI-00008');
    assert(await t.val('SELECT count(*)::int FROM potential_matches WHERE report_id = $1 AND item_id = $2', [r, archived]) === 0, 'not matched');
  }],
  ['Score breakdown is stored as JSONB with all seven factors summing to the score', async (t) => {
    await t.as('owner');
    const m = await t.one(`SELECT score, breakdown FROM potential_matches ORDER BY score DESC LIMIT 1`);
    const keys = ['category', 'brand_model', 'colour', 'location', 'time', 'description', 'features'];
    const sum = keys.reduce((s, k) => s + Number(m.breakdown[k].points), 0);
    assert(Math.abs(sum - Number(m.score)) < 0.1, `sum ${sum} vs score ${m.score}`);
  }],
  ['Dismissing a candidate does not reveal additional items (rank counted before dismissal)', async (t) => {
    const sid = await t.as('student_app', 'rohan.gupta@college.edu');
    const rep = await t.val(`SELECT report_id FROM v_student_reports WHERE description ILIKE '%Blue Milton%'`);
    const before = (await t.q('SELECT item_id FROM v_student_candidates WHERE report_id = $1', [rep])).rows;
    await t.q('SELECT dismiss_candidate($1, $2)', [rep, before[0].item_id]);
    const after = await t.val('SELECT count(*)::int FROM v_student_candidates WHERE report_id = $1', [rep]);
    assert(after === before.length - 1, `before ${before.length}, after ${after}`);
    assert(sid, 'student id');
  }],
  ["'None of these' dismisses all visible candidates; report stays ACTIVE", async (t) => {
    await t.as('student_app', 'priya.das@college.edu');
    const rep = await t.val(`SELECT report_id FROM v_student_reports WHERE description ILIKE '%iPhone 14%'`);
    const n = await t.val('SELECT reject_all_candidates($1)', [rep]);
    assert(n >= 1, 'should dismiss at least one');
    assert(await t.val('SELECT count(*)::int FROM v_student_candidates WHERE report_id = $1', [rep]) === 0, 'none left');
    assert(await t.val('SELECT status FROM v_student_reports WHERE report_id = $1', [rep]) === 'ACTIVE', 'still ACTIVE');
  }],

  // ---------- privacy / security --------------------------------------
  ['Student cannot read private details, finder statements, questions, photos, users, audit log or base items', async (t) => {
    await t.as('student_app', 'aarav.mehta@college.edu');
    for (const tbl of ['found_item_private', 'finder_statements', 'verification_questions', 'item_photos',
                       'users', 'audit_log', 'found_items', 'potential_matches', 'ownership_claims', 'v_admin_claim_review']) {
      await t.fails(`SELECT * FROM ${tbl} LIMIT 1`, [], '42501');
    }
  }],
  ['Student views expose no private columns', async (t) => {
    await t.as('owner');
    const cols = (await t.q(`SELECT column_name FROM information_schema.columns
                              WHERE table_schema = 'campusfind' AND table_name LIKE 'v_student_%'`)).rows.map((r) => r.column_name);
    for (const banned of ['storage_location', 'serial_no', 'hidden_marks', 'private_notes', 'finder_name',
                          'finder_contact', 'expected_answer', 'original_path', 'visible_marks', 'blurred_path', 'password_hash']) {
      assert(!cols.includes(banned), `student view exposes ${banned}`);
    }
  }],
  ["RLS: a student sees only their own lost reports and notifications", async (t) => {
    await t.as('owner');
    const own = await t.val(`SELECT count(*)::int FROM lost_reports r JOIN users u USING (user_id) WHERE u.email = 'aarav.mehta@college.edu'`);
    const total = await t.val('SELECT count(*)::int FROM lost_reports');
    await t.as('student_app', 'aarav.mehta@college.edu');
    assert(await t.val('SELECT count(*)::int FROM lost_reports') === own && own < total, 'RLS filter on lost_reports');
    const foreign = await t.val(`SELECT count(*)::int FROM notifications WHERE user_id <> app_user_id()`);
    assert(foreign === 0, 'RLS filter on notifications');
  }],
  ['Student cannot file a report on behalf of another student (user_id not grantable)', async (t) => {
    await t.as('student_app', 'aarav.mehta@college.edu');
    await t.fails(`INSERT INTO lost_reports (user_id, category_id, description, lost_at)
                   VALUES (5, 1, 'pretending to be another student', now())`, [], '42501');
  }],
  ['Student cannot call admin functions (approve_claim)', async (t) => {
    await t.as('student_app', 'kabir.nair@college.edu');
    await t.fails(`SELECT approve_claim(1, 1, 'self approval attempt', 'desk', now() + interval '1 day')`, [], '42501');
  }],
  ['Admin cannot read password hashes and cannot change statuses directly', async (t) => {
    await t.as('admin_app', ADMIN);
    await t.fails('SELECT password_hash FROM users LIMIT 1', [], '42501');
    await t.fails(`UPDATE found_items SET status = 'RETURNED'`, [], '42501');
    await t.fails(`UPDATE ownership_claims SET status = 'APPROVED'`, [], '42501');
  }],
  ['Admin functions reject an admin id that is not the session user (no spoofing)', async (t) => {
    await t.as('admin_app', ADMIN);
    const other = await t.uid(ADMIN2);
    const claim = await t.claimOf('ananya.rao@college.edu', 'PENDING');
    await t.fails(`SELECT approve_claim($1, $2, 'valid reason text', 'Admin desk', now() + interval '1 day')`,
      [claim, other], 'CF006');
  }],
  ['Blurred photo: authorised for the candidate owner (and audited), denied to unrelated students', async (t) => {
    await t.as('owner');
    const photo = await t.val(`SELECT p.photo_id FROM item_photos p JOIN found_items i USING (item_id) WHERE i.reference_code = 'FI-00001'`);
    await t.as('student_app', 'aarav.mehta@college.edu');
    const path = await t.val('SELECT authorize_blurred_photo($1)', [photo]);
    assert(path && path.startsWith('blurred/'), `aarav should get blurred path, got ${path}`);
    await t.as('student_app', 'meghana.joshi@college.edu');
    assert((await t.val('SELECT authorize_blurred_photo($1)', [photo])) === null, 'meghana denied');
    await t.as('owner');
    assert(await t.val(`SELECT count(*)::int FROM audit_log WHERE action = 'PHOTO_VIEW_BLURRED' AND target_id = $1`, [photo]) === 1, 'audited once');
  }],
  ['Student email domain rule (when configured) rejects other domains', async (t) => {
    await t.as('owner');
    await t.q(`UPDATE app_config SET value = '"college.edu"' WHERE key = 'allowed_email_domain'`);
    await t.as('student_app');
    await t.fails(`SELECT register_student('Test User', 'someone@gmail.com', 'XX001', 'hash')`, [], 'CF008');
    const id = await t.val(`SELECT register_student('Test User', 'someone@college.edu', 'XX001', 'hash')`);
    await t.as('owner');
    assert(await t.val('SELECT role FROM users WHERE user_id = $1', [id]) === 'student', 'role forced to student');
  }],

  // ---------- claims ---------------------------------------------------
  ['Competing claims: first is PENDING, second QUEUED; a second active claim is blocked by the partial unique index', async (t) => {
    await t.as('owner');
    const item = await t.item('FI-00004');
    const st = (await t.q(`SELECT status FROM ownership_claims WHERE item_id = $1 ORDER BY claim_id`, [item])).rows.map((r) => r.status);
    assert(st.join() === 'PENDING,QUEUED', `got ${st}`);
    await t.fails(`UPDATE ownership_claims SET status = 'PENDING' WHERE item_id = $1 AND status = 'QUEUED'`, [item], '23505');
  }],
  ['Student cannot claim an item that is not one of their candidates', async (t) => {
    await t.as('student_app', 'aarav.mehta@college.edu');
    const rep = await t.val(`SELECT report_id FROM v_student_reports WHERE description ILIKE '%iPhone 13%'`);
    await t.as('owner');
    const watch = await t.item('FI-00012');
    await t.as('student_app', 'aarav.mehta@college.edu');
    await t.fails('SELECT submit_claim($1, $2, $3)', [rep, watch, '{}'], 'CF005');
  }],
  ['Claim requires answers to every verification question', async (t) => {
    await t.as('student_app', 'aarav.mehta@college.edu');
    const rep = await t.val(`SELECT report_id FROM v_student_reports WHERE description ILIKE '%iPhone 13%'`);
    const item = await t.val(`SELECT item_id FROM v_student_candidates WHERE report_id = $1 AND item_ref = 'FI-00001'`, [rep]);
    await t.fails('SELECT submit_claim($1, $2, $3)', [rep, item, '{}'], 'CF008');
  }],
  ['Submitting a claim: claim PENDING, report MATCHED, item CLAIM_PENDING, admins notified, history written', async (t) => {
    await t.as('student_app', 'aarav.mehta@college.edu');
    const rep = await t.val(`SELECT report_id FROM v_student_reports WHERE description ILIKE '%iPhone 13%'`);
    const qs = (await t.q(`SELECT question_id FROM get_candidate_questions($1, (SELECT item_id FROM v_student_candidates WHERE report_id = $1 AND item_ref = 'FI-00001'))`, [rep])).rows;
    const answers = Object.fromEntries(qs.map((q, i) => [q.question_id, i === 0 ? 'metro card' : 'mountains']));
    const item = await t.val(`SELECT item_id FROM v_student_candidates WHERE report_id = $1 AND item_ref = 'FI-00001'`, [rep]);
    const claim = await t.val('SELECT submit_claim($1, $2, $3)', [rep, item, JSON.stringify(answers)]);
    await t.as('owner');
    const s = await t.one(`SELECT c.status AS c, r.status AS r, i.status AS i
                           FROM ownership_claims c JOIN lost_reports r USING (report_id) JOIN found_items i ON i.item_id = c.item_id
                           WHERE c.claim_id = $1`, [claim]);
    assert(s.c === 'PENDING' && s.r === 'MATCHED' && s.i === 'CLAIM_PENDING', JSON.stringify(s));
    assert(await t.val(`SELECT count(*)::int FROM notifications WHERE claim_id = $1 AND type = 'CLAIM_SUBMITTED'`, [claim]) === 2, 'both admins notified');
    assert(await t.val('SELECT count(*)::int FROM claim_status_history WHERE claim_id = $1', [claim]) === 1, 'history');
    // Re-claiming the same pair is refused
    await t.as('student_app', 'aarav.mehta@college.edu');
    await t.fails('SELECT submit_claim($1, $2, $3)', [rep, item, JSON.stringify(answers)], 'CF005');
  }],
  ['Admin rejects the PENDING claim: reason + history recorded, queued claim promoted (FIFO)', async (t) => {
    const admin = await t.as('admin_app', ADMIN);
    const pending = await t.claimOf('ananya.rao@college.edu', 'PENDING');
    const queued = await t.claimOf('rohan.gupta@college.edu', 'QUEUED');
    await t.q(`SELECT reject_claim($1, $2, 'Test rejection reason')`, [pending, admin]);
    const a = await t.one('SELECT status, decision_reason FROM ownership_claims WHERE claim_id = $1', [pending]);
    const b = await t.val('SELECT status FROM ownership_claims WHERE claim_id = $1', [queued]);
    assert(a.status === 'REJECTED' && a.decision_reason === 'Test rejection reason', 'rejected with reason');
    assert(b === 'PENDING', `queued claim promoted, got ${b}`);
    const h = await t.one(`SELECT old_status, new_status, reason FROM v_admin_claim_history WHERE claim_id = $1 ORDER BY changed_at DESC LIMIT 1`, [pending]);
    assert(h.old_status === 'PENDING' && h.new_status === 'REJECTED' && h.reason === 'Test rejection reason', 'history');
    assert(await t.val(`SELECT status FROM found_items WHERE reference_code = 'FI-00004'`) === 'CLAIM_PENDING', 'item still reserved');
    assert(await t.val('SELECT status FROM v_admin_lost_reports WHERE report_id = (SELECT report_id FROM ownership_claims WHERE claim_id = $1)', [pending]) === 'ACTIVE', 'report ACTIVE again');
  }],
  ['Rejecting the last open claim makes the item available again (IN_CUSTODY)', async (t) => {
    const admin = await t.as('admin_app', ADMIN);
    await t.q(`SELECT reject_claim($1, $2, 'first rejection')`, [await t.claimOf('ananya.rao@college.edu', 'PENDING'), admin]);
    await t.q(`SELECT reject_claim($1, $2, 'second rejection')`, [await t.claimOf('rohan.gupta@college.edu', 'PENDING'), admin]);
    assert(await t.val(`SELECT status FROM found_items WHERE reference_code = 'FI-00004'`) === 'IN_CUSTODY', 'IN_CUSTODY');
  }],
  ['Admin approves: claim APPROVED, item stays reserved (not returned), claimant notified, queued claimant informed, audited', async (t) => {
    const admin = await t.as('admin_app', ADMIN);
    const claim = await t.claimOf('ananya.rao@college.edu', 'PENDING');
    await t.q(`SELECT approve_claim($1, $2, 'Cat sticker answer matches', 'Admin desk, ground floor', now() + interval '2 days')`, [claim, admin]);
    await t.as('owner');
    const s = await t.one(`SELECT c.status, i.status AS item FROM ownership_claims c JOIN found_items i ON i.item_id = c.item_id WHERE claim_id = $1`, [claim]);
    assert(s.status === 'APPROVED' && s.item === 'CLAIM_PENDING', JSON.stringify(s));
    assert(await t.val(`SELECT count(*)::int FROM notifications WHERE claim_id = $1 AND type = 'CLAIM_APPROVED'`, [claim]) === 1, 'claimant notified');
    assert(await t.val(`SELECT count(*)::int FROM notifications WHERE type = 'QUEUE_UPDATE'`) >= 1, 'queued claimant told');
    assert(await t.val(`SELECT count(*)::int FROM audit_log WHERE action = 'CLAIM_APPROVE' AND target_id = $1`, [claim]) === 1, 'audited');
  }],
  ['Approval failure rolls back completely (invalid deadline -> nothing changes)', async (t) => {
    const admin = await t.as('admin_app', ADMIN);
    const claim = await t.claimOf('ananya.rao@college.edu', 'PENDING');
    const auditBefore = await t.val('SELECT count(*)::int FROM audit_log');
    await t.fails(`SELECT approve_claim($1, $2, 'valid reason here', 'desk', now() - interval '1 day')`, [claim, admin], 'CF008');
    assert(await t.val('SELECT status FROM ownership_claims WHERE claim_id = $1', [claim]) === 'PENDING', 'still PENDING');
    assert(await t.val('SELECT count(*)::int FROM audit_log') === auditBefore, 'no audit row');
  }],
  ['A high match score alone never approves: QUEUED claim cannot be approved, approved claims need an admin', async (t) => {
    const admin = await t.as('admin_app', ADMIN);
    await t.fails(`SELECT approve_claim($1, $2, 'valid reason here', 'desk', now() + interval '1 day')`,
      [await t.claimOf('rohan.gupta@college.edu', 'QUEUED'), admin], 'CF005');
    await t.as('owner');
    assert(await t.val(`SELECT count(*)::int FROM ownership_claims WHERE status IN ('APPROVED','COMPLETED') AND decided_by IS NULL`) === 0, 'every approval has an admin');
  }],
  ['Handover: handover row, item RETURNED, claim COMPLETED, report RESOLVED, queued claims closed', async (t) => {
    const admin = await t.as('admin_app', ADMIN);
    const claim = await t.claimOf('ananya.rao@college.edu', 'PENDING');
    await t.q(`SELECT approve_claim($1, $2, 'Verified at desk', 'Admin desk', now() + interval '1 day')`, [claim, admin]);
    await t.q(`SELECT record_handover($1, $2, 'College ID card', true, 'ok')`, [claim, admin]);
    const s = await t.one(`SELECT c.status AS c, i.status AS i, r.status AS r,
                                  (SELECT count(*)::int FROM handovers h WHERE h.claim_id = c.claim_id) AS h
                           FROM ownership_claims c JOIN found_items i ON i.item_id = c.item_id
                           JOIN v_admin_lost_reports r ON r.report_id = c.report_id WHERE c.claim_id = $1`, [claim]);
    assert(s.c === 'COMPLETED' && s.i === 'RETURNED' && s.r === 'RESOLVED' && s.h === 1, JSON.stringify(s));
    const q = await t.one(`SELECT status, decision_reason FROM ownership_claims WHERE claim_id = $1`, [await t.claimOf('rohan.gupta@college.edu', 'REJECTED')]);
    assert(q.status === 'REJECTED' && /returned/.test(q.decision_reason), 'queued claim closed');
  }],
  ['Handover requires identity verification and an APPROVED claim', async (t) => {
    const admin = await t.as('admin_app', ADMIN);
    const approved = await t.claimOf('kabir.nair@college.edu', 'APPROVED');
    await t.fails(`SELECT record_handover($1, $2, 'College ID', false, NULL)`, [approved, admin], 'CF008');
    await t.fails(`SELECT record_handover($1, $2, 'College ID', true, NULL)`, [await t.claimOf('ananya.rao@college.edu', 'PENDING'), admin], 'CF005');
  }],
  ['Appeal: a rejected claim can be appealed exactly once', async (t) => {
    await t.as('student_app', 'ishita.verma@college.edu');
    const rejected = await t.val(`SELECT claim_id FROM v_student_claims WHERE status = 'REJECTED' AND can_appeal`);
    const appeal = await t.val(`SELECT appeal_claim($1, 'I changed the watch face last week to my dog photo')`, [rejected]);
    assert(appeal, 'appeal created');
    assert(await t.val('SELECT status FROM v_student_claims WHERE claim_id = $1', [appeal]) === 'PENDING', 'appeal PENDING');
    const admin = await t.as('admin_app', ADMIN);
    await t.q(`SELECT reject_claim($1, $2, 'Appeal reviewed, still not convincing')`, [appeal, admin]);
    await t.as('student_app', 'ishita.verma@college.edu');
    await t.fails(`SELECT appeal_claim($1, 'second appeal attempt text')`, [rejected], 'CF005');
    await t.fails(`SELECT appeal_claim($1, 'appealing the appeal itself')`, [appeal], 'CF005');
  }],
  ['Verification indicator differs for the genuine and the competing claimant (admin guidance only)', async (t) => {
    await t.as('admin_app', ADMIN);
    const good = await t.val('SELECT compute_verification_indicator($1)', [await t.claimOf('ananya.rao@college.edu', 'PENDING')]);
    const weak = await t.val('SELECT compute_verification_indicator($1)', [await t.claimOf('rohan.gupta@college.edu', 'QUEUED')]);
    assert(good.questions[0].verdict !== 'NO_MATCH', `genuine answer verdict ${good.questions[0].verdict}`);
    assert(weak.questions[0].verdict === 'NO_MATCH', `competing answer verdict ${weak.questions[0].verdict}`);
    assert(['STRONG', 'MODERATE'].includes(good.overall) && weak.overall === 'WEAK', `${good.overall} vs ${weak.overall}`);
  }],
  ['Serial number check: partial IMEI match is recognised for the iPhone owner', async (t) => {
    await t.as('student_app', 'aarav.mehta@college.edu');
    const rep = await t.val(`SELECT report_id FROM v_student_reports WHERE description ILIKE '%iPhone 13%'`);
    const item = await t.val(`SELECT item_id FROM v_student_candidates WHERE report_id = $1 AND item_ref = 'FI-00001'`, [rep]);
    const qs = (await t.q('SELECT question_id FROM get_candidate_questions($1, $2)', [rep, item])).rows;
    const claim = await t.val('SELECT submit_claim($1, $2, $3)', [rep, item,
      JSON.stringify(Object.fromEntries(qs.map((q, i) => [q.question_id, ['metro card', 'mountains'][i]])))]);
    await t.as('admin_app', ADMIN);
    const v = await t.val('SELECT compute_verification_indicator($1)', [claim]);
    assert(v.serial.result === 'PARTIAL' && v.overall === 'STRONG', JSON.stringify({ s: v.serial.result, o: v.overall }));
  }],

  // ---------- integrity -------------------------------------------------
  ['Status transition rules reject contradictory moves (IN_CUSTODY -> RETURNED)', async (t) => {
    await t.as('owner');
    await t.fails(`UPDATE found_items SET status = 'RETURNED' WHERE reference_code = 'FI-00002'`, [], 'CF003');
    await t.fails(`UPDATE ownership_claims SET status = 'COMPLETED' WHERE status = 'PENDING'`, [], 'CF003');
  }],
  ['Published items cannot be deleted; drafts can', async (t) => {
    const admin = await t.as('admin_app', ADMIN);
    await t.fails(`SELECT * FROM delete_draft_item((SELECT item_id FROM found_items WHERE reference_code = 'FI-00002'), $1)`, [admin], 'CF005');
    const draftId = await createPublishedItem(t, { cat: 'Other', colour: 'Black', desc: 'Test draft item to delete', loc: 'Block A', publish: false });
    const paths = (await t.q('SELECT * FROM delete_draft_item($1, $2)', [draftId, admin])).rows;
    assert(paths.length === 1, 'returns photo paths for file cleanup');
    assert(await t.val('SELECT count(*)::int FROM found_items WHERE item_id = $1', [draftId]) === 0, 'deleted');
  }],
  ['Publishing requires a photo and a finder statement', async (t) => {
    const admin = await t.as('admin_app', ADMIN);
    const id = await t.val(`INSERT INTO found_items (category_id, colour_id, public_description, found_location_id, found_at, storage_location)
                            VALUES (1, 1, 'Phone without a photo yet', 1, now(), 'X') RETURNING item_id`);
    await t.fails('SELECT publish_found_item($1, $2)', [id, admin], 'CF008');
  }],
  ['Audit log and status history are append-only', async (t) => {
    await t.as('owner');
    await t.fails(`UPDATE audit_log SET action = 'LOGIN'`, [], 'CF005');
    await t.fails(`DELETE FROM claim_status_history`, [], 'CF005');
    await t.fails(`DELETE FROM lost_reports`, [], 'CF005');
  }],
  ['Matching weights must sum to 100 (deferred constraint trigger)', async (t) => {
    await t.as('owner');
    await t.q(`UPDATE app_config SET value = '25' WHERE key = 'weight_category'`);
    await t.fails('SET CONSTRAINTS ALL IMMEDIATE', [], 'CF008');
  }],
  ['Verification questions freeze once an item has been claimed', async (t) => {
    await t.as('admin_app', ADMIN);
    await t.fails(`UPDATE verification_questions SET expected_answer = 'dog' WHERE item_id = (SELECT item_id FROM found_items WHERE reference_code = 'FI-00004')`, [], 'CF005');
  }],
];

// ---------------------------------------------------------------- concurrency
async function concurrencyTest() {
  const a = new pg.Client(cfg);
  const b = new pg.Client(cfg);
  await a.connect();
  await b.connect();
  for (const c of [a, b]) await c.query('SET search_path = campusfind, public');
  const adminId = (await a.query(`SELECT user_id FROM users WHERE email = $1`, [ADMIN])).rows[0].user_id;
  const admin2Id = (await a.query(`SELECT user_id FROM users WHERE email = $1`, [ADMIN2])).rows[0].user_id;
  const claim = (await a.query(`SELECT c.claim_id FROM ownership_claims c JOIN lost_reports r USING (report_id)
                                JOIN users u ON u.user_id = r.user_id
                                WHERE u.email = 'ananya.rao@college.edu' AND c.status = 'PENDING'`)).rows[0].claim_id;
  try {
    await a.query('BEGIN');
    await a.query(`SELECT set_config('app.user_id', $1, true)`, [String(adminId)]);
    await a.query('SET LOCAL ROLE admin_app');
    await a.query(`SELECT approve_claim($1, $2, 'Admin A approves', 'Admin desk, ground floor', now() + interval '1 day')`, [claim, adminId]);

    await b.query('BEGIN');
    await b.query(`SELECT set_config('app.user_id', $1, true)`, [String(admin2Id)]);
    await b.query('SET LOCAL ROLE admin_app');
    const started = Date.now();
    const bPromise = b.query(`SELECT reject_claim($1, $2, 'Admin B rejects')`, [claim, admin2Id])
      .then(() => ({ ok: true }), (e) => ({ ok: false, e }));

    await new Promise((r) => setTimeout(r, 1200));     // B must be blocked on FOR UPDATE meanwhile
    let bSettled = false;
    bPromise.then(() => { bSettled = true; });
    await new Promise((r) => setImmediate(r));
    assert(!bSettled, 'B should still be waiting while A holds the row lock');
    await a.query('ROLLBACK');                         // A aborts -> its approval vanishes
    const bRes = await bPromise;                        // B now gets the lock on the PENDING row
    const waited = Date.now() - started;
    assert(bRes.ok, `B should succeed after A rolled back: ${bRes.e?.message}`);
    const seen = (await b.query('SELECT status FROM ownership_claims WHERE claim_id = $1', [claim])).rows[0].status;
    await b.query('ROLLBACK');                         // leave the demo data untouched
    assert(waited >= 1100, `B should have waited for A's lock (waited ${waited} ms)`);
    assert(seen === 'REJECTED', `B's own change visible inside B, got ${seen}`);
    return `B blocked ${waited} ms on SELECT ... FOR UPDATE until A rolled back, then rejected the still-PENDING claim (both rolled back)`;
  } finally {
    await a.query('ROLLBACK').catch(() => {});
    await b.query('ROLLBACK').catch(() => {});
    await a.end();
    await b.end();
  }
}

// ---------------------------------------------------------------- runner
async function main() {
  if (!cfg.password) {
    console.error('PG_SUPERUSER_PASSWORD is empty in server/.env');
    process.exit(1);
  }
  const c = new pg.Client(cfg);
  await c.connect();
  await c.query('SET search_path = campusfind, public');
  const t = makeCtx(c);

  let pass = 0;
  const failures = [];
  for (const [name, fn] of tests) {
    await c.query('BEGIN');
    try {
      await fn(t);
      pass++;
      console.log(`  ✓ ${name}`);
    } catch (err) {
      failures.push(name);
      console.log(`  ✗ ${name}\n      ${err instanceof AssertionError ? err.message : `${err.code || ''} ${err.message}`}`);
    } finally {
      await c.query('ROLLBACK');
    }
  }
  await c.end();

  console.log('\nConcurrency');
  try {
    console.log(`  ✓ Two admins act on one claim: ${await concurrencyTest()}`);
    pass++;
  } catch (err) {
    failures.push('concurrency');
    console.log(`  ✗ concurrency: ${err.message}`);
  }

  console.log(`\n${pass} passed, ${failures.length} failed`);
  process.exit(failures.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
