# ChatSpy CLI

The CLI for ChatSpy: open source AI visibility tracking and optimization.

## What is ChatSpy?

ChatSpy is an open source platform for tracking and optimizing how your brand shows up in AI assistants like ChatGPT, Claude, Gemini, and Perplexity. Define the prompts your customers ask, run them across providers on a schedule, and get visibility into mentions, sentiment, citations, and competitor positioning over time.

`@elmohq/cli` is the fastest way to run ChatSpy on your own infrastructure. It generates a Docker Compose stack, manages secrets and configuration, and gives you a single command to start, stop, and operate your instance.

## Installation

```bash
npm install -g @elmohq/cli
```

Requires [Docker](https://docs.docker.com/get-docker/) and Docker Compose.

## Quick Start

```bash
# 1. Walk through the interactive setup wizard
chatspy init

# 2. Start the stack
chatspy compose up -d

# 3. Open the app at http://localhost:1515
```

`chatspy init` will prompt you for a few things (database, AI provider credentials), generate `elmo.yaml` and `.env`, and optionally start the stack for you.

For the full self-hosting walkthrough, see the [ChatSpy docs](https://chatspy.example.com/docs).

## Commands

| Command                       | Description                                                                                                                                                                                    |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `chatspy init`                | Interactive wizard to set up a local ChatSpy instance                                                                                                                                          |
| `chatspy compose <args...>`   | Run any `docker compose` command against your ChatSpy project (e.g. `chatspy compose up -d`, `chatspy compose down`, `chatspy compose logs -f`, `chatspy compose build`, `chatspy compose ps`) |
| `chatspy edit <env\|compose>` | Change API keys, scrape targets, or the Docker Compose YAML                                                                                                                                    |
| `chatspy upgrade`             | Move your deployment to this CLI's version — runs migrations, re-pins image tags, and restarts the stack                                                                                       |

Run `chatspy --help` or `chatspy <command> --help` for the full list of flags.

### Useful flags

- `--dir <path>` — point any command at a specific config directory (defaults to `~/.elmo`).
- `chatspy init --dev` — build images from a local checkout of the repo instead of pulling from the registry.
