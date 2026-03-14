# Contributing Guidelines

We welcome contributions from the community. Please follow these guidelines to ensure a smooth process.

## Development Setup

```bash
npm install
```

### Commands

```bash
npm run build          # Build with pkgroll
npm test               # Run tests with vitest + coverage
npm run type:check     # TypeScript type checking
npm run biome          # Lint check
npm run biome:fix      # Lint + auto-fix
```

### Git Hooks

The project uses `simple-git-hooks`:
- **pre-commit**: runs `npm run type:check`
- **pre-push**: runs `npm run biome:fix`

## How to Contribute

1. **Start an Issue**: Before you start working on a feature or bug fix, please create an issue to discuss the best approach.
2. **Fork the Repository**: Create a fork of the repository to work on your changes.
3. **Create a Branch**: Create a new branch for your work.
4. **Make Changes**: Ensure your code follows the project's coding standards.
5. **Write Tests**: Write tests for your changes using vitest.
6. **Commit Changes**: Commit with a clear and concise commit message.
7. **Create a Pull Request**: Provide a detailed description of your changes.

## Code Style

- ESM (`"type": "module"`)
- Strict TypeScript
- Biome formatting: no semicolons, single quotes, 2-space indent

## Dependency Policy

- Only `ioredis` in production dependencies
- Custom implementations: `src/ms.ts` (time parsing), `src/sort-keys.ts` (key sorting)
- Never add external deps for functionality that can be implemented in < 50 lines

## Code of Conduct

Please note that this project is governed by a [Code of Conduct](CODE_OF_CONDUCT.md). By participating, you are expected to adhere to it.
