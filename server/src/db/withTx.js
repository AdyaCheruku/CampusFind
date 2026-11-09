/**
 * Run fn(client) inside one transaction on the given pool, with the acting
 * user's id set as a TRANSACTION-LOCAL setting. PostgreSQL views, RLS policies,
 * triggers and functions read it through app_user_id().
 *
 * userId must come from the verified session (req.user.id), never from the
 * request body. Any thrown error rolls back every change.
 */
export async function withTx(pool, userId, fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.user_id', $1, true)", [userId ? String(userId) : '']);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Convenience: request-scoped transaction using the caller's role pool. */
export function txFor(req, fn) {
  return withTx(req.pool, req.user?.id, fn);
}

/**
 * Run several queries on ONE client sequentially (a pg client executes one
 * query at a time; firing them concurrently is deprecated).
 *   const [a, b] = await queryAll(c, [[sqlA, paramsA], [sqlB]]);
 */
export async function queryAll(client, queries) {
  const results = [];
  for (const [sql, params] of queries) results.push(await client.query(sql, params));
  return results;
}
