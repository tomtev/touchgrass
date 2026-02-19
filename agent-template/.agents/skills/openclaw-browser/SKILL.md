# openclaw browser

Browser automation via OpenClaw. Launches a real Chrome instance via CDP — no automation flags. Install with `npm install -g openclaw`.

## Quick Start

```bash
openclaw browser start                   # Start browser (no-op if running)
openclaw browser open <url>              # Open URL in new tab
openclaw browser snapshot                # Get elements with refs
openclaw browser click <ref>             # Click by ref
openclaw browser type <ref> "text"       # Type into element
openclaw browser close                   # Stop browser
```

## Lifecycle

```bash
openclaw browser status                  # Check if running
openclaw browser start                   # Launch browser
openclaw browser stop                    # Stop browser (best-effort)
openclaw browser reset-profile           # Reset profile (moves to Trash)
```

## Tabs

```bash
openclaw browser tabs                    # List all tabs
openclaw browser tab                     # Current tab info
openclaw browser tab new                 # New tab
openclaw browser tab select <n>          # Focus tab by index
openclaw browser tab close <n>           # Close tab by index
openclaw browser open <url>              # Open URL in new tab
openclaw browser focus <targetId>        # Focus tab by target ID
openclaw browser close <targetId>        # Close tab by target ID
```

## Snapshots

Two modes:

**AI snapshot (default)** — numeric refs for actions:
```bash
openclaw browser snapshot
openclaw browser snapshot --efficient    # Compact output
```
Use refs as: `openclaw browser click 12`, `openclaw browser type 23 "text"`

**Aria snapshot** — accessibility tree:
```bash
openclaw browser snapshot --format aria --limit 200
openclaw browser snapshot --interactive --compact --depth 6
openclaw browser snapshot --labels       # Screenshot with ref overlays
openclaw browser snapshot --selector "#main" --interactive
openclaw browser snapshot --frame "iframe#main" --interactive
```
Use refs as: `openclaw browser click e12`

## Interaction

```bash
openclaw browser click <ref>             # Click
openclaw browser click <ref> --double    # Double-click
openclaw browser type <ref> "text"       # Type (appends)
openclaw browser type <ref> "text" --submit  # Type + Enter
openclaw browser fill <ref> "text"       # Clear + type
openclaw browser press Enter             # Press key
openclaw browser press Control+a         # Key combo
openclaw browser hover <ref>             # Hover
openclaw browser scrollintoview <ref>    # Scroll element into view
openclaw browser scroll down 500         # Scroll page
openclaw browser drag <srcRef> <dstRef>  # Drag and drop
openclaw browser select <ref> OptionA OptionB  # Select dropdown options
openclaw browser highlight <ref>         # Highlight element
```

## Navigation

```bash
openclaw browser navigate <url>          # Navigate current tab
openclaw browser open <url>              # Open in new tab
openclaw browser resize 1280 720         # Resize viewport
```

## Screenshots & PDF

```bash
openclaw browser screenshot              # Current viewport
openclaw browser screenshot --full-page  # Full page
openclaw browser screenshot --ref <ref>  # Specific element
openclaw browser pdf                     # Save as PDF
```

## JavaScript

```bash
openclaw browser evaluate "document.title"
openclaw browser evaluate --fn '(el) => el.textContent' --ref <ref>
```

## File Operations

```bash
openclaw browser upload /path/to/file.pdf        # Arm next file chooser
openclaw browser download <ref> report.pdf        # Click + save download
openclaw browser waitfordownload report.pdf       # Wait for next download
openclaw browser fill --fields '[{"ref":"1","type":"text","value":"Ada"}]'
```

## Dialogs

```bash
openclaw browser dialog --accept                  # Accept next alert/confirm/prompt
openclaw browser dialog --dismiss                 # Dismiss it
```

## Wait Conditions

```bash
openclaw browser wait 2000                        # Wait ms
openclaw browser wait "#selector"                 # Wait for element
openclaw browser wait --text "Done"               # Wait for text
openclaw browser wait --url "**/dashboard"        # Wait for URL pattern
openclaw browser wait --load networkidle          # Wait for network idle
openclaw browser wait --fn "window.ready===true"  # Wait for JS condition
```

## Console & Network

```bash
openclaw browser console                          # Recent console messages
openclaw browser console --level error            # Filter by level
openclaw browser errors                           # Page errors
openclaw browser errors --clear                   # Clear error buffer
openclaw browser requests --filter api            # Network requests
openclaw browser requests --clear                 # Clear request buffer
openclaw browser responsebody "**/api" --max-chars 5000  # Response body
```

## Tracing

```bash
openclaw browser trace start                      # Start Playwright trace
openclaw browser trace stop                       # Stop and save trace
```

## Cookies

```bash
openclaw browser cookies                          # List all cookies
openclaw browser cookies set <name> <value> --url "https://example.com"
openclaw browser cookies clear                    # Clear all cookies
```

## Storage

```bash
openclaw browser storage local get                # Get localStorage
openclaw browser storage local set <key> <value>  # Set localStorage item
openclaw browser storage session clear            # Clear sessionStorage
```

## Environment Settings

```bash
openclaw browser set offline on                   # Toggle offline mode
openclaw browser set offline off
openclaw browser set headers --headers-json '{"X-Debug":"1"}'
openclaw browser set credentials user pass        # HTTP Basic auth
openclaw browser set credentials --clear
openclaw browser set geo 37.7749 -122.4194 --origin "https://example.com"
openclaw browser set geo --clear
openclaw browser set media dark                   # Prefers-color-scheme
openclaw browser set timezone America/New_York
openclaw browser set locale en-US
openclaw browser set device "iPhone 14"           # Device emulation
openclaw browser set viewport 1280 720
```

## Profiles

Profiles are managed in `~/.openclaw/openclaw.json`. Each profile has its own CDP port and isolated user data.

```bash
openclaw browser profiles                         # List profiles
openclaw browser create-profile --name <name>     # Create profile
openclaw browser delete-profile --name <name>     # Delete profile
openclaw browser --browser-profile <name> <cmd>   # Use specific profile
```

## Global Flags

```bash
--browser-profile <name>    # Target specific profile
--json                      # Machine-readable JSON output
--timeout <ms>              # Command timeout (default: 30000)
```
