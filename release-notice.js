// Release metadata is computed once; never label an old page using a later API response.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
export function blockedPublicPath(value) {
  return value.split(/[\\/]/).some(p => p.startsWith('.') || /^server\.js$/i.test(p) || /\.(bak|tmp)/i.test(p) || /\.codex-tmp$/i.test(p));
}
export async function publicFingerprint(dir) {
  const entries = [];
  async function walk(base, prefix = '') {
    for (const item of await fs.readdir(base, { withFileTypes: true })) {
      const name = prefix + item.name;
      if (blockedPublicPath(name) || item.isSymbolicLink()) continue;
      if (item.isDirectory()) await walk(path.join(base, item.name), name + '/');
      else if (item.isFile()) entries.push([name, hash(await fs.readFile(path.join(base, item.name)))]);
    }
  }
  await walk(dir);
  entries.sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
  return hash(JSON.stringify(entries)).slice(0, 24);
}
export function parseAnnouncements(markdown) {
  const sections = [];
  let section;
  for (const line of markdown.split(/\r?\n/)) {
    if (/^##\s+\S/.test(line)) {
      section = { title: line.replace(/^##\s+/, '').trim().slice(0, 200), items: [], aliases: [] };
      sections.push(section);
    } else if (section) {
      const item = line.match(/^[-*]\s+(.+)/);
      if (item) section.items.push(item[1].trim().slice(0, 2000));
      const alias = line.match(/^<!-- legacy-announcement-id: ([a-f0-9]{24}) -->$/);
      if (alias) section.aliases.push(alias[1]);
    }
  }
  if (!sections.length) return [];
  const dateOf = title => {
    const date = title.match(/^(\d{4}-\d{2}-\d{2})(?:\s|$)/)?.[1];
    if (!date) return null;
    const time = Date.parse(date + 'T00:00:00Z');
    return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === date ? date : null;
  };
  const seen = new Set(), announcements = [];
  for (const first of sections) {
    const date = dateOf(first.title);
    const key = date || first;
    if (seen.has(key)) continue;
    seen.add(key);
    const group = date ? sections.filter(s => dateOf(s.title) === date) : [first];
    const items = [...new Set(group.flatMap(s => s.items))];
    if (!items.length) continue;
    const id = date ? hash('daily-announcement:' + date).slice(0, 24) : hash(JSON.stringify([first.title, items])).slice(0, 24);
    const legacyIds = [...new Set(group.flatMap(s => [hash(JSON.stringify([s.title, s.items])).slice(0, 24), ...s.aliases]))].filter(value => value !== id);
    announcements.push({ id, date, title: date ? date + ' · 更新汇总' : first.title, items, legacyIds });
  }
  return announcements;
}
export function parseAnnouncement(markdown) { return parseAnnouncements(markdown)[0] || null; }

export function announcementWasRead(notifications, userId, announcement) {
  if (!announcement) return false;
  return [announcement.id, ...(announcement.legacyIds || [])].some(id => !!notifications?.[userId]?.['announce:' + id]?.read);
}
export async function createReleaseNotice(root, { now = Date.now } = {}) {
  const dir = path.join(root, 'public');
  let buildId, healthy = true;
  try { buildId = await publicFingerprint(dir); }
  catch { healthy = false; buildId = 'boot-' + crypto.randomUUID(); console.error('[release] 静态资源版本计算失败，暂不建议刷新'); }
  let announcements = [];
  try { announcements = parseAnnouncements(await fs.readFile(path.join(root, 'CHANGELOG.md'), 'utf8')); }
  catch (e) { if (e.code !== 'ENOENT') console.error('[release] 更新公告暂不可用'); }
  let lastCheck = -Infinity, updating = !healthy, pending;
  return {
    buildId, announcement: announcements[0] || null, announcements,
    inject(html) { return html.replace(/<head\b[^>]*>/i, tag => tag + '\n<script data-ftw-build>window.__FTW_BUILD__=' + JSON.stringify(buildId) + ';</script>'); },
    async version() {
      // Advisory only: the documented deployment still stops the app before replacing files.
      if (!pending && now() - lastCheck >= 5000) {
        pending = (async () => {
          try { updating = !healthy || await publicFingerprint(dir) !== buildId; }
          catch { updating = true; }
          finally { lastCheck = now(); }
        })();
      }
      if (pending) { const check = pending; await check; if (pending === check) pending = null; }
      return { buildId, updating };
    }
  };
}
