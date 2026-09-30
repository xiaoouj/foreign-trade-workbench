import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createReleaseNotice, publicFingerprint, parseAnnouncement, parseAnnouncements, blockedPublicPath } from '../release-notice.js';

test('content versions ignore metadata/backups, detect JS-only deployment, remain stable until restart', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ftw-release-'));
  t.after(() => fs.rm(dir, { recursive:true, force:true }));
  await fs.mkdir(path.join(dir, 'public'));
  await fs.writeFile(path.join(dir, 'public/index.html'), '<html><head></head></html>');
  await fs.writeFile(path.join(dir, 'public/app.js'), 'old');
  let time = 0;
  const release = await createReleaseNotice(dir, { now: () => time });
  const original = await publicFingerprint(path.join(dir, 'public'));
  await fs.utimes(path.join(dir, 'public/app.js'), new Date(), new Date());
  await fs.writeFile(path.join(dir, 'public/app.js.bak-x'), 'ignored');
  assert.equal(await publicFingerprint(path.join(dir, 'public')), original);
  assert.equal((await release.version()).updating, false);
  assert.equal(release.announcement, null);
  await fs.writeFile(path.join(dir, 'public/app.js'), 'new');
  time = 5001;
  const changed = await release.version();
  assert.equal(changed.updating, true); assert.equal(changed.buildId, original);
  const restarted = await createReleaseNotice(dir);
  assert.notEqual(restarted.buildId, original);
  assert.equal((await restarted.version()).updating, false);
  assert.match(restarted.inject('<head lang="zh">'), new RegExp(restarted.buildId));
});

test('first CHANGELOG section only; unambiguous IDs; empty source is optional', () => {
  const a = parseAnnouncement('# 更新日志\n## First\n- one\n* two\n## Old\n- old');
  assert.deepEqual(a.items, ['one','two']);
  assert.equal(a.title, 'First'); assert.equal(a.id.length, 24);
  assert.equal(parseAnnouncement('# Empty'), null);
  assert.equal(parseAnnouncement('## Empty'), null);
  assert.notEqual(a.id, parseAnnouncement('## First\n- changed').id);
});

test('public server source, dot files, backups and temp files are not public assets', () => {
  for (const name of ['/server.js','/app.js.bak','/nested/foo.tmp-1','/.env','/a/.secret','/foo.codex-tmp']) assert.equal(blockedPublicPath(name), true, name);
  for (const name of ['/app.js','/nested/photo.png']) assert.equal(blockedPublicPath(name), false);
});

test('missing public directory degrades without killing service and prevents refresh advice', async () => {
  const release = await createReleaseNotice('/nonexistent-ftw-test-directory');
  assert.match(release.buildId, /^boot-/);
  assert.equal((await release.version()).updating, true);
});

test('same-day sections merge/deduplicate; later edits keep daily ID; next day has a new ID', () => {
  const first = parseAnnouncement('## 2026-09-21 · A\n- one');
  const updated = parseAnnouncement('## 2026-09-21 · B\n- two\n- one\n## 2026-09-21 · A\n- one\n## 2026-09-20 · Old\n- excluded');
  assert.equal(updated.id, first.id);
  assert.equal(updated.title, '2026-09-21 · 更新汇总');
  assert.deepEqual(updated.items, ['two', 'one']);
  assert.notEqual(parseAnnouncement('## 2026-09-22 · Next\n- one').id, first.id);
  assert.equal(parseAnnouncement('## 2026-02-30 · Invalid\n- one').date, null);
});

test('legacy announcement read is recognized without copying reads between accounts', async () => {
  const {announcementWasRead} = await import('../release-notice.js');
  const legacy='a'.repeat(24);
  const a=parseAnnouncement('## 2026-09-21 · Updates\n<!-- legacy-announcement-id: '+legacy+' -->\n- one');
  const notis={A:{['announce:'+legacy]:{read:true}}};
  assert.equal(announcementWasRead(notis,'A',a),true);
  assert.equal(announcementWasRead(notis,'B',a),false);
  assert.equal(announcementWasRead(notis,'A',parseAnnouncement('## 2026-09-22 · Next\n- two')),false);
});

test('system center keeps older dates, merges same-day releases and preserves daily IDs', () => {
  const rows = parseAnnouncements('## 2026-09-21 · A\n- one\n## 2026-09-20 · Old\n- old\n## 2026-09-21 · B\n- two');
  assert.equal(rows.length,2);assert.deepEqual(rows[0].items,['one','two']);assert.deepEqual(rows[1].items,['old']);
  assert.equal(rows[1].id,parseAnnouncement('## 2026-09-20 · Any title\n- newer text').id);
});

test('archive retains all changes on a busy release day', () => {
  const lines = Array.from({length:45}, (_,i) => '- change ' + i).join('\n');
  assert.equal(parseAnnouncements('## 2026-09-21 · Update\n' + lines)[0].items.length,45);
});
