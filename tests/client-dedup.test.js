import test from 'node:test';
import assert from 'node:assert/strict';
import '../public/client-dedup.js';
const {findGroups}=globalThis.ftwClientDedup;
const ids=group=>group.records.map(record=>record.id).sort();

test('customer names match despite case, punctuation, full-width characters and invisible spaces',()=>{
 const records=[{id:'upper',company:'SOYUZPISHCHEPROM ASSOCIATION LLC'},{id:'mixed',company:'Soyuzpishcheprom Association LLC'},{id:'width',company:'Ｓｏｙｕｚｐｉｓｈｃｈｅｐｒｏｍ\u200b－Ａｓｓｏｃｉａｔｉｏｎ ＬＬＣ'}];
 const groups=findGroups(records);assert.equal(groups.length,1);assert.equal(groups[0].type,'exact');assert.deepEqual(ids(groups[0]),['mixed','upper','width']);assert.match(groups[0].reasons.join(' '),/忽略大小写/);
});
test('the reported long-name spelling variation appears as a review candidate',()=>{
 const groups=findGroups([{id:'a',company:'SOYUZPICHSHEPROM ASSOCIATION LLC',country:'俄罗斯',contactName:'Mikhail Eremenko'},{id:'b',company:'Soyuzpishcheprom Association LLC',country:'俄罗斯',contactName:'MIKHAIL EREMENKO'}]);
 assert.equal(groups.length,1);assert.equal(groups[0].type,'similar');assert.deepEqual(ids(groups[0]),['a','b']);assert.match(groups[0].reasons.join(' '),/名称相近.*88%/);assert(groups[0].reasons.includes('联系人同名'));
});
test('short names, shared generic suffixes, different countries and shared contacts alone do not trigger fuzzy groups',()=>{
 for(const records of [
  [{company:'ABC LLC'},{company:'ABD LLC'}],
  [{company:'Alpha Association LLC'},{company:'Omega Association LLC'}],
  [{company:'SOYUZPICHSHEPROM ASSOCIATION LLC',country:'俄罗斯'},{company:'Soyuzpishcheprom Association LLC',country:'德国'}],
  [{company:'Atlas Machinery',contactName:'Mikhail Eremenko'},{company:'Nova Industrial',contactName:'Mikhail Eremenko'}]
 ])assert.equal(findGroups(records).length,0);
});
test('fuzzy relationships remain independent pairs instead of one transitive merge group',()=>{
 const groups=findGroups([{id:'a',company:'abcdefghij LLC'},{id:'b',company:'abcxefghij LLC'},{id:'c',company:'abcxefghik LLC'}]);
 assert.equal(groups.length,2);assert(groups.every(group=>group.type==='similar'&&group.records.length===2));assert.deepEqual(groups.map(ids),[['a','b'],['b','c']]);
});
test('strong phone and case-insensitive email matches remain grouped and explain their evidence',()=>{
 const groups=findGroups([{id:'a',company:'Alpha',contactPhone:'+86 (757) 1234-5678'},{id:'b',company:'Beta',contactPhone:'86 75712345678',contactEmail:'Contact@Example.com'},{id:'c',company:'Gamma',contactEmail:'contact@example.COM'}]);
 assert.equal(groups.length,1);assert.deepEqual(ids(groups[0]),['a','b','c']);assert(groups[0].reasons.some(reason=>reason.includes('电话')));assert(groups[0].reasons.some(reason=>reason.includes('邮箱')));
});
test('blank values and distinct email plus aliases do not create duplicate matches',()=>{
 assert.equal(findGroups([{company:'',contactEmail:'',contactPhone:'---'},{company:'+',contactEmail:'',contactPhone:'0'}]).length,0);
 assert.equal(findGroups([{company:'One',contactEmail:'a+b@example.com'},{company:'Two',contactEmail:'ab@example.com'}]).length,0);
});
test('candidate discovery leaves customer records and their stored spelling untouched',()=>{
 const records=Object.freeze([Object.freeze({id:'a',company:'Test Machinery LLC'}),Object.freeze({id:'b',company:'TEST MACHINERY LLC'})]);
 const before=JSON.stringify(records);assert.equal(findGroups(records).length,1);assert.equal(JSON.stringify(records),before);
});
