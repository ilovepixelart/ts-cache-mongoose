// ES module consumer: loads the package with import.
const pkg = process.env.E2E_PACKAGE
if (!pkg) throw new Error('E2E_PACKAGE is not set')

const loaders = {
  load: async () => (await import(pkg)).default,
  loadNest: async () => import(`${pkg}/nest`),
}

const { main } = await import('./main.ts')
await main(loaders)
