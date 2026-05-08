declare module 'pg-cursor' {
  import { Submittable } from 'pg'
  interface CursorOptions {
    rowMode?: 'array'
  }
  type ReadCallback = (err: Error | null, rows: unknown[]) => void
  class Cursor implements Submittable {
    constructor(text: string, values?: unknown[], options?: CursorOptions)
    submit(connection: unknown): void
    read(rowCount: number, callback: ReadCallback): void
    close(callback?: () => void): void
  }
  export default Cursor
}
