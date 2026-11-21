function sizeArtworkGallery(gallery) {
  const track = gallery.querySelector('.pz-editions-track');
  const viewport = gallery.querySelector('.pz-editions-viewport');
  track.querySelectorAll('[data-gallery-clone]').forEach((clone) => clone.remove());
  const originals = [...track.children];
  const gap = parseFloat(getComputedStyle(track).columnGap) || 0;
  const distance = track.getBoundingClientRect().width + gap;
  if (!distance || !originals.length) return;
  const groups = Math.ceil(viewport.clientWidth / distance) + 1;

  for (let group = 0; group < groups; group += 1) {
    originals.forEach((artwork) => {
      const clone = artwork.cloneNode(true);
      clone.dataset.galleryClone = 'true';
      clone.setAttribute('aria-hidden', 'true');
      clone.removeAttribute('data-info-open');
      clone.removeAttribute('data-info-dismissed');
      clone.querySelector('.pz-artwork-trigger')?.setAttribute('aria-expanded', 'false');
      clone.querySelectorAll('a').forEach((link) => link.tabIndex = -1);
      track.append(clone);
    });
  }
  gallery.style.setProperty('--pz-gallery-distance', `${distance}px`);
  gallery.style.setProperty('--pz-gallery-duration', `${distance / 32}s`);
}

function addArtworkInfo(figure) {
  const data = figure.dataset;
  const trigger = figure.querySelector('a');
  trigger.classList.add('pz-artwork-trigger');
  trigger.setAttribute('role', 'button');
  trigger.setAttribute('aria-expanded', 'false');
  trigger.setAttribute('aria-label', `${data.artworkTitle} - Artwork by ${data.artworkAuthor}`);
  const info = document.createElement('div');
  info.className = 'pz-artwork-info';
  const author = document.createElement('p');
  author.className = 'pz-artwork-author';
  author.textContent = `Artwork by ${data.artworkAuthor}`;
  info.append(author);
  if (data.artworkSource) {
    try {
      const sourceUrl = new URL(data.artworkSource);
      if (sourceUrl.protocol === 'https:') {
        const source = document.createElement('a');
        source.href = sourceUrl.href;
        source.textContent = data.artworkSourceLabel || 'Overlay source';
        source.target = '_blank';
        source.rel = 'noopener noreferrer';
        info.append(source);
      }
    } catch {}
  }
  if (data.artworkNote) {
    const note = document.createElement('p');
    note.textContent = data.artworkNote;
    info.append(note);
  }
  figure.append(info);
}

function initializeArtworkGalleries() {
  document.querySelectorAll('[data-gallery]').forEach((gallery) => {
    if (gallery.dataset.initialized) return;
    gallery.dataset.initialized = 'true';
    const track = gallery.querySelector('.pz-editions-track');
    const viewport = document.createElement('div');
    viewport.className = 'pz-editions-viewport';
    viewport.tabIndex = 0;
    viewport.setAttribute('role', 'region');
    viewport.setAttribute('aria-label', track.getAttribute('aria-label'));
    track.removeAttribute('tabindex');
    track.removeAttribute('role');
    track.removeAttribute('aria-label');
    track.replaceWith(viewport);
    viewport.append(track);
    track.querySelectorAll('img').forEach((image) => image.loading = 'eager');
    const home = gallery.closest('.pz-gallery-home');
    track.querySelectorAll('figure').forEach((figure) => {
      if (!home) return addArtworkInfo(figure);
      const link = figure.querySelector('a');
      link.href = new URL(home.dataset.showcaseUrl, document.baseURI).href;
      link.setAttribute('aria-label', `View ${figure.dataset.artworkTitle} in the artwork showcase`);
    });
    sizeArtworkGallery(gallery);
  });
}

document.addEventListener('click', (event) => {
  if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
  const target = event.target instanceof Element ? event.target : null;
  if (!target || target.closest('.pz-artwork-info')) return;
  const trigger = target.closest('.pz-artwork-trigger');
  const figure = trigger?.closest('figure');
  const opening = figure && !figure.hasAttribute('data-info-open');
  document.querySelectorAll('[data-info-open]').forEach((entry) => {
    entry.removeAttribute('data-info-open');
    entry.querySelector('.pz-artwork-trigger')?.setAttribute('aria-expanded', 'false');
  });
  if (!figure) return;
  event.preventDefault();
  figure.toggleAttribute('data-info-dismissed', !opening);
  figure.toggleAttribute('data-info-open', opening);
  trigger.setAttribute('aria-expanded', String(opening));
});

document.addEventListener('keydown', (event) => {
  if (event.key === ' ' && event.target.matches?.('.pz-artwork-trigger')) {
    event.preventDefault();
    event.target.click();
  }
  if (event.key !== 'Escape') return;
  document.querySelectorAll('.pz-editions-track figure:hover, .pz-editions-track figure:focus-within, [data-info-open]').forEach((figure) => {
    figure.setAttribute('data-info-dismissed', '');
    figure.removeAttribute('data-info-open');
    figure.querySelector('.pz-artwork-trigger')?.setAttribute('aria-expanded', 'false');
  });
});

document.addEventListener('pointerover', (event) => {
  const figure = event.target.closest?.('.pz-editions-track figure');
  if (figure && !figure.contains(event.relatedTarget)) figure.removeAttribute('data-info-dismissed');
});

document.addEventListener('focusin', (event) => {
  const figure = event.target.closest?.('.pz-editions-track figure');
  if (figure && !figure.contains(event.relatedTarget)) figure.removeAttribute('data-info-dismissed');
});

window.addEventListener('resize', () => {
  document.querySelectorAll('[data-gallery][data-initialized]').forEach(sizeArtworkGallery);
});

if (typeof document$ !== 'undefined') {
  document$.subscribe(initializeArtworkGalleries);
} else if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeArtworkGalleries);
} else {
  initializeArtworkGalleries();
}