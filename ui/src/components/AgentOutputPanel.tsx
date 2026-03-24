import { useEffect, useRef, useState } from "react";
import { Terminal, ChevronDown, ChevronUp } from "lucide-react";
import type { ActiveProcess } from "@/api/client.ts";

interface AgentOutputPanelProps {
  processes: ActiveProcess[];
  output: string;
}

function ElapsedTimer({ startedAt }: { startedAt: string }) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const start = new Date(startedAt).getTime();
    const tick = () => setElapsed(Math.floor((Date.now() - start) / 1000));
    tick();
    const interval = setInterval(tick, 1_000);
    return () => clearInterval(interval);
  }, [startedAt]);

  const mins = Math.floor(elapsed / 60);
  const secs = elapsed % 60;
  return (
    <span className="font-mono text-xs tabular-nums">
      {mins > 0 ? `${mins}m ${secs}s` : `${secs}s`}
    </span>
  );
}

export function AgentOutputPanel({ processes, output }: AgentOutputPanelProps) {
  const [collapsed, setCollapsed] = useState(false);
  const scrollRef = useRef<HTMLPreElement>(null);
  const isActiveRef = useRef(false);

  const proc = processes[0];
  const isActive = !!proc;

  useEffect(() => {
    if (isActive && !isActiveRef.current) {
      setCollapsed(false);
    }
    isActiveRef.current = isActive;
  }, [isActive]);

  useEffect(() => {
    if (scrollRef.current && !collapsed) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [output, collapsed]);

  if (!output && !isActive) return null;

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <button
        onClick={() => setCollapsed((c) => !c)}
        className="flex items-center justify-between w-full px-3 py-2 bg-[#1a1a2e] text-white/90 text-xs font-medium hover:bg-[#1a1a2e]/80 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Terminal size={13} className={isActive ? "text-amber-400" : "text-white/50"} />
          {proc ? (
            <>
              <span className="text-amber-400">{proc.runtime}</span>
              <span className="text-white/40">/</span>
              <span>{proc.stage}</span>
              <span className="text-white/40">--</span>
              <ElapsedTimer startedAt={proc.startedAt} />
              <span className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse" />
            </>
          ) : (
            <span className="text-white/50">Agent Output (completed)</span>
          )}
        </div>
        {collapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
      </button>

      {!collapsed && (
        <pre
          ref={scrollRef}
          className="bg-[#0d0d1a] text-[#c8c8d0] text-[11px] leading-[1.6] font-mono p-3 overflow-auto max-h-[320px] min-h-[80px] whitespace-pre-wrap break-words"
        >
          {output || "Waiting for output..."}
        </pre>
      )}
    </div>
  );
}
