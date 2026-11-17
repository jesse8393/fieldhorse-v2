import { describe, expect, it } from 'vitest'
import { MENU_GROUPS, SIDEBAR_MORE } from './navItems.ts'
import { canViewRoute } from './permissions.ts'

// D06: an owner with no teammates yet had no menu entry for Team, Tasks or
// Timesheets, so there was no visible path to invite the first teammate.
// The groups are filtered the way Workspace and the sidebar filter them.
function visible(groups: typeof MENU_GROUPS, role: string, hasCrew: boolean) {
  return groups
    .filter((g) => !g.crewOnly || hasCrew)
    .flatMap((g) => g.items.filter((it) => canViewRoute(role, it.to)).map((it) => it.label))
}

describe('the Team menu', () => {
  it('shows Team, Tasks and Timesheets to an owner or admin with no teammates', () => {
    for (const groups of [MENU_GROUPS, SIDEBAR_MORE]) {
      for (const role of ['owner', 'admin']) {
        expect(visible(groups, role, false)).toEqual(expect.arrayContaining(['Team', 'Tasks', 'Timesheets']))
      }
    }
  })
  it('still keeps Tasks and Timesheets from crew', () => {
    const labels = visible(MENU_GROUPS, 'crew', true)
    expect(labels).not.toContain('Tasks')
    expect(labels).not.toContain('Timesheets')
  })
})
