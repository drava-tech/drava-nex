import React from "react";
import {
  ArrowUpRight,
  BarChart3,
  Eye,
  Monitor,
  Sparkles,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";
import { requireGuestOrAdmin } from "@/lib/auth-helpers";
import {
  displays,
  recognitionMetrics,
  visitorFlow,
} from "@/app/(dashboard)/_data/dashboard-demo";
import { AreaChart } from "@/app/(dashboard)/_components/dashboard/area-chart";
import { PageHeader } from "@/app/(dashboard)/_components/page-header";

const CARD =
  "rounded-2xl border border-[#6d5bc4]/25 bg-[linear-gradient(160deg,#0d0a1f_0%,#12102a_100%)]";
const CARD_ACCENT =
  "rounded-2xl border border-[#8b6ff0]/80 bg-[linear-gradient(160deg,#120e2c_0%,#191537_100%)] shadow-[inset_0_0_24px_rgba(124,92,255,.18),0_0_20px_rgba(94,55,206,.22)]";

function StatTile({
  icon: Icon,
  label,
  value,
  sub,
  accent,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  sub: React.ReactNode;
  accent?: boolean;
}) {
  return (
    <div className={`${accent ? CARD_ACCENT : CARD} flex h-[124px] flex-col justify-between p-5`}>
      <div className="flex items-center gap-2 text-[#b9b3cc]">
        <Icon className="size-[13px] shrink-0" strokeWidth={1.7} />
        <span className="text-[11px] uppercase tracking-[0.16em]">{label}</span>
      </div>
      <div>
        <p className="text-[17px] text-white">{value}</p>
        <p className="mt-1.5 text-[13px] text-[#8f89a6]">{sub}</p>
      </div>
    </div>
  );
}

export default async function DashboardPage() {
  const user = await requireGuestOrAdmin();
  const firstName = user.name?.trim().split(/\s+/)[0] || "there";
  const liveCount = displays.filter((d) => d.live).length;

  return (
    <div className="flex flex-1 flex-col gap-4 bg-[#050310] p-6 font-['Satoshi',sans-serif]">
      <PageHeader title="Dashboard" greetingName={firstName} />

      {/* KPI row */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          icon={BarChart3}
          label="Centre Status"
          value="Online"
          sub="All systems nominal"
        />
        <StatTile
          icon={Monitor}
          label="Active Screens"
          value={String(liveCount)}
          sub={`${displays.length - liveCount} in standby mode`}
        />
        <StatTile
          icon={Eye}
          label="Today's Visitors"
          value="15"
          sub={
            <span className="inline-flex items-center gap-1 text-[#4ade80]">
              +12.4% <TrendingUp className="size-3" strokeWidth={2} />
            </span>
          }
        />
        <StatTile
          icon={Sparkles}
          label="AI Recognition"
          value="98.3%"
          sub="Active · calibrated"
          accent
        />
      </div>

      {/* Chart + side panels */}
      <div className="grid flex-1 gap-4 lg:grid-cols-3">
        <section className={`${CARD} flex flex-col p-5 lg:col-span-2`}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-[15px] text-white">Visitor Flow</h2>
              <p className="mt-1 text-[13px] text-[#8f89a6]">
                Hourly footfall · today
              </p>
            </div>
            <div className="flex items-center gap-3">
              <span className="rounded-full border border-[#6d5bc4]/70 bg-[#241c46] px-3 py-1 text-[11px] text-[#cfc6ff]">
                Today
              </span>
              <ArrowUpRight className="size-4 text-[#8f89a6]" strokeWidth={1.7} />
            </div>
          </div>
          <div className="mt-auto pt-6">
            <AreaChart data={visitorFlow} unit="visitors" />
          </div>
        </section>

        <div className="flex flex-col gap-4">
          <section className={`${CARD_ACCENT} p-5`}>
            <h2 className="flex items-center gap-2 text-[15px] text-white">
              <Sparkles className="size-4 text-[#b9a4ff]" strokeWidth={1.7} />
              AI Recognition
            </h2>
            <div className="mt-4 space-y-3.5">
              {recognitionMetrics.map((metric) => (
                <div key={metric.label}>
                  <div className="flex items-baseline justify-between">
                    <span className="text-[12px] text-[#cfc6ff]">{metric.label}</span>
                    <span className="text-[11px] tabular-nums text-[#8f89a6]">
                      {metric.value}%
                    </span>
                  </div>
                  <div className="mt-1.5 h-[3px] overflow-hidden rounded-full bg-white/10">
                    <div
                      className="h-full rounded-full bg-[linear-gradient(90deg,#7b5bff,#c9b8ff)] shadow-[0_0_8px_rgba(155,124,255,.6)]"
                      style={{ width: `${metric.value}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className={`${CARD} flex flex-1 flex-col p-5`}>
            <div className="flex items-center justify-between">
              <h2 className="text-[15px] text-white">Displays</h2>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-[#4ade80]/40 bg-[#4ade80]/10 px-2.5 py-0.5 text-[11px] text-[#4ade80]">
                <span className="size-1.5 rounded-full bg-[#4ade80]" />
                {liveCount} Live
              </span>
            </div>
            <ul className="mt-3 space-y-2">
              {displays.map((display) => (
                <li
                  key={display.name}
                  className="flex items-center gap-3 rounded-full border border-white/[0.07] bg-[#16122e] px-4 py-2"
                >
                  <span
                    className={`size-1.5 shrink-0 rounded-full ${
                      display.live ? "bg-[#4ade80]" : "bg-[#ef4444]"
                    }`}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12px] text-white">{display.name}</p>
                    <p className="truncate text-[11px] text-[#8f89a6]">
                      {display.content}
                    </p>
                  </div>
                  <span className="text-[12px] tabular-nums text-[#b3adc4]">
                    {display.time}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}
