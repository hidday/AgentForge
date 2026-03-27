import { useEffect, useRef, useState, useMemo } from "react";
import { Terminal, ChevronDown, ChevronUp, Wrench, AlertTriangle, MessageSquare, ChevronRight } from "lucide-react";
import type { ActiveProcess } from "@/api/client.ts";
import { parseClaudeOutput, type ParsedBlock } from "@/lib/parseClaudeOutput.ts";

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

function BlockRenderer({ block }: { block: ParsedBlock }) {
  const [expanded, setExpanded] = useState(true);

  if (block.type === "text") {
    return (
      <div className="flex gap-2 py-1.5">
        <MessageSquare size={12} className="text-blue-400 mt-0.5 shrink-0" />
        <span className="whitespace-pre-wrap break-words">{block.content}</span>
      </div>
    );
  }

  if (block.type === "tool_use") {
    return (
      <div className="py-1.5 border-l-2 border-amber-500/40 pl-2.5 my-1">
        <button
          onClick={() => setExpanded((e) => !e)}
          className="flex items-center gap-1.5 text-amber-400 text-[11px] font-medium hover:text-amber-300 transition-colors"
        >
          <Wrench size={11} className="shrink-0" />
          <span>{block.toolName}</span>
          <ChevronRight
            size={10}
            className={`transition-transform ${expanded ? "rotate-90" : ""}`}
          />
        </button>
        {expanded && block.content && (
          <pre className="text-white/50 text-[10px] mt-1 ml-4 whitespace-pre-wrap break-words max-h-[120px] overflow-auto">
            {block.content}
          </pre>
        )}
      </div>
    );
  }

  if (block.type === "tool_result") {
    const isErr = block.isError;
    return (
      <div
        className={`py-1.5 pl-2.5 my-1 border-l-2 ${
          isErr ? "border-red-500/50" : "border-emerald-500/40"
        }`}
      >
        {isErr && (
          <div className="flex items-center gap-1.5 text-red-400 text-[11px] font-medium mb-0.5">
            <AlertTriangle size={11} className="shrink-0" />
            <span>Error</span>
          </div>
        )}
        <pre
          className={`text-[10px] whitespace-pre-wrap break-words max-h-[200px] overflow-auto ml-0.5 ${
            isErr ? "text-red-300/80" : "text-emerald-300/70"
          }`}
        >
          {block.content}
        </pre>
      </div>
    );
  }

  if (block.type === "error") {
    return (
      <div className="flex items-start gap-2 py-1.5 text-red-400">
        <AlertTriangle size={12} className="mt-0.5 shrink-0" />
        <span className="whitespace-pre-wrap break-words">{block.content}</span>
      </div>
    );
  }

  return (
    <div className="py-0.5 text-white/40 whitespace-pre-wrap break-words">
      {block.content}
    </div>
  );
}

export function AgentOutputPanel({ processes, output }: AgentOutputPanelProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [showRaw, setShowRaw] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const isActiveRef = useRef(false);

  const proc = processes[0];
  const isActive = !!proc;

  const blocks = useMemo(() => parseClaudeOutput(output), [output]);
  const hasBlocks = blocks.length > 0;

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
        <div className="bg-[#0d0d1a]">
          <div className="flex justify-end px-3 pt-1.5">
            <button
              onClick={() => setShowRaw((r) => !r)}
              className="text-[10px] text-white/30 hover:text-white/60 transition-colors font-mono"
            >
              {showRaw ? "parsed" : "raw"}
            </button>
          </div>

          {showRaw ? (
            <pre
              ref={scrollRef as unknown as React.RefObject<HTMLPreElement>}
              className="text-[#c8c8d0] text-[11px] leading-[1.6] font-mono p-3 overflow-auto max-h-[320px] min-h-[80px] whitespace-pre-wrap break-words"
            >
              {output || "Waiting for output..."}
            </pre>
          ) : (
            <div
              ref={scrollRef}
              className="text-[#c8c8d0] text-[11px] leading-[1.6] font-mono p-3 overflow-auto max-h-[320px] min-h-[80px]"
            >
              {hasBlocks ? (
                blocks.map((block, i) => <BlockRenderer key={i} block={block} />)
              ) : (
                <span className="text-white/30">Waiting for output...</span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
