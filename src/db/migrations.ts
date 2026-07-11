import { Kysely, Migration, MigrationProvider, Migrator } from 'kysely'
import { DatabaseSchema } from './schema'

const migrations: Record<string, Migration> = {}

migrations['001_init'] = {
  async up(db: Kysely<unknown>) {
    await db.schema
      .createTable('post')
      .ifNotExists()
      .addColumn('uri', 'varchar', (col) => col.primaryKey())
      .addColumn('cid', 'varchar', (col) => col.notNull())
      .addColumn('author', 'varchar', (col) => col.notNull())
      .addColumn('indexedAt', 'varchar', (col) => col.notNull())
      .addColumn('reason', 'varchar')
      .addColumn('text', 'varchar')
      .execute()

    await db.schema
      .createIndex('post_indexed_at_cid_idx')
      .ifNotExists()
      .on('post')
      .columns(['indexedAt', 'cid'])
      .execute()

    await db.schema
      .createTable('sub_state')
      .ifNotExists()
      .addColumn('service', 'varchar', (col) => col.primaryKey())
      .addColumn('cursor', 'integer', (col) => col.notNull())
      .execute()
  },
  async down(db: Kysely<unknown>) {
    await db.schema.dropTable('sub_state').ifExists().execute()
    await db.schema.dropTable('post').ifExists().execute()
  },
}

const migrationProvider: MigrationProvider = {
  async getMigrations() {
    return migrations
  },
}

export const migrateToLatest = async (db: Kysely<DatabaseSchema>) => {
  const migrator = new Migrator({ db, provider: migrationProvider })
  const { error, results } = await migrator.migrateToLatest()
  results?.forEach((r) => {
    if (r.status === 'Success') {
      console.log(`[db] migration "${r.migrationName}" applied`)
    } else if (r.status === 'Error') {
      console.error(`[db] migration "${r.migrationName}" failed`)
    }
  })
  if (error) throw error
}
