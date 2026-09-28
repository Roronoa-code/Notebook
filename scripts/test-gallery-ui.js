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
      global.galleryCommits=[];global.galleryOnline=true;
      const api={status:()=>({sessions:global.galleryOnline?[{deviceId:'test',sessionId:'one',ready:true,scope:'All photos and videos'}]:[]}),
        list:(_device,cursor)=>{const offset=cursor||0;return {items:Array.from({length:256},(_,i)=>({key:'external_primary:image:'+(offset+i),name:'Disposable photo '+(offset+i),fingerprint:'v:1:1:1',type:'image'})),cursor:offset+256<10000?offset+256:null,scope:'All photos and videos'}},
        media:()=> 'nb://notebook/app/assets/grain-soft.png',history:()=>global.galleryCommits,mutate:(...a)=>{global.galleryCommits.push(a);return {id:'batch'}}};
      for(const [name,fn] of Object.entries(api)){ipcMain.removeHandler('gallery:'+name);ipcMain.handle('gallery:'+name,(_e,...args)=>({value:fn(...args)}));}
    });
    await page.click('#gallery-btn');await page.waitForSelector('.gg-tile img');
    assert.ok(await page.locator('.gg-tile').count()<60,'only viewport cards are rendered');
    await page.locator('.gg-tile').first().click();await page.waitForSelector('.gg-review img');
    await page.keyboard.press('k');assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('gallery-decisions:test')).length),1);
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
    assert.deepEqual(errors,[]);
    const out=path.join(__dirname,'../test-output/gallery');fs.mkdirSync(out,{recursive:true});await page.screenshot({path:path.join(out,'gallery.png')});
    console.log('Gallery UI checks passed: virtual grid, rapid keyboard review, undo, multi-select, explicit commit/cancel and disconnect.');
  } finally { await app.close(); }
})().catch(e=>{console.error(e);process.exitCode=1;});