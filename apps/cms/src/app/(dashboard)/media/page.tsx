"use client";

import React, { useState } from "react";
import { 
  Search, 
  Upload, 
  Filter, 
  Folder, 
  Image as ImageIcon, 
  Video, 
  FileText, 
  MoreVertical,
  CheckCircle2,
  Trash2,
  Download
} from "lucide-react";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from "@platform/ui";

// Mock Data for Media Library
const MOCK_MEDIA = [
  {
    id: "m1",
    name: "hero_background_v2.png",
    type: "image",
    url: "https://images.unsplash.com/photo-1557683316-973673baf926?auto=format&fit=crop&w=800&q=80",
    size: "4.2 MB",
    date: "Oct 24, 2026",
    selected: false,
  },
  {
    id: "m2",
    name: "product_showcase.mp4",
    type: "video",
    url: "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=800&q=80",
    size: "24.5 MB",
    date: "Oct 23, 2026",
    selected: false,
  },
  {
    id: "m3",
    name: "q3_report_final.pdf",
    type: "document",
    url: "https://images.unsplash.com/photo-1568227451296-e24bbf451457?auto=format&fit=crop&w=800&q=80",
    size: "1.2 MB",
    date: "Oct 20, 2026",
    selected: false,
  },
  {
    id: "m4",
    name: "abstract_mesh.jpg",
    type: "image",
    url: "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=800&q=80",
    size: "8.1 MB",
    date: "Oct 19, 2026",
    selected: true,
  },
  {
    id: "m5",
    name: "logo_dark_mode.svg",
    type: "image",
    url: "https://images.unsplash.com/photo-1614850523459-c2f4c699c52e?auto=format&fit=crop&w=800&q=80",
    size: "45 KB",
    date: "Oct 18, 2026",
    selected: false,
  },
  {
    id: "m6",
    name: "interview_raw.mp4",
    type: "video",
    url: "https://images.unsplash.com/photo-1536240478700-b869070f9279?auto=format&fit=crop&w=800&q=80",
    size: "142 MB",
    date: "Oct 15, 2026",
    selected: false,
  },
  {
    id: "m7",
    name: "brand_guidelines.pdf",
    type: "document",
    url: "https://images.unsplash.com/photo-1626785774573-4b799315345d?auto=format&fit=crop&w=800&q=80",
    size: "12.8 MB",
    date: "Oct 10, 2026",
    selected: false,
  },
  {
    id: "m8",
    name: "neon_vibes.png",
    type: "image",
    url: "https://images.unsplash.com/photo-1550684848-fac1c5b4e853?auto=format&fit=crop&w=800&q=80",
    size: "5.5 MB",
    date: "Oct 05, 2026",
    selected: false,
  }
];

const CATEGORIES = [
  { id: 'all', label: 'All Media', icon: Folder },
  { id: 'images', label: 'Images', icon: ImageIcon },
  { id: 'videos', label: 'Videos', icon: Video },
  { id: 'documents', label: 'Documents', icon: FileText },
];

export default function MediaPage() {
  const [activeCategory, setActiveCategory] = useState('all');

  return (
    <div className="flex flex-col h-full bg-zinc-50 dark:bg-[#0a0a0a] min-h-[calc(100vh-4rem)]">
      {/* Top Header Section */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-6 lg:px-8 border-b border-zinc-200 dark:border-white/10 bg-white dark:bg-[#0a0a0a] sticky top-0 z-20">
        <div>
          <h1 className="text-2xl lg:text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">Media Library</h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">Manage and organize your assets</p>
        </div>
        
        <div className="flex items-center gap-3">
          <div className="relative group">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400 group-focus-within:text-blue-500 transition-colors" />
            <input 
              type="text" 
              placeholder="Search media..." 
              className="h-10 pl-9 pr-4 w-full sm:w-64 rounded-full bg-zinc-100 dark:bg-white/5 border-transparent focus:bg-white dark:focus:bg-[#111] focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all text-sm outline-none dark:text-white"
            />
          </div>
          <button className="h-10 px-5 inline-flex items-center justify-center gap-2 rounded-full bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium transition-all hover:shadow-lg hover:shadow-blue-600/25 active:scale-95">
            <Upload className="h-4 w-4" />
            Upload
          </button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Left Sidebar / Categories */}
        <div className="hidden md:flex flex-col w-64 p-6 border-r border-zinc-200 dark:border-white/10 bg-white/50 dark:bg-[#0a0a0a]/50">
          <div className="space-y-1">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400 mb-3 px-3">Library</h3>
            {CATEGORIES.map((cat) => (
              <button
                key={cat.id}
                onClick={() => setActiveCategory(cat.id)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${
                  activeCategory === cat.id 
                    ? 'bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400' 
                    : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-white/5 hover:text-zinc-900 dark:hover:text-zinc-100'
                }`}
              >
                <cat.icon className={`h-4 w-4 ${activeCategory === cat.id ? 'text-blue-600 dark:text-blue-400' : 'text-zinc-400'}`} />
                {cat.label}
              </button>
            ))}
          </div>

          <div className="mt-8 space-y-1">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400 mb-3 px-3">Tags</h3>
            {['Marketing', 'Product', 'Social', 'Archive'].map((tag) => (
              <button key={tag} className="w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-white/5 transition-colors">
                <span className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-zinc-300 dark:bg-zinc-700"></span>
                  {tag}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Main Content Grid */}
        <div className="flex-1 p-6 lg:p-8 overflow-y-auto">
          {/* Controls Bar */}
          <div className="flex items-center justify-between mb-6">
            <p className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
              Showing {activeCategory === 'all' ? 'All Files' : activeCategory} <span className="text-zinc-400 dark:text-zinc-500">({MOCK_MEDIA.length})</span>
            </p>
            <button className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors">
              <Filter className="h-4 w-4" />
              Filter
            </button>
          </div>

          {/* Media Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 lg:gap-6">
            {MOCK_MEDIA.map((media) => (
              <div 
                key={media.id} 
                className={`group relative flex flex-col bg-white dark:bg-[#111] rounded-2xl border transition-all duration-300 ${
                  media.selected 
                    ? 'border-blue-500 ring-1 ring-blue-500 dark:ring-blue-500/50 shadow-md shadow-blue-500/10' 
                    : 'border-zinc-200 dark:border-white/10 hover:border-zinc-300 dark:hover:border-white/20 hover:shadow-xl hover:-translate-y-1'
                }`}
              >
                {/* Checkbox (visible on hover or if selected) */}
                <div className={`absolute top-3 left-3 z-10 transition-opacity duration-200 ${media.selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
                  <button className={`flex items-center justify-center w-6 h-6 rounded-full border ${media.selected ? 'bg-blue-500 border-blue-500 text-white' : 'bg-white/80 border-zinc-300 text-transparent backdrop-blur-sm'}`}>
                    <CheckCircle2 className="w-4 h-4" />
                  </button>
                </div>

                {/* Dropdown Menu */}
                <div className="absolute top-3 right-3 z-10 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button className="flex items-center justify-center w-8 h-8 rounded-full bg-black/40 text-white backdrop-blur-md hover:bg-black/60 transition-colors">
                        <MoreVertical className="w-4 h-4" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-48">
                      <DropdownMenuItem className="cursor-pointer gap-2">
                        <Download className="w-4 h-4" /> Download
                      </DropdownMenuItem>
                      <DropdownMenuItem className="cursor-pointer gap-2">
                        <Folder className="w-4 h-4" /> Move to Folder
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem className="cursor-pointer gap-2 text-red-600 focus:text-red-600">
                        <Trash2 className="w-4 h-4" /> Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>

                {/* Thumbnail Area */}
                <div className="aspect-square w-full overflow-hidden rounded-t-2xl bg-zinc-100 dark:bg-zinc-800/50 relative">
                  {media.type === 'document' ? (
                    <div className="absolute inset-0 flex items-center justify-center">
                      <FileText className="w-16 h-16 text-zinc-300 dark:text-zinc-600" />
                    </div>
                  ) : (
                    <img 
                      src={media.url} 
                      alt={media.name}
                      className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                      loading="lazy"
                    />
                  )}
                  {/* Type Badge */}
                  <div className="absolute bottom-3 left-3 flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-black/50 backdrop-blur-md text-white text-[10px] font-medium tracking-wide uppercase">
                    {media.type === 'video' && <Video className="w-3 h-3" />}
                    {media.type === 'image' && <ImageIcon className="w-3 h-3" />}
                    {media.type === 'document' && <FileText className="w-3 h-3" />}
                    {media.type}
                  </div>
                </div>

                {/* Metadata Area */}
                <div className="p-4 flex flex-col gap-1">
                  <h4 className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate" title={media.name}>
                    {media.name}
                  </h4>
                  <div className="flex items-center justify-between mt-1">
                    <p className="text-xs text-zinc-500 dark:text-zinc-400 font-medium">{media.size}</p>
                    <p className="text-xs text-zinc-400 dark:text-zinc-500">{media.date}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
