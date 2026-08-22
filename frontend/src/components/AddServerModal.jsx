import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import "./CreatePeerModal.css";
import "../pages/Login.css";

const FIELDS = [
  { key: "name", label: "Название", placeholder: "Второй сервер" },
  { key: "endpoint", label: "Адрес:порт (для клиентов)", placeholder: "1.2.3.4:39001" },
  { key: "container", label: "Имя Docker-контейнера", placeholder: "skdsh-awg" },
  { key: "interface", label: "Имя сетевого интерфейса", placeholder: "awg0 — для первого сервера, иначе см. вывод add-server.sh" },
  { key: "configPath", label: "Путь к конфигу в контейнере", placeholder: "/etc/amnezia/amneziawg/awg0.conf" },
  { key: "publicKey", label: "Публичный ключ сервера" },
  { key: "presharedKey", label: "Preshared key" },
  { key: "subnetPrefix", label: "Префикс подсети", placeholder: "10.9.1." },
];

const SSH_FIELDS = [
  { key: "sshHost", label: "IP удалённого сервера", placeholder: "5.6.7.8" },
  { key: "sshUser", label: "SSH-пользователь", placeholder: "root" },
  { key: "sshKeyPath", label: "Путь к приватному SSH-ключу на этой машине", placeholder: "/root/.ssh/id_rsa" },
];

const SHORT_AWG_FIELDS = ["jc", "jmin", "jmax", "s1", "s2", "s3", "s4"];
const LONG_AWG_FIELDS = ["h1", "h2", "h3", "h4"];

function serverToForm(s) {
  if (!s) return {};
  return {
    name: s.name,
    endpoint: s.endpoint,
    container: s.container,
    interface: s.interface,
    configPath: s.config_path,
    publicKey: s.public_key,
    presharedKey: s.preshared_key,
    subnetPrefix: s.subnet_prefix,
    sshHost: s.ssh_host || "",
    sshUser: s.ssh_user || "",
    sshKeyPath: s.ssh_key_path || "",
    jc: s.jc, jmin: s.jmin, jmax: s.jmax,
    s1: s.s1, s2: s.s2, s3: s.s3, s4: s.s4,
    h1: s.h1, h2: s.h2, h3: s.h3, h4: s.h4,
  };
}

export default function AddServerModal({ open, onClose, onCreate, onSave, editingServer }) {
  const [form, setForm] = useState({});
  const [isRemote, setIsRemote] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const isEditing = Boolean(editingServer);

  useEffect(() => {
    if (open) {
      const initial = serverToForm(editingServer);
      setForm(initial);
      setIsRemote(Boolean(editingServer?.ssh_host));
    }
  }, [open, editingServer]);

  function set(key, value) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const payload = isRemote ? form : { ...form, sshHost: undefined };
      if (isEditing) {
        await onSave(editingServer.id, payload);
      } else {
        await onCreate(payload);
      }
      setForm({});
      setIsRemote(false);
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="modal-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <motion.div
            className="modal-card"
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.98 }}
            onClick={(e) => e.stopPropagation()}
            style={{ maxHeight: "85vh", overflowY: "auto" }}
          >
            <h2 className="modal-title">{isEditing ? "Изменить сервер" : "Новый сервер"}</h2>
            <p className="modal-sub">
              {isEditing
                ? "Меняйте только то, что реально изменилось на сервере"
                : 'Значения берутся из вывода install.sh / add-server.sh (раздел "Готово")'}
            </p>

            <div className="login-mode-tabs">
              <button
                type="button"
                className={`login-mode-tab ${!isRemote ? "active" : ""}`}
                onClick={() => setIsRemote(false)}
              >
                На этой машине
              </button>
              <button
                type="button"
                className={`login-mode-tab ${isRemote ? "active" : ""}`}
                onClick={() => setIsRemote(true)}
              >
                Удалённый (по SSH)
              </button>
            </div>

            <form onSubmit={handleSubmit}>
              {FIELDS.map((f) => (
                <div className="field" key={f.key}>
                  <label>{f.label}</label>
                  <input
                    value={form[f.key] || ""}
                    onChange={(e) => set(f.key, e.target.value)}
                    placeholder={f.placeholder}
                    required={f.key !== "interface"}
                  />
                </div>
              ))}

              {isRemote && (
                <>
                  <p className="modal-sub" style={{ marginTop: "4px" }}>
                    Панель зайдёт на этот сервер по SSH, чтобы выполнить docker exec
                  </p>
                  {SSH_FIELDS.map((f) => (
                    <div className="field" key={f.key}>
                      <label>{f.label}</label>
                      <input
                        value={form[f.key] || ""}
                        onChange={(e) => set(f.key, e.target.value)}
                        placeholder={f.placeholder}
                        required
                      />
                    </div>
                  ))}
                </>
              )}

              <div className="field">
                <label>Jc / Jmin / Jmax / S1-S4 (короткие числа)</label>
                <div className="awg-short-grid">
                  {SHORT_AWG_FIELDS.map((k) => (
                    <input
                      key={k}
                      value={form[k] || ""}
                      onChange={(e) => set(k, e.target.value)}
                      placeholder={k.toUpperCase()}
                      required
                    />
                  ))}
                </div>
              </div>

              <div className="field">
                <label>H1-H4 (длинные диапазоны)</label>
                <div className="awg-long-grid">
                  {LONG_AWG_FIELDS.map((k) => (
                    <input
                      key={k}
                      value={form[k] || ""}
                      onChange={(e) => set(k, e.target.value)}
                      placeholder={`${k.toUpperCase()} — например 728858882-738013502`}
                      required
                    />
                  ))}
                </div>
              </div>

              {error && <p className="error-text">{error}</p>}
              <div className="modal-actions">
                <button type="button" className="btn-ghost" onClick={onClose}>
                  Отмена
                </button>
                <button className="btn-primary" disabled={loading}>
                  {loading ? "…" : isEditing ? "Сохранить" : "Добавить"}
                </button>
              </div>
            </form>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
