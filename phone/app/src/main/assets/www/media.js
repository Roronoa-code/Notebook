// Media interactions stay local: no uploads, conversions or changes to the saved originals.
window.NBMedia = (() => {
  let photo = null;
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Where a photo actually sits inside its box when it's shown with object-fit: contain.
  function shown(img) {
    const r = img.getBoundingClientRect(), ar = (img.naturalWidth || r.width) / (img.naturalHeight || r.height);
    const w = Math.min(r.width, r.height * ar), h = w / ar;
    return { x: r.x + (r.width - w) / 2, y: r.y + (r.height - h) / 2, w, h };
  }
  // The transform that puts the viewer's photo exactly over the photo on the item screen.
  function overSource(source, img) {
    const s = shown(source), t = img.getBoundingClientRect();
    if (!t.width || !s.w) return 'none';
    return `translate(${s.x + s.w / 2 - (t.x + t.width / 2)}px,${s.y + s.h / 2 - (t.y + t.height / 2)}px) scale(${s.w / t.width})`;
  }
  const FADE = [{ backgroundColor: 'rgba(8,8,8,0)' }, { backgroundColor: 'rgb(8,8,8)' }];

  function closePhoto(direction = 0) {
    if (!photo) return false;
    const { dialog, returnFocus, source, img, zoomed } = photo;
    photo = null;
    const finish = () => { dialog.close(); dialog.remove(); source.style.opacity = ''; if (returnFocus.isConnected) returnFocus.focus(); };
    if (reduced()) finish();
    else if (!direction && !zoomed() && source.isConnected) {
      // Shrink back into the item screen's photo.
      const o = { duration: 320, easing: 'cubic-bezier(.2,.75,.25,1)', fill: 'forwards' };
      img.style.transition = 'none';
      img.animate([{ transform: img.style.transform || 'none' }, { transform: overSource(source, img) }], o).onfinish = finish;
      dialog.animate([...FADE].reverse(), o);
      dialog.querySelector('.photo-tools').animate([{ opacity: 1 }, { opacity: 0 }], { duration: 160, fill: 'forwards' });
    } else {
      const style = getComputedStyle(dialog);
      const from = { opacity: style.opacity, transform: style.transform };
      dialog.getAnimations().forEach((a) => a.cancel());
      dialog.animate([from, { opacity: 0, transform: direction ? `translateY(${direction * innerHeight}px)` : 'scale(.97)' }],
        { duration: 260, easing: 'cubic-bezier(.22,1,.36,1)', fill: 'forwards' }).onfinish = finish;
    }
    return true;
  }

  function openPhoto(source) {
    if (photo) return;
    const dialog = document.createElement('dialog');
    dialog.className = 'photo-viewer';
    dialog.setAttribute('aria-label', source.alt || 'Photo');
    dialog.innerHTML = '<div class="photo-tools"><button type="button" class="iconbtn glass" data-close aria-label="Close photo"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"></path></svg></button></div><div class="photo-viewport" aria-label="Pinch or double-tap to zoom, swipe up or down to close"></div>';
    const viewport = dialog.querySelector('.photo-viewport');
    const img = source.cloneNode();
    img.draggable = false;
    viewport.append(img);
    document.body.append(dialog);
    let scale = 1, x = 0, y = 0, frame = 0, start = null, lastTap = 0, travelled = false;
    photo = { dialog, returnFocus: document.activeElement, source, img, zoomed: () => scale !== 1 };
    dialog.showModal();
    dialog.querySelector('[data-close]').onclick = () => closePhoto();
    dialog.addEventListener('cancel', (e) => { e.preventDefault(); closePhoto(); });
    if (!reduced()) {
      // The photo grows from where it was on the item screen; the dark backdrop fades in around it.
      const o = { duration: 380, easing: 'cubic-bezier(.2,.75,.25,1)' };
      img.animate([{ transform: overSource(source, img) }, { transform: 'none' }], o);
      dialog.animate(FADE, o);
      dialog.querySelector('.photo-tools').animate([{ opacity: 0 }, { opacity: 1 }], o);
      source.style.opacity = '0';
    }
    let dragY = 0, bounds = viewport.getBoundingClientRect();
    const pointers = new Map();
    const clamp = (v, limit) => Math.max(-limit, Math.min(limit, v));
    const paint = () => {
      frame = 0;
      x = clamp(x, Math.max(0, (img.clientWidth * scale - viewport.clientWidth) / 2));
      y = clamp(y, Math.max(0, (img.clientHeight * scale - viewport.clientHeight) / 2));
      img.style.transform = `translate3d(${x}px,${y}px,0) scale(${scale})`;
    };
    const draw = () => { if (!frame) frame = requestAnimationFrame(paint); };
    const centre = () => {
      const p = [...pointers.values()], r = bounds;
      const a = p[0], b = p[1] || a;
      return { cx: (a.x + b.x) / 2 - r.left - r.width / 2, cy: (a.y + b.y) / 2 - r.top - r.height / 2, distance: Math.hypot(a.x - b.x, a.y - b.y) };
    };
    const begin = () => { start = pointers.size ? { ...centre(), scale, x, y } : null; };
    const zoom = (next, cx = 0, cy = 0) => {
      const ratio = next / scale;
      x = cx - (cx - x) * ratio; y = cy - (cy - y) * ratio; scale = next;
      img.style.transition = reduced() ? 'none' : 'transform .22s cubic-bezier(.22,1,.36,1)';
      paint();
    };
    dialog.addEventListener('keydown', (e) => {
      if (e.key === '+' || e.key === '=') { e.preventDefault(); zoom(Math.min(4, scale + .5)); }
      if (e.key === '-') { e.preventDefault(); zoom(Math.max(1, scale - .5)); }
    });
    viewport.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      img.style.transition = 'none';
      viewport.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      dialog.getAnimations().forEach((a) => a.cancel());
      img.getAnimations().forEach((a) => a.finish()); // touching mid-opening takes over straight away
      dialog.style.transform = ''; dialog.style.opacity = ''; dragY = 0;
      bounds = viewport.getBoundingClientRect();
      travelled = pointers.size > 1;
      begin();
    });
    viewport.addEventListener('pointermove', (e) => {
      if (!pointers.has(e.pointerId) || !start) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const c = centre();
      if (Math.hypot(c.cx - start.cx, c.cy - start.cy) > 5) travelled = true;
      if (pointers.size === 1 && start.scale === 1 && Math.abs(c.cy - start.cy) > Math.abs(c.cx - start.cx)) {
        dragY = c.cy - start.cy;
        dialog.style.transform = `translateY(${dragY}px)`;
        dialog.style.opacity = Math.max(.35, 1 - Math.abs(dragY) / innerHeight);
        return;
      }
      scale = pointers.size > 1 ? Math.max(1, Math.min(4, start.scale * c.distance / Math.max(1, start.distance))) : start.scale;
      const ratio = scale / start.scale;
      x = c.cx - (start.cx - start.x) * ratio;
      y = c.cy - (start.cy - start.y) * ratio;
      draw();
    });
    const end = (e) => {
      if (!pointers.has(e.pointerId)) return;
      if (dragY) {
        if (e.type === 'pointerup' && Math.abs(dragY) > 90) { closePhoto(Math.sign(dragY)); pointers.clear(); return; }
        if (!reduced()) dialog.animate([{ transform: dialog.style.transform, opacity: dialog.style.opacity }, { transform: 'none', opacity: 1 }], { duration: 260, easing: 'cubic-bezier(.22,1,.36,1)' });
        dialog.style.transform = ''; dialog.style.opacity = ''; dragY = 0;
      }
      const c = centre();
      if (!travelled && e.type === 'pointerup' && pointers.size === 1) {
        const now = performance.now();
        if (now - lastTap < 300) { zoom(scale > 1 ? 1 : 2.5, c.cx, c.cy); lastTap = 0; }
        else lastTap = now;
      } else lastTap = 0;
      pointers.delete(e.pointerId);
      begin();
    };
    viewport.addEventListener('pointerup', end);
    viewport.addEventListener('pointercancel', end);
    img.addEventListener('load', paint);
    paint();
  }

  function wireDetails(root) {
    const details = root.querySelector('.media-details');
    if (!details) return;
    const sheet = details.closest('.sheet'), summary = details.querySelector('summary'), fields = details.querySelector('.media-fields');
    let expanded = details.open, animation = null;
    summary.setAttribute('aria-expanded', expanded);
    summary.onclick = (e) => {
      e.preventDefault();
      const from = sheet.getBoundingClientRect().height;
      animation?.cancel();
      expanded = !expanded;
      summary.setAttribute('aria-expanded', expanded);
      fields.inert = !expanded;
      details.open = expanded;
      const to = sheet.getBoundingClientRect().height;
      if (reduced()) return;
      // Keep the content mounted while the sheet closes; rapid taps reverse from its current height.
      details.open = true;
      animation = sheet.animate([{ height: `${from}px` }, { height: `${to}px` }], { duration: 440, easing: 'cubic-bezier(.22,1,.36,1)' });
      animation.onfinish = () => { details.open = expanded; animation = null; };
    };
  }

  function wire(root) {
    wireDetails(root);
    const photoButton = root.querySelector('.photo-open');
    if (photoButton) photoButton.onclick = () => openPhoto(photoButton.querySelector('img'));
    const video = root.querySelector('video');
    if (!video) return;
    const box = root.querySelector('.vbox'), fill = box.querySelector('.vfill'), bar = box.querySelector('.vbar'), sound = box.querySelector('.vsound');
    const message = root.querySelector('.media-message');
    const fail = () => {
      message.textContent = "This video couldn't load. Reopen it to retry, or sync if its file hasn't arrived yet.";
    };
    // The still picture stays underneath until the video is really playing, so nothing ever flashes.
    video.addEventListener('playing', () => { message.textContent = ''; box.classList.add('live'); box.classList.remove('paused'); });
    video.addEventListener('pause', () => box.classList.add('paused'));
    video.addEventListener('error', fail);
    if (video.error) fail();
    let frame = 0;
    const paint = () => {
      const p = video.duration ? video.currentTime / video.duration : 0;
      fill.style.transform = `scaleX(${p.toFixed(4)})`;
      bar.setAttribute('aria-valuenow', String(Math.round(p * 100)));
      frame = requestAnimationFrame(paint);
    };
    frame = requestAnimationFrame(paint);
    new MutationObserver(() => { if (!box.isConnected) cancelAnimationFrame(frame); }).observe(document.getElementById('stage'), { childList: true });
    video.play().catch(() => box.classList.add('paused'));
    box.addEventListener('click', (e) => {
      if (e.target.closest('.vbar, .vsound')) return;
      if (video.paused) video.play().catch(() => box.classList.add('paused')); else video.pause();
    });
    sound.addEventListener('click', () => {
      video.muted = !video.muted;
      sound.setAttribute('aria-pressed', String(!video.muted));
      sound.setAttribute('aria-label', video.muted ? 'Sound on' : 'Sound off');
      sound.innerHTML = video.muted
        ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5L6 9H2v6h4l5 4zM23 9l-6 6M17 9l6 6"></path></svg>'
        : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5L6 9H2v6h4l5 4zM15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14"></path></svg>';
    });
    // Drag along the line to move through the video.
    const seek = (x) => { const r = bar.getBoundingClientRect(); if (video.duration) video.currentTime = Math.max(0, Math.min(1, (x - r.left) / r.width)) * video.duration; };
    bar.addEventListener('touchstart', (e) => { seek(e.touches[0].clientX); }, { passive: true });
    bar.addEventListener('touchmove', (e) => { seek(e.touches[0].clientX); }, { passive: true });
    bar.addEventListener('click', (e) => seek(e.clientX));
    bar.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight') video.currentTime = Math.min(video.duration || 0, video.currentTime + 1);
      if (e.key === 'ArrowLeft') video.currentTime = Math.max(0, video.currentTime - 1);
    });
  }
  return { wire, closePhoto };
})();
