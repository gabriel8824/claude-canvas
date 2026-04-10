import { useState, useEffect } from 'react';
import { Canvas } from './components/Canvas';
import { Toolbar } from './components/Toolbar';
import { OpenProjectModal } from './components/OpenProjectModal';
import { GitHubModal } from './components/GitHubModal';
import { useCanvasStore, SerializedState } from './store';

export function App() {
  const { addNode, hydrate } = useCanvasStore();
  const [showOpenProject, setShowOpenProject] = useState(false);
  const [showGitHub,      setShowGitHub]      = useState(false);

  useEffect(() => {
    const LS_KEY = 'claude-canvas:state';
    function tryLoadLS() {
      try {
        const raw = localStorage.getItem(LS_KEY);
        if (!raw) return false;
        const state = JSON.parse(raw) as SerializedState;
        if (state && Array.isArray(state.nodes) && state.nodes.length > 0) {
          hydrate(state);
          return true;
        }
      } catch {}
      return false;
    }

    fetch('/api/state')
      .then(r => r.json())
      .then(({ state }) => {
        if (state && Array.isArray((state as SerializedState).nodes) && (state as SerializedState).nodes.length > 0) {
          hydrate(state as SerializedState);
        } else if (!tryLoadLS()) {
          addNode('terminal', { x: 80, y: 80 });
        }
      })
      .catch(() => {
        if (!tryLoadLS()) addNode('terminal', { x: 80, y: 80 });
      });
  }, []);

  return (
    <>
      <Toolbar
        onOpenProject={() => setShowOpenProject(true)}
        onGitHub={() => setShowGitHub(true)}
        onAddGit={() => addNode('git', { x: 120, y: 120 })}
      />
      <Canvas />
      {showOpenProject && <OpenProjectModal onClose={() => setShowOpenProject(false)} />}
      {showGitHub      && <GitHubModal      onClose={() => setShowGitHub(false)} />}
    </>
  );
}
