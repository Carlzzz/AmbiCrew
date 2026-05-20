# Global Usage (Run from Any Directory)


If you want to run `ambi` directly from any project directory, set up one of the following. Once configured, `ambi` will automatically recognize your current working directory.

## macOS / Linux

Add to `~/.bashrc` or `~/.zshrc`:

```bash
# Option 1: Add to PATH (recommended)
export PATH="$HOME/path/to/claude-code-haha/bin:$PATH"

# Option 2: Alias
alias ambi="$HOME/path/to/claude-code-haha/bin/ambi"
```

Then reload the config:

```bash
source ~/.bashrc  # or source ~/.zshrc
```

## Windows (Git Bash)

Add to `~/.bashrc`:

```bash
export PATH="$HOME/path/to/claude-code-haha/bin:$PATH"
```

## Verify

After setup, navigate to any project directory and test:

```bash
cd ~/your-other-project
ambi
# Ask "What is the current directory?" — it should show ~/your-other-project
```
