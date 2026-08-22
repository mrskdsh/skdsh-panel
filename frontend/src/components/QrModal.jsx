import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { api } from "../lib/api.js";
import "./CreatePeerModal.css";
import "./QrModal.css";

export default function QrModal({ peer, onClose }) {
  const [mode, setMode] = useState("amnezia");
  const [qr, setQr] = useState(null);
  const [config, setConfig] = useState("");
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!peer) return;
    setMode("amnezia");
  }, [peer]);

  useEffect(() => {
    if (!peer) return;
    setQr(null);
    setError("");

    if (mode === "amnezia") {
      Promise.all([api.getVpnLinkQr(peer.id), api.getVpnLink(peer.id)])
        .then(([qrRes, linkRes]) => {
          setQr(qrRes.qr);
          setConfig(linkRes.link);
        })
        .catch((e) => setError(e.message));
    } else {
      Promise.all([api.getQr(peer.id), api.getConfig(peer.id)])
        .then(([qrRes, configRes]) => {
          setQr(qrRes.qr);
          setConfig(configRes.config);
        })
        .catch((e) => setError(e.message));
    }
  }, [peer, mode]);

  function copyConfig() {
    navigator.clipboard.writeText(config);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  function downloadConfig() {
    const blob = new Blob([config], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${peer.name.replace(/\s+/g, "_")}.conf`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <AnimatePresence>
      {peer && (
        <motion.div
          className="modal-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <motion.div
            className="modal-card qr-modal"
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.98 }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="modal-title">{peer.name}</h2>

            <div className="qr-mode-tabs">
              <button
                className={`qr-mode-tab ${mode === "amnezia" ? "active" : ""}`}
                onClick={() => setMode("amnezia")}
              >
                Для AmneziaVPN
              </button>
              <button
                className={`qr-mode-tab ${mode === "raw" ? "active" : ""}`}
                onClick={() => setMode("raw")}
              >
                Обычный WireGuard
              </button>
            </div>

            {error ? (
              <p className="qr-error">{error}</p>
            ) : (
              <>
                <p className="modal-sub">
                  {mode === "amnezia"
                    ? "Экспериментально: имя сервера подставится автоматически. Если не сработает — переключитесь на «Обычный WireGuard»"
                    : "Если QR не сканируется — импортируйте файл через «Добавить сервер → Из файла»"}
                </p>
                <div className="qr-frame">
                  {qr ? (
                    <img src={qr} alt="QR-код конфига" />
                  ) : (
                    <div className="qr-loading" />
                  )}
                </div>
                {mode === "raw" && (
                  <button
                    className="btn-primary qr-download"
                    onClick={downloadConfig}
                    disabled={!config}
                  >
                    Скачать .conf файл
                  </button>
                )}
                <button className="btn-ghost qr-copy" onClick={copyConfig} disabled={!config}>
                  {copied ? "Скопировано ✓" : "Скопировать ссылку/конфиг текстом"}
                </button>
              </>
            )}

            <div className="modal-actions">
              <button className="btn-ghost" onClick={onClose}>
                Готово
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
