// Real Electron UI with a synthetic phone. No user library, OS input or real mutations.
const { _electron: electron }=require('playwright-core');
const assert=require('assert/strict'), path=require('path'), fs=require('fs');
const { Library }=require('../main/library');
(async()=> {
  const root=path.resolve(__dirname,'..'), out=path.join(root,'test-output','gallery-ui-'+process.pid), userData=path.join(out,'userdata'),libraryPath=path.join(out,'library');
  fs.mkdirSync(userData,{recursive:true});await Library.openOrCreate(libraryPath);
  fs.writeFileSync(path.join(userData,'config.json'),JSON.stringify({libraryPath}));
  const app=await electron.launch({...(process.env.NOTEBOOK_EXE?{executablePath:process.env.NOTEBOOK_EXE}:{args:[root]}),env:{...process.env,NOTEBOOK_USER_DATA:userData,NOTEBOOK_SYNC_HOST:'127.0.0.1',NOTEBOOK_SYNC_PORT:'48961',NOTEBOOK_WINDOW_DISPLAY:'second',NOTEBOOK_FAKE_RECOGNISER:'1',NOTEBOOK_FAKE_NAMES:'1'}});
  try {
    const page=await app.firstWindow(),errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.waitForFunction(()=>window.NB?.S?.snap);
    await app.evaluate(({ipcMain})=>{
      global.galleryCommits=[];global.galleryOnline=true;global.galleryReads=[];
      const api={status:()=>({sessions:global.galleryOnline?[{deviceId:'test',sessionId:'one',ready:true,scope:'All photos and videos'}]:[]}),
        list:(_device,cursor)=>{const offset=cursor||0;return {items:Array.from({length:256},(_,i)=>({key:'external_primary:image:'+(offset+i),name:'Disposable photo '+(offset+i),fingerprint:'v:1:1:1',type:'image'})),cursor:offset+256<10000?offset+256:null,scope:'All photos and videos'}},
        media:(_d,it,kind)=>{global.galleryReads.push(kind+' '+it.key);return 'nb://notebook/app/assets/grain-soft.png'},history:()=>global.galleryCommits,mutate:(...a)=>{global.galleryCommits.push(a);return {id:'batch'}}};
      for(const [name,fn] of Object.entries(api)){ipcMain.removeHandler('gallery:'+name);ipcMain.handle('gallery:'+name,(_e,...args)=>({value:fn(...args)}));}
    });
    await page.click('#gallery-btn');await page.waitForSelector('.gg-tile img');
    assert.ok(await page.locator('.gg-tile').count()<60,'only viewport cards are rendered');
    await page.locator('.gg-tile').first().click();await page.waitForSelector('.gg-review img');
    // the next cards' sharp pictures are fetched while the first is looked at, so they arrive ready
    const reads=await app.evaluate(()=>global.galleryReads);for(let i=1;i<=4;i++)assert.ok(reads.includes('preview external_primary:image:'+i),'card '+i+' fetched ahead');
    await page.keyboard.press('k');assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('gallery-decisions:test')).length),1);
    // the deck: each decision lands on its pile, which grows; Undo brings the card back on top
    const top=()=>page.evaluate(()=>[...document.querySelectorAll('.gg-deck .gg-card')].sort((a,b)=>+b.style.zIndex-+a.style.zIndex)[0]?.dataset.key); // (the top card is the highest one)
    assert.equal(await page.locator('.gg-heap[data-d=keep] .gg-mini').count(),1,'the kept card is on the Keep pile');
    const before=await top();await page.keyboard.press('ArrowLeft');await page.keyboard.press('ArrowRight');
    assert.equal(await page.locator('.gg-heap[data-d=keep] .gg-mini').count(),2,'the Keep pile grows');
    assert.equal(await page.locator('.gg-heap[data-d=trash] b').innerText(),'1');
    await page.keyboard.press('z');await page.keyboard.press('z');
    assert.equal(await top(),before,'Undo puts the card back on top of the deck');
    // dragging the card far enough to the left trashes it; a short drag springs back
    await page.waitForTimeout(700); // (Undo's card is still flying back off its pile)
    const c=await page.locator('.gg-deck .gg-card').last().boundingBox(),cx=c.x+c.width/2,cy=c.y+c.height/2,t0=await page.locator('.gg-heap[data-d=trash] b').innerText();
    await page.mouse.move(cx,cy);await page.mouse.down();await page.mouse.move(cx-60,cy,{steps:6});await page.mouse.up();
    assert.equal(await page.locator('.gg-heap[data-d=trash] b').innerText(),t0,'a short drag springs back');
    await page.waitForTimeout(500);
    await page.mouse.move(cx,cy);await page.mouse.down();await page.mouse.move(cx-220,cy,{steps:10});await page.mouse.up();
    assert.equal(await page.locator('.gg-heap[data-d=trash] b').innerText(),String(+t0+1),'a long drag left trashes it');
    await page.keyboard.press('z');
    await page.waitForTimeout(600);
    await page.screenshot({path:path.join(__dirname,'../test-output/gallery-deck.png')});
    // full screen: Enter makes the photo fill the window; Esc brings it back (and only then leaves the deck)
    await page.keyboard.press('Enter');await page.waitForTimeout(550);
    assert.equal(await page.locator('.gg-review.gg-zoomed').count(),1,'Enter shows the photo full screen');
    await page.keyboard.press('Escape');await page.waitForTimeout(550);
    assert.equal(await page.locator('.gg-review:not(.gg-zoomed)').count(),1,'Esc returns to the deck, still reviewing');
    await page.keyboard.press('t');await page.keyboard.press('Control+z');
    assert.equal(await page.evaluate(async()=>(await nb.galleryHistory('test')).value.length),0,'keyboard decisions never mutate phone');
    await page.keyboard.press('Escape');
    await page.locator('.gg-tile').nth(2).click({modifiers:['Control']});
    await page.locator('.gg-tile').nth(3).click({modifiers:['Control']});
    await page.locator('.gg-footer').getByRole('button',{name:'Mark trash · T',exact:true}).click();
    assert.equal(await page.locator('#gg-mark-count').innerText(),'2');
    await page.locator('#gg-commit').click();await page.getByRole('button',{name:'Cancel',exact:true}).click();
    assert.equal(await page.evaluate(async()=>(await nb.galleryHistory('test')).value.length),0,'cancel is non-destructive');
    await page.waitForSelector('dialog',{state:'detached'});
    await page.locator('#gg-commit').click();await page.getByRole('button',{name:'Trash on phone',exact:true}).click();
    assert.equal(await page.evaluate(async()=>(await nb.galleryHistory('test')).value[0][2].length),2,'only marked items submitted');
    await page.evaluate(async()=>document.querySelector('.gg-viewport').scrollTop=999999);await page.waitForTimeout(2300);
    assert.ok(await page.locator('.gg-tile').count()<60,'scroll keeps DOM bounded');
    await app.evaluate(()=>global.galleryOnline=false);await page.waitForTimeout(2300);
    assert.equal(await page.locator('#gg-commit').isDisabled(),true,'disconnect disables commit');
    await page.click('.bcard[data-id="all"]');await page.waitForSelector('.gg-shell',{state:'detached'});
    assert.equal(await page.locator('#page').evaluate(el=>el.inert),false,'sidebar navigation exits Gallery cleanly');
    await app.evaluate(()=>global.galleryOnline=true);await page.click('#gallery-btn');await page.waitForSelector('.gg-tile img');
    // a batch that finishes says so, and its photos leave the grid
    await app.evaluate(({ipcMain})=>{ipcMain.removeHandler('gallery:history');ipcMain.handle('gallery:history',()=>({value:[{id:'00000000-0000-4000-8000-000000000001',action:'trash',status:'finished',created:Date.now(),items:[{key:'external_primary:image:0',fingerprint:'v:1:1:1'}],results:[{key:'external_primary:image:0',state:'trashed',fingerprint:'v:1:1:2'}]}]}));});
    await page.evaluate(()=>{document.querySelector('.gg-viewport').scrollTop=0;});
    await page.waitForFunction(()=>/Moved 1 photo to your phone's trash/.test(document.body.innerText),null,{timeout:6000});
    await page.waitForTimeout(800);
    assert.equal(await page.locator('.gg-tile[data-key="external_primary:image:0"]').count(),0,'the trashed photo has left the grid');
    assert.deepEqual(errors,[]);
    const out=path.join(__dirname,'../test-output/gallery');fs.mkdirSync(out,{recursive:true});await page.screenshot({path:path.join(out,'gallery.png')});
    console.log('Gallery UI checks passed: virtual grid, swipe deck with growing piles, rapid keyboard review, undo, multi-select, explicit commit/cancel and disconnect.');
  } finally { await app.close(); }
})().catch(e=>{console.error(e);process.exitCode=1;});