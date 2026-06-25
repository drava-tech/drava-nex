import React from "react";
import { Film, Layers, Radio, Slash } from "lucide-react";
import { StatusBadge } from "@platform/ui";
import {
  screens,
  type ContentKind,
} from "@/app/(dashboard)/_data/dashboard-demo";

const kindMeta: Record<ContentKind, { icon: typeof Layers; label: string }> = {
  portfolio: { icon: Layers, label: "Portfolio" },
  "live-stream": { icon: Radio, label: "Live" },
  media: { icon: Film, label: "Media" },
  none: { icon: Slash, label: "—" },
};

export function ScreensTable() {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-xs text-muted-foreground">
            <th className="px-4 py-2.5 font-medium">Screen</th>
            <th className="px-4 py-2.5 font-medium">Status</th>
            <th className="px-4 py-2.5 font-medium">Now playing</th>
            <th className="px-4 py-2.5 text-right font-medium">Last seen</th>
          </tr>
        </thead>
        <tbody>
          {screens.map((screen) => {
            const Kind = kindMeta[screen.contentKind].icon;
            return (
              <tr
                key={screen.id}
                className="border-b last:border-0 transition-colors hover:bg-muted/40"
              >
                <td className="px-4 py-3">
                  <div className="font-medium text-foreground">{screen.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {screen.location}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <StatusBadge status={screen.status} />
                </td>
                <td className="px-4 py-3">
                  <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                    <Kind className="h-3.5 w-3.5 shrink-0" />
                    <span className="text-foreground">{screen.content}</span>
                  </span>
                </td>
                <td className="px-4 py-3 text-right text-xs text-muted-foreground">
                  {screen.lastSeen}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
