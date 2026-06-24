"use client";

import { ChevronLeft } from "lucide-react";
import type { OverviewCard } from "../content";

export function ProjectShowcaseView({ card, onBack }: { card: OverviewCard; onBack: () => void }) {
  return (
    <div className="w-full h-full flex flex-col" style={{ background: "#d4d4d4", padding: 48, gap: 24 }}>

      {/* Main Content Area */}
      <div className="flex-1 bg-[#dcdcdc] rounded-xl flex flex-col p-10" style={{ minHeight: 0 }}>
        <div className="flex items-center gap-4 mb-10">
          <button
            onClick={onBack}
            className="flex items-center justify-center p-2 rounded-full hover:bg-[#c0c0c0] transition-colors cursor-pointer text-[#555]"
            title="Go back"
          >
            <ChevronLeft size={32} />
          </button>
          <h1 className="text-3xl font-bold text-[#222]">{card.title}</h1>
        </div>

        <div className="flex-1 flex gap-12 min-h-0">
          {/* Left Column - Build */}
          <div className="flex-1 flex flex-col min-h-0">
            <h2 className="text-2xl font-medium text-center text-[#222] mb-8">Build</h2>
            <div className="flex flex-col gap-4">
              {/* Row 1 */}
              <div className="flex gap-4 h-12">
                <div className="bg-[#888] rounded-md flex-[2]"></div>
                <div className="bg-[#888] rounded-md flex-[3]"></div>
                <div className="bg-[#888] rounded-md flex-[2]"></div>
              </div>
              {/* Row 2 */}
              <div className="flex gap-4 h-16">
                <div className="bg-[#888] rounded-md flex-[3]"></div>
                <div className="bg-[#888] rounded-md flex-[4]"></div>
                <div className="bg-[#888] rounded-md flex-[2]"></div>
              </div>
              {/* Row 3 */}
              <div className="flex gap-4 h-28">
                <div className="bg-[#888] rounded-md flex-[1]"></div>
                <div className="bg-[#888] rounded-md flex-[2]"></div>
                <div className="bg-[#888] rounded-md flex-[2]"></div>
              </div>
              {/* Row 4 */}
              <div className="flex gap-4 h-12">
                <div className="bg-[#888] rounded-md flex-[2]"></div>
                <div className="bg-[#888] rounded-md flex-[4]"></div>
                <div className="bg-[#888] rounded-md flex-[2]"></div>
              </div>
              {/* Row 5 */}
              <div className="flex gap-4 h-16">
                <div className="bg-[#888] rounded-md flex-[2]"></div>
                <div className="bg-[#888] rounded-md flex-[5]"></div>
                <div className="bg-[#888] rounded-md flex-[3]"></div>
              </div>
              {/* Row 6 */}
              <div className="flex gap-4 h-24">
                <div className="bg-[#888] rounded-md flex-[2]"></div>
                <div className="bg-[#888] rounded-md flex-[4]"></div>
                <div className="bg-[#888] rounded-md flex-[3]"></div>
              </div>
            </div>
          </div>

          {/* Vertical Divider */}
          <div className="w-px bg-[#a0a0a0]"></div>

          {/* Right Column - Technology */}
          <div className="flex-1 flex flex-col min-h-0">
            <h2 className="text-2xl font-medium text-center text-[#222] mb-8">Technology</h2>
            <div className="flex flex-col gap-4">
              {/* Row 1 */}
              <div className="flex gap-4 h-24">
                <div className="bg-[#888] rounded-md flex-[3]"></div>
                <div className="bg-[#888] rounded-md flex-[3]"></div>
                <div className="bg-[#888] rounded-md flex-[1]"></div>
              </div>
              {/* Row 2 */}
              <div className="flex gap-4 h-20">
                <div className="bg-[#888] rounded-md flex-[2]"></div>
                <div className="bg-[#888] rounded-md flex-[2]"></div>
                <div className="flex flex-col gap-4 flex-[2]">
                  <div className="bg-[#888] rounded-md flex-1"></div>
                  <div className="bg-[#888] rounded-md flex-1"></div>
                </div>
              </div>
              {/* Row 3 */}
              <div className="flex gap-4 h-24">
                <div className="bg-[#888] rounded-md flex-[3]"></div>
                <div className="bg-[#888] rounded-md flex-[4]"></div>
                <div className="bg-[#888] rounded-md flex-[1]"></div>
              </div>
              {/* Row 4 */}
              <div className="flex gap-4 h-20">
                <div className="bg-[#888] rounded-md flex-[3]"></div>
                <div className="bg-[#888] rounded-md flex-[3]"></div>
                <div className="bg-[#888] rounded-md flex-[2]"></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
