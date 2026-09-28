// Remote Gallery: bounded DOM and on-demand phone previews, independent of library cards.
(() => {
  const { h, icon } = NB;
  let shell, viewport, canvas, toolbar, notice, viewer, timer, resize, device, session, scope='', ready=false;
  let items=[], cursor=null, more=true, loading=false, epoch=0, mode='all', active=null, selected=new Set();
  let marks=new Map(), undo=[], thumbs=new Map(), wanted=[], workers=0, history=[], applied=new Set();
  let focusBefore;
  let toolbarStamp='', opening=false;
  const btn=(label,fn,cls='')=>h('button',{type:'button',class:'btn small '+cls,onclick:fn},label);
  async function call(name,...args) { const r=await nb['gallery'+name](...args); if(r.error)throw new Error(r.error); return r.value; }
  const tell=e=>NB.toast(e.message || String(e),{error:true});
  const thumbnail=(it,url)=>h('img',{src:url,alt:'',draggable:false,decoding:'async',onerror:()=>{if(ready && shell && thumbs.get(it.key)===url){thumbs.delete(it.key);draw();}}});
  const rows=()=>items.filter(it=>mode==='marked'?marks.get(it.key)?.decision==='trash':mode==='unreviewed'?!marks.has(it.key):true);
  const storage=()=> 'gallery-decisions:'+device;
  function save() {
    try { localStorage.setItem(storage(),JSON.stringify([...marks])); }
    catch { NB.toast('Could not save review decisions. Keep this window open.',{error:true}); }
  }
  function loadMarks() { try { marks=new Map(JSON.parse(localStorage.getItem(storage())||'[]')); } catch { marks=new Map(); } }
  function decide(decision) {
    const keys=selected.size?[...selected]:active?[active.key]:[];
    if(!keys.length)return;
    const before=[];
    for(const key of keys) {
      const it=items.find(i=>i.key===key); if(!it)continue;
      before.push([key,marks.get(key)]); marks.set(key,{key,fingerprint:it.fingerprint,decision});
    }
    undo.push(before); if(undo.length>2000)undo.shift(); selected.clear(); save();
    if(viewer && active)next(1); render();
  }
  function undoDecision() {
    const previous=undo.pop(); if(!previous)return;
    for(const [key,value] of previous) { if(value)marks.set(key,value);else marks.delete(key); }
    save(); render();
  }
  function render(grid=true) {
    if(!shell)return;
    const marked=[...marks.values()].filter(m=>m.decision==='trash').length;
    if(toolbarStamp!==mode+'|'+scope) { toolbarStamp=mode+'|'+scope; toolbar.replaceChildren(
      h('div',{class:'gg-title'},h('h1',null,'Phone Gallery'),h('span',{class:'hint'},scope || 'Your photos, ready for a fresh start')),
      btn('All',()=>filter('all'),mode==='all'?'accent':''),btn('Unreviewed',()=>filter('unreviewed'),mode==='unreviewed'?'accent':''),
      btn('Marked',()=>filter('marked'),mode==='marked'?'accent':''),
      btn('Refresh',()=>refresh()),btn('Recent trash',()=>showHistory()),btn('Close',close)); }
    notice.textContent=ready?`${items.length.toLocaleString()} loaded${more?' · more as you scroll':''} · ${selected.size} selected · ${marked} marked for trash`:
      'Open Notebook on your phone → Sync → Start cleanup. Scan the new PC pairing code once if asked.';
    shell.querySelector('#gg-commit').disabled=!ready || !marked;
    shell.querySelector('#gg-mark-count').textContent=String(marked);
    if(grid)draw();
  }
  function filter(value) { mode=value; selected.clear(); viewport.scrollTop=0; render(); }
  function draw() {
    if(!viewport || !canvas)return;
    const list=rows(), width=viewport.clientWidth, cols=Math.max(2,Math.floor(width/190));
    const size=(width-16*(cols-1))/cols, height=size+34;
    canvas.style.height=Math.ceil(list.length/cols)*height+'px';
    const first=Math.max(0,Math.floor(viewport.scrollTop/height)-1)*cols;
    const last=Math.min(list.length,(Math.ceil((viewport.scrollTop+viewport.clientHeight)/height)+1)*cols);
    const fragment=document.createDocumentFragment(); wanted=[];
    for(let i=first;i<last;i++) {
      const it=list[i], mark=marks.get(it.key), url=thumbs.get(it.key);
      const tile=h('button',{type:'button',class:'gg-tile'+(selected.has(it.key)?' picked':'')+(mark?' '+mark.decision:''),
        style:{left:(i%cols)*(size+16)+'px',top:Math.floor(i/cols)*height+'px',width:size+'px',height:(height-16)+'px'},
        'data-key':it.key, 'aria-label':`${it.name}${mark?' · '+mark.decision:''}`, 'aria-pressed':String(selected.has(it.key)),
        onclick:e=> {
          if(e.ctrlKey||e.metaKey||e.shiftKey) {
            if(e.shiftKey && active) {
              const from=list.findIndex(x=>x.key===active.key); if(from>=0)for(let n=Math.min(from,i);n<=Math.max(from,i);n++)selected.add(list[n].key);
            } else if(selected.has(it.key))selected.delete(it.key);else selected.add(it.key);
            active=it;
            for(const card of canvas.children) { card.classList.toggle('picked',selected.has(card.dataset.key));card.setAttribute('aria-pressed',String(selected.has(card.dataset.key))); }
            render(false);
          } else { selected.clear(); review(it); }
        }},
        url?thumbnail(it,url):h('span',{class:'gg-placeholder','aria-hidden':'true'},it.type==='video'?icon('video'):icon('photo')),
        h('span',{class:'gg-caption'},it.name),
        it.type==='video'?h('span',{class:'gg-duration'},NB.duration(it.duration)):null,
        mark?h('span',{class:'gg-mark'},mark.decision==='keep'?'Keep':'Trash'):null);
      fragment.append(tile);
      if(!url && ready)wanted.push(it);
    }
    const focused=document.activeElement?.dataset.key;
    canvas.replaceChildren(fragment);
    if(focused) [...canvas.children].find(el=>el.dataset.key===focused)?.focus({preventScroll:true});
    pump();
    if(ready && more && !loading && last>=list.length-cols*2)loadMore();
  }
  async function pump() {
    while(workers<2 && wanted.length) {
      const it=wanted.shift(); if(thumbs.has(it.key))continue;
      thumbs.set(it.key,null); workers++; const generation=epoch;
      call('Media',device,it,'thumb').then(url=> {
        if(generation!==epoch)return; thumbs.set(it.key,url);
        // Update just this image; rebuilding the grid for every thumbnail loses focus and causes flicker.
        for(const tile of canvas?.children || [])if(tile.dataset.key===it.key && tile.querySelector('.gg-placeholder')) {
          tile.querySelector('.gg-placeholder').replaceWith(thumbnail(it,url));
        }
      }).catch(()=> { if(generation===epoch)thumbs.set(it.key,''); }).finally(()=> { workers--;pump(); });
    }
  }
  async function loadMore() {
    if(loading || !ready || !more)return; loading=true; const generation=epoch;
    try {
      const page=await call('List',device,cursor);
      if(generation!==epoch)return;
      const known=new Set(items.map(i=>i.key)); for(const it of page.items)if(!known.has(it.key))items.push(it);
      cursor=page.cursor; more=!!cursor; scope=page.scope; render();
    } catch(e) { if(generation===epoch) { more=false; tell(e); } }
    finally { if(generation===epoch)loading=false; }
  }
  function refresh() { closeReview(); epoch++; items=[]; cursor=null; more=true; loading=false; thumbs.clear(); wanted=[]; selected.clear(); viewport.scrollTop=0; loadMore(); render(); }
  async function review(it) {
    if(viewer)nb.galleryCancelReads?.(device,true);
    active=it;
    if(!viewer) {
      viewer=h('section',{class:'gg-review',role:'dialog','aria-modal':'true','aria-label':'Review phone media',tabindex:-1});
      shell.append(viewer); NB.motion.show(viewer); viewport.inert=true; toolbar.inert=true; shell.querySelector('.gg-footer').inert=true;
    }
    const photo=h('div',{class:'gg-large'},h('span',{class:'hint','data-nb-orb':'connecting','data-nb-since':Date.now()},'Loading preview…'));
    viewer.replaceChildren(h('div',{class:'gg-review-head'},h('strong',null,it.name),btn('Back to grid',closeReview)),photo,
      h('div',{class:'gg-review-actions'},btn('← Previous',()=>next(-1)),btn('Keep · K',()=>decide('keep'),'accent'),btn('Mark trash · T',()=>decide('trash'),'danger'),btn('Undo · Ctrl+Z',undoDecision),btn('Next →',()=>next(1))),
      h('p',{class:'hint'},'Decisions stay here until you choose Trash marked.'));
    viewer.focus({preventScroll:true});
    try {
      const url=await call('Media',device,it,'preview'); if(active!==it || !viewer)return;
      photo.replaceChildren(h('img',{src:url,alt:it.name}));
      if(it.type==='video')photo.append(btn('Play video',async()=> {
        try {
          photo.replaceChildren(h('p',{class:'hint','data-nb-orb':'connecting','data-nb-since':Date.now()},'Loading this video only… (up to 256 MB)'),btn('Play on phone',()=>call('OpenPhone',device,it).catch(tell)));
          const video=await call('Media',device,it,'video'); if(active!==it || !viewer)return;
          const el=h('video',{src:video,controls:true,autoplay:true,poster:url,onerror:()=>NB.toast('This format cannot play on this PC. Use Play on phone.',{error:true})});
          photo.replaceChildren(el,btn('Play on phone',()=>call('OpenPhone',device,it).catch(tell)));
        } catch(e) { tell(e); if(active===it)photo.replaceChildren(h('img',{src:url,alt:it.name}),btn('Play on phone',()=>call('OpenPhone',device,it).catch(tell))); }
      }));
    } catch(e) { if(active===it && viewer)photo.replaceChildren(h('p',{class:'hint'},e.message),btn('Try again',()=>review(it))); }
  }
  async function next(direction) {
    const list=rows(), at=list.findIndex(it=>it.key===active?.key);
    let candidate=at>=0?list[at+direction]:list.find(it=>items.indexOf(it)>items.indexOf(active));
    if(!candidate && direction>0 && more) { await loadMore(); candidate=rows().find(it=>items.indexOf(it)>items.indexOf(active)); }
    if(candidate)review(candidate);else closeReview();
  }
  function closeReview() { if(!viewer)return;nb.galleryCancelReads?.(device,true); viewer.querySelector('video')?.pause();viewer.remove();viewer=null;viewport.inert=false;toolbar.inert=false;shell.querySelector('.gg-footer').inert=false;viewport.focus({preventScroll:true}); }
  async function commit() {
    const values=[...marks.values()].filter(m=>m.decision==='trash').slice(0,200);
    if(!ready || !values.length)return;
    let modal;
    modal=NB.modal(`Trash ${values.length} item${values.length===1?'':'s'} on your phone?`,{cancel:()=>modal.close()});
    modal.body.append(h('p',null,'These are the actual phone photos and videos. Android will move them to trash. Restore is available while the phone retains them.'),
      h('p',{class:'hint'},'Android may ask you to confirm this batch on your phone. Each batch contains up to 200 items.'));
    const confirm=btn('Trash on phone',async()=> {
      confirm.disabled=true;
      try { await call('Mutate',device,'trash',values); await modal.close(); NB.toast('Batch sent. Confirm on your phone if asked.'); tick(); }
      catch(e) { modal.fail(e.message);confirm.disabled=false; }
    },'danger'); modal.actions.append(btn('Cancel',()=>modal.close()),confirm);
  }
  async function showHistory() {
    let modal; modal=NB.modal('Recent phone trash',{wide:true,cancel:()=>modal.close()});
    modal.actions.append(btn('Close',()=>modal.close()));
    try {
      history=await call('History',device);
      if(!history.length)modal.body.append(h('p',{class:'hint'},'No batches yet. Mark items, then choose Trash marked.'));
      for(const o of history) {
        const results=o.results||[], trashed=results.filter(r=>r.state==='trashed');
        const counts=results.reduce((sum,r)=>(sum[r.state]=(sum[r.state]||0)+1,sum),{});
        const line=h('div',{class:'gg-history'},h('strong',null,`${o.action==='trash'?'Trash':'Restore'} · ${new Date(o.created).toLocaleString()}`),
          h('p',null,Object.entries(counts).map(([k,v])=>`${v} ${k}`).join(' · ')||o.status),h('p',{class:'hint'},o.message||''));
        line.append(btn('Check on phone',async()=> { try { await call('Reconcile',device,o.id);await modal.close();showHistory(); }catch(e){modal.fail(e.message);} }));
        if(o.action==='trash' && trashed.length)line.append(btn('Restore confirmed items',async()=> {
          try { await call('Mutate',device,'restore',trashed,o.id);await modal.close();NB.toast('Restore sent. Confirm on your phone if asked.');tick(); }catch(e){modal.fail(e.message);}
        }));modal.body.append(line);
      }
    } catch(e) { modal.fail(e.message); }
  }
  async function tick() {
    if(!shell)return;
    try {
      const status=await call('Status'); if(!shell)return;
      let s=status.sessions.find(s=>s.deviceId===device) || status.sessions.find(s=>s.ready);
      if(!s) { if(ready) { closeReview();thumbs.clear();wanted=[]; } ready=false; render(); return; }
      if(device!==s.deviceId) { device=s.deviceId;loadMarks(); }
      const changed=session!==s.sessionId, was=ready; session=s.sessionId; ready=s.ready;scope=s.scope;
      if(changed) { refresh(); }
      else if(ready && !was)refresh();
      if(!ready && was) { closeReview();thumbs.clear();wanted=[]; }
      history=await call('History',device); let changedItems=false;
      for(const o of history) {
        const stamp=o.id+JSON.stringify(o.results);
        if(applied.has(stamp))continue; applied.add(stamp);
        for(const r of o.results||[])if(r.state==='trashed' || r.state==='restored') {
          const original=o.items.find(i=>i.key===r.key), mark=marks.get(r.key);
          if(mark?.fingerprint===original?.fingerprint) { marks.delete(r.key);changedItems=true; }
          if(r.state==='trashed') { const length=items.length;items=items.filter(i=>i.key!==r.key || i.fingerprint!==original?.fingerprint);changedItems ||= items.length!==length; }
        }
      }
      if(changedItems)save();render(changedItems);
    } catch(e) { ready=false;render(); }
  }
  function key(e) {
    if(!shell || NB.modalOpen() || /INPUT|TEXTAREA/.test(e.target.tagName))return;
    let handled=true;
    if(e.key==='Escape')viewer?closeReview():close();
    else if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z')undoDecision();
    else if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='a') { rows().forEach(it=>selected.add(it.key));render(); }
    else if(e.key.toLowerCase()==='k')decide('keep');
    else if(e.key.toLowerCase()==='t'||e.key==='Delete')decide('trash');
    else if(viewer && e.key==='ArrowRight')next(1);
    else if(viewer && e.key==='ArrowLeft')next(-1);
    else if(viewer && e.key==='Tab') {
      const buttons=[...viewer.querySelectorAll('button,video')].filter(el=>!el.disabled),first=buttons[0],last=buttons.at(-1);
      if(e.shiftKey && (document.activeElement===first || document.activeElement===viewer))last?.focus();
      else if(!e.shiftKey && document.activeElement===last)first?.focus();
      else handled=false;
    }
    else handled=false;
    if(handled) { e.preventDefault();e.stopImmediatePropagation(); }
  }
  async function open() {
    if(shell || opening)return;opening=true;
    try { await NB.viewer?.close(); await NB.links?.closePanel(); } catch(e) { tell(e);return; } finally { opening=false; }
    NB.stacks?.clear();
    document.getElementById('gallery-btn').setAttribute('aria-pressed','true');
    if(shell)return; loading=false; toolbarStamp=''; NB.phone?.close(); focusBefore=document.activeElement;
    toolbar=h('header',{class:'gg-toolbar'});notice=h('p',{class:'gg-notice',role:'status'});canvas=h('div',{class:'gg-canvas'});
    viewport=h('div',{class:'gg-viewport',tabindex:0,'aria-label':'Phone photos and videos',onscroll:draw},canvas);
    shell=h('section',{class:'gg-shell','aria-label':'Phone Gallery'},toolbar,notice,viewport,
      h('footer',{class:'gg-footer glass'},btn('Keep selected · K',()=>decide('keep')),btn('Mark trash · T',()=>decide('trash')),btn('Undo decision',undoDecision),
        h('span',{class:'hint'},'Ctrl-click to select · Shift-click for a range'),
        h('button',{type:'button',class:'btn danger',id:'gg-commit',onclick:commit},'Trash marked ',h('span',{id:'gg-mark-count'},'0'))));
    document.body.append(shell); NB.motion.show(shell,focusBefore);document.querySelector('#page').inert=true;
    window.addEventListener('keydown',key,true);resize=new ResizeObserver(draw);resize.observe(viewport);
    render();tick();timer=setInterval(tick,2000);viewport.focus();
  }
  function close(returnFocus=true) {
    if(!shell)return;clearInterval(timer);epoch++;wanted=[];closeReview();resize.disconnect();window.removeEventListener('keydown',key,true);
    if(device)nb.galleryCancelReads?.(device);
    NB.motion.remove(shell);shell=null;viewport=null;session=null;ready=false;thumbs.clear();document.querySelector('#page').inert=false;document.getElementById('gallery-btn').setAttribute('aria-pressed','false');if(returnFocus)focusBefore?.focus();
  }
  document.getElementById('gallery-btn').addEventListener('click',open);
  document.querySelector('.side-nav')?.addEventListener('click',e=>{if(shell && !e.target.closest('#gallery-btn') && e.target.closest('button,input'))close(false);},true);
  NB.gallery={open,close};
})();
