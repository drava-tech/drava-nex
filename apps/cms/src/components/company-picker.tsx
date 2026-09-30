"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Plus } from "lucide-react";
import { searchCompaniesAction } from "@/actions/portfolio-actions";
import type { CompanySearchResult } from "@/lib/companies-api";

const FIELD =
  "w-full bg-zinc-100 border border-border focus:border-zinc-500 dark:bg-zinc-800 dark:focus:border-zinc-500 rounded-lg px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 outline-none transition-colors disabled:opacity-50";

/**
 * Searchable company combobox: types into the existing `company` table
 * (`GET /api/companies?search=`) and lets the author either pick a match or
 * create a brand-new company with the typed name via the persistent "+"
 * button — used in place of the old free-text company field, which matched
 * clients by fuzzy string comparison instead of a real row.
 */
export function CompanyPicker({
  value,
  onSelect,
  onCreateNew,
  disabled,
}: {
  /** Current company name, shown in the field until the author types. */
  value: string;
  onSelect: (company: { id: string; name: string }) => void;
  onCreateNew: (name: string) => void;
  disabled?: boolean;
}) {
  const [query, setQuery] = useState(value);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<CompanySearchResult[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reflect an external change to the selected company (e.g. after a save)
  // once the field isn't actively being edited.
  useEffect(() => {
    if (!open) setQuery(value);
  }, [value, open]);

  useEffect(() => {
    if (!open) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setLoading(true);
      searchCompaniesAction(query)
        .then((res) => setResults(res.success ? (res.data ?? []) : []))
        .finally(() => setLoading(false));
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, open]);

  useEffect(() => {
    const onClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  const trimmed = query.trim();
  const exactMatch = results.some((r) => r.name.toLowerCase() === trimmed.toLowerCase());
  const canCreate = trimmed.length > 0 && !exactMatch;

  const select = (company: CompanySearchResult) => {
    setQuery(company.name);
    setOpen(false);
    onSelect({ id: company.id, name: company.name });
  };

  const createNew = () => {
    if (!canCreate) return;
    setOpen(false);
    onCreateNew(trimmed);
  };

  return (
    <div ref={containerRef} className="relative flex items-center gap-1.5">
      <div className="relative flex-1">
        <input
          className={FIELD}
          value={query}
          disabled={disabled}
          placeholder="Search or type a company name"
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
        />
        {open ? (
          <div className="absolute z-20 mt-1 w-full max-h-56 overflow-y-auto rounded-lg border border-border bg-white shadow-lg dark:bg-zinc-900">
            {loading ? (
              <div className="flex items-center gap-2 px-3 py-2 text-xs text-zinc-400">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Searching…
              </div>
            ) : results.length === 0 ? (
              <div className="px-3 py-2 text-xs text-zinc-400">
                {trimmed ? "No matching companies." : "Type to search companies."}
              </div>
            ) : (
              results.map((company) => (
                <button
                  key={company.id}
                  type="button"
                  onClick={() => select(company)}
                  className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm text-zinc-900 hover:bg-zinc-100 dark:text-zinc-100 dark:hover:bg-zinc-800"
                >
                  <span className="truncate">{company.name}</span>
                  <span className="shrink-0 text-[11px] text-zinc-400">
                    {company.projectCount} {company.projectCount === 1 ? "project" : "projects"}
                  </span>
                </button>
              ))
            )}
          </div>
        ) : null}
      </div>
      <button
        type="button"
        disabled={disabled || !canCreate}
        onClick={createNew}
        title={canCreate ? `Create "${trimmed}" as a new company` : "Type a new company name to create one"}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-dashed border-border text-zinc-500 transition-colors hover:border-zinc-400 hover:text-zinc-700 disabled:opacity-40 dark:hover:text-zinc-300"
      >
        <Plus className="h-4 w-4" />
      </button>
    </div>
  );
}
