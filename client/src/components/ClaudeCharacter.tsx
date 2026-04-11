// Personagem robô 2D do Claude Code — renderizado acima do node no canvas.
// Importado por Canvas.tsx e posicionado com position: absolute.

import { useSyncExternalStore, useState, useRef, useCallback, useEffect } from 'react';
import {
  subscribeClaudeActivity, getClaudeActivitySnapshot,
  ClaudeActivity, ActivityKind,
} from '../claudeActivityStore';
import { subscribeCharacter, getCharacterSnapshot } from '../characterStore';
import { CanvasNode } from '../types';

// ── CSS animations injetado uma vez ──────────────────────────────────────────

let animsInjected = false;
function injectAnims() {
  if (animsInjected || typeof document === 'undefined') return;
  animsInjected = true;
  const style = document.createElement('style');
  style.textContent = `
    @keyframes cc-bob         { 0%,100%{transform:translateY(0)}   50%{transform:translateY(-4px)} }
    @keyframes cc-bob-fast    { 0%,100%{transform:translateY(0)}   50%{transform:translateY(-6px)} }
    @keyframes cc-jump        { 0%,100%{transform:translateY(0)}   40%{transform:translateY(-14px)} 70%{transform:translateY(-6px)} }
    @keyframes cc-shake       { 0%,100%{transform:translateX(0)}   25%{transform:translateX(-4px)} 75%{transform:translateX(4px)} }
    @keyframes cc-dance       { 0%{transform:translateY(0) rotate(0deg) scale(1)} 20%{transform:translateY(-12px) rotate(-8deg) scale(1.08)} 40%{transform:translateY(-6px) rotate(8deg) scale(1.04)} 60%{transform:translateY(-14px) rotate(-6deg) scale(1.1)} 80%{transform:translateY(-4px) rotate(6deg) scale(1.05)} 100%{transform:translateY(0) rotate(0deg) scale(1)} }
    @keyframes cc-poke        { 0%{transform:translateY(0) scale(1)} 20%{transform:translateY(4px) scale(0.95)} 60%{transform:translateY(-8px) scale(1.05)} 100%{transform:translateY(0) scale(1)} }
    @keyframes cc-float-in    { from{opacity:0;transform:translateY(10px)} to{opacity:1;transform:translateY(0)} }
    @keyframes cc-arm-l-idle  { 0%,100%{transform:rotate(0deg)}   50%{transform:rotate(-8deg)} }
    @keyframes cc-arm-r-idle  { 0%,100%{transform:rotate(0deg)}   50%{transform:rotate(8deg)} }
    @keyframes cc-arm-l-think { 0%,100%{transform:rotate(20deg)}  50%{transform:rotate(30deg)} }
    @keyframes cc-arm-r-think { 0%,100%{transform:rotate(-5deg)}  50%{transform:rotate(5deg)} }
    @keyframes cc-arm-l-type  { 0%,100%{transform:rotate(-10deg)} 50%{transform:rotate(10deg)} }
    @keyframes cc-arm-r-type  { 0%,100%{transform:rotate(10deg)}  50%{transform:rotate(-10deg)} }
    @keyframes cc-arm-l-done  { 0%{transform:rotate(0deg)} 50%{transform:rotate(-40deg)} 100%{transform:rotate(0deg)} }
    @keyframes cc-arm-r-done  { 0%{transform:rotate(0deg)} 50%{transform:rotate(40deg)}  100%{transform:rotate(0deg)} }
    @keyframes cc-arm-worry   { 0%,100%{transform:rotate(0deg)}   50%{transform:rotate(-15deg)} }
    @keyframes cc-arm-wave    { 0%{transform:rotate(0deg)} 25%{transform:rotate(-60deg)} 50%{transform:rotate(-30deg)} 75%{transform:rotate(-70deg)} 100%{transform:rotate(0deg)} }
    @keyframes cc-antenna     { 0%,100%{transform:rotate(0deg)}   50%{transform:rotate(6deg)} }
    @keyframes cc-pulse       { 0%,100%{opacity:0.7} 50%{opacity:1} }
    @keyframes cc-eye-blink   { 0%,90%,100%{transform:scaleY(1)} 95%{transform:scaleY(0.08)} }
    @keyframes cc-eye-scan    { 0%,100%{transform:translateX(0)} 33%{transform:translateX(2px)} 66%{transform:translateX(-2px)} }
    @keyframes cc-think-dot   { 0%,100%{opacity:0.3;transform:scale(0.8)} 50%{opacity:1;transform:scale(1)} }
    @keyframes cc-spark       { 0%{opacity:1;transform:scale(1) translate(0,0)} 100%{opacity:0;transform:scale(1.6) translate(4px,-8px)} }
    @keyframes cc-bubble-in   { from{opacity:0;transform:scale(0.85) translateY(4px)} to{opacity:1;transform:scale(1) translateY(0)} }
    @keyframes cc-snap-back   { 0%{transform:scale(1.05)} 100%{transform:scale(1)} }
  `;
  document.head.appendChild(style);
}

// ── Robô SVG ─────────────────────────────────────────────────────────────────

interface RobotProps {
  activity: ClaudeActivity;
  color: string;
  size: number;
  delay?: number;
  isSubagent?: boolean;
  eyeOffsetX?: number;   // -1..1, move pupila horizontalmente
  eyeOffsetY?: number;   // -1..1, move pupila verticalmente
  forceAnim?: 'wave' | 'dance' | 'poke' | null;
}

function Robot({
  activity, color, size, delay = 0, isSubagent = false,
  eyeOffsetX = 0, eyeOffsetY = 0, forceAnim = null,
}: RobotProps) {
  const { kind } = activity;
  const d = `${delay}ms`;

  const bodyAnim = forceAnim === 'dance' ? `cc-dance 0.8s ease-in-out 2`
                 : forceAnim === 'poke'  ? `cc-poke 0.4s ease-out 1`
                 : kind === 'error'      ? `cc-shake 0.35s ease-in-out 4`
                 : kind === 'done'       ? `cc-jump 0.55s ease-in-out 3`
                 : kind === 'thinking'   ? `cc-bob 2.2s ease-in-out infinite ${d}`
                 : kind !== 'idle'       ? `cc-bob-fast 0.85s ease-in-out infinite ${d}`
                 : `cc-bob 3.5s ease-in-out infinite ${d}`;

  const lArmAnim = forceAnim === 'dance' ? `cc-arm-l-done 0.4s ease-in-out infinite ${d}`
                 : kind === 'thinking' ? `cc-arm-l-think 2s ease-in-out infinite ${d}`
                 : kind === 'tool'     ? `cc-arm-l-type 0.5s ease-in-out infinite ${d}`
                 : kind === 'agent'    ? `cc-arm-l-type 0.6s ease-in-out infinite ${d}`
                 : kind === 'done'     ? `cc-arm-l-done 0.55s ease-in-out 4 ${d}`
                 : kind === 'error'    ? `cc-arm-worry 0.3s ease-in-out infinite ${d}`
                 : `cc-arm-l-idle 3.5s ease-in-out infinite ${d}`;

  const rArmAnim = forceAnim === 'wave'  ? `cc-arm-wave 0.35s ease-in-out 4 ${d}`
                 : forceAnim === 'dance' ? `cc-arm-r-done 0.4s ease-in-out infinite ${delay + 100}ms`
                 : kind === 'thinking' ? `cc-arm-r-think 2.2s ease-in-out infinite ${d}`
                 : kind === 'tool'     ? `cc-arm-r-type 0.5s ease-in-out infinite ${delay + 120}ms`
                 : kind === 'agent'    ? `cc-arm-r-type 0.6s ease-in-out infinite ${delay + 150}ms`
                 : kind === 'done'     ? `cc-arm-r-done 0.55s ease-in-out 4 ${delay + 80}ms`
                 : kind === 'error'    ? `cc-arm-worry 0.3s ease-in-out infinite ${delay + 80}ms`
                 : `cc-arm-r-idle 3.5s ease-in-out infinite ${delay + 500}ms`;

  const antAnim  = kind !== 'idle' ? `cc-antenna 1.2s ease-in-out infinite ${d}` : `cc-antenna 3s ease-in-out infinite ${d}`;

  const eyeColor = kind === 'error'    ? '#f87171'
                 : kind === 'done'     ? '#6ee7b7'
                 : kind === 'thinking' ? '#fbbf24'
                 : kind === 'agent'    ? '#c084fc'
                 : '#93c5fd';

  const eyeAnim  = kind === 'thinking'              ? `cc-eye-scan 1.5s ease-in-out infinite ${d}`
                 : kind === 'tool' || kind === 'agent' ? `cc-eye-scan 0.6s ease-in-out infinite ${d}`
                 : `cc-eye-blink 4s ease-in-out infinite ${d}`;

  // Offset dos pupilas: max ±2px horizontal, ±1.5px vertical
  const px = eyeOffsetX * 2;
  const py = eyeOffsetY * 1.5;

  return (
    <svg
      width={size}
      height={size * (100 / 70)}
      viewBox="0 0 70 100"
      style={{ overflow: 'visible', display: 'block' }}
    >
      {/* Sombra */}
      <ellipse cx="35" cy="98" rx="18" ry="4" fill="rgba(0,0,0,0.3)" />

      <g style={{ animation: bodyAnim, transformBox: 'fill-box', transformOrigin: 'bottom center' }}>

        {/* Pernas */}
        <rect x="22" y="74" width="10" height="18" rx="5" fill={color} opacity="0.85" />
        <rect x="38" y="74" width="10" height="18" rx="5" fill={color} opacity="0.85" />
        <ellipse cx="27" cy="92" rx="8" ry="4" fill={color} />
        <ellipse cx="43" cy="92" rx="8" ry="4" fill={color} />
        <ellipse cx="27" cy="92" rx="5" ry="2.5" fill="rgba(255,255,255,0.15)" />
        <ellipse cx="43" cy="92" rx="5" ry="2.5" fill="rgba(255,255,255,0.15)" />

        {/* Corpo */}
        <rect x="16" y="45" width="38" height="32" rx="8" fill={color} />
        <rect x="20" y="49" width="30" height="24" rx="5" fill="rgba(0,0,0,0.25)" />
        <circle cx="35" cy="61" r="5" fill={eyeColor} opacity="0.3" style={{ animation: `cc-pulse 1.4s ease-in-out infinite ${d}` }} />
        <circle cx="35" cy="61" r="3" fill={eyeColor} opacity="0.7" style={{ animation: `cc-pulse 1.4s ease-in-out infinite ${d}` }} />
        <circle cx="23" cy="52" r="2" fill="rgba(255,255,255,0.15)" />
        <circle cx="47" cy="52" r="2" fill="rgba(255,255,255,0.15)" />
        <circle cx="23" cy="70" r="2" fill="rgba(255,255,255,0.15)" />
        <circle cx="47" cy="70" r="2" fill="rgba(255,255,255,0.15)" />
        {!isSubagent && (
          <g opacity="0.5">
            <path d="M35 53 L38 61 H36.5 L35 57 L33.5 61 H32 L35 53Z" fill="rgba(255,255,255,0.8)" />
            <line x1="33" y1="58.5" x2="37" y2="58.5" stroke="rgba(255,255,255,0.8)" strokeWidth="1" strokeLinecap="round" />
          </g>
        )}

        {/* Ombros */}
        <circle cx="16" cy="52" r="5" fill={color} />
        <circle cx="54" cy="52" r="5" fill={color} />

        {/* Braço esquerdo */}
        <g style={{ transformBox: 'fill-box', transformOrigin: '100% 20%', animation: lArmAnim }}>
          <rect x="3" y="48" width="14" height="8" rx="4" fill={color} />
          <rect x="1" y="47" width="6" height="10" rx="3" fill={color} opacity="0.9" />
          <rect x="3" y="53" width="4" height="1.5" rx="0.75" fill="rgba(255,255,255,0.2)" />
          {kind === 'thinking' && <circle cx="3" cy="48" r="3.5" fill={color} />}
        </g>

        {/* Braço direito */}
        <g style={{ transformBox: 'fill-box', transformOrigin: '0% 20%', animation: rArmAnim }}>
          <rect x="53" y="48" width="14" height="8" rx="4" fill={color} />
          <rect x="63" y="47" width="6" height="10" rx="3" fill={color} opacity="0.9" />
          <rect x="63" y="53" width="4" height="1.5" rx="0.75" fill="rgba(255,255,255,0.2)" />
        </g>

        {/* Pescoço */}
        <rect x="29" y="39" width="12" height="9" rx="3" fill={color} />
        <rect x="31" y="40" width="8" height="7" rx="2" fill="rgba(0,0,0,0.2)" />

        {/* Cabeça */}
        <rect x="12" y="10" width="46" height="32" rx="10" fill={color} />
        <rect x="14" y="11" width="42" height="8" rx="7" fill="rgba(255,255,255,0.12)" />

        {/* Orelhas */}
        <rect x="8"  y="18" width="5" height="14" rx="2.5" fill={color} />
        <rect x="57" y="18" width="5" height="14" rx="2.5" fill={color} />
        <rect x="9"  y="21" width="3" height="8"  rx="1.5" fill="rgba(0,0,0,0.25)" />
        <rect x="58" y="21" width="3" height="8"  rx="1.5" fill="rgba(0,0,0,0.25)" />

        {/* Ecrã */}
        <rect x="17" y="14" width="36" height="24" rx="6" fill="#050a15" />
        <rect x="18" y="15" width="34" height="22" rx="5" fill="#060d1e" />
        <rect x="18" y="15" width="34" height="1.5" rx="0.5" fill={eyeColor} opacity="0.06" style={{ animation: `cc-pulse 2s ease-in-out infinite ${d}` }} />

        {/* Olhos com tracking */}
        <g style={{ animation: eyeAnim, transformBox: 'fill-box', transformOrigin: 'center' }}>
          {/* Socket esquerdo */}
          <rect x="22" y="21" width="10" height="8" rx="3" fill={eyeColor} opacity="0.2" />
          {/* Pupila esquerda — segue cursor */}
          <rect x={24 + px} y={23 + py} width="6" height="4" rx="2" fill={eyeColor} opacity="0.9" style={{ transition: 'x 0.08s, y 0.08s' }} />
          {/* Socket direito */}
          <rect x="38" y="21" width="10" height="8" rx="3" fill={eyeColor} opacity="0.2" />
          {/* Pupila direita */}
          <rect x={40 + px} y={23 + py} width="6" height="4" rx="2" fill={eyeColor} opacity="0.9" style={{ transition: 'x 0.08s, y 0.08s' }} />
        </g>

        {/* Expressões */}
        {kind === 'thinking' && <rect x="28" y="32" width="14" height="2" rx="1" fill={eyeColor} opacity="0.6" />}
        {kind === 'done' && <path d="M 26 32 Q 35 38 44 32" stroke={eyeColor} strokeWidth="2" fill="none" strokeLinecap="round" opacity="0.8" />}
        {kind === 'error' && <path d="M 27 35 Q 35 30 43 35" stroke={eyeColor} strokeWidth="2" fill="none" strokeLinecap="round" opacity="0.8" />}
        {kind === 'idle' && <path d="M 28 32 Q 35 35 42 32" stroke={eyeColor} strokeWidth="1.5" fill="none" strokeLinecap="round" opacity="0.4" />}
        {forceAnim === 'wave' && <path d="M 26 32 Q 35 38 44 32" stroke={eyeColor} strokeWidth="2" fill="none" strokeLinecap="round" opacity="0.8" />}
        {forceAnim === 'dance' && <path d="M 26 32 Q 35 38 44 32" stroke={eyeColor} strokeWidth="2" fill="none" strokeLinecap="round" opacity="0.8" />}
        {(kind === 'tool' || kind === 'agent') && (
          <rect x="24" y="32" width="22" height="2.5" rx="1.25" fill="rgba(255,255,255,0.08)" />
        )}

        {/* Antena */}
        <g style={{ transformBox: 'fill-box', transformOrigin: 'bottom center', animation: antAnim }}>
          <rect x="33.5" y="2" width="3" height="10" rx="1.5" fill={color} />
          <circle cx="35" cy="2" r="4" fill={color} />
          <circle cx="35" cy="2" r="3" fill={eyeColor} style={{ animation: `cc-pulse 1s ease-in-out infinite ${d}` }} />
        </g>

        {/* Sparks no done */}
        {kind === 'done' && (
          <>
            <text x="58" y="12" fontSize="10" style={{ animation: `cc-spark 0.7s ease-out 3 ${d}` }}>✨</text>
            <text x="8"  y="14" fontSize="8"  style={{ animation: `cc-spark 0.7s ease-out 3 ${delay + 200}ms` }}>⭐</text>
          </>
        )}
        {forceAnim === 'dance' && (
          <>
            <text x="56" y="10" fontSize="9" style={{ animation: `cc-spark 0.5s ease-out 4 ${d}` }}>✨</text>
            <text x="6"  y="12" fontSize="8" style={{ animation: `cc-spark 0.5s ease-out 4 ${delay + 150}ms` }}>🎉</text>
          </>
        )}

        {/* Bolhas de pensamento */}
        {kind === 'thinking' && (
          <g>
            <circle cx="52" cy="8"  r="2.5" fill="rgba(255,255,255,0.5)" style={{ animation: `cc-think-dot 1.2s ease-in-out infinite ${d}` }} />
            <circle cx="58" cy="4"  r="3.5" fill="rgba(255,255,255,0.45)" style={{ animation: `cc-think-dot 1.2s ease-in-out infinite ${delay + 200}ms` }} />
            <circle cx="65" cy="-1" r="5"   fill="rgba(255,255,255,0.4)" style={{ animation: `cc-think-dot 1.2s ease-in-out infinite ${delay + 400}ms` }} />
            <text x="65" y="1" textAnchor="middle" fontSize="5" fill={color}>…</text>
          </g>
        )}
      </g>
    </svg>
  );
}

// ── Sprite interativo por node ────────────────────────────────────────────────

type InteractAnim = 'wave' | 'dance' | 'poke' | null;

// Tamanho fixo em pixels de tela (independente do zoom)
const MAIN_SIZE = 62;
const CHAR_H    = MAIN_SIZE * (100 / 70); // ~88.6px
const SUB_SIZE  = 44;
const GAP_PX    = 8;

interface SpriteProps {
  node: CanvasNode;
  activity: ClaudeActivity;
  zoom: number;
  canvasOffset: { x: number; y: number };
}

function CharacterSprite({ node, activity, zoom, canvasOffset }: SpriteProps) {
  const [eyeOffset, setEyeOffset] = useState({ x: 0, y: 0 });
  const [hovered, setHovered] = useState(false);
  const [forceAnim, setForceAnim] = useState<InteractAnim>(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [snapping, setSnapping] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const dragStart = useRef<{ mx: number; my: number; ox: number; oy: number } | null>(null);
  const animTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function triggerAnim(anim: InteractAnim, duration: number) {
    if (animTimer.current) clearTimeout(animTimer.current);
    setForceAnim(anim);
    animTimer.current = setTimeout(() => setForceAnim(null), duration);
  }

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height * 0.25;
    const dx = (e.clientX - cx) / (rect.width * 0.8);
    const dy = (e.clientY - cy) / (rect.height * 0.5);
    setEyeOffset({
      x: Math.max(-1, Math.min(1, dx)),
      y: Math.max(-1, Math.min(1, dy)),
    });
  }, []);

  const handleMouseEnter = () => setHovered(true);
  const handleMouseLeave = () => { setHovered(false); setEyeOffset({ x: 0, y: 0 }); };

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isDragging) return;
    triggerAnim('wave', 1500);
  };

  const handleDblClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    triggerAnim('dance', 1800);
  };

  // Arraste em screen space — sem conversão de zoom
  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    dragStart.current = { mx: e.clientX, my: e.clientY, ox: dragOffset.x, oy: dragOffset.y };

    function onMove(ev: MouseEvent) {
      if (!dragStart.current) return;
      setDragOffset({
        x: dragStart.current.ox + (ev.clientX - dragStart.current.mx),
        y: dragStart.current.oy + (ev.clientY - dragStart.current.my),
      });
      setIsDragging(true);
    }

    function onUp() {
      dragStart.current = null;
      setIsDragging(false);
      setSnapping(true);
      setDragOffset({ x: 0, y: 0 });
      setTimeout(() => setSnapping(false), 400);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    }

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  useEffect(() => () => { if (animTimer.current) clearTimeout(animTimer.current); }, []);

  const color = KIND_COLOR[activity.kind];
  const subCount = Math.min(activity.agents, 4);
  const totalW = MAIN_SIZE + subCount * (SUB_SIZE + GAP_PX);

  // Posição em screen space: world→screen
  const nodeScreenX = node.x * zoom + canvasOffset.x;
  const nodeScreenY = node.y * zoom + canvasOffset.y;
  const nodeScreenW = node.width * zoom;

  const charX = nodeScreenX + (nodeScreenW - totalW) / 2 + dragOffset.x;
  const charY = nodeScreenY - CHAR_H - 10 + dragOffset.y;

  const stripText = activity.label
    ? (activity.tool ? `${activity.label} · ${activity.tool.slice(0, 40)}` : activity.label)
    : STRIP_TEXT[activity.kind];

  const hintText = activity.kind === 'idle' ? 'pronto' : stripText;

  return (
    <div
      ref={containerRef}
      onMouseMove={handleMouseMove}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onClick={handleClick}
      onDoubleClick={handleDblClick}
      onMouseDown={handleMouseDown}
      style={{
        position: 'fixed',
        left: charX, top: charY,
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        pointerEvents: 'auto',
        zIndex: 8000,
        cursor: isDragging ? 'grabbing' : 'grab',
        animation: snapping ? 'cc-snap-back 0.35s ease-out' : 'cc-float-in 0.35s ease-out',
        userSelect: 'none',
      }}
    >
      {/* Speech bubble no hover */}
      {hovered && hintText && (
        <div style={{
          marginBottom: 4,
          fontSize: 10,
          fontFamily: 'monospace',
          fontWeight: 500,
          color: '#e2e8f0',
          background: 'rgba(10,14,30,0.92)',
          border: `1px solid ${color}50`,
          borderRadius: 8,
          padding: '3px 8px',
          whiteSpace: 'nowrap',
          maxWidth: 220,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          boxShadow: `0 2px 12px ${color}20`,
          animation: 'cc-bubble-in 0.18s ease-out',
          position: 'relative',
        }}>
          <span style={{ color, marginRight: 4 }}>●</span>
          {hintText}
          <div style={{
            position: 'absolute',
            bottom: -5,
            left: '50%',
            transform: 'translateX(-50%)',
            width: 0, height: 0,
            borderLeft: '4px solid transparent',
            borderRight: '4px solid transparent',
            borderTop: `4px solid ${color}50`,
          }} />
        </div>
      )}

      {/* Robôs */}
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: GAP_PX }}>
        <Robot
          activity={activity}
          color={color}
          size={MAIN_SIZE}
          eyeOffsetX={eyeOffset.x}
          eyeOffsetY={eyeOffset.y}
          forceAnim={forceAnim}
          delay={0}
        />
        {activity.kind === 'agent' && Array.from({ length: subCount }).map((_, i) => (
          <div key={i} style={{ animation: `cc-float-in 0.25s ease-out ${(i + 1) * 120}ms both` }}>
            <Robot
              activity={{ kind: 'tool', label: 'sub', agents: 0 }}
              color="#7c3aed"
              size={SUB_SIZE}
              delay={(i + 1) * 200}
              isSubagent
            />
          </div>
        ))}
      </div>

      {/* Etiqueta de status */}
      {!hovered && stripText && activity.kind !== 'idle' && (
        <div style={{
          marginTop: 4,
          fontSize: 10,
          fontFamily: 'monospace',
          fontWeight: 500,
          color,
          background: `${color}18`,
          border: `1px solid ${color}40`,
          borderRadius: 10,
          padding: '2px 8px',
          whiteSpace: 'nowrap',
          maxWidth: 220,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}>
          {stripText}
        </div>
      )}

      {/* Hint quando idle e hovering */}
      {hovered && activity.kind === 'idle' && (
        <div style={{
          marginTop: 4,
          fontSize: 9,
          fontFamily: 'monospace',
          color: 'rgba(255,255,255,0.25)',
          whiteSpace: 'nowrap',
        }}>
          clique · arraste · duplo-clique
        </div>
      )}
    </div>
  );
}

// ── Camada de personagens sobre os nodes ─────────────────────────────────────

const KIND_COLOR: Record<ActivityKind, string> = {
  idle:     '#4b8bcc',
  thinking: '#d97706',
  tool:     '#0e7490',
  agent:    '#7c3aed',
  done:     '#059669',
  error:    '#dc2626',
};

const STRIP_TEXT: Record<ActivityKind, string> = {
  idle:     '',
  thinking: 'pensando…',
  tool:     '',
  agent:    '',
  done:     'concluído ✓',
  error:    'erro detectado',
};

interface OverlayProps {
  nodes: CanvasNode[];
  zoom: number;
  canvasOffset: { x: number; y: number };
}

const IDLE_ACTIVITY: ClaudeActivity = { kind: 'idle', label: '', agents: 0 };

export function ClaudeCharacterOverlay({ nodes, zoom, canvasOffset }: OverlayProps) {
  injectAnims();
  const activities = useSyncExternalStore(subscribeClaudeActivity, getClaudeActivitySnapshot);
  const characterVisible = useSyncExternalStore(subscribeCharacter, getCharacterSnapshot);

  if (!characterVisible) return null;

  return (
    <>
      {nodes
        .filter(n => n.type === 'claude-code' && !n.minimized)
        .map(node => {
          const activity = activities.get(node.id) ?? IDLE_ACTIVITY;
          return (
            <CharacterSprite
              key={node.id}
              node={node}
              activity={activity}
              zoom={zoom}
              canvasOffset={canvasOffset}
            />
          );
        })}
    </>
  );
}
