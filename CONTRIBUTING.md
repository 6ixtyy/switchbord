# Contributing

Thanks for helping. SwitchBord is MIT-licensed and contributions of every size are welcome.

## Issues

- **Wrong or broken result** (a seller ranked high that is down, a bad price, a broken link): open an issue with the task you asked for, the time, and what came back.
- **Docs unclear or wrong:** open an issue saying what you expected.
- **Want a seller or market added:** SwitchBord reads Coinbase Bazaar (x402) and mpp.dev (MPP) daily. List your endpoint there and it shows up after the next rebuild. Open an issue if it doesn't.
- **Security:** see [SECURITY.md](SECURITY.md). Never post wallet keys or secrets in an issue.

## Pull requests

1. Fork, branch, and make your change. Keep it focused on one thing.
2. Check it runs: `npm ci && npm run inventory && npm start`, then `node scripts/check-api-contract.mjs http://localhost:8402`.
3. If you change a response field, update [API.md](API.md) in the same PR.
4. Open the PR and describe what changed and how you checked it.

This repo is published from the source repo the hosted service deploys from, so a pull request is not merged here directly. Once it is approved, we apply it in the source repo with you as the commit author, and it appears here on the next publish.

## Ground rules

- SwitchBord never holds, moves or signs for funds. Changes that add payment handling to the service won't be accepted.
- Describe only what the code does today. No secrets, keys or private infrastructure details in code, issues or PRs.
