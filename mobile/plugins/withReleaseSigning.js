// Signs release builds with Envo Phone's own key. The key and its passwords stay outside the repo, in
// ~/.envo-release/signing.properties (storeFile, storePassword, keyAlias, keyPassword), or the file
// named by ENVO_SIGNING_PROPERTIES. Without that file a release build is signed with the debug key,
// as Expo's template does. Every update must be signed with the same key, or phones refuse it.
const { withAppBuildGradle } = require('expo/config-plugins');

const READ = `
def envoSigningFile = new File(System.getenv('ENVO_SIGNING_PROPERTIES') ?: "\${System.getProperty('user.home')}/.envo-release/signing.properties")
def envoSigning = new Properties()
if (envoSigningFile.exists()) envoSigningFile.withInputStream { envoSigning.load(it) }
`;

module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (c) => {
    let s = c.modResults.contents;
    if (s.includes('envoSigning')) return c;
    // The release build type uses the release key when there is one.
    s = s.replace(/(buildTypes \{[\s\S]*?release \{[\s\S]*?)signingConfig signingConfigs\.debug/, "$1signingConfig envoSigning['storeFile'] ? signingConfigs.release : signingConfigs.debug");
    s = s.replace(
      /signingConfigs \{\n(\s*)debug \{/,
      (_m, i) =>
        `signingConfigs {\n${i}if (envoSigning['storeFile']) {\n${i}    release {\n${i}        storeFile file(envoSigning['storeFile'])\n${i}        storePassword envoSigning['storePassword']\n${i}        keyAlias envoSigning['keyAlias']\n${i}        keyPassword envoSigning['keyPassword']\n${i}    }\n${i}}\n${i}debug {`,
    );
    s = s.replace(/\nandroid \{/, `${READ}\nandroid {`);
    c.modResults.contents = s;
    return c;
  });
};
