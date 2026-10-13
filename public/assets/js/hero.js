/* =============================================================================
   THE MEMORY CONSERVATORY — HERO
   -----------------------------------------------------------------------------
   Reads its entire behaviour from preferences.js. Nothing about the hero is
   decided here:

       isBlackAndWhite               -> colour vs black & white rendering
       imageSrcListForCarousel       -> which images, and whether it is a
                                        carousel at all (array length decides)
       carouselIntervalMicroseconds  -> how long each image holds, in
                                        microseconds; only consulted when there
                                        is more than one image
       grainOpacity, kenBurns        -> optional finish

   To change any of it, edit preferences.js. This file should not need touching.
   ========================================================================== */

import { preferences } from './preferences.js';

const config = preferences?.home ?? {};
const hero = document.querySelector('[data-hero]');

/* Below this, an interval is too fast to read as anything but a strobe, and
   almost always means milliseconds were entered where microseconds were asked
   for. We clamp and warn rather than flashing the page at the visitor. */
const MINIMUM_INTERVAL_MS = 1500;
const FALLBACK_INTERVAL_MS = 6000;

const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;


/**
 * Convert the configured microsecond interval into milliseconds for setTimeout.
 * Only ever called when there is more than one image.
 */
function resolveIntervalMs() {
  const micro = Number(config.carouselIntervalMicroseconds);

  if (!Number.isFinite(micro) || micro <= 0) {
    console.warn(
      '[preferences] home.carouselIntervalMicroseconds is missing or invalid. ' +
      `Falling back to ${FALLBACK_INTERVAL_MS / 1000}s.`
    );
    return FALLBACK_INTERVAL_MS;
  }

  const ms = micro / 1000;

  if (ms < MINIMUM_INTERVAL_MS) {
    console.warn(
      `[preferences] home.carouselIntervalMicroseconds is ${micro}, which is ` +
      `${ms}ms — far too fast for a hero image. This value is in MICROSECONDS: ` +
      `1 second = 1000000. Clamped to ${MINIMUM_INTERVAL_MS}ms for now.`
    );
    return MINIMUM_INTERVAL_MS;
  }

  return ms;
}


/** Build one hero slide. The first is eager and high priority — it is the LCP. */
function createSlide(src, index) {
  const slide = document.createElement('div');
  slide.className = 'hero__slide';

  const img = document.createElement('img');
  img.className = 'hero__img';
  img.src = src;
  img.alt = ''; // decorative: the headline carries the meaning
  img.decoding = 'async';

  if (index === 0) {
    img.loading = 'eager';
    img.fetchPriority = 'high';
  } else {
    img.loading = 'lazy';
  }

  slide.appendChild(img);
  return slide;
}


function initHero() {
  if (!hero) return;

  const media = hero.querySelector('[data-hero-media]');
  const controls = hero.querySelector('[data-hero-controls]');
  if (!media) return;

  /* --- Finish that applies however many images there are ----------------- */

  hero.dataset.bw = config.isBlackAndWhite === true ? 'true' : 'false';
  hero.dataset.kenburns = config.kenBurns === true && !prefersReducedMotion ? 'true' : 'false';

  const grain = Number(config.grainOpacity);
  if (Number.isFinite(grain)) {
    if (grain > 1) {
      console.warn(
        `[preferences] home.grainOpacity is ${grain}. CSS opacity is capped at 1 ` +
        'by the spec, so anything above it has no effect. To make the grain ' +
        'stronger, raise home.grainContrast, or switch home.grainBlendMode to ' +
        "'screen' — over a dark or heavily tinted hero, 'overlay' collapses " +
        'toward black no matter how opaque the layer is.'
      );
    }
    hero.style.setProperty('--grain-opacity', String(Math.min(Math.max(grain, 0), 1)));
  }

  const grainContrast = Number(config.grainContrast);
  if (Number.isFinite(grainContrast) && grainContrast >= 0) {
    hero.style.setProperty('--grain-contrast', String(grainContrast));
  }

  // Allow-list rather than passing the string straight into a style property.
  const BLEND_MODES = ['overlay', 'soft-light', 'screen', 'normal', 'hard-light', 'multiply'];
  if (config.grainBlendMode) {
    if (BLEND_MODES.includes(config.grainBlendMode)) {
      hero.style.setProperty('--grain-blend', config.grainBlendMode);
    } else {
      console.warn(
        `[preferences] home.grainBlendMode "${config.grainBlendMode}" is not one of ` +
        `${BLEND_MODES.join(', ')}. Falling back to overlay.`
      );
    }
  }

  const tint = Number(config.tintOpacity);
  if (Number.isFinite(tint)) {
    hero.style.setProperty('--hero-tint', String(Math.min(Math.max(tint, 0), 1)));
  }

  const veil = Number(config.veilOpacity);
  if (Number.isFinite(veil)) {
    hero.style.setProperty('--hero-veil', String(Math.min(Math.max(veil, 0), 1)));
  }

  /* --- What are we rendering? -------------------------------------------- */

  const sources = Array.isArray(config.imageSrcListForCarousel)
    ? config.imageSrcListForCarousel.filter(Boolean)
    : [];

  // No images configured: the hero keeps its deep indigo ground and the words
  // still read perfectly. The page is never broken by an empty list.
  if (sources.length === 0) {
    console.warn('[preferences] home.imageSrcListForCarousel is empty — hero will render without a photograph.');
    if (controls) controls.remove();
    return;
  }

  media.replaceChildren(...sources.map(createSlide));
  const slides = Array.from(media.children);
  slides[0].classList.add('is-active');

  /* --- Single image: static background, no carousel, no timer ------------- */

  if (sources.length === 1) {
    if (controls) controls.remove(); // no dots, no arrows, nothing to control
    return;
  }

  /* --- More than one image: carousel -------------------------------------- */

  if (!controls) return;

  const intervalMs = resolveIntervalMs();
  const dotList = controls.querySelector('[data-hero-dots]');
  const current = controls.querySelector('[data-hero-current]');
  const total = controls.querySelector('[data-hero-total]');

  controls.hidden = false;
  if (total) total.textContent = String(sources.length).padStart(2, '0');

  const dots = sources.map((_src, index) => {
    const item = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'hero__dot';
    button.style.setProperty('--slide-duration', `${intervalMs}ms`);
    button.innerHTML = `<span class="sr-only">Show image ${index + 1} of ${sources.length}</span>`;
    button.addEventListener('click', () => goTo(index, true));
    item.appendChild(button);
    dotList?.appendChild(item);
    return button;
  });

  let index = 0;
  let timer = null;

  function paint() {
    slides.forEach((slide, i) => slide.classList.toggle('is-active', i === index));

    dots.forEach((dot, i) => {
      if (i === index) {
        // Re-trigger the progress sweep from zero by replacing the node's
        // animation state; simply re-setting the attribute would not restart it.
        dot.style.animation = 'none';
        dot.removeAttribute('aria-current');
        void dot.offsetWidth; // force reflow
        dot.style.animation = '';
        dot.setAttribute('aria-current', 'true');
      } else {
        dot.removeAttribute('aria-current');
      }
    });

    if (current) current.textContent = String(index + 1).padStart(2, '0');

    // Give the next image a head start so the crossfade is never a blank frame.
    const nextImg = slides[(index + 1) % slides.length]?.querySelector('img');
    if (nextImg && nextImg.loading === 'lazy') nextImg.loading = 'eager';
  }

  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(() => goTo(index + 1, false), intervalMs);
  }

  function goTo(next, fromUser) {
    index = (next + slides.length) % slides.length;
    paint();
    // A manual move restarts the clock, so the visitor never gets a stub of a
    // slide because the automatic timer happened to be nearly up.
    if (fromUser || !prefersReducedMotion) schedule();
  }

  controls.querySelector('[data-hero-prev]')?.addEventListener('click', () => goTo(index - 1, true));
  controls.querySelector('[data-hero-next]')?.addEventListener('click', () => goTo(index + 1, true));

  // Arrow keys, but only while focus is inside the hero — hijacking the arrow
  // keys for the whole page would break scrolling.
  hero.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowLeft') { event.preventDefault(); goTo(index - 1, true); }
    if (event.key === 'ArrowRight') { event.preventDefault(); goTo(index + 1, true); }
  });

  // Swipe, which on a phone is how people will actually move between images.
  let touchStartX = null;
  hero.addEventListener('touchstart', (event) => {
    touchStartX = event.changedTouches[0].clientX;
  }, { passive: true });

  hero.addEventListener('touchend', (event) => {
    if (touchStartX === null) return;
    const delta = event.changedTouches[0].clientX - touchStartX;
    if (Math.abs(delta) > 45) goTo(index + (delta < 0 ? 1 : -1), true);
    touchStartX = null;
  }, { passive: true });

  // Stop advancing while the tab is in the background — otherwise a visitor
  // returns to a carousel that has silently churned through every image.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) clearTimeout(timer);
    else schedule();
  });

  paint();

  // With reduced motion the carousel holds on the first image and offers the
  // controls, rather than moving on its own.
  if (!prefersReducedMotion) schedule();
}

initHero();
