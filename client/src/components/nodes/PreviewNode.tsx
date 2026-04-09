import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { PreviewData } from '../../types';
import { useCanvasStore } from '../../store';

// ─── Device presets ───────────────────────────────────────────────────────────

interface Device {
  name: string;
  width: number;
  height: number;
  kind: 'mobile' | 'tablet' | 'laptop' | 'desktop' | 'responsive';
  dpr?: number;
}

const DEVICES: Device[] = [
  { name: 'Responsive',         width: 0,    height: 0,    kind: 'responsive' },
  { name: 'iPhone SE',          width: 375,  height: 667,  kind: 'mobile',  dpr: 2   },
  { name: 'iPhone 14',          width: 390,  height: 844,  kind: 'mobile',  dpr: 3   },
  { name: 'iPhone 14 Pro Max',  width: 430,  height: 932,  kind: 'mobile',  dpr: 3   },
  { name: 'iPhone 16 Pro Max',  width: 440,  height: 956,  kind: 'mobile',  dpr: 3   },
  { name: 'Samsung Galaxy S24', width: 384,  height: 854,  kind: 'mobile',  dpr: 3   },
  { name: 'Pixel 8 Pro',        width: 412,  height: 915,  kind: 'mobile',  dpr: 3.5 },
  { name: 'iPad Mini',          width: 768,  height: 1024, kind: 'tablet',  dpr: 2   },
  { name: 'iPad Air',           width: 820,  height: 1180, kind: 'tablet',  dpr: 2   },
  { name: 'iPad Pro 11"',       width: 834,  height: 1194, kind: 'tablet',  dpr: 2   },
  { name: 'iPad Pro 13"',       width: 1024, height: 1366, kind: 'tablet',  dpr: 2   },
  { name: 'Galaxy Tab S9',      width: 800,  height: 1280, kind: 'tablet',  dpr: 2   },
  { name: 'MacBook Air 13"',    width: 1280, height: 800,  kind: 'laptop'           },
  { name: 'MacBook Pro 14"',    width: 1512, height: 982,  kind: 'laptop'           },
  { name: 'MacBook Pro 16"',    width: 1728, height: 1117, kind: 'laptop'           },
  { name: '1080p',              width: 1920, height: 1080, kind: 'desktop'          },
  { name: '1440p',              width: 2560, height: 1440, kind: 'desktop'          },
  { name: '4K',                 width: 3840, height: 2160, kind: 'desktop'          },
];

const KIND_ICON:  Record<string, string> = { responsive:'⊞', mobile:'📱', tablet:'▭', laptop:'💻', desktop:'🖥️' };
const KIND_LABEL: Record<string, string> = { responsive:'Responsivo', mobile:'Mobile', tablet:'Tablet', laptop:'Laptop', desktop:'Desktop' };
const KIND_GROUPS = ['responsive','mobile','tablet','laptop','desktop'] as const;

// ─── Bezel metrics ────────────────────────────────────────────────────────────

interface Bezel { bx: number; topY: number; botY: number; extraBot: number; radius: number; }

function bezelOf(kind: Device['kind']): Bezel {
  switch (kind) {
    case 'mobile':  return { bx: 14, topY: 20, botY: 20, extraBot: 12, radius: 44 };
    case 'tablet':  return { bx: 18, topY: 22, botY: 22, extraBot:  0, radius: 20 };
    case 'laptop':  return { bx: 22, topY: 24, botY:  6, extraBot: 38, radius:  8 };
    case 'desktop': return { bx: 12, topY: 14, botY: 14, extraBot: 60, radius:  6 };
    default:        return { bx:  0, topY:  0, botY:  0, extraBot:  0, radius:  0 };
  }
}

function frameSize(device: Device, landscape: boolean) {
  const dw = landscape ? device.height : device.width;
  const dh = landscape ? device.width  : device.height;
  if (device.kind === 'responsive') return { fw: dw, fh: dh };
  const b = bezelOf(device.kind);
  return { fw: dw + b.bx * 2, fh: dh + b.topY + b.botY + b.extraBot };
}

const URL_H          = 37;
const PICKER_H       = 34;
const CANVAS_TITLE_H = 36;
const FRAME_PAD      = 32;

function computeLayout(device: Device, landscape: boolean) {
  if (device.kind === 'responsive') return { nodeW: 900, nodeH: 600, scale: 1, fw: 0, fh: 0 };
  const { fw, fh } = frameSize(device, landscape);
  const idealNodeW  = fw + FRAME_PAD * 2;
  const idealNodeH  = fh + FRAME_PAD * 2 + URL_H + PICKER_H + CANVAS_TITLE_H;
  const maxW = window.innerWidth  * 0.85;
  const maxH = window.innerHeight * 0.88;
  const scale = Math.min(maxW / idealNodeW, maxH / idealNodeH, 1);
  return { nodeW: Math.round(idealNodeW * scale), nodeH: Math.round(idealNodeH * scale), scale, fw, fh };
}

// ─── Device mockup components ─────────────────────────────────────────────────

interface MockupProps { device: Device; landscape: boolean; children: React.ReactNode; }

function PhoneMockup({ device, landscape, children }: MockupProps) {
  const dw = landscape ? device.height : device.width;
  const dh = landscape ? device.width  : device.height;
  const b  = bezelOf('mobile');
  return (
    <div style={{ display:'inline-flex', flexShrink:0 }}>
      <div style={{
        position:'relative',
        width:  !landscape ? dw + b.bx * 2 : dh + b.topY + b.botY,
        height: !landscape ? dh + b.topY + b.botY + b.extraBot : dw + b.bx * 2 + b.extraBot,
        borderRadius: !landscape ? b.radius : b.radius,
        background:'linear-gradient(170deg,#3c4050 0%,#23262e 100%)',
        boxShadow:'0 0 0 1px rgba(255,255,255,0.07),0 8px 32px rgba(0,0,0,0.5),inset 0 1px 0 rgba(255,255,255,0.1)',
      }}>
        <div style={{
          position:'absolute',
          left: !landscape ? b.bx : b.topY,
          top:  !landscape ? b.topY : b.bx,
          width:  !landscape ? dw : dh,
          height: !landscape ? dh : dw,
          borderRadius: 6, overflow:'hidden', background:'#000',
        }}>
          {children}
        </div>
        {/* Camera */}
        <div style={{
          position:'absolute',
          top:  !landscape ? b.topY/2-5 : '50%',
          left: !landscape ? '50%'       : b.bx/2-5,
          transform:'translate(-50%,-50%)',
          width:10, height:10, borderRadius:'50%',
          background:'#1a1e26', border:'1.5px solid #2a2f38', zIndex:5,
        }} />
        <div style={{ position:'absolute', inset:0, borderRadius:b.radius, background:'linear-gradient(135deg,rgba(255,255,255,0.05) 0%,transparent 50%)', pointerEvents:'none' }} />
      </div>
    </div>
  );
}

function TabletMockup({ device, landscape, children }: MockupProps) {
  const dw = landscape ? device.height : device.width;
  const dh = landscape ? device.width  : device.height;
  const b  = bezelOf('tablet');
  return (
    <div style={{ display:'inline-flex', flexShrink:0 }}>
      <div style={{
        position:'relative',
        width:  dw + b.bx * 2,
        height: dh + b.topY + b.botY,
        borderRadius: b.radius,
        background:'linear-gradient(170deg,#3c4050 0%,#23262e 100%)',
        boxShadow:'0 0 0 1px rgba(255,255,255,0.07),0 12px 48px rgba(0,0,0,0.55),inset 0 1px 0 rgba(255,255,255,0.09)',
      }}>
        <div style={{ position:'absolute', left:b.bx, top:b.topY, width:dw, height:dh, borderRadius:4, overflow:'hidden', background:'#000' }}>
          {children}
        </div>
        {/* Camera */}
        <div style={{
          position:'absolute', top: b.topY/2-4, left:'50%', transform:'translateX(-50%)',
          width:8, height:8, borderRadius:'50%', background:'#1a1e26', border:'1.5px solid #2a2f38',
        }} />
        <div style={{ position:'absolute', inset:0, borderRadius:b.radius, background:'linear-gradient(135deg,rgba(255,255,255,0.05) 0%,transparent 50%)', pointerEvents:'none' }} />
      </div>
    </div>
  );
}

function LaptopMockup({ device, landscape, children }: MockupProps) {
  const dw = landscape ? device.height : device.width;
  const dh = landscape ? device.width  : device.height;
  const b  = bezelOf('laptop');
  return (
    <div style={{ display:'inline-flex', flexDirection:'column', alignItems:'center', flexShrink:0 }}>
      <div style={{
        position:'relative',
        width:  dw + b.bx * 2,
        height: dh + b.topY + b.botY,
        borderRadius:`${b.radius}px ${b.radius}px 3px 3px`,
        background:'linear-gradient(170deg,#3c4050 0%,#23262e 100%)',
        boxShadow:'0 0 0 1px rgba(255,255,255,0.07),0 -3px 14px rgba(0,0,0,0.3),inset 0 1px 0 rgba(255,255,255,0.09)',
      }}>
        <div style={{ position:'absolute', left:b.bx, top:b.topY, width:dw, height:dh, borderRadius:2, overflow:'hidden', background:'#000' }}>
          {children}
        </div>
        <div style={{ position:'absolute', top:8, left:'50%', transform:'translateX(-50%)', width:6, height:6, borderRadius:'50%', background:'#1a1e26', border:'1px solid #2a2f38' }} />
        <div style={{ position:'absolute', inset:0, borderRadius:`${b.radius}px ${b.radius}px 3px 3px`, background:'linear-gradient(135deg,rgba(255,255,255,0.05) 0%,transparent 40%)', pointerEvents:'none' }} />
      </div>
      <div style={{ width:dw+b.bx*2+6, height:5, background:'linear-gradient(to bottom,#2c2f38,#1c1e25)' }} />
      <div style={{
        width:dw+b.bx*2+24, height:28,
        background:'linear-gradient(to bottom,#2e3140,#22242c)',
        borderRadius:'0 0 12px 12px',
        boxShadow:'0 4px 20px rgba(0,0,0,0.45),0 0 0 1px rgba(255,255,255,0.05)',
        display:'flex', alignItems:'center', justifyContent:'center',
      }}>
        <div style={{ width:90, height:12, background:'rgba(255,255,255,0.03)', border:'1px solid rgba(255,255,255,0.06)', borderRadius:3 }} />
      </div>
    </div>
  );
}

function MonitorMockup({ device, landscape, children }: MockupProps) {
  const dw = landscape ? device.height : device.width;
  const dh = landscape ? device.width  : device.height;
  const b  = bezelOf('desktop');
  return (
    <div style={{ display:'inline-flex', flexDirection:'column', alignItems:'center', flexShrink:0 }}>
      <div style={{
        position:'relative',
        width:  dw + b.bx * 2,
        height: dh + b.topY + b.botY,
        borderRadius:10,
        background:'linear-gradient(155deg,#3a3e48 0%,#21242c 100%)',
        boxShadow:'0 0 0 1px rgba(255,255,255,0.07),0 14px 52px rgba(0,0,0,0.6),inset 0 1px 0 rgba(255,255,255,0.08)',
      }}>
        <div style={{ position:'absolute', left:b.bx, top:b.topY, width:dw, height:dh, borderRadius:2, overflow:'hidden', background:'#000' }}>
          {children}
        </div>
        <div style={{ position:'absolute', bottom:b.botY/2-3, left:'50%', transform:'translateX(-50%)', width:6, height:6, borderRadius:'50%', background:'#1a8a4a', boxShadow:'0 0 6px #1a8a4a' }} />
        <div style={{ position:'absolute', inset:0, borderRadius:10, background:'linear-gradient(135deg,rgba(255,255,255,0.05) 0%,transparent 40%)', pointerEvents:'none' }} />
      </div>
      <div style={{ width:5, height:32, background:'linear-gradient(to bottom,#2a2d36,#1e2028)' }} />
      <div style={{ display:'flex', flexDirection:'column', alignItems:'center' }}>
        <div style={{ width:130, height:9, borderRadius:4, background:'linear-gradient(to bottom,#2c2f38,#1e2028)', boxShadow:'0 2px 8px rgba(0,0,0,0.4)' }} />
        <div style={{ width:90, height:16, background:'linear-gradient(to bottom,#272a32,#1a1c22)', borderRadius:'0 0 22px 22px', boxShadow:'0 4px 14px rgba(0,0,0,0.35)' }} />
      </div>
    </div>
  );
}

function Mockup(props: MockupProps) {
  if (props.device.kind === 'responsive') return <>{props.children}</>;
  if (props.device.kind === 'mobile')  return <PhoneMockup  {...props} />;
  if (props.device.kind === 'tablet')  return <TabletMockup {...props} />;
  if (props.device.kind === 'laptop')  return <LaptopMockup {...props} />;
  return <MonitorMockup {...props} />;
}

// ─── Expanded overlay ─────────────────────────────────────────────────────────

const OVERLAY_TOOLBAR_H = 52;

function ExpandedView({ device, landscape, url, iframeKey, onClose, onReload }: {
  device: Device; landscape: boolean; url: string; iframeKey: number;
  onClose: () => void; onReload: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const availW = window.innerWidth  - FRAME_PAD * 2;
  const availH = window.innerHeight - OVERLAY_TOOLBAR_H - FRAME_PAD * 2;

  let scale = 1;
  let fw = availW, fh = availH;
  const dw = landscape ? device.height : device.width;
  const dh = landscape ? device.width  : device.height;

  if (device.kind !== 'responsive') {
    const b = bezelOf(device.kind);
    fw = dw + b.bx * 2;
    fh = dh + b.topY + b.botY + b.extraBot;
    scale = Math.min(availW / fw, availH / fh, 1);
  }

  return createPortal(
    <div style={{
      position:'fixed', inset:0, zIndex:99999,
      background:'rgba(6,9,20,0.92)', backdropFilter:'blur(12px)',
      display:'flex', flexDirection:'column',
    }}>
      {/* Toolbar */}
      <div style={{
        height:OVERLAY_TOOLBAR_H, display:'flex', alignItems:'center', gap:10,
        padding:'0 20px', flexShrink:0,
        borderBottom:'1px solid rgba(255,255,255,0.07)',
        background:'rgba(255,255,255,0.02)',
      }}>
        <span style={{ fontSize:12, fontFamily:'monospace', color:'rgba(140,190,255,0.8)', flex:1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
          {url}
        </span>
        <button onClick={onReload} style={iconBtn}>↺</button>
        <button onClick={() => window.open(url, '_blank')} title="Abrir em nova aba" style={iconBtn}>↗</button>
        <button onClick={onClose} style={{ ...iconBtn, color:'rgba(255,255,255,0.7)', fontSize:16 }}>✕</button>
      </div>
      {/* Frame */}
      <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', overflow:'hidden', padding:FRAME_PAD }}>
        <div style={{ transform:`scale(${scale})`, transformOrigin:'center center', flexShrink:0 }}>
          <Mockup device={device} landscape={landscape}>
            <iframe
              key={iframeKey}
              src={url}
              style={{
                width:  device.kind === 'responsive' ? availW : dw,
                height: device.kind === 'responsive' ? availH : dh,
                border:'none', display:'block', background:'#fff',
              }}
              onLoad={() => setLoading(false)}
              title="Preview expanded"
            />
          </Mockup>
        </div>
        {loading && (
          <div style={{ position:'absolute', inset:0, display:'flex', alignItems:'center', justifyContent:'center', background:'rgba(6,9,20,0.7)' }}>
            <span style={{ color:'rgba(255,255,255,0.4)', fontSize:13 }}>Carregando…</span>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

interface Props {
  nodeId: string;
  data: PreviewData;
  width: number;
  height: number;
}

export function PreviewNode({ nodeId, data, width, height }: Props) {
  const { updateNodeData, updateNode } = useCanvasStore();
  const [inputUrl,  setInputUrl]  = useState(data.inputUrl || '');
  const [loadedUrl, setLoadedUrl] = useState(data.url || '');
  const [loading,   setLoading]   = useState(false);
  const [iframeKey, setIframeKey] = useState(0);
  const [deviceIdx, setDeviceIdx] = useState(0);
  const [landscape, setLandscape] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const [customW,   setCustomW]   = useState('');
  const [customH,   setCustomH]   = useState('');
  const [expanded,  setExpanded]  = useState(false);
  const [scale,     setScale]     = useState(1);
  const [iframeSize, setIframeSize] = useState({ w: 800, h: 500 });

  const device = DEVICES[deviceIdx];
  const effW = landscape ? device.height : device.width;
  const effH = landscape ? device.width  : device.height;

  const applyDevice = useCallback((dev: Device, land: boolean) => {
    const layout = computeLayout(dev, land);
    updateNode(nodeId, { width: layout.nodeW, height: layout.nodeH });
    setScale(layout.scale);
    if (dev.kind !== 'responsive') {
      setIframeSize({ w: land ? dev.height : dev.width, h: land ? dev.width : dev.height });
    }
  }, [nodeId, updateNode]);

  useEffect(() => { applyDevice(device, landscape); }, [deviceIdx, landscape]);

  useEffect(() => {
    if (device.kind === 'responsive') { setScale(1); return; }
    const b = bezelOf(device.kind);
    const fw = effW + b.bx * 2;
    const fh = effH + b.topY + b.botY + b.extraBot;
    const availW = width  - FRAME_PAD * 2;
    const availH = height - URL_H - PICKER_H - FRAME_PAD * 2;
    setScale(Math.min(availW / fw, availH / fh, 1));
  }, [width, height]);

  // Auto-load when terminal detects the URL
  useEffect(() => {
    if (data.url && data.url !== loadedUrl) {
      setInputUrl(data.url);
      setLoadedUrl(data.url);
      setLoading(true);
      setIframeKey(k => k + 1);
    }
  }, [data.url]);

  function navigate() {
    let url = inputUrl.trim();
    if (!url) return;
    if (!url.match(/^https?:\/\//)) url = 'http://' + url;
    setLoadedUrl(url);
    updateNodeData(nodeId, { url, inputUrl: url });
    setLoading(true);
    setIframeKey(k => k + 1);
  }

  function openInTab() {
    const url = loadedUrl || inputUrl;
    if (!url) return;
    window.open(url.match(/^https?:\/\//) ? url : 'http://' + url, '_blank');
  }

  function selectDevice(idx: number) {
    setDeviceIdx(idx);
    setLandscape(false);
    setShowPicker(false);
  }

  const scalePct = Math.round(scale * 100);
  const dw = device.kind === 'responsive' ? width  : effW;
  const dh = device.kind === 'responsive' ? (height - URL_H - PICKER_H) : effH;

  return (
    <>
      {expanded && loadedUrl && (
        <ExpandedView
          device={device} landscape={landscape}
          url={loadedUrl} iframeKey={iframeKey}
          onClose={() => setExpanded(false)}
          onReload={() => setIframeKey(k => k + 1)}
        />
      )}

      <div
        style={{ display:'flex', flexDirection:'column', height:'100%', background:'#0d1117', overflow:'hidden' }}
        onClick={() => setShowPicker(false)}
      >
        {/* URL bar */}
        <div style={{
          display:'flex', alignItems:'center', gap:5, padding:'4px 8px',
          background:'#0a0d12', borderBottom:'1px solid #21262d',
          flexShrink:0, height:URL_H, boxSizing:'border-box',
        }}>
          <button
            onClick={() => { setLoading(true); setIframeKey(k=>k+1); }}
            disabled={!loadedUrl}
            title="Recarregar"
            style={iconBtn}
          >↺</button>

          <input
            value={inputUrl}
            onChange={e => setInputUrl(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') navigate(); }}
            placeholder="http://localhost:3000"
            style={{
              flex:1, background:'rgba(255,255,255,0.06)',
              border:'1px solid #30363d', borderRadius:20,
              padding:'4px 14px', fontSize:12, color:'#e6edf3',
              outline:'none', fontFamily:'monospace', minWidth:0,
            }}
            onFocus={e => { e.currentTarget.style.borderColor='#388bfd'; }}
            onBlur={e =>  { e.currentTarget.style.borderColor='#30363d'; }}
          />

          {/* Open in new tab */}
          <button
            onClick={openInTab}
            title="Abrir em nova aba"
            disabled={!loadedUrl && !inputUrl}
            style={iconBtn}
          >
            <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor">
              <path d="M3.75 2h3.5a.75.75 0 0 1 0 1.5h-3.5a.25.25 0 0 0-.25.25v8.5c0 .138.112.25.25.25h8.5a.25.25 0 0 0 .25-.25v-3.5a.75.75 0 0 1 1.5 0v3.5A1.75 1.75 0 0 1 12.25 14h-8.5A1.75 1.75 0 0 1 2 12.25v-8.5C2 2.784 2.784 2 3.75 2Zm6.854-1h4.146a.25.25 0 0 1 .25.25v4.146a.25.25 0 0 1-.427.177L13.03 4.03 9.28 7.78a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042l3.75-3.75-1.543-1.543A.25.25 0 0 1 10.604 1Z"/>
            </svg>
          </button>

          {/* Expand */}
          <button
            onClick={() => loadedUrl && setExpanded(true)}
            disabled={!loadedUrl}
            title="Tela cheia"
            style={iconBtn}
          >⊡</button>
        </div>

        {/* Device picker toolbar */}
        <div
          style={{ display:'flex', alignItems:'center', gap:6, padding:'4px 8px', background:'#0a0d12', borderBottom:'1px solid #21262d', flexShrink:0, position:'relative', height:PICKER_H, boxSizing:'border-box' }}
          onClick={e => e.stopPropagation()}
        >
          <button
            onClick={() => setShowPicker(p => !p)}
            style={{
              display:'flex', alignItems:'center', gap:5,
              background: showPicker ? '#1f2d3d' : 'transparent',
              border:'1px solid #30363d', borderRadius:5,
              color:'#e6edf3', cursor:'pointer', padding:'3px 8px', fontSize:12,
            }}
          >
            <span>{KIND_ICON[device.kind]}</span>
            <span style={{ maxWidth:130, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{device.name}</span>
            <span style={{ color:'#484f58', fontSize:10 }}>▾</span>
          </button>

          {device.kind !== 'responsive' && (<>
            <button onClick={() => setLandscape(l => !l)} title="Girar" style={iconBtn}>
              {landscape ? '↕' : '↔'}
            </button>
            <span style={{ fontSize:10, color:'#8b949e', fontFamily:'monospace' }}>{effW}×{effH}</span>
            {device.dpr && <span style={{ fontSize:10, color:'#484f58' }}>@{device.dpr}x</span>}
          </>)}

          <span style={{ marginLeft:'auto', fontSize:10, color: scalePct < 100 ? '#d29922' : '#484f58', fontFamily:'monospace' }}>
            {device.kind !== 'responsive' ? `${scalePct}%` : 'responsive'}
          </span>

          {/* Device dropdown */}
          {showPicker && (
            <div style={{
              position:'absolute', top:'100%', left:0, zIndex:9999,
              background:'#161b22', border:'1px solid #30363d', borderRadius:8,
              boxShadow:'0 12px 48px rgba(0,0,0,0.75)', width:256, maxHeight:380,
              overflowY:'auto', marginTop:2,
            }}>
              {KIND_GROUPS.map(kind => (
                <div key={kind}>
                  <div style={{ padding:'7px 12px 2px', fontSize:10, color:'#484f58', fontWeight:700, letterSpacing:'0.08em', textTransform:'uppercase' }}>
                    {KIND_ICON[kind]} {KIND_LABEL[kind]}
                  </div>
                  {DEVICES.filter(d => d.kind === kind).map(d => {
                    const idx = DEVICES.indexOf(d);
                    const active = deviceIdx === idx;
                    return (
                      <div
                        key={d.name}
                        onClick={() => selectDevice(idx)}
                        style={{
                          display:'flex', justifyContent:'space-between', alignItems:'center',
                          padding:'5px 12px', cursor:'pointer', fontSize:12,
                          background: active ? '#1f2d3d' : 'transparent',
                          color: active ? '#58a6ff' : '#e6edf3',
                          borderLeft: active ? '2px solid #58a6ff' : '2px solid transparent',
                        }}
                        onMouseEnter={e => { if (!active) e.currentTarget.style.background='#1a2030'; }}
                        onMouseLeave={e => { if (!active) e.currentTarget.style.background='transparent'; }}
                      >
                        <span>{d.name}</span>
                        {d.kind !== 'responsive' && (
                          <span style={{ fontSize:10, color:'#484f58' }}>
                            {d.width}×{d.height}{d.dpr ? ` @${d.dpr}x` : ''}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}

              {/* Custom size */}
              <div style={{ padding:'8px 12px', borderTop:'1px solid #21262d', display:'flex', alignItems:'center', gap:6 }}>
                <input value={customW} onChange={e=>setCustomW(e.target.value)} placeholder="W" style={{ width:46, ...inputStyle }} />
                <span style={{ color:'#484f58' }}>×</span>
                <input value={customH} onChange={e=>setCustomH(e.target.value)} placeholder="H" style={{ width:46, ...inputStyle }} />
                <button
                  onClick={() => {
                    const w = parseInt(customW), h = parseInt(customH);
                    if (w > 0 && h > 0) {
                      DEVICES.push({ name:`${w}×${h}`, width:w, height:h, kind:'desktop' });
                      selectDevice(DEVICES.length - 1);
                    }
                  }}
                  style={{ ...iconBtn, color:'#3fb950', fontSize:11, padding:'2px 8px' }}
                >Add</button>
              </div>
            </div>
          )}
        </div>

        {/* Preview area */}
        <div style={{
          flex:1, overflow:'hidden', position:'relative',
          display:'flex', alignItems:'center', justifyContent:'center',
          background: device.kind === 'responsive' ? '#fff' : '#111520',
        }}>
          {!loadedUrl ? (
            <EmptyState onNavigate={url => { setInputUrl(url); setLoadedUrl(url); updateNodeData(nodeId, { url, inputUrl: url }); setLoading(true); setIframeKey(k=>k+1); }} />
          ) : (
            <div style={{ transform:`scale(${scale})`, transformOrigin:'center center', flexShrink:0 }}>
              <Mockup device={device} landscape={landscape}>
                <iframe
                  key={iframeKey}
                  src={loadedUrl}
                  style={{ width:dw, height:dh, border:'none', display:'block', background:'#fff' }}
                  onLoad={() => setLoading(false)}
                  onError={() => setLoading(false)}
                  title="Preview"
                />
              </Mockup>
            </div>
          )}

          {loading && loadedUrl && (
            <div style={{
              position:'absolute', inset:0, display:'flex', alignItems:'center', justifyContent:'center',
              background:'rgba(13,17,23,0.8)',
            }}>
              <span style={{ color:'rgba(255,255,255,0.35)', fontSize:13 }}>Carregando…</span>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function EmptyState({ onNavigate }: { onNavigate: (url: string) => void }) {
  return (
    <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:12, color:'#8b949e', background:'#0d1117', position:'absolute', inset:0, justifyContent:'center' }}>
      <div style={{ fontSize:36 }}>🌐</div>
      <div style={{ fontSize:13 }}>Digite uma URL e pressione Go</div>
      <div style={{ display:'flex', gap:6, flexWrap:'wrap', justifyContent:'center' }}>
        {['http://localhost:3000', 'http://localhost:5173', 'http://localhost:8080'].map(u => (
          <button key={u} onClick={() => onNavigate(u)}
            style={{ background:'#161b22', border:'1px solid #30363d', borderRadius:4, color:'#58a6ff', cursor:'pointer', padding:'4px 10px', fontSize:12 }}>
            {u}
          </button>
        ))}
      </div>
    </div>
  );
}

const iconBtn: React.CSSProperties = {
  background:'none', border:'1px solid #30363d', borderRadius:4,
  color:'#8b949e', cursor:'pointer', padding:'2px 7px', fontSize:13,
  display:'flex', alignItems:'center', justifyContent:'center',
  minWidth:28, height:26,
};

const inputStyle: React.CSSProperties = {
  background:'#0d1117', border:'1px solid #30363d', borderRadius:4,
  color:'#e6edf3', fontSize:11, padding:'3px 5px', outline:'none',
  fontFamily:'monospace', textAlign:'center' as const,
};
