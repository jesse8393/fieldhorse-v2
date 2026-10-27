/** Fetch a complete ordered result. A failed later page must not appear complete. */
export async function readAllRows(build, pageSize = 500) {
  const rows = []
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await build(offset, offset + pageSize - 1)
    if (error) return { data: null, error }
    rows.push(...(data || []))
    if ((data || []).length < pageSize) return { data: rows, error: null }
  }
}
