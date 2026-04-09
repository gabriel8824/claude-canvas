export type NodeType = 'terminal' | 'files' | 'preview' | 'git' | 'editor' | 'docs';

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
  data: TerminalData | FilesData | PreviewData | GitData | EditorData | DocsData;
}

export interface TerminalData {
  cwd: string;
  status: 'idle' | 'connecting' | 'ready' | 'exited';
  autoRun?: string;    // command to run automatically after terminal is ready
  autoPreview?: boolean; // create a preview node when a server URL is detected in output
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
}

export interface EditorData {
  filePath: string;
  isDirty: boolean;
  openedFromNodeId?: string; // file browser node that opened this editor
}

export interface DocsData {
  rootPath: string;      // project root to scan for .md files
  currentFile: string;   // currently open file path
  history: string[];     // navigation history
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
