"use client";

import React, { useState } from "react";
import { Eye, Sparkles, MessageSquare } from "lucide-react";

export function WelcomeView() {
  const [welcomeTitle, setWelcomeTitle] = useState("Explore The Future");
  const [welcomeSubtitle, setWelcomeSubtitle] = useState("Touch screen or gesture to begin your interactive experience");
  const [ctaText, setCtaText] = useState("Tap to Start");
  const [language, setLanguage] = useState("English");

  return (
    <div className="w-full space-y-6">
      <div className="flex items-center justify-between border-b pb-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-white">Welcome Screen Manager</h2>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">Customize the initial splash screen that visitors see when idle.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Editor Form */}
        <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-6 shadow-sm space-y-5">
          <h3 className="text-base font-semibold text-zinc-900 dark:text-white flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-amber-500" /> Content Editor
          </h3>

          <div className="space-y-4">
            {/* Title */}
            <div className="space-y-1">
              <label className="text-xs font-semibold text-zinc-600 dark:text-zinc-400 uppercase tracking-wider">Main Heading</label>
              <input
                type="text"
                value={welcomeTitle}
                onChange={(e) => setWelcomeTitle(e.target.value)}
                className="w-full px-3 py-2 border border-zinc-200 dark:border-zinc-800 rounded-lg text-sm bg-transparent text-zinc-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-black dark:focus:ring-white"
              />
            </div>

            {/* Subtitle */}
            <div className="space-y-1">
              <label className="text-xs font-semibold text-zinc-600 dark:text-zinc-400 uppercase tracking-wider">Instruction Subtitle</label>
              <textarea
                value={welcomeSubtitle}
                onChange={(e) => setWelcomeSubtitle(e.target.value)}
                rows={3}
                className="w-full px-3 py-2 border border-zinc-200 dark:border-zinc-800 rounded-lg text-sm bg-transparent text-zinc-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-black dark:focus:ring-white resize-none"
              />
            </div>

            {/* CTA */}
            <div className="space-y-1">
              <label className="text-xs font-semibold text-zinc-600 dark:text-zinc-400 uppercase tracking-wider">Call to Action (CTA)</label>
              <input
                type="text"
                value={ctaText}
                onChange={(e) => setCtaText(e.target.value)}
                className="w-full px-3 py-2 border border-zinc-200 dark:border-zinc-800 rounded-lg text-sm bg-transparent text-zinc-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-black dark:focus:ring-white"
              />
            </div>

            {/* Language Selection */}
            <div className="space-y-1">
              <label className="text-xs font-semibold text-zinc-600 dark:text-zinc-400 uppercase tracking-wider">Primary Language</label>
              <div className="flex gap-2">
                {["English", "Hindi", "Kannada", "Multi"].map((lang) => (
                  <button
                    key={lang}
                    onClick={() => setLanguage(lang)}
                    className={`px-3 py-1.5 border rounded-lg text-xs font-medium transition-all ${
                      language === lang
                        ? "border-black bg-zinc-50 dark:border-white dark:bg-zinc-800 text-zinc-900 dark:text-white"
                        : "border-zinc-200 dark:border-zinc-800 text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-300"
                    }`}
                  >
                    {lang}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Live Preview */}
        <div className="bg-[#121212] rounded-xl p-8 border border-zinc-800 flex flex-col justify-between items-center text-center relative overflow-hidden h-[380px] lg:h-[420px] shadow-2xl">
          {/* Subtle design elements */}
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.03),transparent_70%)] pointer-events-none" />
          <div className="absolute top-4 left-4 flex items-center gap-1.5 text-[10px] text-zinc-500 font-mono tracking-widest uppercase">
            <Eye className="h-3.5 w-3.5" /> LIVE DISPLAY PREVIEW
          </div>

          <div className="mt-12 space-y-4 max-w-sm relative z-10">
            <h1 className="text-3xl lg:text-4xl font-light tracking-tight text-white">{welcomeTitle}</h1>
            <p className="text-xs text-zinc-400 font-normal leading-relaxed">{welcomeSubtitle}</p>
          </div>

          <div className="mb-4 relative z-10 flex flex-col items-center gap-3">
            <button className="px-6 py-3 bg-white text-black text-sm font-semibold rounded-full hover:scale-105 active:scale-95 transition-all duration-300 shadow-md">
              {ctaText}
            </button>
            <span className="text-[10px] text-zinc-500 font-medium tracking-wide uppercase flex items-center gap-1">
              <MessageSquare className="h-3 w-3" /> Language: {language}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
