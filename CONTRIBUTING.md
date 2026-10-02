# Contributing to PersistMark

Thanks for your interest in improving PersistMark! 🎉

## Ways to contribute

- 🐛 [Report a bug](https://github.com/emonhmamun/persistmark-extension/issues/new?template=bug_report.md)
- 💡 [Suggest a feature](https://github.com/emonhmamun/persistmark-extension/issues/new?template=feature_request.md)
- 🔧 Open a pull request
- ⭐ Star the repository to help others find it
- 🌍 Help translate the UI/documentation

## Development setup

```bash
git clone https://github.com/emonhmamun/persistmark-extension.git
cd persistmark-extension
npm install
```

**Load the extension during development:**

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** → select the repo folder
4. After changing code, click the ↻ *Reload* button on the extension card

## Project structure

```
├── manifest.json            # MV3 manifest
├── shared/common.js         # palette + default settings (shared by all contexts)
├── background/service-worker.js   # context menus, commands, badge
├── content/
│   ├── content-script.js    # highlight engine, anchoring, floating UI
│   └── styles.css           # injected mark styles
├── popup/                   # highlight manager popup
├── options/                 # settings page
├── test/
│   ├── test-page.html       # local demo page for manual testing
│   ├── engine-test.js       # jsdom unit/E2E tests for the anchoring engine
│   └── e2e-test.js          # Playwright E2E tests in real Chromium
└── docs/                    # architecture, installation, store listing
```

## Before you submit a PR

1. **Run the checks** — your PR must pass all of them:

   ```bash
   npm run lint          # JS syntax + manifest validation
   npm run test:engine   # 30 anchoring-engine checks (jsdom)
   npm run test:e2e      # 39 UI checks in real Chromium (requires: npx playwright install chromium)
   ```

2. **Keep changes focused** — one feature/fix per pull request.
3. **Follow the existing code style** — plain ES2020, single quotes, 2-space indent.
4. **Update documentation** if your change affects user-facing behavior
   (README.md, CHANGELOG.md, docs/).
5. **Add a CHANGELOG entry** under `[Unreleased]`.

## Pull request process

1. Fork the repo and create a branch:
   `git checkout -b feature/my-feature` or `fix/my-bugfix`
2. Commit your changes with a clear message.
3. Push and open a PR against `main`, filling in the
   [pull request template](.github/PULL_REQUEST_TEMPLATE.md).
4. CI must pass (lint + engine tests run automatically on every PR).

## Design principles

- **Privacy first** — no network calls, no analytics, no accounts.
- **Non-invasive UI** — shadow DOM everywhere, `!important` only where site CSS
  requires it, never break the host page.
- **Robust anchoring** — prefer text-context matching over brittle DOM paths.
- **Performance** — debounced observers, per-record fresh indexes, zero work on
  pages without highlights.

## Reporting security issues

Please **do not** open public issues for security vulnerabilities — see
[SECURITY.md](SECURITY.md).

## License

By contributing, you agree that your contributions will be licensed under the
[GPL-3.0 license](LICENSE) that covers this project.
