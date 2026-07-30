import type { ReactNode } from 'react'

export type DataTableColumn<Row> = {
  key: string
  header: ReactNode
  align?: 'left' | 'center' | 'right'
  render: (row: Row) => ReactNode
}

type DataTableProps<Row> = {
  columns: DataTableColumn<Row>[]
  rows: Row[]
  getRowKey: (row: Row, index: number) => string
  empty?: ReactNode
  caption?: string
}

export default function DataTable<Row>({
  columns,
  rows,
  getRowKey,
  empty = 'No records',
  caption
}: DataTableProps<Row>) {
  if (rows.length === 0) {
    return <div className="fh-data-table__empty">{empty}</div>
  }

  return (
    <div className="fh-data-table__scroll">
      <table className="fh-data-table">
        {caption ? <caption className="sr-only">{caption}</caption> : null}
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key} scope="col" data-align={column.align || 'left'}>
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={getRowKey(row, index)}>
              {columns.map((column) => {
                const value = column.render(row)
                const isEmpty = value == null || value === ''
                return (
                  <td key={column.key} data-align={column.align || 'left'}>
                    {isEmpty ? <span className="fh-data-table__placeholder">{'\u2003'}</span> : value}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
