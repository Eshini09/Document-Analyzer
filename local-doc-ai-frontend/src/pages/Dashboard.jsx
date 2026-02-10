import React, { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import TopBar from "../components/TopBar.jsx";
import Dropzone from "../components/Dropzone.jsx";
import FileList from "../components/FileList.jsx";
import SearchPanel from "../components/SearchPanel.jsx";

export default function Dashboard() {
  const nav = useNavigate();
  const [files, setFiles] = useState([]);

  function onLogout() {
    localStorage.removeItem("auth_token");
    nav("/login", { replace: true });
  }

  function addFiles(newFiles) {
    // avoid duplicates by name+size (simple)
    setFiles((prev) => {
      const existing = new Set(prev.map((f) => `${f.name}::${f.size}`));
      const merged = [...prev];
      for (const f of newFiles) {
        const key = `${f.name}::${f.size}`;
        if (!existing.has(key)) merged.push(f);
      }
      return merged;
    });
  }

  function removeFile(index) {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  }

  const stats = useMemo(() => {
    const totalBytes = files.reduce((acc, f) => acc + (f.size || 0), 0);
    return { count: files.length, totalBytes };
  }, [files]);

  return (
    <div className="min-h-screen bg-zinc-50">
      <TopBar onLogout={onLogout} />

      <div className="mx-auto max-w-6xl px-4 py-6">
        <div className="mb-6">
          <div className="text-xl font-semibold text-zinc-900">Workspace</div>
          <div className="mt-1 text-sm text-zinc-500">
            Upload files and search for exact text or meaning. (Backend later)
          </div>
          <div className="mt-3 inline-flex items-center gap-2 rounded-2xl border border-zinc-200 bg-white px-4 py-2 text-xs text-zinc-600">
            <span>{stats.count} files</span>
            <span className="text-zinc-300">•</span>
            <span>Local session</span>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="space-y-6">
            <Dropzone onFiles={addFiles} />
            <FileList files={files} onRemove={removeFile} />
          </div>

          <div className="space-y-6">
            <SearchPanel files={files} />
            <div className="rounded-2xl border border-zinc-200 bg-white p-5">
              <div className="text-sm font-semibold text-zinc-900">Next</div>
              <div className="mt-1 text-sm text-zinc-600">
                When you build the backend, this page will:
                <ul className="mt-2 list-disc pl-5 text-sm text-zinc-600">
                  <li>send files to your local server</li>
                  <li>show upload progress</li>
                  <li>show exact page/paragraph locations from the server</li>
                </ul>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-10 text-xs text-zinc-500">
          Tip: keep all calls to 127.0.0.1 (or your LAN IP) when you add the backend to stay fully local.
        </div>
      </div>
    </div>
  );
}
