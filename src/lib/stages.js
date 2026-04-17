// Fieldhorse pipeline stages + auto-transitions
import { supabase } from './supabase.js'

export const STAGES = [
  { id: 'lead',    label: 'Lead',    color: 'var(--stage-lead)',    icon: 'lead' },
  { id: 'quote',   label: 'Quote',   color: 'var(--stage-quote)',   icon: 'quote' },
  { id: 'job',     label: 'Job',     color: 'var(--stage-job)',     icon: 'job' },
  { id: 'invoice', label: 'Invoice', color: 'var(--stage-invoice)', icon: 'invoice' },
  { id: 'closed',  label: 'Closed',  color: 'var(--stage-closed)',  icon: 'closed' },
  { id: 'lost',    label: 'Lost',    color: 'var(--stage-lost)',    icon: 'lost' }
]

export const STAGE_MAP = Object.fromEntries(STAGES.map((s) => [s.id, s]))

export const ACTIVE_STAGES = ['lead', 'quote', 'job', 'invoice']

export function stageColor(id) {
  return STAGE_MAP[id]?.color || 'var(--steel)'
}

export function stageLabel(id) {
  return STAGE_MAP[id]?.label || id
}

// Transitions
export async function transitionStage(contact, nextStage) {
  const patch = { stage: nextStage }
  const { data, error } = await supabase
    .from('fh_contacts')
    .update(patch)
    .eq('id', contact.id)
    .select()
    .single()
  return { data, error }
}

export async function startQuote(contact) {
  return transitionStage(contact, 'quote')
}

export async function approveQuote(contact) {
  const { data, error } = await transitionStage(contact, 'job')
  if (!error) {
    const start = new Date(Date.now() + 24 * 60 * 60 * 1000)
    await supabase.from('fh_schedule').insert({
      user_id: contact.user_id,
      contact_id: contact.id,
      title: `${contact.job_title || contact.name || 'Job'} — start`,
      start_at: start.toISOString()
    })
  }
  return { data, error }
}

export async function completeJob(contact) {
  return transitionStage(contact, 'invoice')
}

export async function markLost(contact) {
  return transitionStage(contact, 'lost')
}

export async function logPayment(contact, { amount, method, reference, paid_on }) {
  const payload = {
    user_id: contact.user_id,
    contact_id: contact.id,
    amount: Number(amount) || 0,
    method: method || 'check',
    reference: reference || null,
    paid_on: paid_on || new Date().toISOString().slice(0, 10)
  }
  const { error: insErr } = await supabase.from('fh_payments').insert(payload)
  if (insErr) return { error: insErr }

  // Re-check balance
  const { data: pays } = await supabase
    .from('fh_payments')
    .select('amount')
    .eq('contact_id', contact.id)
  const total = (pays || []).reduce((s, p) => s + Number(p.amount || 0), 0)
  if (total >= Number(contact.amount || 0) && contact.stage !== 'closed') {
    await supabase.from('fh_contacts').update({ stage: 'closed' }).eq('id', contact.id)
  }
  return { total }
}

export async function recalcCost(contactId) {
  const { data: subs } = await supabase
    .from('fh_subs')
    .select('rate')
    .eq('contact_id', contactId)
  const { data: exps } = await supabase
    .from('fh_expenses')
    .select('amount')
    .eq('contact_id', contactId)
  const subsTotal = (subs || []).reduce((s, r) => s + Number(r.rate || 0), 0)
  const expsTotal = (exps || []).reduce((s, r) => s + Number(r.amount || 0), 0)
  const cost = subsTotal + expsTotal
  await supabase.from('fh_contacts').update({ cost }).eq('id', contactId)
  return cost
}

export function margin(contact) {
  const amt = Number(contact?.amount || 0)
  const cost = Number(contact?.cost || 0)
  if (!amt) return 0
  return ((amt - cost) / amt) * 100
}

export function marginTier(pct) {
  if (pct >= 30) return 'good'
  if (pct >= 15) return 'warn'
  return 'thin'
}
