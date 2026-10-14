# Contributing

Thanks for your interest in contributing to this project. This guide describes the workflow.

## Prerequisites

- Node.js >= 22.12
- npm
- Git
- A GitHub account

## Setting Up the Development Environment

```bash
# Clone your fork
git clone git@github.com:<your-user>/real-fast-write.git
cd real-fast-write

# Install dependencies
npm ci
```

## Workflow

1. Create a branch from `dev`:
   ```bash
   git checkout dev
   git pull origin dev
   git checkout -b feature/<short-description>
   ```

2. Implement your changes.

3. Make sure all checks pass:
   ```bash
   npm run lint && npm run typecheck && npm test && npm run test:e2e
   ```

4. Commit with a conventional commit message in English, without AI attribution lines:
   ```
   feat(editor): add CSV import support
   ```

5. Push and create a PR targeting `dev`.

## PR Checklist

Before submitting a PR, verify:

- [ ] All tests pass (`npm test`, `npm run test:e2e`)
- [ ] No linting errors (`npm run lint`)
- [ ] Type checking passes (`npm run typecheck`)
- [ ] New functionality has tests
- [ ] Documentation updated (if applicable; keep `README.md` and `README.en.md` identical)
- [ ] CHANGELOG.md updated under `[Unreleased]`
- [ ] Commit messages follow Conventional Commits

## Code Standards

- **TypeScript strict** is required; **Biome** is the only linter/formatter.
- **Type hints** are required for all public functions and methods.
- **Test coverage** for new functionality (target: >= 80 %).

## Issues

- Use the available issue templates.
- Bug reports should include steps to reproduce.
- Feature requests should describe the use case, not just the desired solution.

## Code of Conduct

We expect respectful, constructive interaction. Harassment, discrimination, or trolling will result in exclusion.
