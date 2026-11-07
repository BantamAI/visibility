<p align="center">
  <img src="apps/web/public/icons/chatspy-icon-512.png" alt="ChatSpy" width="96">
</p>

# ChatSpy

ChatSpy is the visibility service: it tracks how AI answer engines like ChatGPT, Claude, Perplexity, Gemini, and Google AI Overviews mention, cite, and describe a business, for agency staff and for revocable public report links. It is a fork of [Elmo](https://github.com/elmohq/elmo) (MIT) with our local-search layer added in `packages/service`.

Agent rules and system boundaries are in [CLAUDE.md](CLAUDE.md) and [AGENTS.md](AGENTS.md). The plan and architecture decisions are in [docs/plan/](docs/plan/).

## Development

The developer guide in [packages/docs/content/docs/developer-guide/](packages/docs/content/docs/developer-guide/) covers setup. In short:

```sh
pnpm install
cp .env.example .env   # also needed at apps/web/.env; see AGENTS.md for the minimum
pnpm dev
```

Before syncing with upstream Elmo, run `scripts/upstream-diff`.

## License

MIT. See [LICENSE.md](LICENSE.md). Elmo's copyright and license notices are kept in copied files.
