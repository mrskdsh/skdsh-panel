import { useState } from "react";
import { api } from "../lib/api.js";
import AddServerModal from "./AddServerModal.jsx";
import "./RequestsPanel.css";
import "./AccountsPanel.css";

export default function ServersPanel({ servers, onReload }) {
  const [open, setOpen] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [editingServer, setEditingServer] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState("");

  async function handleCreate(data) {
    await api.createServer(data);
    await onReload();
  }

  async function handleSave(id, data) {
    await api.updateServer(id, data);
    await onReload();
  }

  function openEdit(server) {
    setEditingServer(server);
    setShowAdd(true);
  }

  function closeModal() {
    setShowAdd(false);
    setEditingServer(null);
  }

  async function handleDelete(server) {
    if (server.peerCount > 0) {
      alert(`На сервере ещё ${server.peerCount} доступ(ов) — сначала перенесите или удалите их.`);
      return;
    }
    if (!confirm(`Удалить сервер «${server.name}»?`)) return;

    setError("");
    setBusyId(server.id);
    try {
      await api.deleteServer(server.id);
      await onReload();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusyId(null);
    }
  }

  if (!servers) return null;

  return (
    <div className="accounts-panel">
      <button className="accounts-toggle" onClick={() => setOpen((v) => !v)}>
        Серверы ({servers.length}) {open ? "▲" : "▼"}
      </button>

      {open && (
        <div className="accounts-list">
          {servers.map((s) => (
            <div key={s.id} className="account-row">
              <span className="account-name">{s.name}</span>
              <span className="account-devices">
                {s.endpoint} · {s.peerCount} устройств
              </span>
              <button className="btn-ghost" onClick={() => openEdit(s)}>
                Изменить
              </button>
              <button
                className="btn-ghost peer-delete"
                onClick={() => handleDelete(s)}
                disabled={busyId === s.id}
              >
                {busyId === s.id ? "…" : "Удалить"}
              </button>
            </div>
          ))}
          <button className="btn-ghost" onClick={() => setShowAdd(true)}>
            + Добавить сервер
          </button>
          {error && <p className="error-text">{error}</p>}
        </div>
      )}

      <AddServerModal
        open={showAdd}
        onClose={closeModal}
        onCreate={handleCreate}
        onSave={handleSave}
        editingServer={editingServer}
      />
    </div>
  );
}
