// Remote Gallery: bounded DOM and on-demand phone previews, independent of library cards.
(() => {
  const { h, icon } = NB;
  let shell, viewport, canvas, toolbar, notice, viewer, timer, resize, device, session, scope='', ready=false;
  let items=[], cursor=null, more=true, loading=false, epoch=0, mode='all', active=null, selected=new Set();
  let marks=new Map(), undo=[], thumbs=new Map(), sharps=new Map(), wanted=[], workers=0, history=[], applied=new Set();
  let piles={keep:[],trash:[]}; // what the deck has sorted this session, newest last (the growing piles)
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
  function decide(decision, from) {
    const keys=selected.size?[...selected]:active?[active.key]:[];
    if(!keys.length)return;
    const before=[];
    for(const key of keys) {
      const it=items.find(i=>i.key===key); if(!it)continue;
      before.push([key,marks.get(key)]); marks.set(key,{key,fingerprint:it.fingerprint,decision});
    }
    undo.push(before); if(undo.length>2000)undo.shift(); selected.clear(); save();
    if(viewer && active) { const it=active; piles[decision].push(it); fly(it,decision,from); next(1); }
    render();
  }
  function undoDecision() {
    const previous=undo.pop(); if(!previous)return;
    for(const [key,value] of previous) { if(value)marks.set(key,value);else marks.delete(key); }
    save(); render();
    // In the deck: the card comes back off its pile and is the one on top again.
    if(viewer && previous.length===1) {
      const it=items.find(i=>i.key===previous[0][0]); if(!it)return;
      for(const d of ['keep','trash']) { const at=piles[d].lastIndexOf(it); if(at>=0) { piles[d].splice(at,1); review(it,d); return; } }
      review(it);
    }
  }
  function render(grid=true) {
    if(!shell)return;
    const marked=[...marks.values()].filter(m=>m.decision==='trash').length;
    if(toolbarStamp!==mode+'|'+scope) { toolbarStamp=mode+'|'+scope; toolbar.replaceChildren(
      h('div',{class:'gg-title'},h('h1',null,'Phone Gallery'),h('span',{class:'hint'},scope || 'Your photos, ready for a fresh start')),
      btn('All',()=>filter('all'),mode==='all'?'accent':''),btn('Unreviewed',()=>filter('unreviewed'),mode==='unreviewed'?'accent':''),
      btn('Marked',()=>filter('marked'),mode==='marked'?'accent':''),
      btn('Swipe through',()=>{const it=rows().find(i=>!marks.has(i.key))||rows()[0];if(it)review(it);},'accent'),
      btn('Refresh',()=>refresh()),btn('Recent trash',()=>showHistory()),btn('Google Photos',()=>cloudPanel()),btn('Close',close)); }
    notice.textContent=ready?`${items.length.toLocaleString()} loaded${more?' · more as you scroll':''} · ${selected.size} selected · ${marked} marked for trash`:
      'On your phone: Notebook → Sync → Start cleanup, once. Then you can put the phone away (it stays available until stopped, or 30 minutes unused). Scan the new PC pairing code once if asked.';
    shell.querySelector('#gg-commit').disabled=!ready || !marked;
    deckStats();
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
        deckCards.get(it.key)?.querySelector('.gg-photo > .gg-placeholder')?.replaceWith(h('img',{src:url,alt:it.name,draggable:false}));
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
  function refresh() { closeReview(); epoch++; items=[]; cursor=null; more=true; loading=false; thumbs.clear();sharps.clear(); wanted=[]; selected.clear(); viewport.scrollTop=0; loadMore(); render(); }
  // Review is a deck (the approved "swipe deck" with growing piles), moving in the approved Liquid style: nothing
  // pops or jumps. The photo you open grows out of its tile; the cards under it move up into place as the top one
  // leaves; a decided card is thrown along an arc (at the speed you flicked it) onto its pile, where it lands as the
  // pile's newest card, exactly where it stays, while the pile re-fans and wobbles like a drop catching it; Undo lifts
  // it back off the pile into the deck; Back to grid shrinks the photo into its tile. The same cards (elements) are kept
  // and moved throughout, so every motion starts from where things really are. Decisions stay on the PC until sent.
  const SPRING='cubic-bezier(.3,1.14,.5,1)', EASE='cubic-bezier(.22,1,.36,1)', LIQUID='cubic-bezier(.26,1.06,.4,1)'; // (a touch of settle, no bouncing about)
  const calm=()=>matchMedia('(prefers-reduced-motion: reduce)').matches;
  const bytes=n=>n>=1e9?(n/1e9).toFixed(2)+' GB':(n/1e6).toFixed(1)+' MB';
  const upcoming=(it,n=2)=>{const list=rows(),at=list.findIndex(x=>x.key===it.key);return at<0?[]:list.slice(at+1,at+1+n);};
  // The sharp picture for a card, asked for once and kept. The next few cards' pictures (and thumbnails) are fetched
  // ahead while you look at this one, so each card is already sharp when it reaches the top.
  function sharp(it) {
    let p=sharps.get(it.key);
    if(!p) { p=call('Media',device,it,'preview'); sharps.set(it.key,p); p.catch(()=>{ if(sharps.get(it.key)===p)sharps.delete(it.key); }); }
    return p;
  }
  function fetchAhead(it) {
    const next=upcoming(it,4);
    for(const x of [...next].reverse())if(!thumbs.has(x.key))wanted.unshift(x);
    pump(); next.forEach(sharp);
  }
  const rest=depth=>`translateY(${depth*22}px) scale(${1-depth*0.06})`;
  const deckCards=new Map(); // key -> card element in the deck
  const pileEls={keep:new Map(),trash:new Map()}; // key -> mini on a pile
  const heapOf=d=>viewer?.querySelector(`.gg-heap[data-d="${d}"]`);
  const nowTransform=el=>{const t=getComputedStyle(el).transform;return t==='none'?'none':t;};
  // Glide an element from whatever it shows now to `to`, cancelling what it was doing.
  function glide(el,to,o={}) {
    if(calm()) { el.getAnimations().forEach(a=>a.cancel()); el.style.transform=to; if(o.opacity!=null)el.style.opacity=o.opacity; return null; }
    const from=nowTransform(el), op=getComputedStyle(el).opacity;
    el.getAnimations().forEach(a=>a.cancel()); el.style.transform=to; if(o.opacity!=null)el.style.opacity=o.opacity;
    return el.animate([{transform:from,opacity:op},{transform:to,opacity:o.opacity??op}],{duration:o.ms||460,easing:o.easing||SPRING,delay:o.delay||0,fill:'backwards'});
  }
  // A number that rolls to its new value (counts, space freed).
  function roll(el,to,fmt) {
    const from=+el.dataset.v||0; el.dataset.v=to; cancelAnimationFrame(el.__roll);
    if(calm() || from===to) { el.textContent=fmt(to); return; }
    const t0=performance.now(); const step=now=>{const k=Math.max(0,Math.min(1,(now-t0)/520)),e=1-Math.pow(1-k,3);el.textContent=fmt(from+(to-from)*e);if(k<1)el.__roll=requestAnimationFrame(step);}; el.__roll=requestAnimationFrame(step);
  }
  function deckStats() {
    if(!viewer)return;
    const trash=[...marks.values()].filter(m=>m.decision==='trash'), size=trash.reduce((sum,m)=>sum+(items.find(i=>i.key===m.key)?.size||0),0);
    const left=items.filter(i=>!marks.has(i.key)).length;
    roll(viewer.querySelector('.gg-free b'),size,bytes);
    roll(viewer.querySelector('.gg-left b'),left,v=>Math.round(v).toLocaleString()+(more?'+':''));
    for(const d of ['keep','trash'])roll(heapOf(d).querySelector('b'),[...marks.values()].filter(m=>m.decision===d).length,v=>Math.round(v).toLocaleString());
    const marked=trash.length, send=viewer.querySelector('.gg-send');
    send.disabled=!ready || !marked; send.textContent=marked?`Trash ${marked} on phone`:'Trash marked';
  }
  // A pile shows its last five cards fanned, the newest on top. Where the k-th of n sits:
  const fan=(d,k,n)=>{const c=k-(n-1)/2,h=n-1-k;return `translate(${(c*9).toFixed(1)}px,${(-h*4).toFixed(1)}px) rotate(${(c*7+(d==='trash'?-4:4)).toFixed(1)}deg)`;};
  function mini(it) { const url=thumbs.get(it.key); return url?h('img',{class:'gg-mini',src:url,alt:'',draggable:false}):h('span',{class:'gg-mini'}); }
  // Lay a pile out from `piles` (the cards on it keep their elements and glide to their new places in the fan).
  function layPile(d,skip) {
    if(!viewer)return;
    const heap=heapOf(d), list=piles[d].slice(-5), map=pileEls[d];
    for(const [key,el] of map)if(!list.some(it=>it.key===key)) { map.delete(key); if(calm()) el.remove(); else el.animate([{opacity:1},{opacity:0}],{duration:220,fill:'forwards'}).onfinish=()=>el.remove(); }
    list.forEach((it,k)=>{
      let el=map.get(it.key);
      if(!el) { if(skip===it.key)return; el=mini(it); map.set(it.key,el); heap.append(el); }
      el.style.zIndex=String(k+1);
      if(it.key!==skip)glide(el,fan(d,k,list.length),{ms:520,easing:SPRING});
    });
  }
  // A pile catches a card: it squashes and wobbles back, like a drop.
  const catchIt=d=>{ if(calm() || !viewer)return; heapOf(d).querySelector('.gg-well').animate([{transform:'scale(1)'},{transform:'scale(1.06,.93)',offset:.3},{transform:'scale(.99,1.02)',offset:.65},{transform:'scale(1)'}],{duration:480,easing:'ease-out'}); };

  // Each card takes its photo's own shape, as large as the space between the piles allows (the whole picture shows,
  // never cropped). Full screen (click the photo, or Enter): the same card grows to fill the window, and the next
  // ones arrive full screen too until you click again, press Enter or Esc.
  let zoomed=false;
  const shapeOf=it=>it.__ar || (it.width>0&&it.height>0 ? it.width/it.height : 0.8);
  function boxFor(it,big) {
    const deck=viewer.querySelector('.gg-deck'), W=deck.clientWidth, H=deck.clientHeight, ar=shapeOf(it);
    if(big) { // the whole review, less a margin and the bar at the bottom, in the deck's own coordinates
      const v=viewer.getBoundingClientRect(), d=deck.getBoundingClientRect(), bw=v.width-48, bh=v.height-24-96;
      const w=Math.min(bw,bh*ar), hh=w/ar;
      return { left:v.left+(v.width-w)/2-d.left, top:v.top+24+(bh-hh)/2-d.top, width:w, height:hh };
    }
    const w=Math.min(W,H*ar), hh=w/ar;
    return { left:(W-w)/2, top:(H-hh)/2, width:w, height:hh };
  }
  function place(el,it,big) { const b=boxFor(it,big); Object.assign(el.style,{left:b.left+'px',top:b.top+'px',width:b.width+'px',height:b.height+'px'}); }
  // Cards waiting underneath sit in the top card's frame (a tidy stack); each takes its own shape when it comes up.
  function placeUnder(el,top) { Object.assign(el.style,{left:top.style.left,top:top.style.top,width:top.style.width,height:top.style.height}); }
  // Move a card to a new box smoothly: measured before and after, it glides between them (FLIP).
  function reshape(el,it,big) {
    const a=el.getBoundingClientRect(); place(el,it,big); if(calm())return;
    const b=el.getBoundingClientRect(); if(!b.width)return;
    el.animate([{transformOrigin:'0 0',transform:`translate(${a.left-b.left}px,${a.top-b.top}px) scale(${a.width/b.width},${a.height/b.height})`},{transformOrigin:'0 0',transform:'none'}],{duration:480,easing:LIQUID});
  }
  function zoom(on) {
    if(!viewer || zoomed===on || !active)return;
    zoomed=on; viewer.classList.toggle('gg-zoomed',on);
    const top=deckCards.get(active.key); if(top)reshape(top,active,on);
    const veil=viewer.querySelector('.gg-veil');
    veil.getAnimations().forEach(x=>x.cancel());
    if(!calm())veil.animate([{opacity:on?0:1},{opacity:on?1:0}],{duration:300,easing:EASE});
  }
  function card(it) {
    const url=thumbs.get(it.key);
    return h('div',{class:'gg-card','data-key':it.key},
      h('div',{class:'gg-photo'},url?h('img',{src:url,alt:it.name,draggable:false}):h('span',{class:'gg-placeholder'},it.type==='video'?icon('video'):icon('photo'))),
      h('div',{class:'gg-meta'},h('b',null,it.name),h('span',null,[it.size?bytes(it.size):'',it.type==='video'?NB.duration(it.duration):''].filter(Boolean).join(' · '))),
      h('span',{class:'gg-stamp keep','aria-hidden':'true'},'KEEP'),h('span',{class:'gg-stamp trash','aria-hidden':'true'},'TRASH'));
  }
  function openDeck(it) {
    viewer=h('section',{class:'gg-review',role:'dialog','aria-modal':'true','aria-label':'Review phone media',tabindex:-1},
      h('div',{class:'gg-deckstats'},h('div',{class:'gg-free'},h('span',{class:'micro'},"You'll free"),h('b',null,'0 MB')),h('div',{class:'gg-left'},h('span',{class:'micro'},'Left to look at'),h('b',null,'0'))),
      h('div',{class:'gg-deck'}),h('div',{class:'gg-veil',onclick:()=>zoom(false)}),
      h('div',{class:'gg-heap','data-d':'trash'},h('span',{class:'micro'},'Trash'),h('b',null,'0'),h('i',{class:'gg-well'})),
      h('div',{class:'gg-heap','data-d':'keep'},h('span',{class:'micro'},'Keep'),h('b',null,'0'),h('i',{class:'gg-well'})),
      h('div',{class:'gg-deckbar'},btn('Back to grid',closeReview),btn('Undo · Z',undoDecision),btn('Skip · Space',()=>next(1)),h('button',{type:'button',class:'btn small danger gg-send',onclick:commit},'Trash marked')),
      h('p',{class:'hint gg-deckhint'},'Drag right or K / → to keep · left or T / ← to trash · click the photo or Enter for full screen · decisions stay on this PC until you send them'));
    deckCards.clear(); pileEls.keep.clear(); pileEls.trash.clear(); zoomed=false;
    new ResizeObserver(()=>{ if(!viewer || !active)return; const top=deckCards.get(active.key); if(!top)return; place(top,active,zoomed); for(const [,el] of deckCards)if(el!==top)placeUnder(el,top); }).observe(viewer);
    shell.append(viewer); viewport.inert=true; toolbar.inert=true; shell.querySelector('.gg-footer').inert=true;
    layPile('keep'); layPile('trash');
    if(calm())return;
    // the grid dims away behind; the surroundings rise in a beat after the photo starts growing out of its tile
    viewer.animate([{backgroundColor:'rgba(10,10,10,0)'},{backgroundColor:'rgba(10,10,10,1)'}],{duration:300,easing:EASE});
    [viewer.querySelector('.gg-deckstats'),...viewer.querySelectorAll('.gg-heap'),viewer.querySelector('.gg-deckbar'),viewer.querySelector('.gg-deckhint')]
      .forEach((el,i)=>el.animate([{opacity:0,transform:`translateY(${i===0?-14:18}px)`},{opacity:1,transform:'none'}],{duration:520,delay:120+i*40,easing:SPRING,fill:'backwards'}));
  }
  const tileOf=it=>canvas&&[...canvas.children].find(t=>t.dataset.key===it.key);
  // Show `it` on top of the deck. `back`: it comes back off that pile (Undo).
  async function review(it,back) {
    if(viewer)nb.galleryCancelReads?.(device,'video'); // a video still loading for the last card stops; pictures fetched ahead carry on
    const first=!viewer, tile=first&&tileOf(it), tileRect=tile&&tile.getBoundingClientRect();
    active=it;
    if(first)openDeck(it);
    const deck=viewer.querySelector('.gg-deck'), want=[it,...upcoming(it)];
    // leaving: cards no longer wanted (skipped past) sink away; the thrown one has already been taken out
    for(const [key,el] of deckCards)if(!want.some(x=>x.key===key)) { deckCards.delete(key); if(calm())el.remove(); else { glide(el,'translateY(40px) scale(.8)',{opacity:0,ms:260,easing:EASE}).onfinish=()=>el.remove(); } }
    // coming back off a pile: the pile's own mini lifts off and becomes the card
    let from=null;
    if(back) { const m=pileEls[back].get(it.key); if(m) { from=m.getBoundingClientRect(); from.rot=parseFloat((m.style.transform.match(/rotate\(([-\d.]+)deg/)||[])[1])||0; m.remove(); pileEls[back].delete(it.key); } }
    want.forEach((x,depth)=>{
      let el=deckCards.get(x.key), fresh=!el;
      if(fresh) { el=card(x); deckCards.set(x.key,el); deck.prepend(el); }
      if(depth===0) { if(fresh)place(el,x,zoomed); else reshape(el,x,zoomed); }
      else placeUnder(el,deckCards.get(want[0].key)||el);
      el.style.zIndex=String(10-depth);
      if(fresh && depth>0) { el.style.transform=rest(depth+1); el.style.opacity='0'; glide(el,rest(depth),{opacity:depth>1?'.55':'1',ms:420,delay:60}); }
      else if(!fresh || depth>0) glide(el,rest(depth),{opacity:depth>1?'.55':'1',ms:520});
      else el.style.transform=rest(0);
    });
    const top=deckCards.get(it.key);
    top.style.opacity='1';
    wireCard(top);
    if(back)layPile(back);
    deckStats();
    viewer.focus({preventScroll:true});
    if(!calm()) {
      const r=top.getBoundingClientRect(), o=from||tileRect;
      if(o) { // grows out of its tile, or lifts off its pile, into the deck
        const k=o.width/r.width;
        top.animate([{transform:`translate(${o.left+o.width/2-(r.left+r.width/2)}px,${o.top+o.height/2-(r.top+r.height/2)}px) rotate(${from?from.rot:0}deg) scale(${k})`,borderRadius:`${14/k}px`},{transform:'none',borderRadius:'26px'}],{duration:first?560:520,easing:LIQUID});
      } else if(first) top.animate([{opacity:0,transform:'scale(.9)'},{opacity:1,transform:'none'}],{duration:420,easing:SPRING});
    }
    // the sharp picture for the top card cross-fades over its thumbnail
    const photo=top.querySelector('.gg-photo'), coming=sharp(it); fetchAhead(it);
    try {
      const url=await coming; if(active!==it || !viewer || !top.isConnected)return;
      const img=h('img',{class:'gg-sharp',src:url,alt:it.name,draggable:false});
      await img.decode?.().catch(()=>{}); if(!top.isConnected)return;
      if(img.naturalWidth && Math.abs(img.naturalWidth/img.naturalHeight-shapeOf(it))>0.02) { it.__ar=img.naturalWidth/img.naturalHeight; reshape(top,it,zoomed); for(const [,el] of deckCards)if(el!==top)placeUnder(el,top); }
      photo.append(img, ...(it.type==='video'?[playButton(it,photo,url)]:[]));
      if(!calm())img.animate([{opacity:0},{opacity:1}],{duration:220,easing:EASE}).onfinish=()=>[...photo.children].forEach(c=>{if(c!==img && c.tagName==='IMG')c.remove();});
      else [...photo.children].forEach(c=>{if(c!==img && c.tagName==='IMG')c.remove();});
    } catch(e) { if(active===it && viewer && top.isConnected && !photo.querySelector('img'))photo.replaceChildren(h('p',{class:'hint'},e.message),btn('Try again',()=>review(it))); }
  }
  function playButton(it,photo,poster) {
    return btn('Play video',async(e)=> {
      e.stopPropagation();
      try {
        photo.replaceChildren(h('p',{class:'hint','data-nb-orb':'connecting','data-nb-since':Date.now()},'Loading this video only… (up to 256 MB)'),btn('Play on phone',()=>call('OpenPhone',device,it).catch(tell)));
        const video=await call('Media',device,it,'video'); if(active!==it || !viewer)return;
        photo.replaceChildren(h('video',{src:video,controls:true,autoplay:true,poster,onerror:()=>NB.toast('This format cannot play on this PC. Use Play on phone.',{error:true})}),btn('Play on phone',()=>call('OpenPhone',device,it).catch(tell)));
      } catch(err) { tell(err); if(active===it)photo.replaceChildren(h('img',{src:poster,alt:it.name}),btn('Play on phone',()=>call('OpenPhone',device,it).catch(tell))); }
    },'gg-play');
  }
  // Drag the top card: it follows the pointer exactly, lifted, tilting with the drag; the stamp for the side it is
  // heading to presses in; the cards underneath lean up a little. Let go far enough and it is thrown.
  function wireCard(top) {
    if(top.__wired)return; top.__wired=true;
    let x0=null, y0=0, dx=0, dy=0;
    const keep=top.querySelector('.gg-stamp.keep'), trash=top.querySelector('.gg-stamp.trash');
    const paint=()=>{
      top.style.transform=`translate(${dx}px,${dy*0.35+Math.abs(dx)*0.04}px) rotate(${dx/16}deg) scale(1.02)`;
      const k=Math.max(0,Math.min(1,dx/100)), t=Math.max(0,Math.min(1,-dx/100));
      keep.style.opacity=k; keep.style.transform=`rotate(-12deg) scale(${1.4-0.4*k})`;
      trash.style.opacity=t; trash.style.transform=`rotate(12deg) scale(${1.4-0.4*t})`;
      const lift=Math.min(1,Math.abs(dx)/160);
      [...deckCards.values()].filter(c=>c!==top).forEach(c=>{const d=10-+c.style.zIndex;c.getAnimations().forEach(a=>a.finish());c.style.transform=`translateY(${(d-lift)*22}px) scale(${1-(d-lift)*0.06})`;});
    };
    top.addEventListener('pointerdown',e=>{if(e.button!==0 || e.target.closest('button,video') || top!==deckCards.get(active?.key))return;x0=e.clientX;y0=e.clientY;dx=dy=0;top.getAnimations().forEach(a=>a.cancel());top.setPointerCapture(e.pointerId);top.classList.add('held');});
    top.addEventListener('pointermove',e=>{if(x0===null)return;dx=e.clientX-x0;dy=e.clientY-y0;paint();});
    const end=()=>{
      if(x0===null)return; x0=null; top.classList.remove('held');
      if(Math.abs(dx)>110) { decide(dx>0?'keep':'trash',{}); return; }
      if(Math.abs(dx)<4 && Math.abs(dy)<4) { top.style.transform=''; zoom(!zoomed); return; }
      glide(top,'none',{ms:520,easing:SPRING});
      for(const s of [keep,trash]) { s.animate([{opacity:s.style.opacity},{opacity:0}],{duration:180}); s.style.opacity=0; }
      [...deckCards.values()].filter(c=>c!==top).forEach(c=>glide(c,rest(10-+c.style.zIndex),{ms:460}));
    };
    top.addEventListener('pointerup',end); top.addEventListener('pointercancel',end);
  }
  // Throw the decided card onto its pile: it leaves from exactly where it is (mid-drag included), along a low curve
  // (turning a little), shrinks into the pile's newest slot at that slot's own angle, and
  // hands over to the mini there in the same frame: the card you threw is the card that stays on the pile.
  function fly(it,decision,from) {
    if(!viewer)return;
    const card=deckCards.get(it.key); if(!card)return;
    deckCards.delete(it.key);
    const d=decision, list=piles[d].slice(-5), heap=heapOf(d);
    if(calm()) { card.remove(); layPile(d); catchIt(d); return; }
    layPile(d,it.key); // the others make room first
    const target=mini(it); pileEls[d].set(it.key,target); target.style.zIndex=String(list.length); target.style.transform=fan(d,list.length-1,list.length); target.style.visibility='hidden'; heap.append(target);
    const r=card.getBoundingClientRect(), m=target.getBoundingClientRect(), v=viewer.getBoundingClientRect(), now=nowTransform(card);
    // the card becomes a free-flying layer in the review, starting where it is drawn
    const flyer=card; viewer.append(flyer); flyer.classList.add('gg-flying');
    Object.assign(flyer.style,{left:r.left-v.left+'px',top:r.top-v.top+'px',width:r.width+'px',height:r.height+'px',transform:'none'});
    flyer.querySelector('.gg-stamp.'+d).style.opacity='1'; flyer.querySelector('.gg-stamp.'+(d==='keep'?'trash':'keep')).style.opacity='0';
    const power=1, rot=parseFloat((m.width&&target.style.transform.match(/rotate\(([-\d.]+)deg/)||[])[1])||0;
    const ex=m.left+m.width/2-(r.left+r.width/2), ey=m.top+m.height/2-(r.top+r.height/2), s=m.width/r.width;
    const spin=(d==='trash'?-1:1)*24; // a small turn on the way, settling at the slot's own angle
    const peak=Math.min(-20,ey*0.3-30);
    const a=flyer.animate([
      {transform:now==='none'?'none':now,offset:0},
      {transform:`translate(${ex*0.5}px,${peak}px) rotate(${(spin*0.55).toFixed(1)}deg) scale(${(1+s)/2*0.9})`,offset:.45,easing:'cubic-bezier(.3,0,.6,1)'},
      {transform:`translate(${ex}px,${ey}px) rotate(${rot}deg) scale(${s})`,offset:1}
    ],{duration:Math.round(620/Math.sqrt(power)),easing:'cubic-bezier(.3,.7,.4,1)',fill:'forwards'});
    const land=()=>{ flyer.remove(); target.style.visibility=''; catchIt(d); };
    a.onfinish=land; setTimeout(()=>{ if(flyer.isConnected)land(); },1400);
  }
  async function next(direction) {
    const list=rows(), at=list.findIndex(it=>it.key===active?.key);
    let candidate=at>=0?list[at+direction]:list.find(it=>items.indexOf(it)>items.indexOf(active));
    if(!candidate && direction>0 && more) { await loadMore(); candidate=rows().find(it=>items.indexOf(it)>items.indexOf(active)); }
    if(candidate)review(candidate);else if(viewer) { // the end of the deck
      active=null;
      for(const [,el] of deckCards) el.remove(); deckCards.clear();
      const done=h('div',{class:'gg-card gg-done'},h('div',null,h('b',null,'All looked at'),h('p',{class:'hint'},'Send the trash batch when you are ready, or go back to the grid.')));
      viewer.querySelector('.gg-deck').replaceChildren(done);
      if(!calm())done.animate([{opacity:0,transform:'translateY(20px) scale(.92)'},{opacity:1,transform:'none'}],{duration:520,easing:SPRING});
      deckStats();
    }
  }
  // Back to the grid: the photo shrinks into its tile as the review fades.
  function closeReview() {
    if(!viewer)return; nb.galleryCancelReads?.(device,true); viewer.querySelector('video')?.pause();
    const v=viewer, top=active&&deckCards.get(active.key), tile=active&&tileOf(active), under=[...deckCards.values()].filter(c=>c!==top);
    viewer=null; viewport.inert=false; toolbar.inert=false; shell.querySelector('.gg-footer').inert=false; viewport.focus({preventScroll:true});
    deckCards.clear();
    if(calm() || !top) { v.remove(); return; }
    v.inert=true; v.style.pointerEvents='none';
    const r=top.getBoundingClientRect(), t=tile&&tile.getBoundingClientRect();
    if(t && t.width) top.animate([{transform:nowTransform(top)},{transform:`translate(${t.left+t.width/2-(r.left+r.width/2)}px,${t.top+t.height/2-(r.top+r.height/2)}px) scale(${t.width/r.width})`}],{duration:420,easing:EASE,fill:'forwards'});
    [...v.children].filter(c=>!c.contains(top)).forEach(c=>c.animate([{opacity:1},{opacity:0}],{duration:200,fill:'forwards'}));
    under.forEach(c=>c.animate([{opacity:getComputedStyle(c).opacity},{opacity:0}],{duration:200,fill:'forwards'}));
    v.animate([{backgroundColor:'rgba(10,10,10,1)'},{backgroundColor:'rgba(10,10,10,0)'}],{duration:380,easing:EASE,fill:'forwards'}).onfinish=()=>v.remove();
  }
  async function commit() {
    const values=[...marks.values()].filter(m=>m.decision==='trash').slice(0,200);
    if(!ready || !values.length)return;
    let modal;
    modal=NB.modal(`Trash ${values.length} item${values.length===1?'':'s'} on your phone?`,{cancel:()=>modal.close()});
    modal.body.append(h('p',null,'These are the actual phone photos and videos. Android will move them to trash. Restore is available while the phone retains them.'),
      h('p',{class:'hint'},'Android may ask you to confirm this batch on your phone. Each batch contains up to 200 items.'));
    const confirm=btn('Trash on phone',async()=> {
      confirm.disabled=true;
      try { await call('Mutate',device,'trash',values); await modal.close(); NB.toast('Batch sent. Tap the confirmation on your phone (a notification, if Notebook is closed).'); tick(); }
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
        if(o.action==='trash' && trashed.length) {
          const kept=Object.keys(o.cloud?.keys||{}).length;
          if(o.cloud?.done) line.append(h('p',{class:'hint'},kept?`${kept} Google Photos cop${kept===1?'y':'ies'} also in Google Photos' trash`:'No Google Photos copies'));
          else line.append(btn('Remove Google Photos copies',async()=> { await modal.close(); NB.toast('Finding the Google Photos copies…'); await cloudTrash(o); }));
        }
        if(o.action==='trash' && trashed.length)line.append(btn('Restore confirmed items',async()=> {
          try { await call('Mutate',device,'restore',trashed,o.id);await modal.close();NB.toast('Restore sent. Tap the confirmation on your phone (a notification, if Notebook is closed).');tick(); }catch(e){modal.fail(e.message);}
        }));modal.body.append(line);
      }
    } catch(e) { modal.fail(e.message); }
  }
  // Google Photos copies (main/gphotos.js). With cloud sync, Samsung Gallery keeps showing a Google Photos copy of a
  // photo trashed on the phone. Once Google Photos is connected, each trash batch's copies follow it to Google Photos'
  // trash (60 days to restore), and restoring the batch brings them back.
  let cloud=null;
  async function cloudCheck() { try { cloud=await call('CloudStatus'); } catch { cloud={signedIn:false}; } return cloud; }
  async function cloudConnect() {
    NB.toast('Sign in to Google Photos in the browser window that opened, then close that window.');
    try { cloud=await call('CloudSignIn'); } catch(e) { tell(e); return false; }
    if(!cloud.signedIn) { NB.toast(cloud.error||'Google Photos is not signed in.',{error:true}); return false; }
    NB.toast(`Google Photos connected · ${cloud.account}`); return true;
  }
  async function cloudTrash(o,quiet) {
    if(!(cloud?.signedIn || (await cloudCheck()).signedIn)) { if(quiet || !(await cloudConnect()))return; }
    try {
      const r=await call('CloudTrash',device,o.id), n=Object.keys(r.keys||{}).length;
      NB.toast(n?`Also moved ${n} Google Photos cop${n===1?'y':'ies'} to Google Photos' trash`:r.unreadable?`Your phone couldn't read ${r.unreadable} of these, so their Google Photos copies weren't found.`:'None of these had a Google Photos copy.',{error:!n && !!r.unreadable});
    } catch(e) { tell(e); }
  }
  async function cloudPanel() {
    let modal; modal=NB.modal('Google Photos copies',{cancel:()=>modal.close()});
    const state=h('p',{class:'hint'},'Checking…');
    modal.body.append(h('p',null,"If your phone's Gallery syncs with Google Photos, a photo you trash here still shows there as a cloud copy. Connect Google Photos and each batch's copies go to Google Photos' trash as well (kept 60 days, and Restore brings them back)."),state);
    const connect=btn('Connect',async()=>{ connect.disabled=true; if(await cloudConnect()) await modal.close(); else connect.disabled=false; },'accent');
    modal.actions.append(btn('Close',()=>modal.close()),connect);
    const c=await cloudCheck();
    state.textContent=c.signedIn?`Connected · ${c.account}`:c.error||'Not connected. Connect opens Chrome (or Edge) with a profile of its own, just for this.';
    connect.textContent=c.signedIn?'Use another account':'Connect';
  }
  // A batch that has just finished says so on the PC, with Undo for a trash batch (it restores the same items).
  function announce(o) {
    if(o.status!=='finished' || Date.now()-o.created>15*60e3)return;
    let told; try { told=new Set(JSON.parse(localStorage.getItem('gallery-told')||'[]')); } catch { told=new Set(); }
    if(told.has(o.id))return; told.add(o.id); try { localStorage.setItem('gallery-told',JSON.stringify([...told].slice(-50))); } catch {}
    const moved=(o.results||[]).filter(r=>r.state===(o.action==='trash'?'trashed':'restored')), n=moved.length, what=`${n} photo${n===1?'':'s'}`;
    if(!n) { NB.toast(o.action==='trash'?'Nothing was moved to trash (cancelled on the phone).':'Nothing was restored.'); return; }
    if(o.action==='trash') { NB.toast(`Moved ${what} to your phone's trash`,{action:{label:'Undo',run:()=>call('Mutate',device,'restore',moved.map(r=>({key:r.key,fingerprint:r.fingerprint})),o.id).then(()=>NB.toast('Restoring on your phone…')).catch(tell)}}); cloudTrash(o,true); }
    else { NB.toast(`Restored ${what} on your phone`); if(o.restoreFrom)call('CloudRestore',device,o.id).then(r=>{ if(r.restored)NB.toast(`Also restored ${r.restored} Google Photos cop${r.restored===1?'y':'ies'}`); }).catch(tell); }
  }
  async function tick() {
    if(!shell)return;
    try {
      const status=await call('Status'); if(!shell)return;
      let s=status.sessions.find(s=>s.deviceId===device) || status.sessions.find(s=>s.ready);
      if(!s) { if(ready) { closeReview();thumbs.clear();sharps.clear();wanted=[]; } ready=false; render(); return; }
      if(device!==s.deviceId) { device=s.deviceId;loadMarks(); }
      const changed=session!==s.sessionId, was=ready; session=s.sessionId; ready=s.ready;scope=s.scope;
      if(changed) { refresh(); }
      else if(ready && !was)refresh();
      if(!ready && was) { closeReview();thumbs.clear();sharps.clear();wanted=[]; }
      history=await call('History',device); let changedItems=false; const leaving=new Set();
      for(const o of history) {
        const stamp=o.id+JSON.stringify(o.results);
        if(applied.has(stamp))continue; applied.add(stamp);
        for(const r of o.results||[])if(r.state==='trashed' || r.state==='restored') {
          const original=o.items.find(i=>i.key===r.key), mark=marks.get(r.key);
          if(mark?.fingerprint===original?.fingerprint) { marks.delete(r.key);changedItems=true; }
          if(r.state==='trashed' && items.some(i=>i.key===r.key && i.fingerprint===original?.fingerprint))leaving.add(r.key);
        }
        announce(o);
      }
      // photos that went to the phone's trash shrink away from the grid before it closes up
      if(leaving.size) {
        const gone=[...(canvas?.children||[])].filter(t=>leaving.has(t.dataset.key));
        if(gone.length && !matchMedia('(prefers-reduced-motion: reduce)').matches) await Promise.all(gone.map(t=>t.animate([{opacity:1,transform:'none'},{opacity:0,transform:'scale(.8)'}],{duration:320,easing:'cubic-bezier(.22,1,.36,1)',fill:'forwards'}).finished.catch(()=>{})));
        items=items.filter(i=>!leaving.has(i.key)); changedItems=true;
      }
      if(changedItems)save();render(changedItems);
    } catch(e) { ready=false;render(); }
  }
  function key(e) {
    if(!shell || NB.modalOpen() || /INPUT|TEXTAREA/.test(e.target.tagName))return;
    let handled=true;
    if(e.key==='Escape')viewer?(zoomed?zoom(false):closeReview()):close();
    else if(viewer && e.key==='Enter' && !e.target.closest('button'))zoom(!zoomed);
    else if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z')undoDecision();
    else if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='a') { rows().forEach(it=>selected.add(it.key));render(); }
    else if(e.key.toLowerCase()==='k'||(viewer && e.key==='ArrowRight'))decide('keep');
    else if(e.key.toLowerCase()==='t'||e.key==='Delete'||(viewer && e.key==='ArrowLeft'))decide('trash');
    else if(viewer && e.key.toLowerCase()==='z' && !e.ctrlKey && !e.metaKey)undoDecision();
    else if(viewer && e.key===' ')next(1);
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
    piles={keep:[],trash:[]};
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
    NB.motion.remove(shell);shell=null;viewport=null;session=null;ready=false;thumbs.clear();sharps.clear();document.querySelector('#page').inert=false;document.getElementById('gallery-btn').setAttribute('aria-pressed','false');if(returnFocus)focusBefore?.focus();
  }
  document.getElementById('gallery-btn').addEventListener('click',open);
  document.querySelector('.side-nav')?.addEventListener('click',e=>{if(shell && !e.target.closest('#gallery-btn') && e.target.closest('button,input'))close(false);},true);
  NB.gallery={open,close};
})();
