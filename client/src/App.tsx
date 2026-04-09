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
    fetch('/api/state')
      .then(r => r.json())
      .then(({ state }) => {
        if (state && Array.isArray((state as SerializedState).nodes) && (state as SerializedState).nodes.length > 0) {
          hydrate(state as SerializedState);
        } else {
          addNode('terminal', { x: 80, y: 80 });
        }
      })
      .catch(() => {
        addNode('terminal', { x: 80, y: 80 });
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
