import { useState, useEffect, useCallback, useRef } from "react";
import { api, type ActiveProcess } from "@/api/client.ts";
import { useSSE, type DashboardEvent } from "./useSSE.ts";

interface UseActiveProcessesResult {
  processes: ActiveProcess[];
  hasActive: boolean;
  output: string;
  activeProcessId: string | null;
}

export function useActiveProcesses(runId: string): UseActiveProcessesResult {
  const [processes, setProcesses] = useState<ActiveProcess[]>([]);
  const [output, setOutput] = useState("");
  const outputRef = useRef("");

  useEffect(() => {
    let cancelled = false;
    async function init() {
      try {
        const result = await api.getActiveProcesses(runId);
        if (cancelled) return;
        setProcesses(result.processes);
        if (result.processes.length > 0) {
          const proc = result.processes[0]!;
          try {
            const outputResult = await api.getProcessOutput(proc.id);
            if (cancelled) return;
            outputRef.current = outputResult.output;
            setOutput(outputResult.output);
          } catch {
            // process may have just ended
          }
        }
      } catch {
        // server may be restarting
      }
    }
    void init();
    return () => { cancelled = true; };
  }, [runId]);

  const handleSSE = useCallback(
    (event: DashboardEvent) => {
      if (event.runId !== runId) return;

      if (event.type === "process:started") {
        setProcesses((prev) => {
          const entry: ActiveProcess = {
            id: (event.processId as string) ?? "",
            pid: 0,
            command: (event.command as string) ?? "",
            runId: event.runId,
            stage: (event.stage as string) ?? "",
            runtime: (event.runtime as string) ?? "",
            startedAt: (event.timestamp as string) ?? new Date().toISOString(),
            elapsedMs: 0,
          };
          return [...prev, entry];
        });
        outputRef.current = "";
        setOutput("");
      }

      if (event.type === "process:completed") {
        setProcesses((prev) => prev.filter((p) => p.id !== event.processId));
      }

      if (event.type === "process:output" && event.chunk) {
        outputRef.current += event.chunk;
        if (outputRef.current.length > 8192) {
          outputRef.current = outputRef.current.slice(-8192);
        }
        setOutput(outputRef.current);
      }
    },
    [runId],
  );

  useSSE(handleSSE);

  const activeProcessId = processes.length > 0 ? processes[0]!.id : null;

  return {
    processes,
    hasActive: processes.length > 0,
    output,
    activeProcessId,
  };
}
