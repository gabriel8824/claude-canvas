import { useState, useEffect, useRef } from 'react';

interface RateWindow {
  utilization: number; // 0–100
  resetsAt: string | null;
}

interface ClaudeLimits {
  available: boolean;
  fiveHour?: RateWindow;
  sevenDay?: RateWindow;
  sevenDayOpus?: RateWindow | null;
  accountEmail?: string | null;
}

interface UsagePeriod {
  costUSD: number;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
}

interface DayModel {
  model: string;
  costUSD: number;
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheWriteTokens: number;
    cacheReadTokens: number;
  };
}

interface DaySummary {
  date: string;
  costUSD: number;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
  models: DayModel[];
}

interface UsageData {
  today: UsagePeriod;
  week: UsagePeriod;
  month: UsagePeriod;
  all: UsagePeriod;
  daily: DaySummary[];
}

function fmt$(n: number): string {
  if (n === 0) return '$0.00';
  if (n < 0.01) return '<$0.01';
  return `$${n.toFixed(2)}`;
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

function shortModel(m: string): string {
  return m
    .replace('claude-', '')
    .replace(/-\d{8,}$/, '') // strip date suffix
    .replace(/-4-(\d+)/, ' 4.$1'); // e.g. "sonnet 4.6"
}

// Compact meter shown inline in the toolbar
// showFree=true → bar and number show remaining; false → show consumed
function ToolbarMeter({ label, pct, color, showFree }: { label: string; pct: number; color: string; showFree: boolean }) {
  const remaining = Math.max(0, 100 - pct);
  const displayPct = showFree ? remaining : pct;
  const barPct    = showFree ? remaining : pct;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
      <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.28)', width: 10, lineHeight: 1, textAlign: 'right', flexShrink: 0 }}>
        {label}
      </span>
      <div style={{ width: 48, height: 5, background: 'rgba(255,255,255,0.06)', borderRadius: 3, overflow: 'hidden', flexShrink: 0 }}>
        <div style={{ height: '100%', borderRadius: 3, width: `${barPct}%`, background: color, transition: 'width 0.5s' }} />
      </div>
      <span style={{ fontSize: 11, fontWeight: 600, color, fontFamily: 'monospace', lineHeight: 1, minWidth: 30 }}>
        {displayPct.toFixed(0)}%
      </span>
    </div>
  );
}

function Bar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div style={{ background: 'rgba(255,255,255,0.07)', borderRadius: 3, height: 4, overflow: 'hidden', flex: 1 }}>
      <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 3, transition: 'width 0.4s' }} />
    </div>
  );
}

export function ClaudeUsageBadge() {
  const [data, setData] = useState<UsageData | null>(null);
  const [limits, setLimits] = useState<ClaudeLimits | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'overview' | 'daily'>('overview');
  const [showFree, setShowFree] = useState(true); // true = quanto falta livre, false = consumo
  const dropRef = useRef<HTMLDivElement>(null);

  async function load() {
    setLoading(true);
    try {
      const [usageRes, limitsRes] = await Promise.all([
        fetch('/api/claude/usage'),
        fetch('/api/claude/limits'),
      ]);
      if (usageRes.ok) setData(await usageRes.json());
      if (limitsRes.ok) setLimits(await limitsRes.json());
    } catch {}
    setLoading(false);
  }

  useEffect(() => {
    load();
    const iv = setInterval(load, 60_000);
    return () => clearInterval(iv);
  }, []);

  useEffect(() => {
    if (!open) return;
    function outside(e: MouseEvent) {
      if (dropRef.current && !dropRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', outside);
    return () => document.removeEventListener('mousedown', outside);
  }, [open]);

  const fiveHourPct = limits?.available ? (limits.fiveHour?.utilization ?? 0) : null;
  const sevenDayPct = limits?.available ? (limits.sevenDay?.utilization ?? 0) : null;

  function limitColor(pct: number) {
    if (pct >= 90) return 'rgba(248,113,113,0.9)';
    if (pct >= 70) return 'rgba(251,191,36,0.9)';
    return 'rgba(96,200,150,0.9)';
  }

  // If no limits data yet, show loading dot or nothing
  const hasLimits = fiveHourPct !== null;

  return (
    <div ref={dropRef} style={{ position: 'relative' }}>
      <button
        onClick={() => { setOpen(v => !v); if (!data && !limits) load(); }}
        title="Uso do Claude — clique para detalhes"
        style={{
          display: 'flex', alignItems: 'center', gap: 6,
          background: open ? 'rgba(96,165,250,0.12)' : 'transparent',
          border: `1px solid ${open ? 'rgba(96,165,250,0.3)' : 'transparent'}`,
          borderRadius: 10, cursor: 'pointer', padding: '4px 8px',
          fontSize: 11, transition: 'all 0.15s', whiteSpace: 'nowrap',
        }}
        onMouseEnter={e => {
          if (open) return;
          (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.06)';
          (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(255,255,255,0.1)';
        }}
        onMouseLeave={e => {
          if (open) return;
          (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
          (e.currentTarget as HTMLButtonElement).style.borderColor = 'transparent';
        }}
      >
        {hasLimits ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <ToolbarMeter label="5h" pct={fiveHourPct!} color={limitColor(fiveHourPct!)} showFree={showFree} />
            {sevenDayPct !== null && (
              <ToolbarMeter label="7d" pct={sevenDayPct} color={limitColor(sevenDayPct)} showFree={showFree} />
            )}
          </div>
        ) : (
          <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', fontFamily: 'monospace' }}>
            {loading ? '…' : '⬡ uso'}
          </span>
        )}
      </button>

      {open && (
        <div style={{
          position: 'absolute',
          top: 'calc(100% + 8px)',
          right: 0,
          width: 320,
          background: 'rgba(10,14,30,0.97)',
          border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: 14,
          boxShadow: '0 20px 60px rgba(0,0,0,0.85), inset 0 1px 0 rgba(255,255,255,0.06)',
          backdropFilter: 'blur(24px)',
          WebkitBackdropFilter: 'blur(24px)',
          zIndex: 10001,
          overflow: 'hidden',
        }}>
          {/* Header */}
          <div style={{ padding: '14px 16px 10px', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <span style={{ fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.85)', letterSpacing: '-0.01em' }}>
                  Claude Code Usage
                </span>
                {limits?.accountEmail && (
                  <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', marginTop: 1 }}>
                    {limits.accountEmail}
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                {/* Toggle: livre ↔ consumo */}
                <div style={{
                  display: 'flex', background: 'rgba(255,255,255,0.05)',
                  border: '1px solid rgba(255,255,255,0.1)', borderRadius: 7, overflow: 'hidden',
                }}>
                  {([true, false] as const).map(isFree => (
                    <button
                      key={String(isFree)}
                      onClick={() => setShowFree(isFree)}
                      title={isFree ? 'Mostrar quanto falta livre' : 'Mostrar consumo'}
                      style={{
                        background: showFree === isFree ? 'rgba(96,165,250,0.2)' : 'transparent',
                        border: 'none', cursor: 'pointer',
                        color: showFree === isFree ? 'rgba(147,210,255,0.9)' : 'rgba(255,255,255,0.35)',
                        fontSize: 10, padding: '3px 8px', transition: 'all 0.12s',
                        fontWeight: showFree === isFree ? 600 : 400,
                      }}
                    >
                      {isFree ? 'livre' : 'uso'}
                    </button>
                  ))}
                </div>
                <button
                  onClick={load}
                  title="Refresh"
                  style={{
                    background: 'none', border: 'none', cursor: 'pointer',
                    color: 'rgba(255,255,255,0.3)', fontSize: 11, padding: '2px 4px',
                    borderRadius: 5, transition: 'color 0.15s',
                  }}
                  onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = 'rgba(255,255,255,0.7)'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = 'rgba(255,255,255,0.3)'; }}
                >
                  ↻
                </button>
              </div>
            </div>

            {/* Session limit cards */}
            {limits?.available && (
              <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
                <FreeCard
                  label="Sessão 5h"
                  pct={limits.fiveHour?.utilization ?? 0}
                  resetsAt={limits.fiveHour?.resetsAt ?? null}
                  showFree={showFree}
                />
                <FreeCard
                  label="Semana 7d"
                  pct={limits.sevenDay?.utilization ?? 0}
                  resetsAt={limits.sevenDay?.resetsAt ?? null}
                  showFree={showFree}
                />
                {limits.sevenDayOpus && (
                  <FreeCard
                    label="Opus 7d"
                    pct={limits.sevenDayOpus.utilization}
                    resetsAt={limits.sevenDayOpus.resetsAt}
                    showFree={showFree}
                  />
                )}
              </div>
            )}
            {limits && !limits.available && (
              <div style={{ marginTop: 8, fontSize: 10, color: 'rgba(255,255,255,0.2)' }}>
                Limites indisponíveis (macOS + Claude app necessários)
              </div>
            )}
            {/* Tabs */}
            <div style={{ display: 'flex', gap: 4, marginTop: 10 }}>
              {(['overview', 'daily'] as const).map(t => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  style={{
                    background: tab === t ? 'rgba(96,165,250,0.18)' : 'transparent',
                    border: `1px solid ${tab === t ? 'rgba(96,165,250,0.3)' : 'rgba(255,255,255,0.07)'}`,
                    borderRadius: 7, padding: '3px 10px', cursor: 'pointer',
                    fontSize: 11, color: tab === t ? 'rgba(147,210,255,0.9)' : 'rgba(255,255,255,0.4)',
                    transition: 'all 0.12s',
                  }}
                >
                  {t === 'overview' ? 'Overview' : 'Daily'}
                </button>
              ))}
            </div>
          </div>

          {!data ? (
            <div style={{ padding: 24, textAlign: 'center', color: 'rgba(255,255,255,0.3)', fontSize: 12 }}>
              {loading ? 'Carregando…' : 'Sem dados'}
            </div>
          ) : tab === 'overview' ? (
            <OverviewTab data={data} />
          ) : (
            <DailyTab daily={data.daily} />
          )}
        </div>
      )}
    </div>
  );
}

// Prominent card — hero number switches between "livre" and "uso" based on showFree
function FreeCard({ label, pct, resetsAt, showFree }: {
  label: string; pct: number; resetsAt: string | null; showFree: boolean;
}) {
  const remaining = Math.max(0, 100 - pct);
  const heroPct  = showFree ? remaining : pct;
  const heroLabel = showFree ? 'livre' : 'usado';
  const color = pct >= 90 ? 'rgba(248,113,113,0.9)' : pct >= 70 ? 'rgba(251,191,36,0.9)' : 'rgba(96,200,150,0.9)';
  const bgColor = pct >= 90 ? 'rgba(248,113,113,0.08)' : pct >= 70 ? 'rgba(251,191,36,0.06)' : 'rgba(96,200,150,0.06)';
  const borderColor = pct >= 90 ? 'rgba(248,113,113,0.25)' : pct >= 70 ? 'rgba(251,191,36,0.2)' : 'rgba(96,200,150,0.18)';

  let resetLabel = '';
  if (resetsAt) {
    const diff = new Date(resetsAt).getTime() - Date.now();
    if (diff > 0) {
      const h = Math.floor(diff / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      resetLabel = h > 0 ? `${h}h${m > 0 ? ` ${m}m` : ''}` : `${m}m`;
    }
  }

  return (
    <div style={{
      flex: 1, background: bgColor, border: `1px solid ${borderColor}`,
      borderRadius: 10, padding: '10px 12px',
      display: 'flex', flexDirection: 'column', gap: 6,
    }}>
      <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', fontWeight: 500 }}>{label}</span>

      {/* Hero number */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 3 }}>
        <span style={{ fontSize: 26, fontWeight: 700, color, fontFamily: 'monospace', lineHeight: 1 }}>
          {heroPct.toFixed(0)}
        </span>
        <span style={{ fontSize: 13, color, fontWeight: 600, opacity: 0.8 }}>%</span>
        <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', marginLeft: 2 }}>{heroLabel}</span>
      </div>

      {/* Track — always shows remaining as the filled portion */}
      <div style={{ height: 4, background: 'rgba(255,255,255,0.07)', borderRadius: 2, overflow: 'hidden' }}>
        <div style={{
          height: '100%', borderRadius: 2,
          width: `${showFree ? remaining : pct}%`,
          background: color, transition: 'width 0.5s',
        }} />
      </div>

      {/* Footer */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.25)', fontFamily: 'monospace' }}>
          {showFree ? `${pct.toFixed(0)}% usado` : `${remaining.toFixed(0)}% livre`}
        </span>
        {resetLabel && (
          <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.2)', fontFamily: 'monospace' }}>
            ↺ {resetLabel}
          </span>
        )}
      </div>
    </div>
  );
}

function PeriodRow({ label, period, maxCost }: { label: string; period: UsagePeriod; maxCost: number }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)' }}>{label}</span>
        <div style={{ display: 'flex', gap: 10, alignItems: 'baseline' }}>
          <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.25)', fontFamily: 'monospace' }}>
            {fmtTokens(period.totalTokens)} tok
          </span>
          <span style={{ fontSize: 13, fontWeight: 600, color: period.costUSD > 0 ? 'rgba(96,200,150,0.95)' : 'rgba(255,255,255,0.3)', fontFamily: 'monospace' }}>
            {fmt$(period.costUSD)}
          </span>
        </div>
      </div>
      <Bar value={period.costUSD} max={maxCost} color="rgba(96,165,250,0.7)" />
    </div>
  );
}

function OverviewTab({ data }: { data: UsageData }) {
  const maxCost = Math.max(data.today.costUSD, data.week.costUSD, data.month.costUSD, 0.01);

  // Aggregate models across all data
  const modelMap = new Map<string, { cost: number; tokens: number }>();
  for (const day of data.daily) {
    for (const m of day.models) {
      const existing = modelMap.get(m.model) ?? { cost: 0, tokens: 0 };
      modelMap.set(m.model, {
        cost: existing.cost + m.costUSD,
        tokens: existing.tokens + m.usage.inputTokens + m.usage.outputTokens,
      });
    }
  }
  const models = [...modelMap.entries()]
    .sort((a, b) => b[1].cost - a[1].cost)
    .slice(0, 5);

  return (
    <div style={{ padding: '14px 16px' }}>
      {/* Period rows */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 16 }}>
        <PeriodRow label="Hoje" period={data.today} maxCost={maxCost} />
        <PeriodRow label="7 dias" period={data.week} maxCost={maxCost} />
        <PeriodRow label="30 dias" period={data.month} maxCost={maxCost} />
        <PeriodRow label="Total" period={data.all} maxCost={maxCost} />
      </div>

      {/* Token breakdown for today */}
      {data.today.totalTokens > 0 && (
        <>
          <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 12, marginBottom: 12 }}>
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Hoje — breakdown de tokens
            </div>
            <TokenBreakdown period={data.today} />
          </div>
        </>
      )}

      {/* Top models */}
      {models.length > 0 && (
        <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 12 }}>
          <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Modelos (30 dias)
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            {models.map(([model, stat]) => (
              <div key={model} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.55)', fontFamily: 'monospace' }}>
                  {shortModel(model)}
                </span>
                <div style={{ display: 'flex', gap: 10 }}>
                  <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.2)', fontFamily: 'monospace' }}>
                    {fmtTokens(stat.tokens)}
                  </span>
                  <span style={{ fontSize: 11, color: 'rgba(96,200,150,0.8)', fontFamily: 'monospace' }}>
                    {fmt$(stat.cost)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function TokenBreakdown({ period }: { period: UsagePeriod }) {
  const rows = [
    { label: 'Input',        value: period.inputTokens,      color: 'rgba(96,165,250,0.7)' },
    { label: 'Output',       value: period.outputTokens,     color: 'rgba(167,139,250,0.7)' },
    { label: 'Cache write',  value: period.cacheWriteTokens, color: 'rgba(251,191,36,0.6)' },
    { label: 'Cache read',   value: period.cacheReadTokens,  color: 'rgba(52,211,153,0.6)' },
  ].filter(r => r.value > 0);
  const total = rows.reduce((s, r) => s + r.value, 0);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {rows.map(r => (
        <div key={r.label} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', width: 70, flexShrink: 0 }}>{r.label}</span>
          <Bar value={r.value} max={total} color={r.color} />
          <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', fontFamily: 'monospace', width: 36, textAlign: 'right', flexShrink: 0 }}>
            {fmtTokens(r.value)}
          </span>
        </div>
      ))}
    </div>
  );
}

function DailyTab({ daily }: { daily: DaySummary[] }) {
  if (daily.length === 0) {
    return <div style={{ padding: 24, textAlign: 'center', color: 'rgba(255,255,255,0.3)', fontSize: 12 }}>Sem dados</div>;
  }
  const maxCost = Math.max(...daily.map(d => d.costUSD), 0.01);
  return (
    <div style={{ maxHeight: 320, overflowY: 'auto', padding: '8px 16px 14px' }}>
      {daily.map(day => (
        <div key={day.date} style={{ paddingBottom: 12, marginBottom: 12, borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
            <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.55)', fontFamily: 'monospace' }}>
              {day.date}
            </span>
            <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
              <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.2)', fontFamily: 'monospace' }}>
                {fmtTokens(day.totalTokens)}
              </span>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'rgba(96,200,150,0.9)', fontFamily: 'monospace' }}>
                {fmt$(day.costUSD)}
              </span>
            </div>
          </div>
          <Bar value={day.costUSD} max={maxCost} color="rgba(96,165,250,0.55)" />
          {day.models.length > 0 && (
            <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: '3px 8px' }}>
              {day.models.slice(0, 4).map(m => (
                <span key={m.model} style={{ fontSize: 9, color: 'rgba(255,255,255,0.25)', fontFamily: 'monospace' }}>
                  {shortModel(m.model)} {fmt$(m.costUSD)}
                </span>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
