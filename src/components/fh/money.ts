// Money in the redesign always shows cents (spec 5.6). The formatter
// lives in lib/format.ts as moneyCents; components here import it under
// this name.
export { moneyCents as formatMoney } from '../../lib/format.ts'
