# AI Command Center

By Moonshot Consulting.

A browser-based prompt workspace: choose from ten commands, arrange up to five compatible steps, add material, and copy a complete prompt into your preferred AI tool.

Includes section help, an example, and browser-local saved workflows. Saved workflows contain command choices and order only. Goal, material, and context are not saved and clear on refresh. This app does not call an AI model or independently verify claims.

## Hosting

This repository contains the static public app. Enable GitHub Pages from the main branch, root directory. No build or API key is required.

## Local preview

Run `python3 -m http.server 8000 --bind 127.0.0.1` in this folder, then visit http://127.0.0.1:8000/.
