// CommonJS consumer: loads the package with require().
const pkg = process.env.E2E_PACKAGE
if (!pkg) throw new Error('E2E_PACKAGE is not set')

const loaders = {
  load: async () => require(pkg),
  loadNest: async () => require(`${pkg}/nest`),
}

import('./main.ts').then(({ main }) => main(loaders))
