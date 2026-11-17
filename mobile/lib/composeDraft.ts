// The native compose screen cleans a drafted message with the same rule as
// the web: a dash the model writes anyway becomes plain punctuation, and a
// range of numbers, times, days or months reads "to".
export { plainPunctuation } from '../../src/lib/composeDraft'
