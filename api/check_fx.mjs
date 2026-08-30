import pg from 'pg';
const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
try {
  const tbl = await pool.query("SELECT to_regclass('public.fx_rates') as exists");
  console.log('fx_rates exists:', tbl.rows[0].exists);
  if (tbl.rows[0].exists) {
    const r = await pool.query("SELECT base_currency, quote_currency, rate, source, fetched_at FROM fx_rates ORDER BY base_currency, quote_currency");
    console.log('Rows:', r.rows.length);
    for (const row of r.rows) {
      console.log(row.base_currency, '->', row.quote_currency, '=', row.rate, '(', row.source, ') @', row.fetched_at);
    }
    const ageQ = await pool.query("SELECT MAX(EXTRACT(EPOCH FROM (NOW() - fetched_at))) as max_age_sec, MIN(EXTRACT(EPOCH FROM (NOW() - fetched_at))) as min_age_sec FROM fx_rates");
    console.log('Age (s):', ageQ.rows[0]);
  }
} catch (err) {
  console.error('err:', err.message);
} finally {
  await pool.end();
}
