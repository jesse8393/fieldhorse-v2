import { addDaysYmd, todayYmd } from './dates.ts'

export const QUOTE_FOLLOW_UP_DAY_OPTIONS = [1, 2, 3, 5, 7, 14, 30] as const
export const DEFAULT_QUOTE_FOLLOW_UP_DAYS = 3

export type QuoteFollowUpConfig = {
  enabled: boolean
  days: number
}

type JsonObject = Record<string, unknown>

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function normalizeDays(value: unknown): number {
  const days = Number(value)
  return QUOTE_FOLLOW_UP_DAY_OPTIONS.includes(days as (typeof QUOTE_FOLLOW_UP_DAY_OPTIONS)[number])
    ? days
    : DEFAULT_QUOTE_FOLLOW_UP_DAYS
}

export function readQuoteFollowUpPreferences(preferences: unknown): QuoteFollowUpConfig {
  const root = isObject(preferences) ? preferences : {}
  const raw = isObject(root.quote_follow_up) ? root.quote_follow_up : {}
  return {
    enabled: typeof raw.enabled === 'boolean' ? raw.enabled : true,
    days: normalizeDays(raw.days),
  }
}

export function mergeQuoteFollowUpPreferences(
  preferences: unknown,
  config: QuoteFollowUpConfig,
): JsonObject {
  const root = isObject(preferences) ? preferences : {}
  const current = isObject(root.quote_follow_up) ? root.quote_follow_up : {}
  return {
    ...root,
    quote_follow_up: {
      ...current,
      enabled: Boolean(config.enabled),
      days: normalizeDays(config.days),
    },
  }
}

export function quoteFollowUpDate(preferences: unknown, now: Date = new Date()): string | null {
  const config = readQuoteFollowUpPreferences(preferences)
  if (!config.enabled) return null
  return addDaysYmd(todayYmd(now), config.days)
}

export function formatFollowUpDate(value: string | null | undefined): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || '')
  if (!match) return ''
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}
