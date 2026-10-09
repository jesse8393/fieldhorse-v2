// src/lib/speech.ts
//
// Plain feedback for Web Speech API failures. Without it a blocked
// microphone or a silent timeout just snapped the mic button back to idle
// with no hint of what went wrong.

export type SpeechErrorFeedback = {
  title: string
  description: string
  tone: 'error' | 'info'
}

/**
 * Toast copy for a SpeechRecognition error code (event.error). Returns
 * null for 'aborted', which fires when the app stops recognition itself.
 */
export function speechErrorFeedback(code: unknown): SpeechErrorFeedback | null {
  switch (code) {
    case 'aborted':
      return null
    case 'not-allowed':
    case 'service-not-allowed':
      return {
        title: 'Microphone blocked',
        description: 'Allow microphone access in your browser settings, then try again.',
        tone: 'error'
      }
    case 'no-speech':
      return {
        title: "Didn't catch that",
        description: 'No speech was heard. Tap the mic and try again.',
        tone: 'info'
      }
    case 'audio-capture':
      return {
        title: 'No microphone found',
        description: 'Check that a microphone is connected and not in use by another app.',
        tone: 'error'
      }
    case 'network':
      return {
        title: 'Voice needs a connection',
        description: 'Speech recognition could not reach the network. Type it instead.',
        tone: 'error'
      }
    default:
      return {
        title: 'Voice stopped',
        description: 'Something interrupted voice capture. Try again or type it instead.',
        tone: 'error'
      }
  }
}
