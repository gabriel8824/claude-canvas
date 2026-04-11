export type NodeType = 'terminal' | 'files' | 'preview' | 'git' | 'editor' | 'docs' | 'notes' | 'http' | 'ai-review' | 'process-manager' | 'db-inspector' | 'claude-code';

export interface CanvasNode {
  id: string;
  type: NodeType;
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
  minimized: boolean;
  // per-type state
  data: TerminalData | FilesData | PreviewData | GitData | EditorData | DocsData | NotesData | HttpClientData | AiReviewData | ProcessManagerData | DbInspectorData;
}

export interface TerminalPane {
  id: string;
  cwd: string;
}

export interface TerminalData {
  cwd: string;
  status: 'idle' | 'connecting' | 'ready' | 'exited';
  autoRun?: string;    // command to run automatically after terminal is ready
  autoPreview?: boolean; // create a preview node when a server URL is detected in output
  linkedFilesNodeId?: string; // files node that opened this terminal (for connection line)
  // Multi-pane support
  panes?: TerminalPane[];
  activePaneId?: string;
  splitDirection?: 'horizontal' | 'vertical'; // 'horizontal' = side by side, 'vertical' = top/bottom
}

export interface FilesData {
  currentPath: string;
  history: string[];
}

export interface PreviewData {
  url: string;
  inputUrl: string;
  linkedTerminalId?: string; // terminal running the dev server for this preview
}

export interface GitData {
  repoPath: string;
  linkedClaudeNodeId?: string; // claude-code node linked to this git panel (for connection line)
}

export interface EditorTab {
  id: string;
  filePath: string;
  isDirty: boolean;
}

export interface EditorData {
  tabs: EditorTab[];
  activeTabId: string;
  openedFromNodeId?: string;
  // Legacy fields for backward compat (derived from active tab)
  filePath?: string;
  isDirty?: boolean;
}

export interface DocsData {
  rootPath: string;      // project root to scan for .md files
  currentFile: string;   // currently open file path
  history: string[];     // navigation history
}

export interface NotesData {
  content: string;
  renderMarkdown: boolean;
}

export interface HttpRequestHeader { key: string; value: string; }
export interface HttpClientData {
  url: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  headers: HttpRequestHeader[];
  body: string;
  response?: {
    status: number;
    statusText: string;
    body: string;
    time: number;
    headers: HttpRequestHeader[];
  };
}

export interface AiReviewData {
  filePath: string;
  code: string;
  review: string;
  loading: boolean;
  language: string;
}

export interface ProcessInfo {
  id: string;
  name: string;
  command: string;
  pid?: number;
  status: 'running' | 'exited';
  cwd: string;
  startedAt: string;
}

export interface ProcessManagerData {
  // no config needed; reads from server
}

export interface DbInspectorData {
  connectionType: 'sqlite' | 'postgres' | 'mysql';
  connectionString: string; // path for SQLite, connection string for others
  selectedTable: string;
  query: string;
}

export interface FileItem {
  name: string;
  path: string;
  type: 'file' | 'dir';
  size?: number;
  ext?: string;
}

export interface Group {
  id: string;
  label: string;
  nodeIds: string[];
  color?: string; // key into GROUP_COLORS palette
}

export interface GroupConnection {
  id: string;
  fromGroupId: string;
  toGroupId: string;
  label?: string;
}
