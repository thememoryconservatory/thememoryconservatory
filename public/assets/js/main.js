/* =============================================================================
   THE MEMORY CONSERVATORY — SITE BEHAVIOUR
   -----------------------------------------------------------------------------
   Runs on every page: navigation, scroll reveals, WhatsApp wiring.

   Deliberately dependency-free. Everything here is a handful of native APIs —
   no animation library — because most of this audience is browsing on a
   mid-range Android phone on a variable connection, and a 30KB library to fade
   some sections in is a poor trade.
   ========================================================================== */

import { preferences } from './preferences.js';

const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;


/* -----------------------------------------------------------------------------
   HEADER — transparent over the hero, indigo once scrolled
   -------------------------------------------------------------------------- */

function initHeader() {
  const header = document.getElementById('siteHeader');
  if (!header) return;

  const setState = () => {
    header.dataset.scrolled = window.scrollY > 40 ? 'true' : 'false';
  };

  setState();
  window.addEventListener('scroll', setState, { passive: true });
}


/* -----------------------------------------------------------------------------
   MOBILE MENU
   -------------------------------------------------------------------------- */

function initMobileMenu() {
  const toggle = document.getElementById('navToggle');
  const panel = document.getElementById('navMobile');
  if (!toggle || !panel) return;

  const setOpen = (open) => {
    toggle.setAttribute('aria-expanded', String(open));
    panel.dataset.open = String(open);
    document.body.dataset.menuOpen = String(open);
    if (open) {
      const firstLink = panel.querySelector('a');
      if (firstLink) firstLink.focus({ preventScroll: true });
    }
  };

  toggle.addEventListener('click', () => {
    setOpen(toggle.getAttribute('aria-expanded') !== 'true');
  });

  // Escape closes and returns focus to the button that opened it.
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && panel.dataset.open === 'true') {
      setOpen(false);
      toggle.focus({ preventScroll: true });
    }
  });

  // Following a link should close the panel behind it.
  panel.querySelectorAll('a').forEach((link) => {
    link.addEventListener('click', () => setOpen(false));
  });

  // Rotating to landscape past the desktop breakpoint must not strand the
  // page with a hidden panel still holding the body scroll lock.
  window.matchMedia('(min-width: 64rem)').addEventListener('change', (event) => {
    if (event.matches) setOpen(false);
  });
}


/* -----------------------------------------------------------------------------
   SCROLL REVEALS
   -------------------------------------------------------------------------- */

function initReveals() {
  const targets = document.querySelectorAll('.reveal');
  if (!targets.length) return;

  // Reduced motion, or a browser without IntersectionObserver: show everything
  // immediately rather than risk content that never appears.
  if (prefersReducedMotion || !('IntersectionObserver' in window)) {
    targets.forEach((el) => el.classList.add('is-visible'));
    return;
  }

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target); // reveal once, then stop watching
      });
    },
    { rootMargin: '0px 0px -12% 0px', threshold: 0.08 }
  );

  targets.forEach((el) => observer.observe(el));
}


/* -----------------------------------------------------------------------------
   WHATSAPP
   -----------------------------------------------------------------------------
   Every WhatsApp element on the page is hidden by CSS until this runs. If
   `preferences.site.whatsapp.enabled` is false they simply stay hidden — there
   is no flash of a button that then vanishes, and nothing to tidy up.
   -------------------------------------------------------------------------- */

function initWhatsApp() {
  const config = preferences?.site?.whatsapp;
  const elements = document.querySelectorAll('[data-whatsapp]');
  if (!elements.length) return;

  if (!config || config.enabled !== true) return;

  const digits = String(config.number || '').replace(/\D/g, '');
  if (!digits) {
    console.warn(
      '[preferences] site.whatsapp.enabled is true but no number is set. ' +
      'Add the full international number, digits only, e.g. "919876543210".'
    );
    return;
  }

  const href = `https://wa.me/${digits}` +
    (config.prefilledMessage ? `?text=${encodeURIComponent(config.prefilledMessage)}` : '');

  elements.forEach((el) => {
    el.setAttribute('href', href);
    el.setAttribute('target', '_blank');
    el.dataset.enabled = 'true';
  });
}


/* -----------------------------------------------------------------------------
   TESTIMONIALS — one review at a time

   After the reference the client chose: a boxed review with arrows and a
   counter. No autoplay — the reference has none, and a review
   that moves while someone is reading it is worse than one that waits.

   All the slides share one grid cell (see input.css), so this only has to say
   which one is active. Inactive slides are made inert, so keyboard focus and
   screen readers only ever meet the review on screen.
   -------------------------------------------------------------------------- */

function initTestimonials() {
  document.querySelectorAll('[data-reviews]').forEach((root) => {
    const slides = [...root.querySelectorAll('[data-review]')];
    const nav = root.querySelector('[data-reviews-nav]');
    if (slides.length < 2 || !nav) return;

    const prev = nav.querySelector('[data-reviews-prev]');
    const next = nav.querySelector('[data-reviews-next]');
    const current = nav.querySelector('[data-reviews-current]');
    const total = nav.querySelector('[data-reviews-total]');
    let index = 0;

    const show = (i) => {
      index = (i + slides.length) % slides.length;
      slides.forEach((slide, k) => {
        const on = k === index;
        slide.toggleAttribute('data-active', on);
        slide.inert = !on;
        slide.setAttribute('aria-hidden', String(!on));
      });
      if (current) current.textContent = String(index + 1);
    };

    if (total) total.textContent = String(slides.length);
    prev.addEventListener('click', () => show(index - 1));
    next.addEventListener('click', () => show(index + 1));

    // Arrow keys while anything in the testimonials has focus.
    root.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowRight') { event.preventDefault(); show(index + 1); }
      if (event.key === 'ArrowLeft')  { event.preventDefault(); show(index - 1); }
    });

    // Swipe on a phone: a mostly-horizontal drag of 40px or more.
    let x0 = null;
    let y0 = null;
    const stage = root.querySelector('[data-reviews-stage]');
    stage.addEventListener('touchstart', (e) => {
      x0 = e.touches[0].clientX;
      y0 = e.touches[0].clientY;
    }, { passive: true });
    stage.addEventListener('touchend', (e) => {
      if (x0 === null) return;
      const dx = e.changedTouches[0].clientX - x0;
      const dy = e.changedTouches[0].clientY - y0;
      x0 = null;
      if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) show(index + (dx < 0 ? 1 : -1));
    }, { passive: true });

    nav.hidden = false;
    show(0);
  });
}


/* -----------------------------------------------------------------------------
   GALLERY LIGHTBOX

   The grid shows 600px thumbnails. Clicking one opens the 2560px version in a
   native <dialog>, which supplies the focus trap, the inert background,
   Esc-to-close and focus return — all of which a hand-rolled overlay gets
   wrong. The full-size source lives on the button as data-full, so it appears
   once in the markup and is only fetched when someone actually opens it.
   -------------------------------------------------------------------------- */

function initLightbox() {
  const dialog = document.querySelector('[data-lightbox]');
  if (!dialog) return;

  const image = dialog.querySelector('[data-lightbox-img]');
  const thumb = dialog.querySelector('[data-lightbox-thumb]');
  const frame = dialog.querySelector('[data-lightbox-frame]');
  const close = dialog.querySelector('[data-lightbox-close]');
  const prev = dialog.querySelector('[data-lightbox-prev]');
  const next = dialog.querySelector('[data-lightbox-next]');
  const count = dialog.querySelector('[data-lightbox-count]');
  if (!image || !thumb || !frame) return;

  // Every photograph on the page, in page order — the order the client
  // curated — so the arrows walk the wedding's timeline.
  const buttons = [...document.querySelectorAll('[data-full]')];
  let index = -1;

  // Bumped on every show and on close, so a full-size file that finishes
  // downloading after the viewer has moved on cannot write itself into the
  // frame — which otherwise leaves the previous photograph loaded and flashes
  // it on the next open.
  let generation = 0;

  // Full-size files already fetched (or in flight). Kept so that stepping
  // back and forth never downloads the same 2560px file twice.
  const cache = new Map();
  const load = (src) => {
    if (!cache.has(src)) {
      const img = new Image();
      img.decoding = 'async';
      img.src = src;
      cache.set(src, img);
    }
    return cache.get(src);
  };

  /* The flow the client asked for: the thumbnail opens at once, blurred, and
     the full-size photograph fades in over it when it arrives. A photograph
     already in memory skips the blur and appears straight away, so stepping
     through with the arrows stays instant. */
  const show = (i) => {
    index = (i + buttons.length) % buttons.length;
    const button = buttons[index];
    const src = button.dataset.full;
    const small = button.querySelector('img');
    const mine = ++generation;

    // Shape the frame from the manifest ratio before anything loads.
    const ratio = button.closest('.shot')?.style.getPropertyValue('--ratio') || '1.5';
    frame.style.setProperty('--ratio', ratio);

    thumb.src = small ? (small.currentSrc || small.src) : '';
    image.alt = small ? small.alt : '';
    image.removeAttribute('data-loaded');
    image.removeAttribute('data-instant');
    image.removeAttribute('src');

    const reveal = (instant) => {
      if (mine !== generation) return;            // the viewer has moved on
      image.src = src;
      image.toggleAttribute('data-instant', instant);
      // Decode first, so the fade shows the whole photograph, never a part —
      // but never wait on it for more than 300ms: decode() can stay pending
      // indefinitely in some browsers, which would leave the photograph
      // hidden behind the blur for good.
      const decoded = image.decode ? image.decode().catch(() => {}) : Promise.resolve();
      const ready = Promise.race([decoded, new Promise((r) => setTimeout(r, 300))]);
      ready.then(() => {
        if (mine !== generation) return;
        // Commit the hidden state before showing, so the fade always runs.
        // A forced layout rather than requestAnimationFrame, which browsers
        // pause in a background tab and would leave the photograph hidden.
        void image.offsetWidth;
        image.setAttribute('data-loaded', '');
      });
    };

    const full = load(src);
    if (full.complete && full.naturalWidth) {
      reveal(true);
    } else {
      full.addEventListener('load', () => reveal(false), { once: true });
    }

    if (count) count.textContent = `${index + 1} / ${buttons.length}`;

    // Fetch the neighbours now, so the next arrow press is instant. This is
    // what makes it feel like a photo viewer rather than a page of links.
    load(buttons[(index + 1) % buttons.length].dataset.full);
    load(buttons[(index - 1 + buttons.length) % buttons.length].dataset.full);
  };

  buttons.forEach((button, i) => {
    button.addEventListener('click', () => {
      show(i);
      dialog.showModal();
    });
  });

  if (close) close.addEventListener('click', () => dialog.close());
  if (prev) prev.addEventListener('click', () => show(index - 1));
  if (next) next.addEventListener('click', () => show(index + 1));

  // Left and right arrow keys, like any photo viewer. Esc is the dialog's own.
  dialog.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowRight') { event.preventDefault(); show(index + 1); }
    if (event.key === 'ArrowLeft')  { event.preventDefault(); show(index - 1); }
  });

  // Swipe on a phone: a mostly-horizontal drag of 40px or more.
  let touchX = null;
  let touchY = null;
  dialog.addEventListener('touchstart', (event) => {
    touchX = event.touches[0].clientX;
    touchY = event.touches[0].clientY;
  }, { passive: true });
  dialog.addEventListener('touchend', (event) => {
    if (touchX === null) return;
    const dx = event.changedTouches[0].clientX - touchX;
    const dy = event.changedTouches[0].clientY - touchY;
    touchX = null;
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) show(index + (dx < 0 ? 1 : -1));
  }, { passive: true });

  // Clicking the backdrop closes it. The dialog fills the whole viewport, so
  // "did they miss the photograph and the controls?" is the hit test.
  dialog.addEventListener('click', (event) => {
    if (event.target.closest('[data-lightbox-frame]') || event.target.closest('button')) return;
    dialog.close();
  });

  // Drop the source on close so the next open never flashes the previous one.
  dialog.addEventListener('close', () => {
    generation += 1;
    image.removeAttribute('src');
    image.removeAttribute('data-loaded');
    thumb.removeAttribute('src');
  });
}


/* -----------------------------------------------------------------------------
   FOOTER YEAR
   -------------------------------------------------------------------------- */

function initYear() {
  const year = String(new Date().getFullYear());
  document.querySelectorAll('[data-year]').forEach((el) => { el.textContent = year; });
}


/* -------------------------------------------------------------------------- */

initHeader();
initMobileMenu();
initReveals();
initTestimonials();
initWhatsApp();
initLightbox();
initYear();
