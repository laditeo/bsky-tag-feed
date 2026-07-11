import { Kysely, PostgresDialect } from 'kysely'
import { Pool } from 'pg'
import { DatabaseSchema } from './schema'

export type Database = Kysely<DatabaseSchema>

export const createDb = (connectionString: string, ssl: boolean): Database => {
  const pool = new Pool({
    connectionString,
    ssl: ssl ? { rejectUnauthorized: false } : undefined,
  })
  return new Kysely<DatabaseSchema>({
    dialect: new PostgresDialect({ pool }),
  })
}

export * from './schema'
export { migrateToLatest } from './migrations'
