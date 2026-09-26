// The open item's screen: a photo or video (the picture above a sheet that opens into its note, boards
// and actions) or a note (the editor above its boards). Gestures on the picture: viewer.js.
window.NBItem = function NBItem({ S, esc, svg, P, url, vb, sanitize, byId, boards, arStyle }) {
  function itemHTML() {
    const it = byId(S.item);
    if (!it) return null;
    const chips = boards().map((b) => { const on = (it.boards || []).includes(b.id); return `<button type="button" class="chip${on ? ' on' : ''}" aria-pressed="${on}" data-a="boardToggle" data-v="${b.id}">${esc(b.name)}</button>`; }).join('');
    let stage;
    if (it.kind === 'note') {
      stage = `<div class="notestage"><div class="notebar"><button type="button" class="btn accent" data-a="tidy" id="tidybtn">Tidy up</button></div>
        <div class="editor" id="editor" contenteditable="true" role="textbox" aria-multiline="true" aria-label="Note" data-placeholder="Start typing, then tap Tidy up to turn it into a heading and bullet points.">${sanitize(it.html)}</div></div>`;
    } else if (it.kind === 'video') {
      // Our own quiet player: plays on a loop with the sound off; tap to pause, drag the line to seek.
      stage = `<div class="scrim"></div><div class="stage" style="${arStyle(it)}"><div class="vbox">
        <img class="vposter" src="${url(it.thumb)}" alt="" style="${vb(it)}">
        <video id="vid" src="${url(it.file)}" style="${vb(it)}" muted loop playsinline preload="auto" aria-label="${esc(it.title)}"></video>
        <span class="vpaused" aria-hidden="true"><svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor"><path d="M7 4l13 8-13 8z"/></svg></span>
        <div class="vbar" role="slider" aria-label="Position" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" tabindex="0"><div class="vfill"></div></div>
        <button type="button" class="vsound" aria-label="Sound on" aria-pressed="false">${svg('M11 5L6 9H2v6h4l5 4zM23 9l-6 6M17 9l6 6', 18)}</button>
      </div><p class="media-message" role="status"></p></div>`;
    } else {
      stage = `<div class="scrim"></div><div class="stage" style="${arStyle(it)}"><div class="photo"><img src="${url(it.thumb || it.file)}" data-full="${url(/\.dng$/i.test(it.file || '') ? (it.thumb || it.file) : it.file)}" alt="${esc(it.title)}" decoding="async" style="${vb(it)}"></div></div>`;
    }
    const fields = `${it.kind !== 'note' ? `<div class="field-group"><label class="lbl" for="note">Note</label><textarea id="note" class="notebox" placeholder="Why did you save this?">${esc(it.caption || '')}</textarea></div>` : ''}
        <div class="field-group"><span class="lbl">Boards</span><div class="chips">${chips}</div></div>
        ${it.stack ? `<button type="button" class="btn" data-a="unstack" style="align-self:flex-start">Take out of stack</button>` : ''}`;
    const bin = `<button type="button" class="btn danger" data-a="bin">${svg(P.bin, 16)}<span>Move to Bin</span></button><span style="flex:1"></span>`;
    // A photo or video: its sheet is a title bar that opens (tap or drag it) into the note, boards and
    // actions; Done closes the sheet. A note: the sheet is always there, and Done closes the note.
    const sheet = it.kind === 'note'
      ? `<div class="sheet frost compact"><div class="media-fields">${fields}</div><div class="media-actions">${bin}<button type="button" class="btn white" data-a="back">Done</button></div></div>`
      : `<div class="sheet frost"><div class="media-details"><button type="button" class="dhead" aria-expanded="false"><span>${esc(it.title)}</span><small>Details & boards</small></button>
        <div class="media-body"><div class="media-fields">${fields}</div><div class="media-actions">${bin}<button type="button" class="btn white" data-close-details>Done</button></div></div></div></div>`;
    return `<div class="screen ${it.kind !== 'note' ? 'media-screen' : 'note-screen'}" style="overflow:hidden">
      ${stage}
      <button type="button" class="iconbtn glass lbback" data-a="back" aria-label="Back" style="position:absolute;top:calc(var(--st) + 10px);left:16px;z-index:4">${svg(P.back)}</button>
      ${it.kind === 'note' ? '<span class="glass kindpill">Note</span>' : ''}
      ${sheet}
    </div>`;
  }

  // What swiping shows beside the open picture: the neighbour exactly as it will sit once open.
  function peekHTML(id) {
    const it = byId(id);
    return it ? `<div class="peek" style="${arStyle(it)}" aria-hidden="true"><img src="${url(it.thumb || it.file)}" alt="" style="${vb(it)}"></div>` : '<div class="peek"></div>';
  }

  return { itemHTML, peekHTML };
};
