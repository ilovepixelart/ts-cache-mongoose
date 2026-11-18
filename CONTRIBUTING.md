# Contributing

## Getting Started

```bash
git clone https://github.com/ilovepixelart/ts-cache-mongoose.git
cd ts-cache-mongoose
npm install
npx simple-git-hooks  # one-time: register the git hooks defined in package.json
```

## Development

```bash
npm run type:check         # type check src
npm run type:check:tests   # type check tests
npm run biome              # lint check
npm run biome:fix          # lint + auto-fix
npm test                   # run tests with coverage
npm run build              # build with pkgroll
```

### Git Hooks

The project uses `simple-git-hooks`. Contributors run `npx simple-git-hooks`
once after `npm install` to register the hooks locally:

- **pre-commit**: runs `npm run type:check`
- **pre-push**: runs `npm run biome:fix`

## Before Submitting a PR

1. Run the full check: `npm run type:check && npm run type:check:tests && npm run biome && npm test && npm run build`
2. Ensure no test regressions
3. Follow the existing code style (Biome handles formatting)
4. Keep changes focused: one feature or fix per PR

## Code Style

- ESM (`"type": "module"`)
- Strict TypeScript
- Biome formatting: no semicolons, single quotes, 2-space indent
- Arrow functions for standalone functions (no `this`)
- No unnecessary comments or docstrings

## Testing

- Framework: vitest
- Database: mongodb-memory-server
- Write tests for new features and bug fixes
- Test behavior, not implementation details

## End-to-end tests

`npm run test:e2e` builds and packs the package, installs the tarball into a consumer project in the
system temp directory, and runs the scenarios in `e2e/consumer/` there, each scenario group in its own
process (`init()` configures the cache once per process), once through `require()` and once through
`import`. They run against a MongoDB replica set from mongodb-memory-server and a real Redis, and
count MongoDB read commands through the driver's command monitoring, because a query that is never
cached still returns correct data.

The run fails when a scenario fails, when `require()` and `import` give different results, or when a
result differs from the latest release on npm, which runs the same scenarios in the same consumer
project. A change that is meant to differ from the release goes into `e2e/allowlist.json` with its
scenario (`group/name`) and pull request number; an entry that no longer differs fails the run, so the
list is emptied after the next release.

It needs Node.js 22.18 or later (type stripping) and a Redis server. Start a throwaway one on a
port of its own and remove it afterwards:

```bash
docker run -d --name ts-cache-mongoose-e2e -p 127.0.0.1:6390:6379 redis:8-alpine
REDIS_PORT=6390 npm run test:e2e
docker rm -f ts-cache-mongoose-e2e
```

Options, after `npm run build`:

```bash
node e2e/run.ts --groups memory,redis-down             # some scenario groups (see e2e/consumer/main.ts)
node e2e/run.ts --candidate ts-cache-mongoose@2.4.2    # another build or published version
node e2e/run.ts --reference 2.4.2                      # compare with another release
node e2e/run.ts --no-reference                         # skip the comparison
E2E_MONGOOSE=mongoose@8.23.0 E2E_BSON=bson@^6.10.4 node e2e/run.ts   # other peer versions
```

CI runs it on Node.js 24.x for each mongoose version of the coverage matrix.
