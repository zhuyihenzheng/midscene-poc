# Copilot instructions

Repository conventions, commands, and engines are in [AGENTS.md](../AGENTS.md).

- Building tests for a new site: run the `/new-site-tests` prompt (`.github/prompts/new-site-tests.prompt.md`).
- Editing tests under `sites/**/tests/`: the contract in `.github/instructions/site-tests.instructions.md` applies.

Every expected value in a test comes from the site's design document, and every verdict comes from recorded DOM values or backend journals. In chat, reply in the user's language. In the test files, write UI labels, case texts, and prompts in Japanese, matching the target application.
