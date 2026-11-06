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
  vm.runInContext(source.replace(/\}\)\(\);\s*$/, 'globalThis.api = {fetchTimelineData, escapeHTML, processTimelineData, sortReactionItems, recordObservedReactions};})();'),context);
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


test('sort modes, ties and unknown observation times',()=>{
 const api=harness([]).api;
 const items=[{timeline_id:1,created_at:10,total_reaction_users:8},{timeline_id:2,created_at:30,total_reaction_users:2,last_reaction_observed_at:100},{timeline_id:3,created_at:20,total_reaction_users:8,last_reaction_observed_at:200}];
 for(const [mode,expected] of Object.entries({likes_desc:[3,1,2],likes_asc:[2,3,1],published_desc:[2,3,1],published_asc:[1,3,2],observed_desc:[3,2,1],observed_asc:[2,3,1]})) {
 assert.equal(JSON.stringify(api.sortReactionItems(items,mode).map(x=>x.timeline_id)),JSON.stringify(expected));
 }
 assert.equal(items[0].timeline_id,1);
});
test('observation only advances for added reactions after baseline',()=>{
 const api=harness([]).api;
 const item={timeline_id:1,reactions:[{value:0,users:[{id:1}]}]};
 assert.equal(api.recordObservedReactions([], [item], false,100)[0].last_reaction_observed_at,0);
 const old={...item,last_reaction_observed_at:50};
 assert.equal(api.recordObservedReactions([old],[item],true,100)[0].last_reaction_observed_at,50);
 const added={...item,reactions:[{value:0,users:[{id:1},{id:2}]}]};
 assert.equal(api.recordObservedReactions([old],[added],true,100)[0].last_reaction_observed_at,100);
 assert.equal(api.recordObservedReactions([old],[{...item,reactions:[]}],true,100)[0].last_reaction_observed_at,50);
});

