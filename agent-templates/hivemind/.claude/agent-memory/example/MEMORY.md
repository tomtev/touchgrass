# Agent Memory

## Reddit Monitoring

- New Reddit (reddit.com) shows CAPTCHA/human verification for unauthenticated browsing. Use old.reddit.com instead — it loads search results without bot detection.
- Old Reddit URL pattern for subreddit-scoped searches: `https://old.reddit.com/r/<subreddit>/search/?q=<query>&sort=new&t=month&restrict_sr=on`
- For cross-Reddit searches: `https://old.reddit.com/search/?q=<query>+<term>&sort=new&t=month`
- The `agent-browser --profile` and `--executable-path` flags are ignored if a browser daemon is already running. Use `agent-browser close` first if you need to restart with different options.
