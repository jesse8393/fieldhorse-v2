export type QuickGuide = {
  id: string
  recording?: boolean
  title: string
  description: string
  action: string
  href: string
  steps: { title: string; detail: string }[]
}

export const QUICK_GUIDES: QuickGuide[] = [
  {
    id: 'job', recording: true, title: 'Give every job a home.', description: 'Start with a customer and scope.', action: 'Create a job', href: '/jobs/new',
    steps: [
      { title: 'Start a new job', detail: 'Choose New job from Today. Give your work a clear title.' },
      { title: 'Connect your customer', detail: 'Choose an existing customer or enter their details. Add your scope and job address.' },
      { title: 'Save and review', detail: 'Save your job. Review its details before adding tasks, visits, or project updates.' }
    ]
  },
  {
    id: 'day', recording: true, title: 'Build a day that works.', description: 'Move from priorities to planned visits.', action: 'Open your schedule', href: '/schedule',
    steps: [
      { title: 'Check your next stop', detail: 'Open Today for upcoming visits and work needing attention.' },
      { title: 'Plan your next visit', detail: 'Choose Add visit from Today. On Add event, enter a title, date, and time.' },
      { title: 'Keep work connected', detail: 'Link your visit to a job when needed. Save and review it on your schedule.' }
    ]
  },
  {
    id: 'update', recording: true, title: 'Keep everyone in context.', description: 'Find job updates, photos, and balances.', action: 'Open your jobs', href: '/jobs',
    steps: [
      { title: 'Open a job', detail: 'Choose a job from Jobs. Contact actions sit within easy reach.' },
      { title: 'Review project photos', detail: 'Choose Photos for images attached to this job. Use the camera action to capture new job photos.' },
      { title: 'Check payment records', detail: 'With financial access, choose Contract balance or Invoices from All tools. Review recorded amounts before taking action.' }
    ]
  },
  {
    id: 'quote', recording: true, title: 'Put clear scope in writing.', description: 'Turn project details into a reviewable proposal.', action: 'Open your quotes', href: '/quotes',
    steps: [
      { title: 'Start with your customer', detail: 'Choose New quote. Connect an existing customer and give your proposal a clear title.' },
      { title: 'Define scope and pricing', detail: 'Add line items, scope, exclusions, and payment terms. Check quantities and totals.' },
      { title: 'Preview before sending', detail: 'Review your customer document. Send when ready, then track replies from Quotes.' }
    ]
  },
  {
    id: 'billing', recording: true, title: 'Make every payment clear.', description: 'Keep invoices and received payments connected.', action: 'Open your money workspace', href: '/invoices',
    steps: [
      { title: 'Choose what to bill', detail: 'Choose New invoice from Money. Select a job or customer and enter your billing details.' },
      { title: 'Review before sending', detail: 'Check amount, due date, customer details, and payment instructions. Preview your invoice.' },
      { title: 'Save and review', detail: 'Save your invoice and review its balance before sending. Record payments only after funds arrive.' }
    ]
  }
]

export function quickGuide(id: string | null) {
  return QUICK_GUIDES.find(guide => guide.id === id) ?? QUICK_GUIDES[0]
}
