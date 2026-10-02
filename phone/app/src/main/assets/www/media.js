// Media interactions stay local: no uploads, conversions or changes to the saved originals.
// The quiet video player on an open video. (Photos and the gestures on them: viewer.js.)
window.NBMedia = (() => {
  function wire(root) {
    const video = root.querySelector('video');
    if (!video) return;
    const box = root.querySelector('.vbox'), fill = box.querySelector('.vfill'), bar = box.querySelector('.vbar'), sound = box.querySelector('.vsound');
    // Loading, playing, paused and failed are separate states on the box. Failed keeps the still picture,
    // hides the playback controls (nothing can play) and says why, inside the picture's own bounds, with a
    // way to try again right here. The sample notebook's videos are stills, and it says so instead.
    const message = box.querySelector('.media-message'), words = message.querySelector('span'), retry = message.querySelector('[data-video-retry]');
    const fail = () => {
      box.classList.add('failed'); box.classList.remove('paused', 'live');
      const demo = !!window.NBNative?.demo;
      words.textContent = demo ? 'Sample video: only its still picture is included.' : "This video can't play. If it's new, sync with your PC first.";
      retry.hidden = demo;
      message.hidden = false;
    };
    retry.addEventListener('click', (e) => { e.stopPropagation(); box.classList.remove('failed'); message.hidden = true; video.load(); video.play().catch(() => {}); });
    // The still picture stays underneath until the video is really playing, so nothing ever flashes.
    video.addEventListener('playing', () => { message.hidden = true; box.classList.remove('failed', 'paused'); box.classList.add('live'); });
    video.addEventListener('pause', () => { if (!box.classList.contains('failed')) box.classList.add('paused'); });
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
    video.play().catch(() => { if (!box.classList.contains('failed')) box.classList.add('paused'); });
    box.addEventListener('click', (e) => {
      if (e.target.closest('.vbar, .vsound, .media-message') || box.classList.contains('failed')) return;
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
  return { wire };
})();
