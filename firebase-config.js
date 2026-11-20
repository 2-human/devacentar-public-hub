/* The Centar DEVA hub's Firebase project (devacentar-hub, web app "Centar DEVA hub").
 * Public by design: access is decided by email-link sign-in, the account's role claim and the Firestore rules
 * (firebase/), not by keeping this hidden. Plain JSON below so tools can read it; the publisher
 * (work-setup/build/publish_gated.sh) refuses a config for another project or one that points at the emulators. */
window.FIREBASE_CONFIG = {
  "apiKey": "AIzaSyARm7hcvqPcfDraz_Nyv8bUcTHdunyUvpU",
  "authDomain": "devacentar-hub.firebaseapp.com",
  "projectId": "devacentar-hub",
  "storageBucket": "devacentar-hub.firebasestorage.app",
  "messagingSenderId": "165052418454",
  "appId": "1:165052418454:web:e5143f594094c8905935b7"
};
