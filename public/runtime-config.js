// Deployment settings the app reads before it starts (src/shared/runtimeConfig.js).
//
// This static copy is what Firebase Hosting serves, and it sets nothing: the
// shared site keeps the values it was built with. A dedicated environment's
// host answers /runtime-config.js itself (stack/app.mjs) with that
// environment's data driver, gateway and sign-in, which is how one build of
// the app serves every company that runs it.
