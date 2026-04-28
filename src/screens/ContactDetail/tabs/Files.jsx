import StubTab from './_StubTab.jsx'

/**
 * FILES tab — sub-tab router.
 *
 * Sub-sections (to be built in Drop 3.3):
 *   - Photos (fh_job_files where kind=photo + upload + Vision auto-caption)
 *   - Files (fh_job_files where kind=file + upload + download)
 *   - Messages (fh_notes log + inline add)
 */
export default function FilesTab(props) {
  return <StubTab name="Files" upcoming={['Photos', 'Files', 'Messages']} />
}
