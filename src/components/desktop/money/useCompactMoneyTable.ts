import { useMediaQuery } from '../../../lib/useMediaQuery.ts'

/**
 * True below 1100 px. There the Money tables drop their Job column (and
 * Who owes you its Properties column) and read that line under the
 * customer's name instead, so the amount, the status and the Action
 * buttons keep their room (PHASE8_PLAN.md Task 14). Rendered, not hidden
 * with CSS, so the line is on the page once.
 */
export function useCompactMoneyTable(): boolean {
  return useMediaQuery('(max-width: 1099px)')
}
