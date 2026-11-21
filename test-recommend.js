
const r=require('./recommend');
const mk=(i,pm,conf,best)=>({m:{id:'m'+i,league:'L',date:new Date(Date.now()+3600e3*(i+1)).toISOString(),status:'SCHEDULED',home:{name:'H'+i},away:{name:'A'+i}},p:{pm,confidence:conf,best}});
const rows=[mk(1,{'1':.6,'1X':.85,'Over 1.5':.7},'High',{id:'1',source:'ai',p:.6}),mk(2,{'1X':.9},'Low',null),mk(3,{'2':.5,'X2':.8,'1X':.3},'Medium',{id:'1',source:'ai'}),mk(4,{'1X':.6},'High',null)];
const d={leagues:{L:{name:'L'}},matches:{},predictions:{},meta:{},teams:{}};
for(const x of rows){d.matches[x.m.id]=x.m;d.predictions[x.m.id]=Object.assign({league:'L',matchId:x.m.id,kickoff:x.m.date,actual:{}},x.p)}
const out=r.recommend(d,{from:new Date().toISOString(),to:new Date(Date.now()+30*3600e3).toISOString()});
const assert=require('assert');
assert.strictEqual(out.picks.length,1,'only the confident, non-contradicted match qualifies');
assert.strictEqual(out.picks[0].matchId,'m1'); assert.strictEqual(out.picks[0].pick,'1X'); assert.ok(out.picks[0].aiAgrees);
assert.ok(out.minP>=0.72); assert.deepStrictEqual(out.slip.ids,['m1']); assert.ok(out.slip.combined>=0.5);
console.log('OK recommended picks (low confidence, weak and AI-contradicted matches are skipped)');
