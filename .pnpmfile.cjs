module.exports = {
  hooks: {
    readPackage(pkg) {
      if (pkg.name === '@prisma/client') {
        delete pkg.peerDependencies
        delete pkg.peerDependenciesMeta
      }
      return pkg
    },
  },
}
