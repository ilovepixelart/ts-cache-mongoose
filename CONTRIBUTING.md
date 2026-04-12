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
4. Keep changes focused — one feature or fix per PR

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
