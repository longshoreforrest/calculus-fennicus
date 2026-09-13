/* Calculus Fennicus reader — runtime config for the comment layer (classic
 * script, loaded in <head> before the viewer module).
 *
 * The ONE place to tune endpoints, keys and owner accounts. publish.mjs copies
 * this file into the public repo and stamps `buildVersion`. No secrets belong
 * here: the Google client id and the MyPublicAnalytics endpoint are public
 * already (same values as the PhD reader and the Unitas modules).
 */
window.CF_VIEWER_CONFIG = {
  // Book id carried in every comment (nide 3 will be 'cf3').
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
  dests: { en: 'dests-en.json', fi: 'dests-fi.json' },
  labels: { en: 'labels-en.json', fi: 'labels-fi.json' },

  // Web Speech API dictation language follows the edition being commented.
  dictationLang: { fi: 'fi-FI', en: 'en-US' },

  // Stamped by publish.mjs (cache-buster for the modules and the JSON tables).
  buildVersion: '20260913-0948',
};
