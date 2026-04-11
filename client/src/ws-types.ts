// Client → Server messages
export type ClientMessage =
  | { type: 'terminal:create'; id: string; cwd: string; cols: number; rows: number }
  | { type: 'terminal:input'; id: string; data: string }
  | { type: 'terminal:resize'; id: string; cols: number; rows: number }
  | { type: 'terminal:kill'; id: string }
  | { type: 'files:list'; reqId: string; path: string }
  | { type: 'files:read'; reqId: string; path: string }
  | { type: 'git:status'; reqId: string; path: string }
  | { type: 'git:add'; reqId: string; path: string; files: string[] }
  | { type: 'git:restore'; reqId: string; path: string; files: string[] }
  | { type: 'git:commit'; reqId: string; path: string; message: string }
  | { type: 'git:push'; reqId: string; path: string }
  | { type: 'git:pull'; reqId: string; path: string }
  | { type: 'git:log'; reqId: string; path: string }
  | { type: 'git:diff'; reqId: string; path: string; staged: boolean }
  | { type: 'git:clone'; reqId: string; url: string; targetDir: string }
  | { type: 'git:init'; reqId: string; path: string };

// Server → Client messages
export type ServerMessage =
  | { type: 'terminal:ready'; id: string; scrollback?: string }
  | { type: 'terminal:output'; id: string; data: string }
  | { type: 'terminal:exit'; id: string; code: number | null }
  | { type: 'files:list'; reqId: string; path: string; items: FileItem[] }
  | { type: 'files:read'; reqId: string; path: string; content?: string; error?: string }
  | { type: 'git:status'; reqId: string; branch: string; ahead: number; behind: number; files: GitFileStatus[]; error?: string }
  | { type: 'git:add'; reqId: string; ok: boolean; error?: string }
  | { type: 'git:restore'; reqId: string; ok: boolean; error?: string }
  | { type: 'git:commit'; reqId: string; ok: boolean; hash?: string; error?: string }
  | { type: 'git:push'; reqId: string; chunk?: string; done?: boolean; error?: string }
  | { type: 'git:pull'; reqId: string; chunk?: string; done?: boolean; error?: string }
  | { type: 'git:log'; reqId: string; commits: GitCommit[]; error?: string }
  | { type: 'git:diff'; reqId: string; diff?: string; error?: string }
  | { type: 'git:clone'; reqId: string; chunk?: string; done?: boolean; error?: string }
  | { type: 'git:init'; reqId: string; ok: boolean; error?: string };

export interface FileItem {
  name: string;
  path: string;
  type: 'file' | 'dir';
  size?: number;
  ext?: string;
}

export interface GitFileStatus {
  status: string;
  file: string;
  staged: boolean;
}

export interface GitCommit {
  hash: string;
  message: string;
  author: string;
  date: string;
}
