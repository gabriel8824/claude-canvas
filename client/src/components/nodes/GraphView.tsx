import { useEffect, useRef, useCallback } from 'react';

interface GNode  { id: string; name: string; }
interface GLink  { source: string; target: string; }
interface SimNode extends GNode { x: number; y: number; vx: number; vy: number; }

interface Props {
  rootPath:    string;
  currentFile: string;
  onSelect:    (path: string) => void;
  width:       number;
  height:      number;
}

// ─── Physics constants ────────────────────────────────────────────────────────
const REPULSION  = 1200;
const REST_LEN   = 110;
const SPRING     = 0.04;
const GRAVITY    = 0.002;
const DAMPING    = 0.78;
const NODE_R     = 5;
const NODE_R_CUR = 9;

export function GraphView({ rootPath, currentFile, onSelect, width, height }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameRef  = useRef(0);

  // All mutable sim state lives in a ref so RAF loop never triggers re-renders
  const sim = useRef<{
    nodes:     SimNode[];
    links:     GLink[];
    nodeMap:   Map<string, SimNode>;
    // view transform
    tx: number; ty: number; scale: number;
    // interaction
    hoverId:   string | null;
    dragNode:  SimNode | null;
    dragOffX:  number; dragOffY: number;
    panning:   boolean;
    panX:      number; panY:     number;
    panTX:     number; panTY:    number;
    mouseX:    number; mouseY:   number;
    loaded:    boolean;
  }>({
    nodes: [], links: [], nodeMap: new Map(),
    tx: 0, ty: 0, scale: 1,
    hoverId: null, dragNode: null, dragOffX: 0, dragOffY: 0,
    panning: false, panX: 0, panY: 0, panTX: 0, panTY: 0,
    mouseX: 0, mouseY: 0,
    loaded: false,
  });

  // ── Load graph data ──────────────────────────────────────────────────────────
  useEffect(() => {
    const s = sim.current;
    s.loaded = false;
    s.nodes = []; s.links = []; s.nodeMap.clear();
    s.tx = 0; s.ty = 0; s.scale = 1;

    fetch(`/api/docs/graph?path=${encodeURIComponent(rootPath)}`)
      .then(r => r.json())
      .then(({ nodes, links }: { nodes: GNode[]; links: GLink[] }) => {
        const cx = width / 2, cy = height / 2;
        const simNodes: SimNode[] = nodes.map((n, i) => {
          const angle = (i / Math.max(nodes.length, 1)) * Math.PI * 2;
          const r = Math.min(cx, cy) * 0.6;
          return { ...n, x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r, vx: 0, vy: 0 };
        });
        s.nodes   = simNodes;
        s.links   = links;
        s.nodeMap = new Map(simNodes.map(n => [n.id, n]));
        s.loaded  = true;
      })
      .catch(() => {});
  }, [rootPath]);

  // ── Canvas helpers ───────────────────────────────────────────────────────────
  function canvasToWorld(cx: number, cy: number) {
    const s = sim.current;
    return { x: (cx - s.tx) / s.scale, y: (cy - s.ty) / s.scale };
  }

  function nodeAt(cx: number, cy: number): SimNode | null {
    const { x, y } = canvasToWorld(cx, cy);
    const s = sim.current;
    for (const n of s.nodes) {
      const r = n.id === currentFile ? NODE_R_CUR : NODE_R;
      const dx = n.x - x, dy = n.y - y;
      if (dx * dx + dy * dy <= (r + 3) * (r + 3)) return n;
    }
    return null;
  }

  // ── RAF loop: physics + render ────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    function tick() {
      const s   = sim.current;
      const ctx = canvas!.getContext('2d')!;
      const W   = canvas!.width;
      const H   = canvas!.height;
      const cx  = W / 2, cy = H / 2;

      // ── Physics ──────────────────────────────────────────────────────────────
      if (s.loaded) {
        const nodes = s.nodes;
        const nm    = s.nodeMap;

        // Repulsion between all pairs (O(n²), fine for < 600 nodes)
        for (let i = 0; i < nodes.length; i++) {
          const a = nodes[i];
          if (s.dragNode === a) continue;
          for (let j = i + 1; j < nodes.length; j++) {
            const b = nodes[j];
            const dx = a.x - b.x, dy = a.y - b.y;
            const d2 = dx * dx + dy * dy + 0.01;
            if (d2 > 90000) continue; // skip if > 300px apart
            const f = Math.min(REPULSION / d2, 8);
            const fx = dx * f, fy = dy * f;
            a.vx += fx; a.vy += fy;
            if (s.dragNode !== b) { b.vx -= fx; b.vy -= fy; }
          }

          // Gravity toward center
          a.vx += (cx - a.x) * GRAVITY;
          a.vy += (cy - a.y) * GRAVITY;

          // Damping + integrate
          a.vx *= DAMPING;
          a.vy *= DAMPING;
          a.x  += a.vx;
          a.y  += a.vy;
        }

        // Spring forces along edges
        for (const link of s.links) {
          const src = nm.get(link.source), tgt = nm.get(link.target);
          if (!src || !tgt) continue;
          const dx = tgt.x - src.x, dy = tgt.y - src.y;
          const d  = Math.sqrt(dx * dx + dy * dy) + 0.01;
          const f  = (d - REST_LEN) * SPRING;
          const fx = (dx / d) * f, fy = (dy / d) * f;
          if (s.dragNode !== src) { src.vx += fx; src.vy += fy; }
          if (s.dragNode !== tgt) { tgt.vx -= fx; tgt.vy -= fy; }
        }

        // Dragged node follows mouse exactly
        if (s.dragNode) {
          const world = canvasToWorld(s.mouseX, s.mouseY);
          s.dragNode.x  = world.x + s.dragOffX;
          s.dragNode.y  = world.y + s.dragOffY;
          s.dragNode.vx = 0;
          s.dragNode.vy = 0;
        }
      }

      // ── Render ───────────────────────────────────────────────────────────────
      ctx.clearRect(0, 0, W, H);

      // Background
      ctx.fillStyle = 'rgba(5,8,20,0.0)';
      ctx.fillRect(0, 0, W, H);

      if (!s.loaded) {
        ctx.fillStyle  = 'rgba(255,255,255,0.2)';
        ctx.font       = '13px system-ui';
        ctx.textAlign  = 'center';
        ctx.fillText('Carregando grafo…', W / 2, H / 2);
        frameRef.current = requestAnimationFrame(tick);
        return;
      }

      ctx.save();
      ctx.translate(s.tx, s.ty);
      ctx.scale(s.scale, s.scale);

      const nm = s.nodeMap;

      // Collect connected IDs for current file highlight
      const connected = new Set<string>();
      for (const l of s.links) {
        if (l.source === currentFile) connected.add(l.target);
        if (l.target === currentFile) connected.add(l.source);
      }

      // Edges
      for (const link of s.links) {
        const src = nm.get(link.source), tgt = nm.get(link.target);
        if (!src || !tgt) continue;
        const isCurEdge = link.source === currentFile || link.target === currentFile;
        ctx.beginPath();
        ctx.moveTo(src.x, src.y);
        ctx.lineTo(tgt.x, tgt.y);
        ctx.strokeStyle = isCurEdge ? 'rgba(192,130,255,0.5)' : 'rgba(120,160,255,0.13)';
        ctx.lineWidth   = isCurEdge ? 1.5 : 1;
        ctx.stroke();
      }

      // Nodes + labels
      ctx.textAlign = 'left';
      for (const n of s.nodes) {
        const isCur   = n.id === currentFile;
        const isConn  = connected.has(n.id);
        const isHover = n.id === s.hoverId;
        const r       = isCur ? NODE_R_CUR : NODE_R;

        // Glow for current / hover
        if (isCur || isHover) {
          ctx.beginPath();
          ctx.arc(n.x, n.y, r + 5, 0, Math.PI * 2);
          ctx.fillStyle = isCur ? 'rgba(192,130,255,0.2)' : 'rgba(140,190,255,0.15)';
          ctx.fill();
        }

        ctx.beginPath();
        ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
        ctx.fillStyle = isCur
          ? 'rgba(200,150,255,0.95)'
          : isConn
            ? 'rgba(130,190,255,0.85)'
            : isHover
              ? 'rgba(180,210,255,0.85)'
              : 'rgba(80,120,200,0.55)';
        ctx.fill();

        // Label: always for current, hover, or connected
        if (isCur || isHover || isConn) {
          ctx.fillStyle = isCur ? 'rgba(230,200,255,0.95)' : 'rgba(190,215,255,0.8)';
          ctx.font      = `${isCur ? 12 : 11}px system-ui`;
          ctx.fillText(n.name, n.x + r + 5, n.y + 4);
        }
      }

      ctx.restore();

      frameRef.current = requestAnimationFrame(tick);
    }

    frameRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameRef.current);
  }, [currentFile]);

  // ── Mouse events ─────────────────────────────────────────────────────────────
  const onMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const cx   = e.clientX - rect.left;
    const cy   = e.clientY - rect.top;
    const s    = sim.current;
    s.mouseX   = cx;
    s.mouseY   = cy;

    if (s.panning) {
      s.tx = s.panTX + (cx - s.panX);
      s.ty = s.panTY + (cy - s.panY);
    } else if (s.dragNode) {
      // handled in tick via mouseX/mouseY
    } else {
      const hit = nodeAt(cx, cy);
      s.hoverId = hit?.id ?? null;
      canvasRef.current!.style.cursor = hit ? 'pointer' : 'grab';
    }
  }, []);

  const onMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const cx   = e.clientX - rect.left;
    const cy   = e.clientY - rect.top;
    const s    = sim.current;
    const hit  = nodeAt(cx, cy);
    if (hit) {
      const world  = canvasToWorld(cx, cy);
      s.dragNode   = hit;
      s.dragOffX   = hit.x - world.x;
      s.dragOffY   = hit.y - world.y;
      canvasRef.current!.style.cursor = 'grabbing';
    } else {
      s.panning = true;
      s.panX    = cx; s.panY = cy;
      s.panTX   = s.tx; s.panTY = s.ty;
      canvasRef.current!.style.cursor = 'grabbing';
    }
  }, []);

  const onMouseUp = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const cx   = e.clientX - rect.left;
    const cy   = e.clientY - rect.top;
    const s    = sim.current;
    if (s.dragNode) {
      // If barely moved, treat as click
      const world = canvasToWorld(cx, cy);
      const dx    = world.x + s.dragOffX - s.dragNode.x;
      const dy    = world.y + s.dragOffY - s.dragNode.y;
      if (dx * dx + dy * dy < 25) onSelect(s.dragNode.id);
      s.dragNode = null;
    }
    s.panning = false;
    canvasRef.current!.style.cursor = 'grab';
  }, [onSelect]);

  const onWheel = useCallback((e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const rect  = canvasRef.current!.getBoundingClientRect();
    const cx    = e.clientX - rect.left;
    const cy    = e.clientY - rect.top;
    const s     = sim.current;
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    const newScale = Math.max(0.1, Math.min(5, s.scale * delta));
    // Zoom toward cursor
    s.tx    = cx - (cx - s.tx) * (newScale / s.scale);
    s.ty    = cy - (cy - s.ty) * (newScale / s.scale);
    s.scale = newScale;
  }, []);

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      style={{ display: 'block', cursor: 'grab', background: 'rgba(5,8,20,0.95)' }}
      onMouseMove={onMouseMove}
      onMouseDown={onMouseDown}
      onMouseUp={onMouseUp}
      onMouseLeave={() => { sim.current.hoverId = null; sim.current.panning = false; sim.current.dragNode = null; }}
      onWheel={onWheel}
    />
  );
}
