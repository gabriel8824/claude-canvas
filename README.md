# Claude Canvas

A visual infinite canvas for developers — run real terminals, browse files, edit code, preview apps, track git changes, and read documentation, all in a single drag-and-drop workspace.

Built to be used alongside [Claude Code](https://claude.ai/code): open a terminal panel, run `claude`, and interact with your AI assistant without leaving your workspace.

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Node](https://img.shields.io/badge/node-%3E%3D18-green.svg)

---

## Features

| Panel | Description |
|---|---|
| **Terminal** `⌨️` | Real PTY terminals. Run any CLI tool, including `claude`. |
| **Files** `📁` | File browser with inline editor. Open files directly into an Editor panel. |
| **Editor** `✏️` | Full code editor with syntax highlighting and save. |
| **Preview** `🌐` | Embedded browser. Auto-detects local dev server URLs from terminal output. |
| **Git** `🔀` | Stage/unstage files, commit (with AI-generated messages), push, pull, clone. |
| **Docs** `📚` | Markdown viewer with Obsidian-style wiki links and force-directed graph view. |

**Canvas features:**
- Infinite scrollable canvas — drag the background to pan
- Drag panel title bars to move, drag edges/corners to resize
- Minimize any panel to its title bar
- Group panels into labeled, color-coded projects
- Auto-save: canvas state is persisted on the server and restored on reload

---

## Requirements

- **Node.js** 18 or later
- **Python 3** and **Xcode Command Line Tools** (macOS) — required to compile `node-pty`
- **Git** — for the Git panel features
- **Anthropic API key** (optional) — for AI-generated commit messages

---

## Installation

```bash
git clone https://github.com/gabriel8824/claude-canvas.git
cd claude-canvas
npm install
```

> If `node-pty` fails to build on macOS:
> ```bash
> xcode-select --install
> npm install
> ```

---

## Running

### Development

```bash
npm run dev
```

Starts:
- **Backend** at `http://localhost:3001` — Express + WebSocket + PTY server
- **Frontend** at `http://localhost:5173` — Vite dev server with hot reload

Open **http://localhost:5173** in your browser.

### Production

```bash
npm run build
npm start
```

Open **http://localhost:3001**.

---

## Configuration

### AI commit message generation

Set your Anthropic API key before starting the server:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
npm start
```

Without this key the ✨ button in the Git panel is disabled.

---

## Usage Guide

### Opening a Project

Click **Open Project** in the toolbar and select a folder. Claude Canvas automatically opens:
- A **Files** panel for the folder
- A **Terminal** panel with `cwd` set to the folder
- A **Git** panel for the repository
- A **Docs** panel if the folder contains an `.obsidian` vault

All panels are grouped together and can be moved as a unit.

---

### Terminal

- Runs your system shell (bash/zsh) as a real PTY
- The path field at the top sets the working directory — press **Enter** or **↺** to restart in a new directory
- **Auto-preview**: when a terminal outputs a `localhost` URL, a Preview panel opens automatically at the correct port
- Run Claude Code inside any terminal:
  ```
  claude
  ```

Clicking `⌨️ Terminal` in the toolbar while a project is open creates a terminal already in the project's folder.

---

### Files

- Navigate folders by clicking, click a file to open it in the Editor
- The **Scripts** tab shows `package.json` scripts — click ▶ to run them in a new terminal
- Back/forward history buttons

---

### Editor

- Syntax highlighting for most languages
- `Cmd+S` / **Save** button writes to disk
- Panel title shows `●` when there are unsaved changes

---

### Preview

- Enter a URL and press **Go** or Enter
- Device mockups: Phone, Tablet, Laptop, Monitor
- Toggle landscape mode
- External link button opens the URL in your default browser
- Auto-loads when a linked terminal's dev server starts

---

### Git

- Stage (`+`) and unstage (`-`) files
- **✨** generates a commit message from staged diff using Claude AI
- **Commit** — commits staged changes
- **↑ Commit & Push** — commits then pushes
- **Pull** / **Push** — sync with remote
- **Clone** — clone a repo by URL
- **Log** — last 20 commits

---

### Docs

**Tree view** (`≡`):
- File tree of all `.md`/`.mdx` files under the configured root path
- Search, click to open, back/forward history
- `[[wiki links]]` render as clickable in-panel navigation links

**Graph view** (`◎`):
- Force-directed graph of notes connected by `[[wiki links]]`
- Drag nodes, scroll to zoom, drag background to pan
- Click a node to open that file
- Current file in purple, linked files in blue

**🔮 Open in Obsidian** — opens the current file or vault in the Obsidian app.

---

### Canvas Controls

| Action | How |
|---|---|
| Pan canvas | Drag empty background |
| Move a panel | Drag its title bar |
| Resize a panel | Drag any edge or corner |
| Minimize | Yellow traffic-light button |
| Close | Red traffic-light button |
| Rename group | Click the group label |
| Change group color | Click the group label → color picker |

---

## Architecture

```
claude-canvas/
├── server/src/
│   ├── index.ts        # Express HTTP + WebSocket + all API routes
│   ├── terminal.ts     # PTY session manager (node-pty)
│   └── files.ts        # File system helpers
│
└── client/src/
    ├── store.ts         # Zustand canvas state + auto-save
    ├── ws.ts            # WebSocket client
    └── components/
        ├── Canvas.tsx           # Infinite canvas, drag/resize, groups
        ├── Toolbar.tsx
        ├── OpenProjectModal.tsx
        └── nodes/
            ├── TerminalNode.tsx
            ├── FileBrowserNode.tsx
            ├── EditorNode.tsx
            ├── PreviewNode.tsx
            ├── GitNode.tsx
            ├── DocsNode.tsx
            └── GraphView.tsx    # Canvas-based force-directed graph
```

**Stack:** React 18 · TypeScript · Vite · Zustand · Express · node-pty · xterm.js · marked · ws

---

## Contributing

Issues and pull requests are welcome.

1. Fork the repo
2. `git checkout -b feature/your-feature`
3. Commit with [Conventional Commits](https://www.conventionalcommits.org/) style
4. Open a pull request

---

## License

[MIT](LICENSE)
