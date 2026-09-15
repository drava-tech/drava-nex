import React from "react";
import { Radio } from "lucide-react";
import { Button } from "@platform/ui";
import type { IrRemoteConfig } from "@/lib/ir-devices";

/**
 * Generic IR remote surface shown in the environment "Remotes" overlay. Each
 * configured non-AC remote (TV, soundbar, …) renders as a button grid; pressing
 * a key fires the codebook command through the CrabController bridge. Driven by
 * IR_REMOTES in lib/ir-devices.ts + the `remotes:` config on the bridge side.
 */
export default function IrRemotesContent({
  remotes,
  onKey,
}: {
  remotes: IrRemoteConfig[];
  onKey: (deviceUuid: string, key: string) => void;
}) {
  return (
    <div className="flex flex-col gap-6 text-card-foreground">
      <div className="flex items-center gap-2">
        <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center text-primary shrink-0">
          <Radio className="w-4.5 h-4.5" />
        </div>
        <div>
          <h2 className="text-xl font-black tracking-tight">IR Remotes</h2>
          <p className="text-xs text-muted-foreground font-medium">Codebook remotes via the IR bridge</p>
        </div>
      </div>

      {remotes.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No IR remotes configured. Add them to <code className="font-mono text-xs">IR_REMOTES</code> in{" "}
          <code className="font-mono text-xs">lib/ir-devices.ts</code>.
        </p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {remotes.map((remote) => (
            <div key={remote.deviceId} className="rounded-2xl border bg-card p-4 shadow-sm">
              <h3 className="font-bold tracking-tight mb-3">{remote.label}</h3>
              <div className="grid grid-cols-3 gap-2">
                {remote.keys.map((key) => (
                  <Button
                    key={key}
                    variant="outline"
                    className="rounded-xl font-semibold text-xs h-11"
                    onClick={() => onKey(remote.uuid, key)}
                  >
                    {key}
                  </Button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
