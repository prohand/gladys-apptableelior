// -----------------------------------------------------------------------------
// What the integration must remember across restarts: the invoices already
// seen, so a restart (or an update of the integration) does not announce every
// past invoice as new.
//
// Kept in /data, the only writable path of the sandboxed container. A file
// that cannot be read or written costs the memory, never the integration: the
// worst case is that the invoices present at startup are taken as known.
// -----------------------------------------------------------------------------

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createLogger } from '@gladysassistant/integration-sdk';

const logger = createLogger({ name: 'memory' });

export const DEFAULT_MEMORY_FILE = '/data/apptable-state.json';

/** Invoices kept in memory: years of monthly invoices, for several holders. */
const MAX_INVOICES = 500;

/**
 * @param {string} [file]
 * @returns {Promise<{ invoiceIds: Set<string>|null, rememberInvoices(ids: string[]): Promise<void> }>}
 *   `invoiceIds` is null until the first invoice list was ever stored
 */
export async function loadMemory(file = DEFAULT_MEMORY_FILE) {
  let invoiceIds = null;
  try {
    const raw = JSON.parse(await readFile(file, 'utf8'));
    if (Array.isArray(raw.invoiceIds)) {
      invoiceIds = new Set(raw.invoiceIds.map(String));
    }
  } catch (err) {
    if (err.code !== 'ENOENT') {
      logger.warn(`Cannot read ${file}: ${err.message}`);
    }
  }

  return {
    get invoiceIds() {
      return invoiceIds;
    },
    async rememberInvoices(ids) {
      invoiceIds = new Set([...(invoiceIds ?? []), ...ids]);
      const kept = [...invoiceIds].slice(-MAX_INVOICES);
      try {
        await mkdir(dirname(file), { recursive: true });
        await writeFile(file, JSON.stringify({ invoiceIds: kept }));
      } catch (err) {
        logger.warn(`Cannot write ${file}: ${err.message}`);
      }
    },
  };
}
