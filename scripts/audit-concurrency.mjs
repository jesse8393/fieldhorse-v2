import assert from 'node:assert/strict'
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`

// The first transaction holds its write open until a different backend is
// observed waiting for its lock. This proves overlap, not just Promise timing.
export async function verifyConcurrency(db, test) {
  const race = async (sql, first, second, rejectedCode) => {
    const a = await db.openSession(), b = await db.openSession()
    try {
      for (const client of [a,b]) {
        await client.query('begin')
        await client.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({sub:id(1),role:'authenticated'})])
        await client.query('set local role authenticated')
      }
      const pid = (await b.query('select pg_backend_pid() as pid')).rows[0].pid
      await a.query(sql, first)
      let settled = false
      const pending = b.query(sql, second).then(
        () => { settled = true; return null },
        error => { settled = true; return error }
      )
      let waiting = false
      const deadline = Date.now() + 5000
      while (!settled && Date.now() < deadline) {
        waiting = (await db.query("select wait_event_type='Lock' as waiting from pg_stat_activity where pid=$1", [pid])).rows[0]?.waiting === true
        if (waiting) break
        await new Promise(resolve => setTimeout(resolve,20))
      }
      assert.equal(waiting,true,'second PostgreSQL backend must contend before the first commits')
      await a.query('commit')
      const error = await pending
      assert.equal(error?.code,rejectedCode,'only one conflicting transaction may commit')
    } finally {
      await Promise.allSettled([a.query('rollback'), b.query('rollback')])
      await Promise.all([a.end(),b.end()])
    }
  }
  await test('concurrent invoice drafts cannot consume the same contract balance', async () => {
    await db.query('insert into public.fh_contacts(id,user_id,org_id,amount) values($1,$2,$3,1000)',[id(280),id(1),id(100)])
    await race('insert into public.fh_invoices(id,user_id,contact_id,amount,status) values($1,$2,$3,700,\'draft\')',
      [id(380),id(1),id(280)],[id(381),id(1),id(280)],'23514')
    assert.equal(Number((await db.query('select sum(amount) as amount from public.fh_invoices where contact_id=$1',[id(280)])).rows[0].amount),700)
  })
  await test('concurrent crew bookings cannot reserve the same person twice', async () => {
    await race('insert into public.fh_schedule(id,user_id,contact_id,start_at,end_at,assigned_user_ids) values($1,$2,$3,\'2026-12-01T10:00Z\',\'2026-12-01T11:00Z\',$4)',
      [id(580),id(1),id(200),[id(4)]],[id(581),id(1),id(200),[id(4)]],'23P01')
    assert.equal(Number((await db.query('select count(*) as count from public.fh_schedule where id=any($1)',[[id(580),id(581)]])).rows[0].count),1)
  })
}
