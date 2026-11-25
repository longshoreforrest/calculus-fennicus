/* Calculus Fennicus reader — runtime config for the comment layer (classic
 * script, loaded in <head> before the viewer module).
 *
 * The ONE place to tune endpoints, keys and owner accounts. publish.mjs copies
 * this file into the public repo and stamps `buildVersion`. No secrets belong
 * here: the Google client id and the MyPublicAnalytics endpoint are public
 * already (same values as the PhD reader and the Unitas modules).
 */
window.CF_VIEWER_CONFIG = {
  // Book id carried in every comment (volume II will be 'cf3').
  book: 'cf1',
  // MyPublicAnalytics site tag — comments POST as event:'feedback' with this
  // site; the Worker lists it under FEEDBACK_PRIVATE_SITES, so only the owner
  // accounts below can read them back.
  site: 'calculus-fennicus',
  collectEndpoint: 'https://mypa.longshoreforrest.workers.dev/collect',
  feedbackEndpoint: 'https://mypa.longshoreforrest.workers.dev/feedback',

  // Google Sign-In (Google Identity Services). Same OAuth client the Worker
  // verifies tokens against; https://longshoreforrest.github.io is already an
  // authorized JavaScript origin (shared with the PhD reader).
  googleClientId: '605639423178-s3pu2m6mkf9r50u69709u0mhchf0ha97.apps.googleusercontent.com',
  identityKey: 'unitas:identity',   // shared localStorage key (MyPA beacon reads the same)
  requireSignIn: true,              // must be signed in to submit a comment

  // Owner view: these accounts see EVERY reader's comment inside the reader
  // (🗂 button + markers on the pages, in both editions). The Worker enforces
  // the same allowlist (FEEDBACK_OWNERS).
  ownerEmails: ['longshoreforrest@gmail.com'],

  // Named-destination tables per edition (tools/gen-dests.py, written next to
  // labels-xx.json on publish). They make a comment's anchor resolve in the
  // other language — see COMMENTS_PLAN.md §4.
  dests: { en: 'dests-en.json', fi: 'dests-fi.json', 'ratkaisut-fi': 'dests-ratkaisut-fi.json' },
  labels: { en: 'labels-en.json', fi: 'labels-fi.json', 'ratkaisut-fi': 'labels-ratkaisut-fi.json' },

  // Third document: worked solutions to the exercises (Finnish). publish.mjs
  // publishes ratkaisut-fi.pdf + its tables + ratkaisut-map.json only when the
  // solutions PDF has been built; without ratkaisut-map.json the reader hides
  // everything solutions-related. Its comments carry doc:'ratkaisut-fi' and
  // never mix with the book's (fi/en share anchors; the solutions do not).
  solutions: {
    doc: 'ratkaisut-fi',
    pdf: ['ratkaisut-fi.pdf', '../ratkaisut1/fi-pdf/ratkaisut1.pdf'],   // published name, local build
    map: 'ratkaisut-map.json',        // book section ref -> chapter file ("VI.2" -> "exp-2")
    // REVIEW BADGE: true shows "Tarkastusversio" in the reader while the solutions
    // are being checked. Set to false (and republish) to remove the badge.
    review: true,
  },

  // Links inside the PDFs that point at these bases open IN the reader (document
  // switch, no page load) — e.g. the solutions' links back to the book.
  siteBaseUrls: ['https://longshoreforrest.github.io/calculus-fennicus/'],

  // Web Speech API dictation language follows the edition being commented.
  dictationLang: { fi: 'fi-FI', en: 'en-US', 'ratkaisut-fi': 'fi-FI' },

  // Stamped by publish.mjs (cache-buster for the modules and the JSON tables).
  buildVersion: '20261125-1639',
};
