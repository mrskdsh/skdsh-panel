import { useEffect, useState } from "react";
import { api } from "../lib/api.js";
import PeerRow from "../components/PeerRow.jsx";
import CreatePeerModal from "../components/CreatePeerModal.jsx";
import QrModal from "../components/QrModal.jsx";
import SupportModal from "../components/SupportModal.jsx";
import ChangePasswordModal from "../components/ChangePasswordModal.jsx";
import RequestsPanel from "../components/RequestsPanel.jsx";
import AssignModal from "../components/AssignModal.jsx";
import AccountsPanel from "../components/AccountsPanel.jsx";
import ServersPanel from "../components/ServersPanel.jsx";
import "./Dashboard.css";

export default function AdminDashboard({ user, onLogout }) {
  const [peers, setPeers] = useState(null);
  const [users, setUsers] = useState([]);
  const [servers, setServers] = useState([]);
  const [serverFilter, setServerFilter] = useState("");
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [qrPeer, setQrPeer] = useState(null);
  const [assignPeer, setAssignPeer] = useState(null);
  const [showSupport, setShowSupport] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [busyId, setBusyId] = useState(null);

  async function load() {
    try {
      const data = await api.listPeers(serverFilter || undefined);
      setPeers(data);
      setError("");
    } catch (e) {
      setError(e.message);
    }
  }

  async function loadUsers() {
    try {
      setUsers(await api.listUsers());
    } catch (e) {
      console.error(e);
    }
  }

  async function loadServers() {
    try {
      setServers(await api.listServers());
    } catch (e) {
      console.error(e);
    }
  }

  useEffect(() => {
    load();
    loadUsers();
    loadServers();
    const interval = setInterval(() => {
      load();
      loadUsers();
      loadServers();
    }, 30000);
    return () => clearInterval(interval);
  }, [serverFilter]);

  async function runAction(id, fn) {
    setActionError("");
    setBusyId(id);
    try {
      await fn();
      await load();
    } catch (e) {
      setActionError(e.message);
    } finally {
      setBusyId(null);
    }
  }

  async function handleCreate(data) {
    await api.createPeer(data);
    await load();
    await loadServers();
  }

  function handleUpdateLimit(id, limitGB) {
    return runAction(id, () => api.updatePeer(id, { limitGB }));
  }

  function handleRename(id, name) {
    return runAction(id, () => api.updatePeer(id, { name }));
  }

  function handleToggleBlock(id, blocked) {
    return runAction(id, () => api.updatePeer(id, { blocked }));
  }

  function handleDelete(id) {
    if (!confirm("Удалить доступ безвозвратно?")) return;
    return runAction(id, () => api.deletePeer(id));
  }

  async function handleAssign(ownerId) {
    await api.updatePeer(assignPeer.id, { ownerId });
    await load();
  }

  async function handleUnassign() {
    await api.updatePeer(assignPeer.id, { ownerId: null });
    await load();
  }

  async function handleLogout() {
    await api.logout();
    onLogout();
  }

  async function submitSupport(message) {
    await api.createSupportTicket(message);
  }

  const totalUsed = peers?.reduce((s, p) => s + p.usedGB, 0) ?? 0;

  return (
    <div className="shell">
      <header className="topbar">
        <div className="topbar-title">
          <span className="dot" />
          Skdsh Panel · админ
        </div>
        <div className="topbar-actions">
          <button className="logout-btn" onClick={() => setShowPasswordModal(true)}>
            Пароль
          </button>
          <button className="logout-btn" onClick={() => setShowSupport(true)}>
            Поддержка
          </button>
          <button className="logout-btn" onClick={handleLogout}>
            Выйти
          </button>
        </div>
      </header>

      <div className="content">
        <RequestsPanel onPeersChanged={load} onUsersChanged={loadUsers} />

        <h1 className="section-title">Пользователи</h1>
        <p className="section-sub">
          {peers ? `${peers.length} · за месяц использовано ${totalUsed.toFixed(1)} ГБ` : "Загрузка…"}
        </p>

        <div className="dash-toolbar">
          <button className="btn-primary" onClick={() => setCreateOpen(true)}>
            + Новый доступ
          </button>
          {servers.length > 1 && (
            <select
              className="server-filter-select"
              value={serverFilter}
              onChange={(e) => setServerFilter(e.target.value)}
            >
              <option value="">Все серверы</option>
              {servers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          )}
        </div>

        <ServersPanel servers={servers} onReload={loadServers} />
        <AccountsPanel users={users} onReload={loadUsers} />

        {error && <p className="error-text">{error}</p>}
        {actionError && <p className="error-text">{actionError}</p>}

        <div className="peer-list">
          {peers?.map((peer) => (
            <PeerRow
              key={peer.id}
              peer={peer}
              busy={busyId === peer.id}
              assignedTo={users.find((u) => u.id === peer.ownerId)?.display_name}
              serverName={servers.length > 1 ? servers.find((s) => s.id === peer.serverId)?.name : null}
              onUpdateLimit={handleUpdateLimit}
              onRename={handleRename}
              onToggleBlock={handleToggleBlock}
              onDelete={handleDelete}
              onShowQr={setQrPeer}
              onAssign={setAssignPeer}
            />
          ))}
          {peers?.length === 0 && (
            <div className="empty-state">Пока никого нет — создайте первый доступ</div>
          )}
        </div>
      </div>

      <CreatePeerModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreate={handleCreate}
        servers={servers}
      />
      <QrModal peer={qrPeer} onClose={() => setQrPeer(null)} />
      <AssignModal
        peer={assignPeer}
        currentOwnerId={assignPeer?.ownerId}
        profiles={users}
        onClose={() => setAssignPeer(null)}
        onAssign={handleAssign}
        onUnassign={handleUnassign}
      />
      <SupportModal open={showSupport} onClose={() => setShowSupport(false)} onSubmit={submitSupport} />
      <ChangePasswordModal open={showPasswordModal} onClose={() => setShowPasswordModal(false)} />
    </div>
  );
}
