# task-progress

A Claude Code mod that shows an estimated progress bar for the current task
above the prompt, for as long as Claude is working.

```
██████░░░░░░░░░░░░░░ 30% · 1/4 · Write the fix · 3m 12s · ~6m 40s left  [Hide]
```

- Before Claude has a task list, a sweeping bar shows the turn's elapsed time.
- Once Claude writes a task list (`TodoWrite`, `TaskCreate`/`TaskUpdate`, or
  the Claude desktop app's task list), the bar shows steps done, the current
  step, elapsed time and an ETA.
- The ETA is the average time of finished steps times the steps left, so it is
  an estimate, and appears after the first step is done.
- Subagents' own task lists are ignored. **Hide** hides the bar until the next turn.

**Zero tokens.** The mod only observes task-list tool calls. It adds nothing
to the model's context, makes no model calls and no network calls.

## Install

Needs Claude Code 2.1.287 or later. At the prompt of a terminal session:

```
/plugin install task-progress --marketplace martinposta/claude-task-progress
```

Answer `y` to add the marketplace, then pick a scope (user is first).

From a shell:

```bash
claude plugin install task-progress --marketplace martinposta/claude-task-progress
```

In the desktop app, where `/plugin` does not run: click + next to the prompt
box, then Plugins, Add marketplace with `martinposta/claude-task-progress`,
then Add plugin.

## Uninstall

```bash
claude plugin uninstall task-progress
```

## Development

```bash
claude plugin validate .
claude plugin test .
```

## License

MIT
