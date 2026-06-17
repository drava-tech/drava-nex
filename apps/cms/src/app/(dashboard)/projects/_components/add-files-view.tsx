"use client";

import React, { useState } from "react";
import { Upload, FileText, Film, Volume2, Trash2, CheckCircle2 } from "lucide-react";

export function AddFilesView() {
  const [files, setFiles] = useState([
    { id: "1", name: "presentation_loop.mp4", type: "video", size: "48.2 MB", date: "Jun 15, 2026" },
    { id: "2", name: "model_lobby_3d.glb", type: "document", size: "18.4 MB", date: "Jun 14, 2026" },
    { id: "3", name: "welcome_voiceover.wav", type: "audio", size: "4.1 MB", date: "Jun 12, 2026" },
    { id: "4", name: "project_settings.json", type: "document", size: "1.2 KB", date: "Jun 10, 2026" },
  ]);

  const [dragActive, setDragActive] = useState(false);
  const [uploadSuccess, setUploadSuccess] = useState(false);

  const handleDelete = (id: string) => {
    setFiles(files.filter(f => f.id !== id));
  };

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const newFile = {
        id: Math.random().toString(),
        name: e.dataTransfer.files[0].name,
        type: e.dataTransfer.files[0].type.includes("video") ? "video" : e.dataTransfer.files[0].type.includes("audio") ? "audio" : "document",
        size: `${(e.dataTransfer.files[0].size / (1024 * 1024)).toFixed(1)} MB`,
        date: "Today",
      };
      setFiles([newFile, ...files]);
      setUploadSuccess(true);
      setTimeout(() => setUploadSuccess(false), 3000);
    }
  };

  const getIcon = (type: string) => {
    switch (type) {
      case "video": return <Film className="h-5 w-5 text-blue-500" />;
      case "audio": return <Volume2 className="h-5 w-5 text-amber-500" />;
      default: return <FileText className="h-5 w-5 text-zinc-500" />;
    }
  };

  return (
    <div className="w-full space-y-6">
      <div className="flex items-center justify-between border-b pb-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-white">Media & Assets</h2>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">Upload 3D models, videos, audio narratives, and JSON configurations.</p>
        </div>
      </div>

      {/* Upload Zone */}
      <div
        onDragEnter={handleDrag}
        onDragOver={handleDrag}
        onDragLeave={handleDrag}
        onDrop={handleDrop}
        className={`border-2 border-dashed rounded-xl p-8 flex flex-col items-center justify-center text-center transition-all ${
          dragActive
            ? "border-black bg-zinc-50 dark:border-white dark:bg-zinc-900"
            : "border-zinc-300 dark:border-zinc-800 hover:border-zinc-400 dark:hover:border-zinc-700 bg-white dark:bg-zinc-950"
        }`}
      >
        <div className="p-4 bg-zinc-100 dark:bg-zinc-900 rounded-full mb-4">
          <Upload className="h-6 w-6 text-zinc-600 dark:text-zinc-300" />
        </div>
        <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">Drag and drop files here, or browse local folders</p>
        <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1 mb-4">Supported formats: GLTF/GLB, MP4, WAV, MP3, JSON (Max 100MB)</p>
        
        <label className="cursor-pointer px-4 py-2 bg-black text-white dark:bg-white dark:text-black rounded-lg text-sm font-medium hover:bg-zinc-800 dark:hover:bg-zinc-100 transition-colors">
          Browse Files
          <input
            type="file"
            className="hidden"
            onChange={(e) => {
              if (e.target.files && e.target.files[0]) {
                const newFile = {
                  id: Math.random().toString(),
                  name: e.target.files[0].name,
                  type: e.target.files[0].type.includes("video") ? "video" : e.target.files[0].type.includes("audio") ? "audio" : "document",
                  size: `${(e.target.files[0].size / (1024 * 1024)).toFixed(1)} MB`,
                  date: "Today",
                };
                setFiles([newFile, ...files]);
                setUploadSuccess(true);
                setTimeout(() => setUploadSuccess(false), 3000);
              }
            }}
          />
        </label>
      </div>

      {uploadSuccess && (
        <div className="bg-emerald-50 dark:bg-emerald-950/20 text-emerald-800 dark:text-emerald-300 px-4 py-3 rounded-xl flex items-center gap-2 border border-emerald-200 dark:border-emerald-900/30 text-sm">
          <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-500" />
          <span>File uploaded successfully and synced to display cache.</span>
        </div>
      )}

      {/* Uploaded Files Table */}
      <div className="space-y-4">
        <h3 className="text-lg font-semibold text-zinc-900 dark:text-white">Active Repository Files</h3>
        <div className="overflow-hidden border border-zinc-200 dark:border-zinc-800 rounded-xl bg-white dark:bg-zinc-950">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-zinc-50 dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800 text-xs font-semibold text-zinc-600 dark:text-zinc-400 uppercase tracking-wider">
                <th className="p-4">File Name</th>
                <th className="p-4">Size</th>
                <th className="p-4">Uploaded Date</th>
                <th className="p-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800 text-sm">
              {files.map((file) => (
                <tr key={file.id} className="hover:bg-zinc-50/50 dark:hover:bg-zinc-900/30 transition-colors">
                  <td className="p-4 flex items-center gap-3">
                    {getIcon(file.type)}
                    <span className="font-medium text-zinc-900 dark:text-white">{file.name}</span>
                  </td>
                  <td className="p-4 text-zinc-600 dark:text-zinc-400">{file.size}</td>
                  <td className="p-4 text-zinc-600 dark:text-zinc-400">{file.date}</td>
                  <td className="p-4 text-right">
                    <button
                      onClick={() => handleDelete(file.id)}
                      className="p-1.5 text-zinc-500 hover:text-red-500 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                      title="Delete Asset"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
              {files.length === 0 && (
                <tr>
                  <td colSpan={4} className="p-8 text-center text-zinc-400 italic">No files in repository.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
