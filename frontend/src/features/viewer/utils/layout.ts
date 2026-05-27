import type { FileRecord } from '../../../types'

const COLUMN_WIDTH = 340
const COLUMN_GAP = 20
const ROW_GAP = 20
const CARD_HEIGHT = 400

export function waterfallLayout(
  files: FileRecord[],
  columnCount = 4
): { id: string; position: { x: number; y: number } }[] {
  const columnHeights = new Array(columnCount).fill(0)

  return files.map((file) => {
    const col = columnHeights.indexOf(Math.min(...columnHeights))
    const x = col * (COLUMN_WIDTH + COLUMN_GAP)
    const y = columnHeights[col]
    columnHeights[col] += CARD_HEIGHT + ROW_GAP
    return { id: file.id, position: { x, y } }
  })
}
