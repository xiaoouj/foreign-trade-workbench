import path from 'node:path';

// JSON uses a persisted rollback journal; MySQL commits all collections in one transaction.
// All callers run inside the application's existing write queue.
export function createCatalogStore({ dataDir, read, write, jsonRead, jsonWrite, dal, mode }) {
  const journal = path.join(dataDir, 'catalog-write-journal.json');
  const file = base => path.join(dataDir, base + '.json');
  async function recover() {
    if (mode() !== 'json') return;
    const pending = await jsonRead(journal, {});
    if (!pending.active) return;
    for (const [base, rows] of Object.entries(pending.originals)) await write(file(base), rows);
    await jsonWrite(journal, { active: false, recoveredAt: Date.now() });
  }
  async function commit(collections) {
    if (mode() === 'mysql') return dal.commitCatalog(collections);
    const originals = {};
    for (const base of Object.keys(collections)) originals[base] = await read(file(base), []);
    await jsonWrite(journal, { active: true, originals, at: Date.now() });
    try {
      for (const [base, rows] of Object.entries(collections)) await write(file(base), rows);
      await jsonWrite(journal, { active: false, committedAt: Date.now() });
    } catch (error) {
      // Preserve the pending journal if rollback fails so startup can recover it.
      for (const [base, rows] of Object.entries(originals)) await write(file(base), rows);
      await jsonWrite(journal, { active: false, rolledBackAt: Date.now() });
      throw error;
    }
  }
  return { recover, commit };
}
