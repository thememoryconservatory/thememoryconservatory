/* =============================================================================
   THE MEMORY CONSERVATORY — SITE PREFERENCES
   =============================================================================

   This is the single place to change how the site behaves without touching any
   component code, markup or styling.

   It is organised by page. Each page gets its own section, so new pages can add
   their own preferences here as they are built. `site` holds anything shared
   across every page.

       preferences.site   -> applies everywhere
       preferences.home   -> Home / Landing page
       preferences.about  -> (to be added when the About page is built)
       ...and so on.

   Anything marked TODO:CLIENT is placeholder data awaiting the real thing.
   See PRELAUNCH-CHECKLIST.md for the full list.
   ========================================================================== */

export const preferences = {

  /* ---------------------------------------------------------------------------
     SITE-WIDE
     ------------------------------------------------------------------------ */
  site: {
    brandName: 'The Memory Conservatory',
    // Official details, per the brand guidelines.
    email: 'thememoryconservatory@gmail.com',
    phone: '+918438533169',
    address: '#28, Duraiswamy Pillai St, West Tambaram, Chennai',
    website: 'https://www.thememoryconservatory.com',

    /* WhatsApp enquiry button.
       In India most wedding enquiries arrive over WhatsApp rather than email,
       so the button appears in the footer and as a floating button on mobile.

       Set `enabled: false` to remove it from every page at once — the markup is
       hidden by default in CSS and only revealed when this is true, so turning
       it off leaves nothing visible and nothing to clean up.

       `number` must be in full international format, digits only:
       country code + number, no "+", no spaces, no dashes.
       Example for a Chennai mobile: '919876543210' */
    whatsapp: {
      enabled: true,
      number: '918438533169',   // from the client's brand guidelines
      prefilledMessage: "Hello! I'd like to enquire about wedding photography.",
    },
  },

  /* ---------------------------------------------------------------------------
     HOME / LANDING PAGE
     ------------------------------------------------------------------------ */
  home: {

    /* -------------------------------------------------------------------------
       isBlackAndWhite
       -------------------------------------------------------------------------
       Controls how the hero background image(s) are rendered.

           true   -> hero image(s) rendered in black & white
           false  -> hero image(s) rendered in full colour

       This is a display filter only. The source files are untouched, so you can
       flip this back and forth freely without re-exporting any images.

       It applies to every image in the carousel, not just the first one. */
    isBlackAndWhite: false,

    /* -------------------------------------------------------------------------
       imageSrcListForCarousel
       -------------------------------------------------------------------------
       The hero background image source(s).

       THIS IS ALWAYS AN ARRAY — never a bare string, even when there is only
       one image. Keeping the type consistent means the hero logic never has to
       guess: it simply checks the array's length to decide what to render.

           More than one image  ->  renders as a CAROUSEL. Images crossfade
                                    automatically, and navigation controls
                                    (dots, arrows, swipe, arrow keys) appear.

           Exactly one image    ->  renders as a STATIC background image.
                                    No carousel behaviour, no controls, and no
                                    timer is started.

           Empty array          ->  no image renders; the hero falls back to a
                                    plain deep-indigo background. The page still
                                    works, it just has no photograph.

       So to switch from a carousel to a single static hero, delete the lines you
       do not want and leave one behind. Nothing else needs changing.

       Paths are relative to the site root, i.e. files inside public/. */
    imageSrcListForCarousel: [                                   // TODO:CLIENT
      'https://tmc-gallery.pages.dev/jayashree-x-rajesh/full/jayashree-rajesh-outdoor-145.jpg',
      'https://tmc-gallery.pages.dev/jayashree-x-rajesh/full/jayashree-rajesh-outdoor-132.jpg',
      'https://tmc-gallery.pages.dev/sheena-x-daniel/full/sheena-daniel-outdoor-17.jpg',
      'https://tmc-gallery.pages.dev/nivedha-x-ajit/full/n-x-a-tmc-13.jpg',
    ],

    /* -------------------------------------------------------------------------
       carouselIntervalMicroseconds
       -------------------------------------------------------------------------
       How long each image stays on screen before transitioning to the next,
       expressed in MICROSECONDS.

       ONLY USED WHEN `imageSrcListForCarousel` HAS MORE THAN ONE IMAGE.
       With a single image the hero is static, so there is nothing to time and
       this value is ignored entirely — no timer is ever started.

       Microseconds are a thousand times smaller than the milliseconds normally
       used by JavaScript timers, so the numbers look large. For reference:

           3 seconds  =  3000000
           5 seconds  =  5000000
           6 seconds  =  6000000   <- current setting
           8 seconds  =  8000000
          10 seconds  = 10000000

       (The hero converts this to milliseconds internally by dividing by 1000.
       If a suspiciously small value is set — one that would flash images faster
       than a person can see, which usually means milliseconds were entered by
       mistake — the hero clamps it to a safe minimum and logs a warning to the
       browser console rather than strobing the page.) */
    carouselIntervalMicroseconds: 6000000,

    /* -------------------------------------------------------------------------
       Hero finish — optional extras
       ------------------------------------------------------------------------- */

    /* --- Film grain ------------------------------------------------------
       Three controls, because opacity alone cannot make grain stronger.

       CSS `opacity` is clamped to 0-1 by the spec: 1.5 computes to 1. Once
       grainOpacity reaches 1 there is nothing left to raise, and if the grain
       still looks weak the cause is the blend mode or the texture, not the
       opacity. Reach for grainContrast and grainBlendMode instead.
       --------------------------------------------------------------------- */

    /* How much of the grain layer is composited. 0 = off, 1 = fully present.
       Over a light hero, 0.05-0.12 is plenty. Over a heavily tinted one you
       will want much more. */
    /* Dialled well back from 1. The client's correction: "we shall finalise if
       we need the grain effects on the slideshow. It doesn't look that great
       right now." Set to 0 to switch the texture off altogether — the layer is
       hidden entirely at 0, so nothing is left behind. */
    grainOpacity: 0.18,

    /* Pushes the noise toward pure black and white, which is what actually
       makes grain look coarse rather than like a grey haze. 1 = the raw
       texture, 2-4 = progressively harsher and more filmic. This is the knob
       to turn when grainOpacity is already at 1 and it still is not enough. */
    grainContrast: 1.6,

    /* How the grain combines with the image beneath it.

         'overlay'     the default. Beautiful over a bright photograph, but it
                       modulates midtones, so as the backdrop approaches black
                       the result approaches black too. On a heavily tinted
                       hero it all but disappears — which is exactly the case
                       where people try to raise the opacity and get nowhere.
         'soft-light'  gentler than overlay, similar falloff on dark grounds.
         'screen'      lightens only. The one that stays visible over a dark,
                       tinted hero, because it adds luminance instead of
                       modulating it. Pair with a low opacity.
         'normal'      no blending. Strongest and flattest; the grain sits on
                       top as literal grey speckle rather than living in the
                       image. Use sparingly.

       Rule of thumb: light hero -> 'overlay'. Dark or heavily tinted hero ->
       'screen'. */
    grainBlendMode: 'overlay',

    /* Depth of the flat black tint laid over the hero photograph.
       0 = no tint, 1 = solid black. Applied ALWAYS — in colour mode as well as
       black & white — on top of the indigo gradient that keeps the headline
       legible. Its job is to settle the image back so the words sit in front
       of it, and to hold a consistent depth across photographs that were shot
       in very different light.

       Around 0.15-0.25 reads as depth. Past roughly 0.35 the photograph starts
       to look muddy rather than deliberate. */
    tintOpacity: 0.22,

    /* Depth of the flat black veil sitting BETWEEN the photograph and the
       content — the headline, the buttons and the carousel controls all sit on
       top of it.

       This is separate from `tintOpacity` above, and the two do different jobs:

           tintOpacity  darkens the PHOTOGRAPH. It sits under the indigo
                        gradient and the film grain, so the grain and the
                        gradient are laid over an already-settled image.

           veilOpacity  darkens EVERYTHING BENEATH THE TEXT. It sits above the
                        gradient and the grain, so it lifts the words off the
                        picture whatever the lower layers are doing.

       Use this one when the copy needs more separation from a busy or bright
       photograph. Around 0.10-0.20 is a gentle lift; past roughly 0.30 the two
       tints together start to flatten the image. Set to 0 to switch it off. */
    veilOpacity: 0.16,

    /* Slow "Ken Burns" zoom on the hero image while it is on screen.
       Adds a sense of motion to a still photograph. Automatically disabled for
       visitors who have asked their device to reduce motion. */
    kenBurns: true,
  },

};

export default preferences;
