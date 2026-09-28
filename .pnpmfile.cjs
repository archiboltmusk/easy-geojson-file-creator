// typescript-eslint refuses to load under TypeScript 7, which this repo uses.
// Point its packages at the TS 6 API package instead, as the TS 7 release notes suggest.
// Remove once typescript-eslint supports TS 7:
// https://github.com/typescript-eslint/typescript-eslint/issues/10940
const TS6 = "npm:@typescript/typescript6@^6.0.2"

function readPackage(pkg) {
  if (pkg.name === "typescript-eslint" || pkg.name.startsWith("@typescript-eslint/") || pkg.name === "ts-api-utils") {
    if (pkg.peerDependencies?.typescript) {
      delete pkg.peerDependencies.typescript
      if (pkg.peerDependenciesMeta) delete pkg.peerDependenciesMeta.typescript
      pkg.dependencies = { ...pkg.dependencies, typescript: TS6 }
    }
  }
  return pkg
}

module.exports = { hooks: { readPackage } }
