// RowProof site configuration. Edit these, redeploy, done.
// Every CTA falls back to an email if its link is empty, so the site works before payments are set up.
window.ROWPROOF_CONFIG = {
  // Where buyers reach you. Use a domain address (e.g. hello@rowproof.dev) once you own one.
  contactEmail: 'stackdrawn@gmail.com',

  // Optional: a scheduling page (Cal.com, SavvyCal, Calendly) for buyers who want a call.
  bookingUrl: '',

  // Optional: hosted checkout links per offer (Stripe Payment Links, Polar, or Lemon Squeezy).
  // Leave empty to collect a written brief by email first (recommended for the first pilots).
  checkout: {
    boundaryCheck: '',
    releaseAssurance: '',
    agency: '',
  },

  // Public source repository.
  repoUrl: 'https://github.com/Shreyastacky/ship-safe',
};
