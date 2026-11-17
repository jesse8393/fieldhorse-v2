// The Reminders section at the top of the notifications screen (audit
// finding AUTO-09). One row per client, led by the newest open reminder:
// the client's name, that reminder's headline and how many are open. Under
// it, Call, Text or Email as the reminder asks, Done, and Dismiss, which
// asks for a second tap because it drops reminders nobody acted on. Done
// and Dismiss close every open reminder of the client, and the row leaves.

import { useEffect, useState } from 'react'
import { BellRing, Calendar } from 'lucide-react'
import { Button, Icon } from '../../components/fh'
import { fmtAge } from '../../lib/notifications.ts'
import { contactLinkFor, type ReminderGroup } from '../../lib/reminders.ts'
import { countNoun } from '../../lib/format.ts'

type Props = {
  groups: ReminderGroup[]
  busy: Set<string>
  onOpen: (group: ReminderGroup) => void
  onClose: (group: ReminderGroup, action: 'done' | 'dismissed') => void
}

export default function RemindersSection({ groups, busy, onOpen, onClose }: Props) {
  // The row whose Dismiss is waiting for its second tap.
  const [armed, setArmed] = useState<string | null>(null)
  useEffect(() => {
    if (!armed) return
    const timer = window.setTimeout(() => setArmed(null), 4000)
    return () => window.clearTimeout(timer)
  }, [armed])

  return (
    <section className="fhn-section" aria-labelledby="fhn-reminders-title">
      <h2 className="fhn-section__title" id="fhn-reminders-title">Reminders</h2>
      <ul className="fhn-rows">
        {groups.map((group) => {
          const lead = group.newest
          const isUnread = group.reminders.some((r) => !r.read_at)
          const isBusy = busy.has(group.key)
          const contact = contactLinkFor(lead)
          const count = group.reminders.length
          return (
            <li key={group.key} className={`fhn-row has-actions${isUnread ? ' is-unread' : ''}`}>
              <button type="button" className="fhn-row__main" onClick={() => onOpen(group)}>
                {isUnread && <span className="fhn-row__dot" aria-hidden="true" />}
                <span className="fhn-row__kind fhn-row__kind--neutral" aria-hidden="true">
                  <Icon icon={lead.kind === 'review_ask' ? Calendar : BellRing} size={18} />
                </span>
                <span className="fhn-row__text">
                  <span className="fhn-row__top">
                    <span className="fhn-row__title">
                      {isUnread && <span className="fhc-vh">Unread. </span>}
                      {group.clientName}
                    </span>
                    <span className="fhn-row__age">{fmtAge(lead.created_at)}</span>
                  </span>
                  <span className="fhn-row__body">{lead.headline}</span>
                  {count > 1 && <span className="fhn-row__meta">{count} {countNoun(count, 'reminder')}</span>}
                </span>
              </button>
              <div className="fhn-row__actions">
                {contact && (
                  <Button variant="secondary" size="mini" href={contact.href} aria-label={`${contact.label} ${group.clientName}`}>
                    {contact.label}
                  </Button>
                )}
                <Button variant="secondary" size="mini" loading={isBusy} onClick={() => { setArmed(null); onClose(group, 'done') }}>
                  Done
                </Button>
                <Button
                  variant={armed === group.key ? 'destructive' : 'quiet'}
                  size="mini"
                  disabled={isBusy}
                  onClick={() => {
                    if (armed === group.key) { setArmed(null); onClose(group, 'dismissed') }
                    else setArmed(group.key)
                  }}
                >
                  {armed === group.key ? 'Tap again to dismiss' : 'Dismiss'}
                </Button>
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
