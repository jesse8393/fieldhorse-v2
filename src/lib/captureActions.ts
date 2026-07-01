// src/lib/captureActions.ts
//
// Commit layer for Universal Capture: takes an operator-confirmed
// CaptureIntent and performs the write the rest of the app would have
// done by hand — same tables, same helpers (logPayment, recalcCost),
// so captured data is indistinguishable from manually entered data.

import { supabase } from './supabase.ts'
import { resilientInsert } from './outbox.ts'
import { findOrCreateClient } from './clients.ts'
import { logPayment, recalcCost } from './stages.ts'
import type { CaptureIntent } from './captureIntelligence.ts'

// The slice of fh_contacts the capture flow loads for matching +
// payment logging. logPayment() needs user_id/amount/stage off the row.
export type CaptureContact = {
  id: string
  user_id: string
  name: string | null
  job_title: string | null
  stage: string | null
  amount: number | null
}

export type CommitResult = {
  // Route to offer in the success toast ("View" target).
  link: string | null
  // Past-tense confirmation, e.g. "Payment logged".
  toast: string
}

export async function commitCapture({ intent, userId, contacts }: {
  intent: CaptureIntent
  userId: string
  contacts: CaptureContact[]
}): Promise<CommitResult> {
  const job = intent.job_id ? contacts.find((c) => c.id === intent.job_id) || null : null

  switch (intent.kind) {
    case 'note': {
      const { queued, error } = await resilientInsert('fh_notes', {
        user_id: userId,
        contact_id: job?.id || null,
        text: intent.text,
        category: 'note'
      })
      if (error) throw error
      return {
        link: job ? `/jobs/${job.id}` : '/notes',
        toast: queued ? 'Note saved — will sync when back online' : 'Note saved'
      }
    }

    case 'todo': {
      // fh_job_todos requires a job — without one the capture is still
      // worth keeping, so it lands as a note the operator can re-file.
      if (!job) {
        // Preserve the due date the operator entered in the note text so
        // it isn't silently dropped when the to-do downgrades to a note.
        const dueSuffix = intent.due_at ? ` (due ${intent.due_at})` : ''
        const { error } = await resilientInsert('fh_notes', {
          user_id: userId,
          contact_id: null,
          text: `To-do: ${intent.text}${dueSuffix}`,
          category: 'note'
        })
        if (error) throw error
        return { link: '/notes', toast: 'Saved as note (no job attached)' }
      }
      const { queued, error } = await resilientInsert('fh_job_todos', {
        user_id: userId,
        job_id: job.id,
        text: intent.text || '',
        // Noon local keeps the due date stable across timezones.
        due_at: intent.due_at ? new Date(`${intent.due_at}T12:00:00`).toISOString() : null
      })
      if (error) throw error
      return { link: `/jobs/${job.id}`, toast: queued ? 'To-do saved — will sync' : 'To-do added' }
    }

    case 'payment': {
      if (!job) throw new Error('Pick a job to log the payment against.')
      if (!intent.amount) throw new Error('Enter the payment amount.')
      const { error } = await logPayment(job as any, {
        amount: intent.amount,
        method: intent.method,
        kind: intent.payment_kind
      }) as any
      if (error) throw error
      return { link: `/jobs/${job.id}?tab=financials`, toast: 'Payment logged' }
    }

    case 'expense': {
      if (!intent.amount) throw new Error('Enter the expense amount.')
      const { queued, error } = await resilientInsert('fh_expenses', {
        user_id: userId,
        contact_id: job?.id || null,
        description: intent.description,
        amount: intent.amount,
        category: intent.category,
        expense_date: intent.expense_date
      })
      if (error) throw error
      // Keep the per-job cost/margin rollup honest (same as Expenses tab).
      // Offline, the rollup recalc waits for the queue — the expense row
      // itself is what must not be lost.
      if (job && !queued) await recalcCost(job.id, userId)
      return { link: job ? `/jobs/${job.id}?tab=financials` : '/invoices', toast: 'Expense logged' }
    }

    case 'schedule': {
      const { queued, error } = await resilientInsert('fh_schedule', {
        user_id: userId,
        contact_id: job?.id || null,
        title: intent.title,
        start_at: intent.start_at,
        end_at: intent.end_at
      })
      if (error) throw error
      return { link: '/schedule', toast: queued ? 'Saved — will sync' : 'Added to schedule' }
    }

    case 'lead': {
      const name = intent.name || intent.title || 'New lead'
      // Link (or create) the client so a captured lead isn't an orphan
      // — matches what NewLeadSheet does. Skipped when offline (the
      // lookups need the network); the lead still saves via the outbox.
      let clientId: string | null = null
      if (typeof navigator === 'undefined' || navigator.onLine !== false) {
        clientId = await findOrCreateClient(userId, {
          name,
          phone: intent.phone,
          email: intent.email,
          address: intent.address
        })
      }
      // resilientInsert mints the id client-side, so the success link
      // works even when the row is still queued for sync.
      const { queued, error, id } = await resilientInsert('fh_contacts', {
        user_id: userId,
        name,
        phone: intent.phone || null,
        email: intent.email || null,
        address: intent.address || null,
        job_title: intent.title || null,
        amount: intent.amount || null,
        follow_up_on: intent.follow_up_on || null,
        client_id: clientId,
        stage: 'lead'
      })
      if (error) throw error
      return {
        link: queued ? '/leads' : `/leads/${id}`,
        toast: queued ? 'Lead saved — will sync' : 'Lead created'
      }
    }
  }
}
