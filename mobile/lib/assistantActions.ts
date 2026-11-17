// mobile/lib/assistantActions.ts
//
// Runs one record action the Dispatch assistant asked for, with the app's
// own save hooks, and returns the reply to show. A save that fails says so;
// the reply never claims a record was added when it was not.

type Saved = { error?: { message?: string } | null }
export type AssistantSaves = {
  createLead: (input: any) => Promise<Saved>
  createEvent: (input: any) => Promise<Saved>
  createClient: (input: any) => Promise<Saved>
  saveNote: (input: any) => Promise<Saved>
}

function failed(result: Saved): string | null {
  return result?.error ? `Couldn't save that: ${result.error.message || 'try again.'}` : null
}

export function toIso(date?: string, time?: string): string {
  const now = new Date()
  let d = now
  if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
    const [y, mo, da] = date.split('-').map(Number)
    let hh = 9, mm = 0
    if (time && /^\d{1,2}:\d{2}$/.test(time)) { const [h, m] = time.split(':').map(Number); hh = h; mm = m }
    d = new Date(y, mo - 1, da, hh, mm, 0, 0)
  } else if (time && /^\d{1,2}:\d{2}$/.test(time)) {
    const [h, m] = time.split(':').map(Number); d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m, 0, 0)
  }
  return d.toISOString()
}

export async function runAssistantAction(userId: string, saves: AssistantSaves, action: string, data: any, say: string): Promise<string> {
  try {
    if (action === 'create_lead') {
      if (!data?.name) return 'What name should I put on the lead?'
      const result = await saves.createLead({
        userId, name: data.name, phone: data.phone, email: data.email, address: data.address,
        jobTitle: data.job_title, jobType: data.job_type, amount: typeof data.amount === 'number' ? data.amount : undefined,
        notes: data.notes
      })
      const problem = failed(result)
      if (problem) return problem
      return say || `Added ${data.name}.`
    }
    if (action === 'create_event') {
      if (!data?.title) return 'What should I title the event?'
      const problem = failed(await saves.createEvent({ userId, title: data.title, startAt: toIso(data.date, data.time) }))
      if (problem) return problem
      return say || `Scheduled "${data.title}".`
    }
    if (action === 'create_client') {
      if (!data?.name) return 'What is the client name?'
      const problem = failed(await saves.createClient({ userId, name: data.name, companyName: data.company, phone: data.phone, email: data.email, address: data.address }))
      if (problem) return problem
      return say || `Added client ${data.name}.`
    }
    if (action === 'add_note') {
      if (!data?.text) return 'What should the note say?'
      const problem = failed(await saves.saveNote({ userId, text: data.text, contactId: null }))
      if (problem) return problem
      return say || 'Note saved.'
    }
    return "I didn't recognize that action."
  } catch (e) {
    return `Couldn't do that: ${(e as Error).message}`
  }
}
