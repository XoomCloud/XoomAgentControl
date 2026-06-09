"use client";

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.6)", display: "grid", placeItems: "center", zIndex: 50, padding: 20 }}
      onClick={onClose}
    >
      <div className="card" style={{ width: 640, maxWidth: "95vw", maxHeight: "90vh", overflow: "auto" }} onClick={(e) => e.stopPropagation()}>
        <div className="card-h">
          <div className="card-title" style={{ fontSize: 18 }}>
            {title}
          </div>
          <button className="btn sm" onClick={onClose}>
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
