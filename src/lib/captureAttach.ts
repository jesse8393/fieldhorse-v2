// Opening Universal Capture from anywhere in the app. The sheet listens
// for the `fh:open-capture` window event (see CaptureSheet.tsx); a screen
// that knows which job the person is looking at passes its id so the
// capture is filed against that job.

export type OpenCaptureDetail = { jobId?: string }

export function openCapture(detail: OpenCaptureDetail = {}): void {
  window.dispatchEvent(new CustomEvent<OpenCaptureDetail>('fh:open-capture', { detail }))
}
