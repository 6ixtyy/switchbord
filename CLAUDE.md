# CLAUDE.md (public repo)

This repo holds SwitchBord's open-source code (MIT) and public docs: the service (`src/`), the site (`site/`), the API contract, MCP setup, `llms.txt` and runnable examples. It is published from a separate source repo and overwritten on every publish.

- **Don't commit here directly.** Changes made in this repo are lost on the next publish. Pull requests are welcome and are applied in the source repo ([CONTRIBUTING.md](CONTRIBUTING.md)).
- **Product in one line:** SwitchBord is a free, live router for paid agent APIs (x402, MPP). It returns the best sellers for a task, checked live, plus backups. Agents pay sellers directly; SwitchBord never touches money.
- **Run it:** Node 22. `npm ci`, `npm run inventory`, `npm start` (API and MCP on :8402).
- **Rules for anything written here:** describe only what the code and live API do today ([API.md](API.md) is the contract). Never claim SwitchBord processes payments, guarantees sellers, or ships a paying client. No secrets, infrastructure details or internal plans.
