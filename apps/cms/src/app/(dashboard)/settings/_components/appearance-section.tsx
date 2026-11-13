"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { Moon, Sun } from "lucide-react";

// The app runs with enableSystem off (see app/layout.tsx), so there are two
// choices, matching the account menu's Dark / Day toggle.
const THEMES = [
  { value: "dark", label: "Dark", Icon: Moon },
  { value: "light", label: "Day", Icon: Sun },
] as const;

export function AppearanceSection() {
  const { theme, setTheme } = useTheme();
  // next-themes only knows the theme after mount; render no selection until then.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <div role="radiogroup" aria-label="Theme" className="inline-flex w-fit gap-1 rounded-xl border bg-card p-1">
      {THEMES.map(({ value, label, Icon }) => {
        const active = mounted && theme === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => setTheme(value)}
            className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm transition-colors ${
              active ? "btn-active" : "text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
          >
            <Icon className="size-4" />
            {label}
          </button>
        );
      })}
    </div>
  );
}
