export type QuickGuide = {
  id: string
  title: string
  description: string
  action: string
  href: string
  steps: { title: string; detail: string }[]
}

export const QUICK_GUIDES: QuickGuide[] = [
  {
    id: 'job', title: 'Give every job a home.', description: 'Start with a customer and scope.', action: 'Create a job', href: '/jobs/new',
    steps: [
      { title: 'Start a new job', detail: 'Choose New job from Today. Give your work a clear title.' },
      { title: 'Connect your customer', detail: 'Choose an existing customer or enter their details. Add your scope and job address.' },
      { title: 'Save and review', detail: 'Save your job. Review its details before adding tasks, visits, or project updates.' }
    ]
  },
  {
    id: 'day', title: 'Build a day that works.', description: 'Move from priorities to planned visits.', action: 'Open your schedule', href: '/schedule',
    steps: [
      { title: 'Check your next stop', detail: 'Open Today for upcoming visits and work needing attention.' },
      { title: 'Plan your next visit', detail: 'Choose Add visit from Today. On Add event, enter a title, date, and time.' },
      { title: 'Keep work connected', detail: 'Link your visit to a job when needed. Save and review it on your schedule.' }
    ]
  },
  {
    id: 'update', title: 'Keep everyone in context.', description: 'Find job updates, photos, and balances.', action: 'Open your jobs', href: '/jobs',
    steps: [
      { title: 'Open a job', detail: 'Choose a job from Jobs. Contact actions sit within easy reach.' },
      { title: 'Review project photos', detail: 'Choose Photos for images attached to this job. Use the camera action to capture new job photos.' },
      { title: 'Check payment records', detail: 'With financial access, choose Contract balance or Invoices from All tools. Review recorded amounts before taking action.' }
    ]
  }
]

export function quickGuide(id: string | null) {
  return QUICK_GUIDES.find(guide => guide.id === id) ?? QUICK_GUIDES[0]
}
