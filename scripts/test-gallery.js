// Real TLS/server + broker, disposable settings only. No phone or original files.
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const { SyncServer } = require('../main/sync-server');
const { Gallery } = require('../main/gallery');
const { Library } = require('../main/library');

(async()=> {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'notebook-gallery-'));
  const gallery=new Gallery(path.join(root,'gallery'));
  const server=new SyncServer({ settingsFile:path.join(root,'sync.json'),host:'127.0.0.1',port:48701,discoveryPort:48702,secure:true });
  server.gallery=gallery;
  const request=(route,body,token,session,method='POST',pin=server.identity.fingerprint)=>new Promise((resolve,reject)=> {
    const req=https.request({hostname:'127.0.0.1',port:server.securePort,path:route,method,agent:false,
      ca:new crypto.X509Certificate(Buffer.from(JSON.parse(fs.readFileSync(path.join(root,'secure-sync/identity.json'))).cert,'base64')).toString(),
      checkServerIdentity:(_host,cert)=>crypto.createHash('sha256').update(cert.raw).digest('hex')===pin?undefined:new Error('Wrong pin'),
      headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{}),...(session?{'X-Gallery-Session':session}:{})}},res=> {
      let text='';res.on('data',c=>text+=c);res.on('end',()=>resolve({status:res.statusCode,body:JSON.parse(text)}));
    });req.on('error',reject);req.end(JSON.stringify(body));
  });
  try {
    await server.start(await Library.openOrCreate(path.join(root,'lib'))); assert.ok(server.securePort,server.secureError);
    const pair=async device=> { const code=server.newCode();const r=await request('/api/pair',{code,deviceId:device});assert.equal(r.status,200);return r.body.token; };
    const token=await pair('phone-one'), other=await pair('phone-two'), session=crypto.randomUUID();
    await assert.rejects(request('/api/ping',{},token,null,'GET','0'.repeat(64)),/Wrong pin/);
    assert.equal((await fetch(`http://127.0.0.1:${server.port}/api/ping`,{headers:{Authorization:'Bearer '+token}})).status,401);
    assert.equal((await request('/api/gallery/session',{sessionId:session,scope:'All photos and videos'},token)).status,200);
    assert.equal((await request('/api/gallery/poll',{ready:true},other,session)).status,409);
    const query=gallery.list('phone-one',null);
    const command=(await request('/api/gallery/poll',{ready:true},token,session)).body.command;
    assert.equal(command.kind,'list');
    assert.equal((await request('/api/gallery/result/'+command.id,{items:[]},other,session)).status,409);
    await request('/api/gallery/result/'+command.id,{items:[],cursor:null},token,session); assert.deepEqual(await query,{items:[],cursor:null});
    const item={key:'external_primary:image:123',fingerprint:'version:1024:100:1'};
    await assert.rejects(gallery.mutate('phone-one','delete',[item]),/Choose/);
    await assert.rejects(gallery.mutate('phone-one','trash',[{key:'../../secrets',fingerprint:'x'}]),/Invalid/);
    const cancelled=gallery.media('phone-one',item,'preview');
    const cancelledCheck=assert.rejects(cancelled,/cancelled/);gallery.cancelReads('phone-one',true);await cancelledCheck;
    const op=await gallery.mutate('phone-one','trash',[item]);
    await assert.rejects(gallery.mutate('phone-one','trash',[item]),/previous/);
    const trash=(await request('/api/gallery/poll',{ready:true},token,session)).body.command;
    assert.equal(trash.id,op.id);assert.equal(trash.kind,'trash');
    await request('/api/gallery/result/'+op.id,{status:'finished',results:[{key:item.key,state:'trashed',fingerprint:'version:1024:100:2'}]},token,session);
    assert.equal(gallery.history('phone-one')[0].results[0].state,'trashed');
    const restored=await gallery.mutate('phone-one','restore',[item],op.id);
    assert.equal(gallery.history('phone-one')[0].items[0].fingerprint,'version:1024:100:2');
    gallery.revoke('phone-one'); await new Promise(r=>setImmediate(r));
    assert.equal(gallery.history('phone-one').find(o=>o.id===restored.id).status,'unknown');
    assert.throws(()=>gallery.session('phone-one'),/Open Notebook/);
    const reopened=new Gallery(path.join(root,'gallery'));assert.equal(reopened.history('phone-one').length,2);
    console.log('Gallery checks passed: TLS pinning, no plaintext downgrade, cross-device/session isolation, safe batch validation, durable results, restore identity and no replay on disconnect.');
  } finally { await server.stop();fs.rmSync(root,{recursive:true,force:true}); }
})().catch(e=>{console.error(e);process.exitCode=1;});
