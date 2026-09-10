// คัดลอก frontend/src/lib/types.ts มาเป็น backend/src/contract.ts
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
export const HEADER =
  '// สำเนาของ frontend/src/lib/types.ts — สัญญาระหว่างสองฝั่ง\n' +
  '// แก้ที่ฝั่ง frontend แล้วรัน `pnpm sync-types` (มี test ตรวจว่าตรงกัน)\n\n'
const src = readFileSync(path.resolve(here, '../../frontend/src/lib/types.ts'), 'utf8')
writeFileSync(path.resolve(here, '../src/contract.ts'), HEADER + src)
console.log('sync เรียบร้อย')
