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
   TESTIMONIALS — paging the scroll-snap track

   The track is a real overflow container with CSS scroll-snap, so swiping,
   trackpad flicks and keyboard scrolling all work before this file loads. All
   this adds is a pair of arrows and a page counter, which is why the nav is
   `hidden` in the markup and only revealed here: an arrow that does nothing
   because a script failed is worse than no arrow.
   -------------------------------------------------------------------------- */

function initTestimonials() {
  document.querySelectorAll('[data-testimonials]').forEach((root) => {
    const track = root.querySelector('[data-testimonial-track]');
    const nav = root.querySelector('[data-testimonial-nav]');
    if (!track || !nav) return;

    const cards = [...track.querySelectorAll('.testimonial')];
    const prev = nav.querySelector('[data-testimonial-prev]');
    const next = nav.querySelector('[data-testimonial-next]');
    const current = nav.querySelector('[data-testimonial-current]');
    const total = nav.querySelector('[data-testimonial-total]');

    // How many cards fit, measured rather than assumed, so this stays correct
    // at every breakpoint and the moment the phone is rotated.
    //
    // A page is NOT track.clientWidth. Three columns plus the two gaps between
    // them come to about 36px more than the visible width, so counting pages
    // off clientWidth reported nine reviews as four pages rather than three.
    // Measuring one card and one gap gives the true stride.
    const gap = () => parseFloat(getComputedStyle(track).columnGap) || 0;
    const cardWidth = () => cards[0].getBoundingClientRect().width;

    const perPage = () =>
      Math.max(1, Math.round((track.clientWidth + gap()) / (cardWidth() + gap())));

    const pageStride = () => perPage() * (cardWidth() + gap());
    const maxScroll = () => track.scrollWidth - track.clientWidth;

    // Nothing to page through — one screenful holds everything.
    if (maxScroll() < 4) return;

    nav.hidden = false;

    const update = () => {
      const max = maxScroll();
      // 4px of slack: fractional layout widths mean scrollLeft rarely lands
      // exactly on 0 or on max, and a strict compare leaves the arrow at the
      // end of the run permanently enabled.
      prev.disabled = track.scrollLeft <= 4;
      next.disabled = track.scrollLeft >= max - 4;

      if (current && total) {
        const pages = Math.max(1, Math.ceil(cards.length / perPage()));
        total.textContent = String(pages);
        current.textContent = String(
          Math.min(pages, Math.round(track.scrollLeft / pageStride()) + 1)
        );
      }
    };

    const page = (direction) => {
      track.scrollBy({
        left: direction * pageStride(),
        behavior: prefersReducedMotion ? 'auto' : 'smooth'
      });
    };

    prev.addEventListener('click', () => page(-1));
    next.addEventListener('click', () => page(1));

    // Passive: this only reads scroll position and never calls
    // preventDefault, so the browser must not wait on it to scroll.
    track.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);

    update();

    /* --- The full review, in a modal --------------------------------------
       One dialog per section, filled from whichever card was clicked, rather
       than nine dialogs in the markup: the reviews then exist once.
       -------------------------------------------------------------------- */

    const dialog = root.querySelector('[data-testimonial-dialog]');

    if (dialog && typeof dialog.showModal === 'function') {
      const dialogBody = dialog.querySelector('[data-testimonial-dialog-body]');
      const dialogBy = dialog.querySelector('[data-testimonial-dialog-by]');

      cards.forEach((card) => {
        const trigger = card.querySelector('[data-testimonial-open]');
        if (!trigger) return;

        trigger.addEventListener('click', () => {
          // textContent, never innerHTML: the review is copied as text so
          // nothing in it can be interpreted as markup.
          dialogBody.textContent = card.querySelector('.testimonial__body').textContent.trim();
          dialogBy.textContent = card.querySelector('.testimonial__by').textContent.trim();
          dialog.showModal();
        });
      });

      dialog.querySelector('[data-testimonial-close]')
        ?.addEventListener('click', () => dialog.close());

      // Clicking the backdrop closes it. The backdrop is not a separate
      // element, so the test is whether the click landed outside the dialog's
      // own box rather than on some child of it.
      dialog.addEventListener('click', (event) => {
        if (event.target !== dialog) return;
        const box = dialog.getBoundingClientRect();
        const outside =
          event.clientX < box.left || event.clientX > box.right ||
          event.clientY < box.top || event.clientY > box.bottom;
        if (outside) dialog.close();
      });
    }

    /* --- Autoplay ---------------------------------------------------------
       Advances a page every 6s and wraps at the end. Paused whenever someone
       is actually looking at or using it, which is more cases than just hover:
       a pointer inside the track, keyboard focus within it, an open dialog, a
       touch in progress, the tab in the background, or the section scrolled
       off screen. Autoplay that fights the reader is worse than none.
       -------------------------------------------------------------------- */

    if (prefersReducedMotion) return;

    const INTERVAL = 6000;
    let timer = null;
    let onScreen = true;

    // A Set of named reasons, not a counter. A counter has to be incremented
    // and decremented in perfectly matched pairs, and these events do not pair
    // up: `mouseenter` fires once but `focusin` fires on every move within the
    // section, so a counter drifts upward and the carousel stops for good.
    // Named reasons are idempotent — holding "hover" twice is still one hold.
    const holds = new Set();
    const hold = (reason) => holds.add(reason);
    const release = (reason) => holds.delete(reason);

    const tick = () => {
      if (holds.size || !onScreen || document.hidden) return;
      // Wrap rather than stop: this is an ambient loop, not a wizard.
      if (track.scrollLeft >= maxScroll() - 4) {
        track.scrollTo({ left: 0, behavior: 'smooth' });
      } else {
        page(1);
      }
    };

    const start = () => { if (!timer) timer = setInterval(tick, INTERVAL); };
    const stop = () => { clearInterval(timer); timer = null; };

    root.addEventListener('mouseenter', () => hold('hover'));
    root.addEventListener('mouseleave', () => release('hover'));

    // :focus-visible, not plain focus. Clicking a card with a mouse leaves the
    // browser focus sitting on that card's button; treating that as "someone is
    // keyboard-navigating here" pinned the carousel permanently once a reader
    // had opened and closed a single review. Only keyboard focus should pause.
    root.addEventListener('focusin', (event) => {
      if (event.target.matches(':focus-visible')) hold('focus');
    });

    root.addEventListener('focusout', () => {
      // At focusout the next element has not been focused yet, so the check has
      // to wait a turn before asking whether focus is still inside.
      setTimeout(() => {
        if (!root.querySelector(':focus-visible')) release('focus');
      }, 0);
    });

    // A finger on the track counts as reading it.
    track.addEventListener('touchstart', () => hold('touch'), { passive: true });
    track.addEventListener('touchend', () => release('touch'), { passive: true });

    const dlg = root.querySelector('[data-testimonial-dialog]');
    if (dlg) {
      dlg.addEventListener('close', () => release('dialog'));
      root.querySelectorAll('[data-testimonial-open]')
        .forEach((b) => b.addEventListener('click', () => hold('dialog')));
    }

    // Nothing should be moving in a section nobody is looking at.
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(
        ([entry]) => { onScreen = entry.isIntersecting; },
        { threshold: 0.2 }
      ).observe(root);
    }

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) stop(); else start();
    });

    start();
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
  const close = dialog.querySelector('[data-lightbox-close]');
  if (!image) return;

  // Bumped on every open and on close, so a full-size file that finishes
  // downloading after the viewer has moved on cannot write itself into the
  // frame — which otherwise leaves the previous photograph loaded and flashes
  // it on the next open.
  let generation = 0;

  const open = (button) => {
    const src = button.dataset.full;
    if (!src) return;
    const thumbnail = button.querySelector('img');
    const mine = ++generation;

    // Show the thumbnail immediately, upscaled, so the frame is never empty
    // while the full-size file travels. It is swapped the moment that lands.
    if (thumbnail) {
      image.src = thumbnail.currentSrc || thumbnail.src;
      image.alt = thumbnail.alt || '';
    }

    const fullSize = new Image();
    fullSize.onload = () => { if (mine === generation) image.src = src; };
    fullSize.src = src;

    dialog.showModal();
  };

  document.querySelectorAll('[data-full]').forEach((button) => {
    button.addEventListener('click', () => open(button));
  });

  if (close) close.addEventListener('click', () => dialog.close());

  // Clicking the backdrop closes it. The dialog fills the whole viewport, so
  // "did they miss the image?" is the hit test — anything outside the <img>.
  dialog.addEventListener('click', (event) => {
    if (event.target === image || event.target.closest('[data-lightbox-close]')) return;
    dialog.close();
  });

  // Drop the source on close so a large photograph is not held in memory, and
  // so the next open never flashes the previous one.
  dialog.addEventListener('close', () => {
    generation += 1;
    image.removeAttribute('src');
  });
}


/* -----------------------------------------------------------------------------
   HOME COLLAGE

   The client sent more photographs than the mockup has cells. Rather than drop
   the surplus, one cell at a time crossfades to a photograph that is not
   currently on screen, so the whole set is seen over time.

   Three things stop it running when it would only waste work or annoy:
   reduced-motion preference, a hidden tab, and the collage being scrolled out
   of view.
   -------------------------------------------------------------------------- */

const COLLAGE_INTERVAL = 3000;   // the client asked for three seconds
const COLLAGE_FADE = 800;        // must match the img transition in input.css

function initCollage() {
  const root = document.querySelector('[data-collage]');
  if (!root) return;

  const cells = [...root.querySelectorAll('[data-collage-img]')];
  let pool = [];
  try {
    pool = JSON.parse(root.dataset.pool || '[]');
  } catch {
    return;                      // malformed data is not worth throwing over
  }

  // With no spare photographs there is nothing to rotate to.
  if (!cells.length || pool.length <= cells.length) return;

  const motionOK = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!motionOK) return;

  const onScreen = new Set(cells.map((img) => img.getAttribute('src')));
  let timer = null;
  let visible = false;

  const swap = () => {
    const spares = pool.filter((p) => !onScreen.has(p.src));
    if (!spares.length) return;

    const cell = cells[Math.floor(Math.random() * cells.length)];
    const next = spares[Math.floor(Math.random() * spares.length)];
    const current = cell.getAttribute('src');
    if (current === next.src) return;

    // Fetch the replacement BEFORE fading, so the cell never sits empty
    // waiting for it on a slow connection.
    const preload = new Image();
    preload.onload = () => {
      cell.dataset.swapping = 'true';
      setTimeout(() => {
        cell.src = next.src;
        cell.alt = next.alt;
        onScreen.delete(current);
        onScreen.add(next.src);
        // Next frame, so the browser paints the new source while still
        // transparent and the fade back in is of the new photograph.
        requestAnimationFrame(() => { cell.dataset.swapping = 'false'; });
      }, COLLAGE_FADE);
    };
    preload.src = next.src;
  };

  const start = () => {
    if (timer || !visible || document.hidden) return;
    timer = setInterval(swap, COLLAGE_INTERVAL);
  };
  const stop = () => {
    clearInterval(timer);
    timer = null;
  };

  if ('IntersectionObserver' in window) {
    new IntersectionObserver((entries) => {
      visible = entries[0].isIntersecting;
      visible ? start() : stop();
    }, { threshold: 0.15 }).observe(root);
  } else {
    visible = true;
    start();
  }

  document.addEventListener('visibilitychange', () => {
    document.hidden ? stop() : start();
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
initCollage();
initYear();
