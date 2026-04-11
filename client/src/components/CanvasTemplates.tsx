import { useCanvasStore } from '../store';
import { FilesData, TerminalData, GitData } from '../types';

interface Template {
  id: string;
  name: string;
  icon: string;
  description: string;
  apply: () => void;
}

interface Props {
  onDismiss: () => void;
}

export function CanvasTemplates({ onDismiss }: Props) {
  const store = useCanvasStore();

  function applyFrontend() {
    const filesNode = store.addNode('files',   { x: 80,  y: 100 }, { title: 'Projeto', width: 280, height: 460 });
    const termNode  = store.addNode('terminal',{ x: 380, y: 100 }, { title: 'Terminal', width: 640, height: 460 });
    const editNode  = store.addNode('editor',  { x: 80,  y: 600 }, { title: 'Editor', width: 640, height: 480 });
    const prevNode  = store.addNode('preview', { x: 740, y: 100 }, { title: 'Preview', width: 760, height: 460 });
    store.createGroup([filesNode.id, termNode.id, editNode.id, prevNode.id], 'Frontend Dev');
    onDismiss();
  }

  function applyFullStack() {
    const filesNode = store.addNode('files',   { x: 80,  y: 100 }, { width: 280, height: 460 });
    const termNode  = store.addNode('terminal',{ x: 380, y: 100 }, { width: 640, height: 460 });
    const gitNode   = store.addNode('git',     { x: 1040,y: 100 }, { width: 320, height: 460 });
    const editNode  = store.addNode('editor',  { x: 80,  y: 600 }, { width: 640, height: 480 });
    const prevNode  = store.addNode('preview', { x: 740, y: 600 }, { width: 620, height: 480 });
    const httpNode  = store.addNode('http',    { x: 1380,y: 100 }, { width: 640, height: 460 });
    store.createGroup([filesNode.id, termNode.id, gitNode.id, editNode.id, prevNode.id, httpNode.id], 'Full Stack');
    onDismiss();
  }

  function applyDocs() {
    const docsNode  = store.addNode('docs',    { x: 80,  y: 100 }, { width: 900, height: 600 });
    const notesNode = store.addNode('notes',   { x: 1010,y: 100 }, { width: 380, height: 300 });
    const filesNode = store.addNode('files',   { x: 1010,y: 420 }, { width: 380, height: 280 });
    store.createGroup([docsNode.id, notesNode.id, filesNode.id], 'Docs / PKM');
    onDismiss();
  }

  function applyBlank() {
    store.addNode('terminal', { x: 80, y: 80 });
    onDismiss();
  }

  const templates: Template[] = [
    { id: 'frontend', name: 'Frontend Dev',  icon: '🎨', description: 'Files + Terminal + Editor + Preview', apply: applyFrontend },
    { id: 'fullstack',name: 'Full Stack',    icon: '🚀', description: 'Terminal + Editor + Git + Preview + HTTP', apply: applyFullStack },
    { id: 'docs',     name: 'Docs / PKM',    icon: '📚', description: 'Docs Graph + Notes + File Browser', apply: applyDocs },
    { id: 'blank',    name: 'Blank Canvas',  icon: '◻️', description: 'Canvas vazio com um terminal', apply: applyBlank },
  ];

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9990,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(5,8,20,0.96)',
      backdropFilter: 'blur(20px)',
      WebkitBackdropFilter: 'blur(20px)',
    }}>
      <div style={{ textAlign: 'center', maxWidth: 700 }}>
        <div style={{ marginBottom: 8 }}>
          <span style={{ fontSize: 48 }}>🎨</span>
        </div>
        <h1 style={{ fontSize: 28, fontWeight: 700, background: 'linear-gradient(135deg, #a78bfa, #60a5fa)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', marginBottom: 8 }}>
          Claude Canvas
        </h1>
        <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 14, marginBottom: 40, fontFamily: 'monospace' }}>
          Escolha um template para começar
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16, marginBottom: 32 }}>
          {templates.map(t => (
            <button
              key={t.id}
              onClick={t.apply}
              style={{
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 16,
                padding: '20px 24px',
                cursor: 'pointer',
                textAlign: 'left',
                transition: 'all 0.15s',
              }}
              onMouseEnter={e => {
                (e.currentTarget as HTMLButtonElement).style.background = 'rgba(140,190,255,0.08)';
                (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(140,190,255,0.25)';
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.04)';
                (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(255,255,255,0.1)';
              }}
            >
              <div style={{ fontSize: 28, marginBottom: 8 }}>{t.icon}</div>
              <div style={{ fontSize: 15, fontWeight: 600, color: 'rgba(220,230,245,0.9)', marginBottom: 4 }}>{t.name}</div>
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)', fontFamily: 'monospace' }}>{t.description}</div>
            </button>
          ))}
        </div>

        <button
          onClick={onDismiss}
          style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.25)', cursor: 'pointer', fontSize: 13, fontFamily: 'monospace' }}
        >
          Pular → canvas vazio
        </button>
      </div>
    </div>
  );
}
