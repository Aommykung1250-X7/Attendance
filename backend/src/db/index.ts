import { drizzle } from 'drizzle-orm/node-postgres'
import pg from 'pg'
import { config } from '../config.js'
import * as schema from './schema.js'

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 10 })
export const db = drizzle(pool, { schema })

export type DB = typeof db
/** ใช้ได้ทั้ง db และ transaction */
export type Tx = Parameters<Parameters<DB['transaction']>[0]>[0] | DB

export { schema }
