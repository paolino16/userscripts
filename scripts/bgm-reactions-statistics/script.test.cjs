const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const test = require('node:test');
const source = fs.readFileSync(__dirname + '/bgm-reactions-statistics.user.js', 'utf8');
function harness(pages) {
  let calls = 0;
  const context = {console:{log(){},error(){}}, URL, AbortSignal, setTimeout: fn => fn(),
    location:{origin:'https://bgm.tv',pathname:'/user/test/timeline'},
    document:{createElement:()=>({}),head:{appendChild(){}},querySelector:()=>null},
    $:()=>({ready(){}}),
    GM_xmlhttpRequest: opts => { const page=pages[calls++]; opts.onload({status:200,responseText:JSON.stringify(page)}); }
  };
  context.window = context; vm.createContext(context);
  vm.runInContext(source.replace(/\}\)\(\);\s*$/, 'globalThis.api = {fetchTimelineData, escapeHTML, processTimelineData};})();'),context);
  return {api:context.api,calls:()=>calls};
}
test('empty page terminates immediately', async()=>{
  const h=harness([[]]); const r=await h.api.fetchTimelineData('test');
  assert.equal(r.complete,true); assert.equal(h.calls(),1);
});
test('repeated full page rejects instead of saving partial data', async()=>{
  const page=Array.from({length:20},(_,i)=>({id:100-i}));
  const h=harness([page,page]);
  await assert.rejects(h.api.fetchTimelineData('test'),/分页未前进/); assert.equal(h.calls(),2);
});
test('malformed response rejects', async()=>{
  await assert.rejects(harness([{}]).api.fetchTimelineData('test'),/格式异常/);
});
test('short final page is complete', async()=>{
  const r=await harness([[{id:1}]]).api.fetchTimelineData('test'); assert.equal(r.complete,true);
});
test('untrusted display text is escaped',()=>{
  assert.equal(harness([]).api.escapeHTML('<img onerror="x">'), '&lt;img onerror=&quot;x&quot;&gt;');
});
test('missing reaction users does not crash',()=>{
  const r=harness([]).api.processTimelineData([{id:1,cat:3,batch:false,reactions:[{value:0}],memo:{subject:[{subject:{id:2}}]}}]);
  assert.equal(r[0].total_reaction_users,0);
});


