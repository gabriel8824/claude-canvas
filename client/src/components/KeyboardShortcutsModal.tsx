import React from 'react';

interface ShortcutEntry {
  keys: string[];
  description: string;
}

interface ShortcutSection {
  title: string;
  shortcuts: ShortcutEntry[];
}

const SHORTCUTS: ShortcutSection[] = [
  {
    title: 'Canvas',
    shortcuts: [
      { keys: ['Ctrl/⌘', 'Scroll'], description: 'Zoom in/out' },
      { keys: ['Ctrl/⌘', '+'], description: 'Zoom in' },
      { keys: ['Ctrl/⌘', '−'], description: 'Zoom out' },
      { keys: ['Ctrl/⌘', '0'], description: 'Reset zoom' },
      { keys: ['Ctrl/⌘', 'Z'], description: 'Undo' },
      { keys: ['Ctrl/⌘', '⇧', 'Z'], description: 'Redo' },
      { keys: ['Ctrl/⌘', 'P'], description: 'Fuzzy file finder' },
      { keys: ['Ctrl/⌘', 'K'], description: 'Command palette' },
      { keys: ['?'], description: 'Show keyboard shortcuts' },
      { keys: ['Esc'], description: 'Close modal / dismiss' },
    ],
  },
  {
    title: 'Editor',
    shortcuts: [
      { keys: ['Ctrl/⌘', 'S'], description: 'Save file' },
      { keys: ['Ctrl/⌘', 'Z'], description: 'Undo (in editor)' },
      { keys: ['Ctrl/⌘', '⇧', 'Z'], description: 'Redo (in editor)' },
      { keys: ['Tab'], description: 'Indent' },
      { keys: ['⇧', 'Tab'], description: 'Unindent' },
    ],
  },
  {
    title: 'Geral',
    shortcuts: [
      { keys: ['Drag', 'title'], description: 'Mover painel' },
      { keys: ['Drag', 'edge'], description: 'Redimensionar painel' },
      { keys: ['Click', '●'], description: 'Minimizar painel' },
      { keys: ['Click', '×'], description: 'Fechar painel' },
      { keys: ['Drag', 'canvas'], description: 'Mover canvas' },
    ],
  },
];

interface Props {
  onClose: () => void;
}

export function KeyboardShortcutsModal({ onClose }: Props) {
  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 99998,
        background: 'rgba(0,0,0,0.65)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        animation: 'fadeIn 0.15s ease-out',
      }}
      onClick={onClose}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: 'rgba(8,12,28,0.97)',
          border: '1px solid rgba(255,255,255,0.12)',
          borderRadius: 20,
          padding: '28px 32px',
          width: 580,
          maxHeight: '80vh',
          overflow: 'auto',
          boxShadow: '0 24px 80px rgba(0,0,0,0.8)',
          animation: 'slideDown 0.15s ease-out',
        }}
      >
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          marginBottom: 24,
        }}>
          <div>
            <h2 style={{ fontSize: 16, fontWeight: 700, color: 'rgba(255,255,255,0.9)', margin: 0 }}>
              Atalhos de Teclado
            </h2>
            <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', margin: '4px 0 0', fontFamily: 'monospace' }}>
              Pressione ? para abrir · Esc para fechar
            </p>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'rgba(255,255,255,0.06)',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 8, color: 'rgba(255,255,255,0.5)',
              cursor: 'pointer', width: 30, height: 30,
              fontSize: 18, display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            ×
          </button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 28 }}>
          {SHORTCUTS.map(section => (
            <div key={section.title}>
              <div style={{
                fontSize: 9, fontFamily: 'monospace', fontWeight: 700,
                letterSpacing: '0.1em', color: 'rgba(140,190,255,0.6)',
                marginBottom: 12, textTransform: 'uppercase',
              }}>
                {section.title}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {section.shortcuts.map((s, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                    <span style={{ fontSize: 12, color: 'rgba(200,215,240,0.7)', flex: 1 }}>
                      {s.description}
                    </span>
                    <div style={{ display: 'flex', gap: 3, flexShrink: 0 }}>
                      {s.keys.map((k, j) => (
                        <React.Fragment key={j}>
                          {j > 0 && <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.2)', alignSelf: 'center' }}>+</span>}
                          <kbd style={{
                            background: 'rgba(255,255,255,0.06)',
                            border: '1px solid rgba(255,255,255,0.12)',
                            borderBottom: '2px solid rgba(255,255,255,0.18)',
                            borderRadius: 5,
                            padding: '2px 7px',
                            fontSize: 11,
                            fontFamily: 'monospace',
                            color: 'rgba(255,255,255,0.75)',
                            whiteSpace: 'nowrap',
                          }}>
                            {k}
                          </kbd>
                        </React.Fragment>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
