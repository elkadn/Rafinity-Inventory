import { useEffect, useRef, useState } from "react";
import type { ChangeEvent, CSSProperties, ReactNode } from "react";
import { useAuth } from "../context/AuthContext";
import {
  adminListDays,
  adminUserDayScans,
  adminDeleteUserScan,
  adminMergedDay,
  adminDownloadDayCsv,
  adminListUsers,
  adminCreateUser,
  adminUpdateUser,
  adminSetInventory,
  adminClearInventory,
  adminListDeletions,
  fetchActiveInventory,
  type DaySummaryDto,
  type UserDayScansDto,
  type ScanDto,
  type MergedDayDto,
  type AuthUserDto,
  type ActiveInventoryDto,
  type DeletionDto,
  type BulkPhotoJobDto,
  adminCreatePhotoJob,
  adminListPhotoJobs,
  adminListPhotoHistory,
} from "../lib/api";
import { DownloadIcon } from "../components/icons";

type View =
  | { kind: "days" }
  | { kind: "day"; date: string }
  | { kind: "user"; date: string; userId: string }
  | { kind: "merged"; date: string }
  | { kind: "users" }
  | { kind: "photos" }
  | { kind: "inventory" }
  | { kind: "deletions" };

type NavKey = "days" | "photos" | "inventory" | "deletions" | "users";

const NAV_ITEMS: { key: NavKey; label: string; icon: ReactNode }[] = [
  { key: "days", label: "Scans", icon: <ScanIcon /> },
  { key: "photos", label: "Photos", icon: <FolderIcon /> },
  { key: "inventory", label: "Inventaire", icon: <InventoryIcon /> },
  { key: "deletions", label: "Suppressions", icon: <TrashIcon /> },
  { key: "users", label: "Utilisateurs", icon: <UsersIcon /> },
];

function navKeyForView(view: View): NavKey {
  if (view.kind === "day" || view.kind === "user" || view.kind === "merged")
    return "days";
  return view.kind;
}

function initials(prenom?: string, nom?: string, username?: string) {
  if (prenom || nom)
    return `${(prenom ?? "")[0] ?? ""}${(nom ?? "")[0] ?? ""}`.toUpperCase();
  return (username ?? "?").slice(0, 2).toUpperCase();
}

export default function AdminPage() {
  const { token, user, logout } = useAuth();
  const [view, setView] = useState<View>({ kind: "days" });
  const [days, setDays] = useState<DaySummaryDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeInventory, setActiveInventory] =
    useState<ActiveInventoryDto | null>(null);

  const loadDays = () => {
    if (!token) return;
    setLoading(true);
    adminListDays(token)
      .then(setDays)
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (!token) return;
    loadDays();
    fetchActiveInventory(token)
      .then(setActiveInventory)
      .catch(() => {});
  }, [token]);

  const activeNav = navKeyForView(view);

  const goTo = (key: NavKey) => {
    if (key === "days") {
      setView({ kind: "days" });
      loadDays();
    }
    else setView({ kind: key } as View);
  };

  return (
    <div style={shellStyle}>
      <style>{`
        * { box-sizing: border-box; }
        .admin-nav-btn { transition: background 0.15s ease, color 0.15s ease; }
        .admin-nav-btn:hover:not(.active) { background: rgba(189, 177, 132, 0.08); }
        .admin-nav-btn.active { background: rgba(189, 177, 132, 0.14); }
        .admin-row-btn:hover { border-color: rgba(189, 177, 132, 0.4) !important; box-shadow: 0 4px 14px rgba(80, 74, 45, 0.08); }
        .admin-primary-btn:hover { filter: brightness(0.96); }
        .admin-ghost-btn:hover { background: rgba(189, 177, 132, 0.10) !important; }
        .admin-logout-btn:hover { background: rgba(192, 86, 79, 0.12) !important; border-color: rgba(192, 86, 79, 0.35) !important; }
        @keyframes admin-progress-shimmer { from { background-position: 200% 0; } to { background-position: -200% 0; } }
        @keyframes admin-processing-dot { 0%, 60%, 100% { opacity: .25; transform: translateY(0); } 30% { opacity: 1; transform: translateY(-3px); } }
        @keyframes admin-toast-in { from { opacity: 0; transform: translate(-50%, -12px); } to { opacity: 1; transform: translate(-50%, 0); } }
        .admin-users-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
        .admin-input:focus, .admin-select:focus {
          border-color: #bdb184 !important;
          box-shadow: 0 0 0 3px rgba(189, 177, 132, 0.16) !important;
        }
        @media (max-width: 860px) {
          .admin-sidebar { display: none !important; }
          .admin-mobile-nav { display: flex !important; }
          .admin-main { margin-left: 0 !important; }
          .admin-content { padding: 16px !important; }
          .admin-users-grid { grid-template-columns: 1fr; }
        }
      `}</style>

      {/* Sidebar (desktop) */}
      <aside className="admin-sidebar" style={sidebarStyle}>
        <div style={sidebarBrandStyle}>
          <img
            src="/rafinity.png"
            alt="Rafinity"
            style={{
              height: 30,
              width: "auto",
              objectFit: "contain",
            }}
          />

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
            }}
          >
            <div
              style={{
                fontSize: 15,
                fontWeight: 800,
                color: "#2b2a22",
              }}
            >
              Gestion d'inventaire
            </div>
          </div>
        </div>

        <div style={{ padding: "18px 14px 6px" }}>
          <div style={navSectionLabelStyle}>Menu</div>
        </div>
        <nav
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 4,
            padding: "0 12px",
            flex: 1,
          }}
        >
          {NAV_ITEMS.map((item) => {
            const isActive = activeNav === item.key;
            return (
              <div key={item.key}>
                <button
                  className={`admin-nav-btn${isActive ? " active" : ""}`}
                  onClick={() => goTo(item.key)}
                  style={{
                    ...navBtnStyle,
                    color: isActive ? "#6b6242" : "#59543f",
                    fontWeight: isActive ? 700 : 600,
                    borderLeft: isActive
                      ? "3px solid #bdb184"
                      : "3px solid transparent",
                  }}
                >
                  <span
                    style={{
                      display: "flex",
                      width: 18,
                      color: isActive ? "#6b6242" : "#9a927a",
                    }}
                  >
                    {item.icon}
                  </span>
                  {item.label}
                </button>
                {item.key === "inventory" && activeInventory && (
                  <div style={sidebarInventoryChipStyle}>
                    <span style={liveDotStyle} />
                    <div style={{ minWidth: 0 }}>
                      <div
                        style={{
                          fontSize: 11.5,
                          fontWeight: 700,
                          color: "#3b6d11",
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {activeInventory.label ??
                          activeInventory.inventory_date}
                      </div>
                      <div style={{ fontSize: 10.5, color: "#7f9457" }}>
                        {activeInventory.inventory_date}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </nav>

        <div style={sidebarFooterStyle}>
          <div style={userChipStyle}>
            <div style={avatarStyle}>
              {initials(undefined, undefined, user?.username)}
            </div>
            <div style={{ minWidth: 0 }}>
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 700,
                  color: "#2b2a22",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {user?.username}
              </div>
              <div style={{ fontSize: 11, color: "#9a927a" }}>
                Administrateur
              </div>
            </div>
          </div>
          <button
            className="admin-logout-btn"
            onClick={logout}
            style={logoutBtnStyle}
          >
            <LogoutIcon />
            Déconnexion
          </button>
        </div>
      </aside>

      <div className="admin-main" style={mainStyle}>
        {/* Mobile top nav */}
        <div className="admin-mobile-nav" style={mobileNavStyle}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "12px 14px 4px",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <img
                src="/rafinity.png"
                alt="Rafinity"
                style={{ height: 24, width: "auto" }}
              />
              <strong style={{ fontSize: 14 }}>Administration</strong>
            </div>
            {activeInventory && (
              <div style={mobileInventoryChipStyle}>
                <span style={liveDotStyle} />
                {activeInventory.inventory_date}
              </div>
            )}
          </div>
          <div
            style={{
              display: "flex",
              gap: 6,
              overflowX: "auto",
              padding: "4px 14px 12px",
            }}
          >
            {NAV_ITEMS.map((item) => (
              <button
                key={item.key}
                className={`admin-nav-btn${activeNav === item.key ? " active" : ""}`}
                onClick={() => goTo(item.key)}
                style={{
                  ...mobileNavBtnStyle,
                  color: activeNav === item.key ? "#6b6242" : "#59543f",
                }}
              >
                {item.icon}
                {item.label}
              </button>
            ))}
            <button
              className="admin-logout-btn"
              onClick={logout}
              style={mobileLogoutBtnStyle}
            >
              <LogoutIcon />
              Sortir
            </button>
          </div>
        </div>

        <main className="admin-content" style={contentStyle}>
          {view.kind === "days" && (
            <DaysView
              days={days}
              loading={loading}
              onSelectDay={(date) => setView({ kind: "day", date })}
            />
          )}
          {view.kind === "day" && (
            <DayUsersView
              date={view.date}
              days={days}
              onBack={() => setView({ kind: "days" })}
              onSelectUser={(userId) =>
                setView({ kind: "user", date: view.date, userId })
              }
              onMerge={() => setView({ kind: "merged", date: view.date })}
            />
          )}
          {view.kind === "user" && (
            <UserScansView
              date={view.date}
              userId={view.userId}
              onBack={() => setView({ kind: "day", date: view.date })}
            />
          )}
          {view.kind === "merged" && (
            <MergedView
              date={view.date}
              onBack={() => setView({ kind: "day", date: view.date })}
            />
          )}
          {view.kind === "inventory" && (
            <InventoryView
              activeInventory={activeInventory}
              onChanged={(inv) => setActiveInventory(inv)}
            />
          )}
          {view.kind === "photos" && <PhotoImportView />}
          {view.kind === "deletions" && <DeletionsView />}
          {view.kind === "users" && <UserManagementView />}
        </main>
      </div>
    </div>
  );
}

// --------------------------------------------------------------------- //
function DaysView({
  days,
  loading,
  onSelectDay,
}: {
  days: DaySummaryDto[];
  loading: boolean;
  onSelectDay: (date: string) => void;
}) {
  const [selectedDate, setSelectedDate] = useState("");

  if (loading) return <PageSkeleton />;

  const filteredDays = days.filter(
    (day) => !selectedDate || day.date === selectedDate
  );

  return (
    <div>
      <PageHeader
        title="Scans par journée"
        subtitle="Consultez les codes scannés, jour par jour"
      />
      <div
        style={{
          marginBottom: 14,
          display: "flex",
          alignItems: "center",
          gap: 10,
          flexWrap: "wrap",
        }}
      >
        <input
          type="date"
          value={selectedDate}
          onChange={(e) => setSelectedDate(e.target.value)}
          className="admin-input"
          style={{
            ...inputStyle,
            width: "100%",
            maxWidth: 280,
            padding: "9px 12px",
          }}
        />
        {selectedDate && (
          <button
            onClick={() => setSelectedDate("")}
            style={{
              ...ghostBtnStyle,
              padding: "9px 12px",
              fontSize: 13,
              fontWeight: 600,
              whiteSpace: "nowrap",
            }}
          >
            Réinitialiser
          </button>
        )}
      </div>
      {days.length === 0 ? (
        <EmptyState text="Aucun scan enregistré pour l'instant." />
      ) : filteredDays.length === 0 ? (
        <EmptyState text="Aucune journée ne correspond à cette date." />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {filteredDays.map((d) => (
            <button
              key={d.date}
              className="admin-row-btn"
              onClick={() => onSelectDay(d.date)}
              style={cardBtnStyle}
            >
              <div>
                <div
                  style={{ fontWeight: 700, fontSize: 15, color: "#2b2a22" }}
                >
                  {d.date}
                </div>
                <div style={{ fontSize: 13, color: "#9a927a", marginTop: 2 }}>
                  {d.users.length} utilisateur{d.users.length > 1 ? "s" : ""} ·{" "}
                  {d.total_scans} code
                  {d.total_scans > 1 ? "s" : ""}
                </div>
              </div>
              <ChevronIcon />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// --------------------------------------------------------------------- //
function DayUsersView({
  date,
  days,
  onBack,
  onSelectUser,
  onMerge,
}: {
  date: string;
  days: DaySummaryDto[];
  onBack: () => void;
  onSelectUser: (userId: string) => void;
  onMerge: () => void;
}) {
  const day = days.find((d) => d.date === date);

  return (
    <div>
      <BackButton onClick={onBack} label="Toutes les journées" />
      <div style={headerRowStyle}>
        <PageHeader
          title={date}
          subtitle={`${day?.users.length ?? 0} utilisateur(s) actif(s) ce jour`}
          noMargin
        />
        <PrimaryButton onClick={onMerge}>Fusionner la journée</PrimaryButton>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {day?.users.map((u) => (
          <button
            key={u.user_id}
            className="admin-row-btn"
            onClick={() => onSelectUser(u.user_id)}
            style={cardBtnStyle}
          >
            <div>
              <div style={{ fontWeight: 700, fontSize: 15, color: "#2b2a22" }}>
                {u.prenom} {u.nom}{" "}
                <span style={{ fontWeight: 400, color: "#9a927a" }}>
                  ({u.username})
                </span>
              </div>
              <div style={{ fontSize: 13, color: "#9a927a", marginTop: 2 }}>
                {u.count} code{u.count > 1 ? "s" : ""} scanné
                {u.count > 1 ? "s" : ""}
              </div>
            </div>
            <ChevronIcon />
          </button>
        ))}
      </div>
    </div>
  );
}

// --------------------------------------------------------------------- //
// function UserScansView({
//   date,
//   userId,
//   onBack,
// }: {
//   date: string;
//   userId: string;
//   onBack: () => void;
// }) {
//   const { token } = useAuth();
//   const [data, setData] = useState<UserDayScansDto | null>(null);

//   useEffect(() => {
//     if (!token) return;
//     adminUserDayScans(token, date, userId).then(setData);
//   }, [token, date, userId]);

//   if (!data) return <PageSkeleton />;

//   return (
//     <div>
//       <BackButton onClick={onBack} label={date} />
//       <div style={headerRowStyle}>
//         <PageHeader
//           title={`${data.user.prenom} ${data.user.nom}`}
//           subtitle={date}
//           noMargin
//         />
//         <PrimaryButton
//           onClick={() => token && adminDownloadDayCsv(token, date, userId)}
//         >
//           <DownloadIcon size={15} /> Export CSV
//         </PrimaryButton>
//       </div>
//       <CodeTable
//         rows={data.scans.map((s) => ({
//           code: s.code,
//           meta: s.method,
//           scan_date: s.scan_date,
//         }))}
//         metaLabel="Méthode"
//       />
//     </div>
//   );
// }
function UserScansView({
  date,
  userId,
  onBack,
}: {
  date: string;
  userId: string;
  onBack: () => void;
}) {
  const { token } = useAuth();
  const [data, setData] = useState<UserDayScansDto | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<ScanDto | null>(null);
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);

  useEffect(() => {
    if (!token) return;
    adminUserDayScans(token, date, userId).then(setData);
  }, [token, date, userId]);

  if (!data) return <PageSkeleton />;

  const filteredScans = data.scans.filter((scan) =>
    scan.code.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const deleteSelectedScan = async () => {
    if (!token || !deleteTarget) return;
    try {
      await adminDeleteUserScan(token, date, userId, deleteTarget.id);
      setData((current) => current ? { ...current, scans: current.scans.filter((scan) => scan.id !== deleteTarget.id) } : current);
      setToast({ type: "success", message: `Le code ${deleteTarget.code} a été supprimé pour ${data.user.username}.` });
    } catch (error) {
      setToast({ type: "error", message: error instanceof Error ? error.message : "Impossible de supprimer ce code." });
    } finally {
      setDeleteTarget(null);
    }
  };

  return (
    <div>
      <BackButton onClick={onBack} label={date} />
      <div style={headerRowStyle}>
        <PageHeader
          title={`${data.user.prenom} ${data.user.nom}`}
          subtitle={date}
          noMargin
        />
        <PrimaryButton
          onClick={() => token && adminDownloadDayCsv(token, date, userId)}
        >
          <DownloadIcon size={15} /> Export Excel
        </PrimaryButton>
      </div>

      {/* Barre de recherche */}
      <div style={{ 
        display: "flex", 
        gap: 10, 
        marginBottom: 16,
        alignItems: "center"
      }}>
        <div style={{ position: "relative", flex: 1, maxWidth: 350 }}>
          <input
            type="text"
            placeholder="Rechercher un code..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="admin-input"
            style={{
              ...inputStyle,
              padding: "9px 14px",
              paddingLeft: 36,
              width: "100%",
            }}
          />
          <span style={{
            position: "absolute",
            left: 12,
            top: "50%",
            transform: "translateY(-50%)",
            color: "#9a927a",
            fontSize: 14,
          }}>🔍</span>
          {searchTerm && (
            <button
              onClick={() => setSearchTerm("")}
              style={{
                position: "absolute",
                right: 12,
                top: "50%",
                transform: "translateY(-50%)",
                background: "none",
                border: "none",
                color: "#9a927a",
                cursor: "pointer",
                fontSize: 16,
                padding: 0,
              }}
            >
              ✕
            </button>
          )}
        </div>
        <span style={{ 
          fontSize: 13, 
          color: "#9a927a",
          whiteSpace: "nowrap"
        }}>
          {filteredScans.length} / {data.scans.length} codes
        </span>
      </div>

      <CodeTable
        rows={filteredScans.map((s) => ({
          code: s.code,
          meta: s.method,
          scan_date: s.scan_date,
          action: <button type="button" onClick={() => setDeleteTarget(s)} style={adminDeleteButtonStyle}>Supprimer</button>,
        }))}
        metaLabel="Méthode"
      />
      {toast && <AdminToast toast={toast} onClose={() => setToast(null)} />}
      {deleteTarget && (
        <ConfirmDialog
          title="Supprimer ce code ?"
          message={`Le code ${deleteTarget.code} sera enregistré comme supprimé par ${data.user.username}.`}
          confirmLabel="Supprimer"
          onCancel={() => setDeleteTarget(null)}
          onConfirm={deleteSelectedScan}
        />
      )}
    </div>
  );
}
// --------------------------------------------------------------------- //
// function MergedView({ date, onBack }: { date: string; onBack: () => void }) {
//   const { token } = useAuth();
//   const [data, setData] = useState<MergedDayDto | null>(null);

//   useEffect(() => {
//     if (!token) return;
//     adminMergedDay(token, date).then(setData);
//   }, [token, date]);

//   if (!data) return <PageSkeleton />;

//   return (
//     <div>
//       <BackButton onClick={onBack} label={date} />
//       <div style={headerRowStyle}>
//         <PageHeader
//           title={`Fusion · ${date}`}
//           subtitle={
//             <>
//               {data.total_unique_codes} code
//               {data.total_unique_codes > 1 ? "s" : ""} unique
//               {data.total_unique_codes > 1 ? "s" : ""}
//               {data.conflicts > 0 && (
//                 <span style={{ color: "#b8862f", fontWeight: 700 }}>
//                   {" "}
//                   · {data.conflicts} scanné{data.conflicts > 1 ? "s" : ""} par
//                   plusieurs utilisateurs
//                 </span>
//               )}
//             </>
//           }
//           noMargin
//         />
//         <PrimaryButton
//           onClick={() => token && adminDownloadDayCsv(token, date)}
//         >
//           <DownloadIcon size={15} /> Export CSV fusionné
//         </PrimaryButton>
//       </div>
//       <CodeTable
//         rows={data.codes.map((c) => ({
//           code: c.code,
//           meta: c.users.length > 1 ? c.users.join(", ") : c.users[0],
//           warn: c.users.length > 1,
//         }))}
//         metaLabel="Utilisateur(s)"
//         showScanDate={false} // Masquer la colonne Date Scan
//       />
//     </div>
//   );
// }

function MergedView({ date, onBack }: { date: string; onBack: () => void }) {
  const { token } = useAuth();
  const [data, setData] = useState<MergedDayDto | null>(null);
  const [searchTerm, setSearchTerm] = useState("");

  useEffect(() => {
    if (!token) return;
    adminMergedDay(token, date).then(setData);
  }, [token, date]);

  if (!data) return <PageSkeleton />;

  // Filtrer les codes par recherche
  const filteredCodes = data.codes.filter((c) =>
    c.code.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div>
      <BackButton onClick={onBack} label={date} />
      <div style={headerRowStyle}>
        <PageHeader
          title={`Fusion · ${date}`}
          subtitle={
            <>
              {data.total_unique_codes} code
              {data.total_unique_codes > 1 ? "s" : ""} unique
              {data.total_unique_codes > 1 ? "s" : ""}
              {data.conflicts > 0 && (
                <span style={{ color: "#b8862f", fontWeight: 700 }}>
                  {" "}
                  · {data.conflicts} scanné{data.conflicts > 1 ? "s" : ""} par
                  plusieurs utilisateurs
                </span>
              )}
            </>
          }
          noMargin
        />
        <PrimaryButton
          onClick={() => token && adminDownloadDayCsv(token, date)}
        >
          <DownloadIcon size={15} /> Export Excel fusionné
        </PrimaryButton>
      </div>

      {/* Barre de recherche */}
      <div style={{ 
        display: "flex", 
        gap: 10, 
        marginBottom: 16,
        alignItems: "center"
      }}>
        <div style={{ position: "relative", flex: 1, maxWidth: 350 }}>
          <input
            type="text"
            placeholder="Rechercher un code..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="admin-input"
            style={{
              ...inputStyle,
              padding: "9px 14px",
              paddingLeft: 36,
              width: "100%",
            }}
          />
          <span style={{
            position: "absolute",
            left: 12,
            top: "50%",
            transform: "translateY(-50%)",
            color: "#9a927a",
            fontSize: 14,
          }}>🔍</span>
          {searchTerm && (
            <button
              onClick={() => setSearchTerm("")}
              style={{
                position: "absolute",
                right: 12,
                top: "50%",
                transform: "translateY(-50%)",
                background: "none",
                border: "none",
                color: "#9a927a",
                cursor: "pointer",
                fontSize: 16,
                padding: 0,
              }}
            >
              ✕
            </button>
          )}
        </div>
        <span style={{ 
          fontSize: 13, 
          color: "#9a927a",
          whiteSpace: "nowrap"
        }}>
          {filteredCodes.length} / {data.codes.length} codes
        </span>
      </div>

      <CodeTable
        rows={filteredCodes.map((c) => ({
          code: c.code,
          meta: c.users.length > 1 ? c.users.join(", ") : c.users[0],
          warn: c.users.length > 1,
          // scan_date supprimé comme demandé
        }))}
        metaLabel="Utilisateur(s)"
        showScanDate={false}
      />
    </div>
  );
}

// --------------------------------------------------------------------- //
function CodeTable({
  rows,
  metaLabel,
  showScanDate = true, // Ajout d'un paramètre optionnel
}: {
  rows: {
    code: string;
    meta: string;
    warn?: boolean;
    scan_date?: string; // scan_date devient optionnel
    action?: ReactNode;
  }[];
  metaLabel: string;
  showScanDate?: boolean; // Nouveau paramètre
}) {
  return (
    <div style={tableWrapStyle}>
      <div style={tableHeadStyle}>
        <div style={{ flex: 1 }}>Code</div>
        <div style={{ flex: 1 }}>{metaLabel}</div>
        {showScanDate && <div style={{ flex: 1 }}>Date Scan</div>}{" "}
        {/* Conditionnel */}
      </div>
      <div style={{ maxHeight: 520, overflowY: "auto" }}>
        {rows.map((r, i) => (
          <div
            key={i}
            style={{
              ...tableRowStyle,
              borderBottom: i < rows.length - 1 ? "1px solid #eeece0" : "none",
            }}
          >
            <div
              style={{
                flex: 1,
                fontFamily: "ui-monospace, monospace",
                fontWeight: 700,
                fontSize: 13.5,
                color: "#2b2a22",
              }}
            >
              {r.code}
            </div>
            <div
              style={{
                flex: 1,
                color: r.warn ? "#b8862f" : "#8b8574",
                fontWeight: r.warn ? 700 : 400,
                fontSize: 13.5,
              }}
            >
              {r.warn && "⚠ "}
              {r.meta}
            </div>
            {showScanDate /* Conditionnel */ && (
              <div
                style={{
                  flex: 1,
                  fontWeight: 400,
                  fontSize: 13.5,
                }}
              >
                {r.scan_date}
              </div>
            )}
            {r.action && <div style={{ width: 90, textAlign: "right" }}>{r.action}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}
// --------------------------------------------------------------------- //
function InventoryView({
  activeInventory,
  onChanged,
}: {
  activeInventory: ActiveInventoryDto | null;
  onChanged: (inv: ActiveInventoryDto | null) => void;
}) {
  const { token } = useAuth();
  const [date, setDate] = useState(activeInventory?.inventory_date ?? "");
  const [label, setLabel] = useState(activeInventory?.label ?? "");
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(null), 3000);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  const handleSet = async () => {
    if (!token || !date) return;
    try {
      const inv = await adminSetInventory(token, {
        inventory_date: date,
        label: label || undefined,
      });
      onChanged(inv);
      setToast({ type: "success", message: `Inventaire actif défini sur ${date}.` });
    } catch (err) {
      setToast({
        type: "error",
        message: err instanceof Error ? err.message : "Erreur lors de la mise à jour de l'inventaire.",
      });
    }
  };

  const handleClear = async () => {
    if (!token) return;
    setConfirmClear(false);
    try {
      await adminClearInventory(token);
      onChanged(null);
      setToast({ type: "success", message: "Inventaire actif supprimé." });
    } catch (err) {
      setToast({
        type: "error",
        message: err instanceof Error ? err.message : "Erreur lors de la suppression de l'inventaire.",
      });
    }
  };

  return (
    <div>
      <PageHeader
        title="Inventaire actif"
        subtitle="Contrôlez sous quelle date les scans sont enregistrés"
      />

      {activeInventory ? (
        <div style={activeInventoryCardStyle}>
          <div
            style={{
              display: "flex",
              alignItems: "flex-start",
              justifyContent: "space-between",
              gap: 12,
              flexWrap: "wrap",
            }}
          >
            <div>
              <StatusBadge tone="success">Actif</StatusBadge>
              <div
                style={{
                  fontWeight: 800,
                  fontSize: 16,
                  color: "#2b2a22",
                  marginTop: 8,
                }}
              >
                {activeInventory.label ?? activeInventory.inventory_date}
              </div>
              <div style={{ fontSize: 13, color: "#8b8574", marginTop: 4 }}>
                Date :{" "}
                <strong style={{ color: "#59543f" }}>
                  {activeInventory.inventory_date}
                </strong>{" "}
                · Défini par{" "}
                <strong style={{ color: "#59543f" }}>
                  {activeInventory.set_by_username}
                </strong>{" "}
                le {new Date(activeInventory.set_at * 1000).toLocaleString()}
              </div>
            </div>
            <DangerButton onClick={() => setConfirmClear(true)}>Désactiver</DangerButton>
          </div>
        </div>
      ) : (
        <EmptyState text="Aucun inventaire actif. Les scanners enregistrent sous la date du jour." />
      )}

      <div style={panelStyle}>
        <div
          style={{
            fontWeight: 700,
            marginBottom: 14,
            fontSize: 14.5,
            color: "#2b2a22",
          }}
        >
          {activeInventory ? "Modifier" : "Définir"} l'inventaire actif
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <FieldGroup label="Date d'inventaire *">
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="admin-input"
              style={inputStyle}
            />
          </FieldGroup>
          <FieldGroup label="Libellé (optionnel)">
            <input
              className="admin-input"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              style={inputStyle}
            />
          </FieldGroup>
        </div>
        <PrimaryButton
          onClick={handleSet}
          disabled={!date}
          style={{ marginTop: 16 }}
        >
          Activer cet inventaire
        </PrimaryButton>
      </div>

      <p style={hintTextStyle}>
        Une fois un inventaire actif défini, tous les scanners enregistrent
        leurs codes sous la date d'inventaire choisie (et non la date réelle du
        scan). Les scanners connectés détectent le changement en moins de 30
        secondes automatiquement.
      </p>

      {toast && (
        <AdminToast toast={toast} onClose={() => setToast(null)} />
      )}
      {confirmClear && (
        <ConfirmDialog
          title="Désactiver l’inventaire actif ?"
          message="Les prochains scans utiliseront automatiquement la date du jour."
          confirmLabel="Désactiver"
          onCancel={() => setConfirmClear(false)}
          onConfirm={handleClear}
        />
      )}
    </div>
  );
}

// --------------------------------------------------------------------- //
function PhotoImportView() {
  const { token } = useAuth();
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [jobs, setJobs] = useState<BulkPhotoJobDto[]>([]);
  const [history, setHistory] = useState<BulkPhotoJobDto[]>([]);
  const [historyDate, setHistoryDate] = useState("");
  const [expandedJobIds, setExpandedJobIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [confirmUpload, setConfirmUpload] = useState(false);
  const knownJobStatuses = useRef<Map<string, BulkPhotoJobDto["status"]> | null>(null);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(null), 3000);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  const selectedSize = files.reduce((total, file) => total + file.size, 0);
  const displayJobs = [...jobs, ...history].sort(
    (a, b) => (b.created_at ?? 0) - (a.created_at ?? 0),
  );
  const selectedFolderCounts = Array.from(
    files.reduce((folders, file) => {
      const path = file.webkitRelativePath || file.name;
      const parts = path.split("/").filter(Boolean);
      const folderName = parts.length >= 3 ? parts[parts.length - 2] : "Dossier utilisateur";
      folders.set(folderName, (folders.get(folderName) ?? 0) + 1);
      return folders;
    }, new Map<string, number>()),
  );
  const selectedParentFolder = files[0]
    ? (files[0].webkitRelativePath || files[0].name)
        .split("/")
        .filter(Boolean)[0]
    : "";
  const formatSize = (bytes: number) => {
    if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} Ko`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
  };

  const handleFolderSelection = (event: ChangeEvent<HTMLInputElement>) => {
    setFiles(Array.from(event.target.files ?? []));
  };

  const openParentFolder = async () => {
    const directoryPicker = (
      window as Window & {
        showDirectoryPicker?: () => Promise<unknown>;
      }
    ).showDirectoryPicker;

    if (!directoryPicker || !window.isSecureContext) {
      inputRef.current?.click();
      return;
    }

    try {
      const directory: any = await directoryPicker();
      const selectedFiles: File[] = [];

      const collectFiles = async (handle: any, path: string): Promise<void> => {
        for await (const entry of handle.values()) {
          const entryPath = `${path}/${entry.name}`;
          if (entry.kind === "directory") {
            await collectFiles(entry, entryPath);
            continue;
          }
          if (entry.kind !== "file") continue;

          const file = await entry.getFile();
          if (!file.type.startsWith("image/")) continue;
          Object.defineProperty(file, "webkitRelativePath", {
            configurable: true,
            value: entryPath,
          });
          selectedFiles.push(file);
        }
      };

      await collectFiles(directory, directory.name);
      setFiles(selectedFiles);
      if (selectedFiles.length === 0) {
        setToast({ type: "error", message: "Aucune image trouvée dans ce dossier." });
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setToast({ type: "error", message: "Impossible de lire le dossier sélectionné." });
    }
  };

  const loadJobs = async () => {
    if (!token) return;
    try {
      const activeJobs = await adminListPhotoJobs(token);
      let completedJobs: BulkPhotoJobDto[] = [];
      try {
        completedJobs = await adminListPhotoHistory(token, historyDate || undefined);
      } catch (error) {
        setToast({
          type: "error",
          message: error instanceof Error ? `Historique photo: ${error.message}` : "Impossible de charger l'historique photo.",
        });
      }
      const allJobs = [...activeJobs, ...completedJobs];
      const previousStatuses = knownJobStatuses.current;
      const statusChangedJob = previousStatuses
        ? allJobs.find(
            (job) =>
              job.status === "completed" &&
              previousStatuses.get(job.id) !== "completed" &&
              previousStatuses.get(job.id) !== undefined,
          )
        : null;
      if (statusChangedJob && !historyDate) {
        setToast({
          type: "success",
          message: `Le traitement photo de ${statusChangedJob.total_photos} image(s) est terminé.`,
        });
      }
      knownJobStatuses.current = new Map(allJobs.map((job) => [job.id, job.status]));
      setJobs(activeJobs);
      setHistory(completedJobs);
    } catch (error) {
      setToast({
        type: "error",
        message: error instanceof Error ? `Traitements photo: ${error.message}` : "Impossible de charger les traitements photo.",
      });
    }
  };

  useEffect(() => {
    void loadJobs();
    const timer = window.setInterval(() => void loadJobs(), 5000);
    return () => window.clearInterval(timer);
  }, [token, historyDate]);

  const launch = async () => {
    if (!token || files.length === 0) return;
    setConfirmUpload(false);
    setLoading(true);
    setToast(null);
    try {
      const job = await adminCreatePhotoJob(token, files);
      setJobs((current) => [job, ...current]);
      setFiles([]);
      setToast({ type: "success", message: "Le traitement a été lancé en arrière-plan." });
    } catch (error) {
      setToast({ type: "error", message: error instanceof Error ? error.message : "Échec du lancement." });
    } finally {
      setLoading(false);
    }
  };

  const toggleJob = (jobId: string) => {
    setExpandedJobIds((current) => {
      const next = new Set(current);
      if (next.has(jobId)) next.delete(jobId);
      else next.add(jobId);
      return next;
    });
  };

  return (
    <div>
      <PageHeader
        title="Import de photos"
        subtitle="Sélectionnez un dossier parent contenant un sous-dossier par utilisateur"
      />
      <div style={panelStyle}>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          {...({ webkitdirectory: "", directory: "" } as object)}
          style={{ display: "none" }}
          onChange={handleFolderSelection}
        />
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <PrimaryButton onClick={() => void openParentFolder()}>
            <FolderIcon size={17} /> Choisir le dossier parent
          </PrimaryButton>
          <span style={{ color: "#6f6a58", fontSize: 13 }}>
              {files.length
                ? `Dossier prêt à être envoyé · ${selectedParentFolder}`
                : "Aucun dossier sélectionné"}
          </span>
        </div>
        {files.length > 0 && (
          <div style={photoSelectionStyle}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
              <strong style={{ color: "#2b2a22" }}>Contenu sélectionné</strong>
              <span style={{ color: "#6f6a58", fontSize: 13 }}>{formatSize(selectedSize)}</span>
            </div>
            <div style={{ color: "#6f6a58", fontSize: 13, marginTop: 8 }}>
              {selectedFolderCounts.length} sous-dossier{selectedFolderCounts.length > 1 ? "s" : ""} · {files.length} image{files.length > 1 ? "s" : ""} au total
            </div>
            <div style={folderListStyle}>
              {selectedFolderCounts.map(([folder, count]) => (
                <span key={folder} style={folderChipStyle}>📁 {folder} · {count} image{count > 1 ? "s" : ""}</span>
              ))}
            </div>
          </div>
        )}

        <PrimaryButton onClick={() => setConfirmUpload(true)} disabled={loading || files.length === 0} style={{ marginTop: 16 }}>
          {loading ? "Envoi…" : "Lancer le traitement"}
        </PrimaryButton>
      </div>

      <div style={{ marginTop: 24, display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={photoHistoryFilterStyle}>
          <div>
            <div style={{ fontWeight: 800, color: "#2b2a22" }}>Historique des traitements</div>
            <div style={{ color: "#8b8574", fontSize: 12.5, marginTop: 3 }}>Les résultats terminés sont conservés dans la base de données.</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <input
              type="date"
              value={historyDate}
              onChange={(event) => setHistoryDate(event.target.value)}
              className="admin-input"
              style={{ ...inputStyle, width: "auto", minWidth: 170 }}
              aria-label="Filtrer l'historique par date d'inventaire"
            />
            {historyDate && (
              <button
                type="button"
                onClick={() => setHistoryDate("")}
                style={{
                  border: "1px solid #d4cfb5",
                  background: "#f7f5ef",
                  color: "#534e41",
                  borderRadius: 8,
                  padding: "7px 10px",
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                Réinitialiser
              </button>
            )}
          </div>
        </div>
        {displayJobs.map((job) => (
          <div key={job.id} style={{ ...panelStyle, padding: 16 }}>
            <button
              type="button"
              onClick={() => toggleJob(job.id)}
              aria-expanded={expandedJobIds.has(job.id)}
              style={jobHeaderButtonStyle}
            >
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 700, color: "#2b2a22" }}>
                  <span style={{ ...jobChevronStyle, transform: expandedJobIds.has(job.id) ? "rotate(90deg)" : "rotate(0deg)" }}>›</span>
                  {job.status === "completed" ? "Traitement terminé" : job.status === "failed" ? "Traitement interrompu" : <AnimatedProcessingLabel status={job.status} />}
                </div>
                <div style={{ color: "#8b8574", fontSize: 13, marginTop: 4 }}>
                  {job.processed_photos}/{job.total_photos} photos traitées · Inventaire {job.inventory_date} · {formatJobDuration(job)}
                </div>
                {(job.status === "queued" || job.status === "processing") && (
                  <div style={processingTrackStyle} aria-label="Traitement en cours">
                    <div style={{ ...processingBarStyle, width: job.total_photos ? `${Math.max(8, (job.processed_photos / job.total_photos) * 100)}%` : "18%" }} />
                  </div>
                )}
              </div>
              <StatusBadge tone={job.status === "completed" ? "success" : job.status === "failed" ? "danger" : "info"}>
                {job.status === "queued" ? "En attente" : job.status === "processing" ? "En cours" : job.status === "completed" ? "Terminé" : "Erreur"}
              </StatusBadge>
            </button>
            {job.status === "completed" && expandedJobIds.has(job.id) && (
              <div style={jobSummaryGridStyle}>
                <SummaryMetric label="Codes détectés" value={job.codes_found} />
                <SummaryMetric label="Ajoutés" value={job.added} tone="success" />
                <SummaryMetric label="Doublons ignorés" value={job.duplicates} tone="warning" />
                <SummaryMetric label="Photos traitées" value={`${job.processed_photos}/${job.total_photos}`} />
              </div>
            )}
            {job.user_results?.length > 0 && expandedJobIds.has(job.id) && (
              <div style={userPhotoResultsStyle}>
                <div style={userPhotoResultsTitleStyle}>Résultats par utilisateur</div>
                <div style={userPhotoResultsGridStyle}>
                  {job.user_results.map((result) => (
                    <div key={result.user_id} style={userPhotoResultStyle}>
                      <div style={{ fontWeight: 800, color: "#2b2a22" }}>{result.username}</div>
                      <div style={userPhotoResultMetaStyle}>
                        {result.processed_photos}/{result.total_photos} photos · {result.codes_found} codes détectés
                      </div>
                      {result.codes.length > 0 && (
                        <CompactCodeChips codes={result.codes} />
                      )}
                      <div style={userPhotoResultStatsStyle}>
                        <span style={{ color: "#3b7d2a" }}>{result.added} ajoutés</span>
                        <span style={{ color: "#a15c08" }}>{result.duplicates} doublons</span>
                        {result.skipped > 0 && <span>{result.skipped} ignorées</span>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {job.status === "failed" && job.error && expandedJobIds.has(job.id) && <div style={jobErrorStyle}>{job.error}</div>}
          </div>
        ))}
      </div>
      {toast && (
        <AdminToast toast={toast} onClose={() => setToast(null)} />
      )}
      {confirmUpload && (
        <ConfirmDialog
          title="Lancer le traitement des photos ?"
          message={`${files.length} photo${files.length > 1 ? "s" : ""} seront envoyée${files.length > 1 ? "s" : ""} et analysée${files.length > 1 ? "s" : ""} par lecture de codes-barres.`}
          confirmLabel="Envoyer et traiter"
          onCancel={() => setConfirmUpload(false)}
          onConfirm={launch}
        />
      )}
    </div>
  );
}

function CompactCodeChips({ codes, maxVisible = 6 }: { codes: string[]; maxVisible?: number }) {
  const [expanded, setExpanded] = useState(false);
  const hasMore = codes.length > maxVisible;
  const visibleCodes = expanded ? codes : codes.slice(0, maxVisible);
  const hiddenCount = hasMore ? codes.length - maxVisible : 0;

  return (
    <div style={compactCodeListStyle} title={codes.join(", ")}>
      {visibleCodes.map((code) => (
        <span key={code} style={compactCodePillStyle}>{code}</span>
      ))}
      {hasMore && (
        <button
          type="button"
          onClick={() => setExpanded((current) => !current)}
          style={compactCodeToggleStyle}
          aria-label={expanded ? "Masquer les codes" : `Afficher les ${hiddenCount} codes supplémentaires`}
        >
          {expanded ? "Masquer" : `+${hiddenCount}`}
        </button>
      )}
    </div>
  );
}

function AnimatedProcessingLabel({ status }: { status: BulkPhotoJobDto["status"] }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
      {status === "queued" ? "Préparation du traitement" : "Lecture des codes-barres"}
      <span aria-hidden="true" style={{ display: "inline-flex", gap: 3 }}>
        {[0, 1, 2].map((dot) => <span key={dot} style={{ ...processingDotStyle, animationDelay: `${dot * 140}ms` }}>•</span>)}
      </span>
    </span>
  );
}

function formatJobDuration(job: BulkPhotoJobDto): string {
  const start = job.started_at ?? job.created_at;
  const end = job.finished_at ?? Date.now() / 1000;
  const totalSeconds = Math.max(0, Math.round(end - start));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) return `Durée ${hours} h ${minutes} min`;
  if (minutes > 0) return `Durée ${minutes} min ${seconds} s`;
  return `Durée ${seconds} s`;
}

function AdminToast({
  toast,
  onClose,
}: {
  toast: { type: "success" | "error"; message: string };
  onClose: () => void;
}) {
  return (
    <div role="alert" style={{ ...photoToastStyle, background: toast.type === "error" ? "#b42318" : "#287d3c" }}>
      <strong>{toast.type === "error" ? "Action impossible" : "Opération réussie"}</strong>
      <span>{toast.message}</span>
      <button type="button" aria-label="Fermer" onClick={onClose} style={toastCloseStyle}>×</button>
    </div>
  );
}

function ConfirmDialog({
  title,
  message,
  confirmLabel,
  onCancel,
  onConfirm,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div role="presentation" style={dialogBackdropStyle} onMouseDown={onCancel}>
      <div role="dialog" aria-modal="true" aria-labelledby="admin-dialog-title" style={dialogStyle} onMouseDown={(event) => event.stopPropagation()}>
        <div style={dialogIconStyle}>!</div>
        <h2 id="admin-dialog-title" style={dialogTitleStyle}>{title}</h2>
        <p style={dialogMessageStyle}>{message}</p>
        <div style={dialogActionsStyle}>
          <button type="button" onClick={onCancel} style={dialogCancelStyle}>Annuler</button>
          <DangerButton onClick={onConfirm}>{confirmLabel}</DangerButton>
        </div>
      </div>
    </div>
  );
}

function SummaryMetric({ label, value, tone = "default" }: { label: string; value: number | string; tone?: "default" | "success" | "warning" }) {
  return <div style={{ background: "#faf9f5", border: "1px solid #eeece0", borderRadius: 10, padding: "9px 10px" }}><div style={{ fontSize: 18, fontWeight: 800, color: tone === "success" ? "#3b7d2a" : tone === "warning" ? "#a15c08" : "#2b2a22" }}>{value}</div><div style={{ color: "#8b8574", fontSize: 11.5, marginTop: 2 }}>{label}</div></div>;
}

// --------------------------------------------------------------------- //
// function DeletionsView() {
//   const { token } = useAuth();
//   const [deletions, setDeletions] = useState<DeletionDto[]>([]);
//   const [filterDate, setFilterDate] = useState("");
//   const [loading, setLoading] = useState(true);

//   const load = async () => {
//     if (!token) return;
//     setLoading(true);
//     try {
//       const data = await adminListDeletions(token, filterDate || undefined);
//       setDeletions(data);
//     } finally {
//       setLoading(false);
//     }
//   };
//   useEffect(() => {
//     load();
//     // eslint-disable-next-line react-hooks/exhaustive-deps
//   }, [token]);

//   return (
//     <div>
//       <PageHeader
//         title="Historique des suppressions"
//         subtitle="Suivi des codes retirés par les utilisateurs"
//       />

//       <div
//         style={{
//           display: "flex",
//           gap: 10,
//           marginBottom: 20,
//           alignItems: "flex-end",
//           flexWrap: "wrap",
//         }}
//       >
//         <FieldGroup label="Filtrer par inventaire">
//           <input
//             type="date"
//             value={filterDate}
//             onChange={(e) => setFilterDate(e.target.value)}
//             className="admin-input"
//             style={inputStyle}
//           />
//         </FieldGroup>
//         <PrimaryButton onClick={load}>Filtrer</PrimaryButton>
//         {filterDate && (
//           <GhostButton onClick={() => setFilterDate("")}>Effacer</GhostButton>
//         )}
//       </div>

//       {loading ? (
//         <PageSkeleton />
//       ) : deletions.length === 0 ? (
//         <EmptyState
//           text={`Aucune suppression enregistrée${filterDate ? ` pour le ${filterDate}` : ""}.`}
//         />
//       ) : (
//         <div style={tableWrapStyle}>
//           <div
//             style={{
//               ...tableHeadStyle,
//               display: "grid",
//               gridTemplateColumns: "1fr 1fr 1fr 1.6fr",
//             }}
//           >
//             <div>Code</div>
//             <div>Utilisateur</div>
//             <div>Inventaire</div>
//             <div>Supprimé le</div>
//           </div>
//           {deletions.map((d, i) => (
//             <div
//               key={d.id}
//               style={{
//                 display: "grid",
//                 gridTemplateColumns: "1fr 1fr 1fr 1.6fr",
//                 padding: "12px 18px",
//                 fontSize: 13.5,
//                 borderBottom:
//                   i < deletions.length - 1 ? "1px solid #eeece0" : "none",
//                 alignItems: "start",
//               }}
//             >
//               <div
//                 style={{
//                   fontFamily: "ui-monospace, monospace",
//                   fontWeight: 700,
//                   color: "#c0564f",
//                 }}
//               >
//                 {d.code}
//               </div>
//               <div style={{ color: "#2b2a22" }}>{d.username}</div>
//               <div style={{ color: "#8b8574" }}>{d.inventory_date}</div>
//               <div style={{ color: "#9a927a", fontSize: 12 }}>
//                 {new Date(d.deleted_at * 1000).toLocaleString()}
//                 {d.reason && (
//                   <div style={{ marginTop: 2, fontStyle: "italic" }}>
//                     « {d.reason} »
//                   </div>
//                 )}
//               </div>
//             </div>
//           ))}
//         </div>
//       )}
//     </div>
//   );
// }
function DeletionsView() {
  const { token } = useAuth();
  const [deletions, setDeletions] = useState<DeletionDto[]>([]);
  const [filterDate, setFilterDate] = useState("");
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(10);

  const load = async (date?: string) => {
    if (!token) return;
    setLoading(true);
    try {
      const data = await adminListDeletions(token, date);
      setDeletions(data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    const totalPages = Math.max(1, Math.ceil(deletions.length / rowsPerPage));
    setPage((currentPage) => Math.min(currentPage, totalPages));
  }, [deletions.length, rowsPerPage]);

  const handleClearFilter = () => {
    setFilterDate("");
    setPage(1);
    load(undefined);
  };

  const handleFilter = () => {
    setPage(1);
    load(filterDate || undefined);
  };

  const totalPages = Math.max(1, Math.ceil(deletions.length / rowsPerPage));
  const startIndex = (page - 1) * rowsPerPage;
  const visibleDeletions = deletions.slice(startIndex, startIndex + rowsPerPage);

  return (
    <div>
      <PageHeader
        title="Historique des suppressions"
        subtitle="Suivi des codes retirés par les utilisateurs"
      />

      <div
        style={{
          display: "flex",
          gap: 10,
          marginBottom: 20,
          alignItems: "flex-end",
          flexWrap: "wrap",
        }}
      >
        <FieldGroup label="Filtrer par inventaire">
          <input
            type="date"
            value={filterDate}
            onChange={(e) => setFilterDate(e.target.value)}
            className="admin-input"
            style={inputStyle}
          />
        </FieldGroup>
        <PrimaryButton onClick={handleFilter}>Filtrer</PrimaryButton>
        {filterDate && (
          <GhostButton onClick={handleClearFilter}>Effacer</GhostButton>
        )}
      </div>

      {loading ? (
        <PageSkeleton />
      ) : deletions.length === 0 ? (
        <EmptyState
          text={`Aucune suppression enregistrée${filterDate ? ` pour le ${filterDate}` : ""}.`}
        />
      ) : (
        <>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 12,
              marginBottom: 12,
              flexWrap: "wrap",
            }}
          >
            <div style={{ fontSize: 13, color: "#7f785d" }}>
              Affichage de {startIndex + 1} à {Math.min(startIndex + rowsPerPage, deletions.length)} sur {deletions.length}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <label style={{ fontSize: 13, color: "#7f785d" }}>
                Lignes par page
              </label>
              <select
                value={rowsPerPage}
                onChange={(e) => setRowsPerPage(Number(e.target.value))}
                className="admin-select"
                style={{
                  ...inputStyle,
                  padding: "8px 10px",
                  minWidth: 90,
                }}
              >
                <option value={10}>10</option>
                <option value={20}>20</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
              </select>
            </div>
          </div>

          <div style={tableWrapStyle}>
            <div
              style={{
                ...tableHeadStyle,
                display: "grid",
                gridTemplateColumns: "1fr 1fr 1fr 1.6fr",
              }}
            >
              <div>Code</div>
              <div>Utilisateur</div>
              <div>Inventaire</div>
              <div>Supprimé le</div>
            </div>
            {visibleDeletions.map((d, i) => (
              <div
                key={d.id}
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr 1fr 1.6fr",
                  padding: "12px 18px",
                  fontSize: 13.5,
                  borderBottom:
                    i < visibleDeletions.length - 1 ? "1px solid #eeece0" : "none",
                  alignItems: "start",
                }}
              >
                <div
                  style={{
                    fontFamily: "ui-monospace, monospace",
                    fontWeight: 700,
                    color: "#c0564f",
                  }}
                >
                  {d.code}
                </div>
                <div style={{ color: "#2b2a22" }}>{d.username}</div>
                <div style={{ color: "#8b8574" }}>{d.inventory_date}</div>
                <div style={{ color: "#9a927a", fontSize: 12 }}>
                  {new Date(d.deleted_at * 1000).toLocaleString()}
                  {d.reason && (
                    <div style={{ marginTop: 2, fontStyle: "italic" }}>
                      « {d.reason} »
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginTop: 14,
              gap: 10,
              flexWrap: "wrap",
            }}
          >
            <button
              onClick={() => setPage((current) => Math.max(1, current - 1))}
              disabled={page === 1}
              style={{
                ...ghostBtnStyle,
                padding: "8px 12px",
                opacity: page === 1 ? 0.5 : 1,
                cursor: page === 1 ? "not-allowed" : "pointer",
              }}
            >
              Précédent
            </button>
            <div style={{ fontSize: 13, color: "#7f785d" }}>
              Page {page} / {totalPages}
            </div>
            <button
              onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
              disabled={page === totalPages}
              style={{
                ...ghostBtnStyle,
                padding: "8px 12px",
                opacity: page === totalPages ? 0.5 : 1,
                cursor: page === totalPages ? "not-allowed" : "pointer",
              }}
            >
              Suivant
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// --------------------------------------------------------------------- //
function UserManagementView() {
  const { token, user } = useAuth();
  const [users, setUsers] = useState<AuthUserDto[]>([]);
  const [passwordDrafts, setPasswordDrafts] = useState<Record<string, string>>({});
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [form, setForm] = useState({
    username: "",
    password: "",
    nom: "",
    prenom: "",
    role: "scanner" as "scanner" | "admin",
    ip_poste: "",
  });

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(null), 3000);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  const load = () => {
    if (token) adminListUsers(token).then(setUsers);
  };
  useEffect(load, [token]);

  const showToast = (type: "success" | "error", message: string) => {
    setToast({ type, message });
  };

  const handleCreate = async () => {
    if (!token) return;
    try {
      await adminCreateUser(token, {
        ...form,
        ip_poste: form.ip_poste || null,
      });
      setForm({
        username: "",
        password: "",
        nom: "",
        prenom: "",
        role: "scanner",
        ip_poste: "",
      });
      showToast("success", "Utilisateur créé avec succès.");
      load();
    } catch (err) {
      showToast(
        "error",
        err instanceof Error ? err.message : "Erreur lors de la création.",
      );
    }
  };

  const toggleStatus = async (u: AuthUserDto) => {
    if (!token) return;
    if (u.id === user?.id) {
      showToast("error", "L'administrateur courant ne peut pas être désactivé.");
      return;
    }
    try {
      await adminUpdateUser(token, u.id, {
        statut: u.statut === "actif" ? "inactif" : "actif",
      });
      showToast(
        "success",
        `${u.username} est maintenant ${u.statut === "actif" ? "inactif" : "actif"}.`,
      );
      load();
    } catch (err) {
      showToast(
        "error",
        err instanceof Error ? err.message : "Erreur lors du changement de statut.",
      );
    }
  };

  const changePassword = async (u: AuthUserDto) => {
    if (!token) return;
    const nextPassword = (passwordDrafts[u.id] ?? "").trim();
    if (!nextPassword) {
      showToast("error", `Saisissez un mot de passe pour ${u.username}.`);
      return;
    }
    try {
      await adminUpdateUser(token, u.id, { password: nextPassword });
      setPasswordDrafts((current) => ({ ...current, [u.id]: "" }));
      showToast("success", `Mot de passe mis à jour pour ${u.username}.`);
    } catch (err) {
      showToast(
        "error",
        err instanceof Error ? err.message : "Erreur lors du changement de mot de passe.",
      );
    }
  };

  return (
    <div>
      <PageHeader
        title="Utilisateurs"
        subtitle="Gérez les comptes ayant accès à l'application"
      />

      <div style={{ ...panelStyle, marginBottom: 24 }}>
        <div
          style={{
            fontWeight: 700,
            marginBottom: 14,
            fontSize: 14.5,
            color: "#2b2a22",
          }}
        >
          Créer un utilisateur
        </div>
        <div style={formGridStyle}>
          <FieldGroup label="Nom d'utilisateur">
            <input
              className="admin-input"
              value={form.username}
              onChange={(e) => setForm({ ...form, username: e.target.value })}
              style={inputStyle}
            />
          </FieldGroup>
          <FieldGroup label="Mot de passe">
            <input
              className="admin-input"
              type="password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              style={inputStyle}
            />
          </FieldGroup>
          <FieldGroup label="Prénom">
            <input
              className="admin-input"
              value={form.prenom}
              onChange={(e) => setForm({ ...form, prenom: e.target.value })}
              style={inputStyle}
            />
          </FieldGroup>
          <FieldGroup label="Nom">
            <input
              className="admin-input"
              value={form.nom}
              onChange={(e) => setForm({ ...form, nom: e.target.value })}
              style={inputStyle}
            />
          </FieldGroup>
          <FieldGroup label="Rôle">
            <select
              className="admin-select"
              value={form.role}
              onChange={(e) =>
                setForm({
                  ...form,
                  role: e.target.value as "scanner" | "admin",
                })
              }
              style={inputStyle}
            >
              <option value="scanner">Scanner</option>
              <option value="admin">Admin</option>
            </select>
          </FieldGroup>
          <FieldGroup label="IP du poste (optionnel)">
            <input
              className="admin-input"
              value={form.ip_poste}
              onChange={(e) => setForm({ ...form, ip_poste: e.target.value })}
              style={inputStyle}
            />
          </FieldGroup>
        </div>
        <PrimaryButton onClick={handleCreate} style={{ marginTop: 16 }}>
          Créer l'utilisateur
        </PrimaryButton>
      </div>

      <div className="admin-users-grid">
        {users.map((u) => {
          const isCurrentAdmin = u.id === user?.id;
          return (
            <div key={u.id} style={userRowStyle}>
              <div>
                <div
                  style={{ fontWeight: 700, fontSize: 14.5, color: "#2b2a22" }}
                >
                  {u.prenom} {u.nom}{" "}
                  <span style={{ fontWeight: 400, color: "#9a927a" }}>
                    ({u.username})
                  </span>
                </div>
                <div
                  style={{
                    display: "flex",
                    gap: 8,
                    marginTop: 6,
                    alignItems: "center",
                    flexWrap: "wrap",
                  }}
                >
                  <StatusBadge tone={u.role === "admin" ? "info" : "neutral"}>
                    {u.role}
                  </StatusBadge>
                  <StatusBadge tone={u.statut === "actif" ? "success" : "danger"}>
                    {u.statut}
                  </StatusBadge>
                  {isCurrentAdmin && (
                    <StatusBadge tone="info">admin courant</StatusBadge>
                  )}
                  {u.ip_poste && (
                    <span style={{ fontSize: 12, color: "#9a927a" }}>
                      {u.ip_poste}
                    </span>
                  )}
                </div>
                <div
                  style={{
                    display: "flex",
                    gap: 8,
                    marginTop: 10,
                    alignItems: "center",
                    flexWrap: "wrap",
                  }}
                >
                  <input
                    className="admin-input"
                    type="password"
                    placeholder="Nouveau mot de passe"
                    value={passwordDrafts[u.id] ?? ""}
                    onChange={(e) =>
                      setPasswordDrafts((current) => ({
                        ...current,
                        [u.id]: e.target.value,
                      }))
                    }
                    style={{
                      ...inputStyle,
                      width: 200,
                      minWidth: 160,
                    }}
                  />
                  <PrimaryButton onClick={() => changePassword(u)} style={{ padding: "8px 12px" }}>
                    Changer le mot de passe
                  </PrimaryButton>
                </div>
              </div>
              <GhostButton
                onClick={() => toggleStatus(u)}
                disabled={isCurrentAdmin}
                style={{
                  opacity: isCurrentAdmin ? 0.45 : 1,
                  cursor: isCurrentAdmin ? "not-allowed" : "pointer",
                }}
              >
                {u.statut === "actif" ? "Désactiver" : "Activer"}
              </GhostButton>
            </div>
          );
        })}
      </div>

      {toast && (
        <div
          style={{
            position: "fixed",
            top: 18,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 2000,
            padding: "12px 16px",
            borderRadius: 12,
            background: toast.type === "success" ? "#2f7d32" : "#b23a3a",
            color: "#fff",
            boxShadow: "0 12px 28px rgba(22, 20, 18, 0.22)",
            fontWeight: 700,
            fontSize: 13.5,
            maxWidth: "min(90vw, 420px)",
            wordBreak: "break-word",
          }}
        >
          {toast.message}
        </div>
      )}
    </div>
  );
}

// --------------------------------------------------------------------- //
// Shared building blocks
// --------------------------------------------------------------------- //

function PageHeader({
  title,
  subtitle,
  noMargin,
}: {
  title: string;
  subtitle?: ReactNode;
  noMargin?: boolean;
}) {
  return (
    <div style={{ marginBottom: noMargin ? 0 : 22 }}>
      <h1
        style={{ fontSize: 20, fontWeight: 800, color: "#2b2a22", margin: 0 }}
      >
        {title}
      </h1>
      {subtitle && (
        <p style={{ fontSize: 13.5, color: "#9a927a", margin: "4px 0 0" }}>
          {subtitle}
        </p>
      )}
    </div>
  );
}

function BackButton({
  onClick,
  label,
}: {
  onClick: () => void;
  label: string;
}) {
  return (
    <button onClick={onClick} className="admin-ghost-btn" style={backBtnStyle}>
      <ChevronIcon direction="left" /> {label}
    </button>
  );
}

function EmptyState({ text }: { text: string }) {
  return <div style={emptyStateStyle}>{text}</div>;
}

function PageSkeleton() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {[0, 1, 2].map((i) => (
        <div key={i} style={{ ...cardBtnStyle, cursor: "default" }}>
          <div
            style={{
              width: "60%",
              height: 14,
              background: "#eeece0",
              borderRadius: 6,
            }}
          />
        </div>
      ))}
    </div>
  );
}

function FieldGroup({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div style={{ flex: 1, minWidth: 160 }}>
      <label
        style={{
          fontSize: 12.5,
          color: "#8b8574",
          fontWeight: 600,
          display: "block",
          marginBottom: 5,
        }}
      >
        {label}
      </label>
      {children}
    </div>
  );
}

function StatusBadge({
  tone,
  children,
}: {
  tone: "success" | "danger" | "info" | "neutral";
  children: ReactNode;
}) {
  const tones: Record<string, { bg: string; fg: string }> = {
    success: { bg: "rgba(99, 153, 34, 0.14)", fg: "#3b6d11" },
    danger: { bg: "rgba(192, 86, 79, 0.14)", fg: "#8f3b36" },
    info: { bg: "rgba(55, 138, 221, 0.14)", fg: "#185fa5" },
    neutral: { bg: "rgba(189, 177, 132, 0.16)", fg: "#6b6242" },
  };
  const t = tones[tone];
  return (
    <span
      style={{
        background: t.bg,
        color: t.fg,
        fontSize: 11.5,
        fontWeight: 700,
        padding: "3px 9px",
        borderRadius: 999,
        textTransform: "capitalize",
      }}
    >
      {children}
    </span>
  );
}

function PrimaryButton({
  onClick,
  children,
  disabled,
  style,
}: {
  onClick: () => void;
  children: ReactNode;
  disabled?: boolean;
  style?: CSSProperties;
}) {
  return (
    <button
      className="admin-primary-btn"
      onClick={onClick}
      disabled={disabled}
      style={{
        ...primaryBtnStyle,
        ...style,
        opacity: disabled ? 0.55 : 1,
        cursor: disabled ? "not-allowed" : "pointer",
      }}
    >
      {children}
    </button>
  );
}

function GhostButton({
  onClick,
  children,
  disabled,
  style,
}: {
  onClick: () => void;
  children: ReactNode;
  disabled?: boolean;
  style?: CSSProperties;
}) {
  return (
    <button
      className="admin-ghost-btn"
      onClick={onClick}
      disabled={disabled}
      style={{
        ...ghostBtnStyle,
        ...style,
        opacity: disabled ? 0.55 : 1,
        cursor: disabled ? "not-allowed" : "pointer",
      }}
    >
      {children}
    </button>
  );
}

function DangerButton({
  onClick,
  children,
}: {
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button onClick={onClick} style={dangerBtnStyle}>
      {children}
    </button>
  );
}

// --------------------------------------------------------------------- //
// Icons
// --------------------------------------------------------------------- //

function iconProps(size = 17) {
  return {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
}

function ScanIcon() {
  return (
    <svg {...iconProps()}>
      <path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2" />
      <line x1="3" y1="12" x2="21" y2="12" />
    </svg>
  );
}
function InventoryIcon() {
  return (
    <svg {...iconProps()}>
      <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
      <path d="M3.3 7 12 12l8.7-5M12 22V12" />
    </svg>
  );
}
function TrashIcon() {
  return (
    <svg {...iconProps()}>
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  );
}
function UsersIcon() {
  return (
    <svg {...iconProps()}>
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}
function LogoutIcon() {
  return (
    <svg
      width={15}
      height={15}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  );
}
function ChevronIcon({
  direction = "right",
}: {
  direction?: "left" | "right";
}) {
  return (
    <svg
      width={16}
      height={16}
      viewBox="0 0 24 24"
      fill="none"
      stroke="#9a927a"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ flexShrink: 0 }}
    >
      <polyline
        points={direction === "right" ? "9 18 15 12 9 6" : "15 18 9 12 15 6"}
      />
    </svg>
  );
}

// --------------------------------------------------------------------- //
// Styles
// --------------------------------------------------------------------- //

const shellStyle: CSSProperties = {
  minHeight: "100dvh",
  display: "flex",
  background: "#f7f6f1",
};


function FolderIcon({ size = 18 }: { size?: number }) {
  return (
    <svg {...iconProps(size)}>
      <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H9l2 2h7.5A2.5 2.5 0 0 1 21 9.5v7A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5z" />
    </svg>
  );
}

function VideoIcon({ size = 18 }: { size?: number }) {
  return (
    <svg {...iconProps(size)}>
      <rect x="3" y="5" width="13" height="14" rx="2" />
      <path d="m16 10 5-3v10l-5-3z" />
    </svg>
  );
}
const sidebarStyle: CSSProperties = {
  width: 250,
  flexShrink: 0,
  background: "#ffffff",
  borderRight: "1px solid #eeece0",
  display: "flex",
  flexDirection: "column",
  position: "sticky",
  top: 0,
  height: "100dvh",
};

const sidebarBrandStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: 4,
  padding: "15px 13px",
  borderBottom: "1px solid #eeece0",
};
const navSectionLabelStyle: CSSProperties = {
  fontSize: 10.5,
  fontWeight: 700,
  color: "#c3bda3",
  textTransform: "uppercase",
  letterSpacing: 0.6,
  padding: "0 8px",
};

const navBtnStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  width: "100%",
  textAlign: "left",
  background: "none",
  border: "none",
  borderRadius: "0 10px 10px 0",
  padding: "10px 12px",
  fontSize: 13.5,
  cursor: "pointer",
  position: "relative",
};

const sidebarInventoryChipStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 7,
  margin: "2px 12px 8px 33px",
  padding: "6px 10px",
  background: "rgba(99, 153, 34, 0.08)",
  border: "1px solid rgba(99, 153, 34, 0.2)",
  borderRadius: 8,
};

const liveDotStyle: CSSProperties = {
  width: 6,
  height: 6,
  borderRadius: 999,
  background: "#639922",
  flexShrink: 0,
};

const mobileInventoryChipStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  fontSize: 11.5,
  fontWeight: 700,
  color: "#3b6d11",
  background: "rgba(99, 153, 34, 0.1)",
  border: "1px solid rgba(99, 153, 34, 0.22)",
  borderRadius: 999,
  padding: "4px 10px",
  whiteSpace: "nowrap",
};

const sidebarFooterStyle: CSSProperties = {
  padding: "14px 14px 16px",
  borderTop: "1px solid #eeece0",
  display: "flex",
  flexDirection: "column",
  gap: 10,
};

const userChipStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  padding: "6px 4px",
};

const avatarStyle: CSSProperties = {
  width: 32,
  height: 32,
  borderRadius: 999,
  background: "linear-gradient(135deg, #bdb184, #a89968)",
  color: "#2b2a22",
  fontSize: 12,
  fontWeight: 800,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  flexShrink: 0,
};

const logoutBtnStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 7,
  background: "rgba(192, 86, 79, 0.08)",
  border: "1px solid rgba(192, 86, 79, 0.28)",
  borderRadius: 10,
  padding: "9px 10px",
  fontSize: 13,
  fontWeight: 700,
  color: "#a3352f",
  cursor: "pointer",
  width: "100%",
  transition: "background 0.15s ease, border-color 0.15s ease",
};

const mobileLogoutBtnStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  whiteSpace: "nowrap",
  background: "rgba(192, 86, 79, 0.08)",
  border: "1px solid rgba(192, 86, 79, 0.28)",
  borderRadius: 999,
  padding: "7px 13px",
  fontSize: 13,
  fontWeight: 700,
  color: "#a3352f",
  cursor: "pointer",
  flexShrink: 0,
};

const mainStyle: CSSProperties = {
  flex: 1,
  minWidth: 0,
};

const mobileNavStyle: CSSProperties = {
  display: "none",
  flexDirection: "column",
  background: "#ffffff",
  borderBottom: "1px solid #eeece0",
  position: "sticky",
  top: 0,
  zIndex: 5,
};

const mobileNavBtnStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  whiteSpace: "nowrap",
  background: "none",
  border: "1px solid #eeece0",
  borderRadius: 999,
  padding: "7px 13px",
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
  flexShrink: 0,
};

const contentStyle: CSSProperties = {
  padding: "32px 40px",
  maxWidth: 1040,
  margin: "0 auto",
};

const headerRowStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-start",
  gap: 14,
  flexWrap: "wrap",
  marginBottom: 22,
};

const cardBtnStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  width: "100%",
  textAlign: "left",
  background: "#ffffff",
  border: "1px solid #eeece0",
  borderRadius: 14,
  padding: "16px 18px",
  cursor: "pointer",
  transition: "border-color 0.15s ease, box-shadow 0.15s ease",
};

const backBtnStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 4,
  background: "none",
  border: "none",
  color: "#8b8574",
  cursor: "pointer",
  fontSize: 13.5,
  fontWeight: 600,
  padding: "6px 4px",
  marginBottom: 14,
};

const emptyStateStyle: CSSProperties = {
  color: "#9a927a",
  fontSize: 14,
  background: "#ffffff",
  border: "1px dashed #ddd8c4",
  borderRadius: 14,
  padding: "28px 20px",
  textAlign: "center",
};

const tableWrapStyle: CSSProperties = {
  background: "#ffffff",
  borderRadius: 14,
  overflow: "hidden",
  border: "1px solid #eeece0",
};

const tableHeadStyle: CSSProperties = {
  display: "flex",
  padding: "12px 18px",
  fontSize: 11.5,
  color: "#9a927a",
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: 0.3,
  borderBottom: "1px solid #eeece0",
  background: "#faf9f4",
};

const tableRowStyle: CSSProperties = {
  display: "flex",
  padding: "13px 18px",
};

const adminDeleteButtonStyle: CSSProperties = {
  border: "1px solid rgba(192, 86, 79, 0.3)",
  borderRadius: 8,
  padding: "5px 8px",
  background: "rgba(192, 86, 79, 0.06)",
  color: "#8f3b36",
  fontSize: 11.5,
  fontWeight: 700,
  cursor: "pointer",
};

const panelStyle: CSSProperties = {
  background: "#ffffff",
  border: "1px solid #eeece0",
  borderRadius: 16,
  padding: 22,
};

const photoSelectionStyle: CSSProperties = {
  marginTop: 16,
  padding: 14,
  background: "#f7f6f1",
  border: "1px solid #e8e5d8",
  borderRadius: 12,
};

const folderListStyle: CSSProperties = {
  display: "flex",
  gap: 7,
  flexWrap: "wrap",
  marginTop: 12,
};

const folderChipStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  padding: "5px 9px",
  borderRadius: 8,
  background: "#fff",
  border: "1px solid #e4dfcf",
  color: "#59543f",
  fontSize: 12,
  fontWeight: 600,
};

const jobSummaryGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(125px, 1fr))",
  gap: 8,
  marginTop: 14,
};

const jobHeaderButtonStyle: CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "space-between",
  gap: 12,
  width: "100%",
  padding: 0,
  border: 0,
  background: "transparent",
  textAlign: "left",
  cursor: "pointer",
  color: "inherit",
};

const jobChevronStyle: CSSProperties = {
  display: "inline-block",
  color: "#9a927a",
  fontSize: 22,
  fontWeight: 400,
  lineHeight: "14px",
  transition: "transform 160ms ease",
};

const userPhotoResultsStyle: CSSProperties = {
  marginTop: 14,
  paddingTop: 14,
  borderTop: "1px solid #eeece0",
};

const photoHistoryFilterStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 14,
  flexWrap: "wrap",
  padding: "13px 15px",
  border: "1px solid #e8e5d8",
  borderRadius: 12,
  background: "#faf9f4",
};

const userPhotoResultsTitleStyle: CSSProperties = {
  color: "#59543f",
  fontSize: 12,
  fontWeight: 800,
  marginBottom: 8,
  textTransform: "uppercase",
  letterSpacing: 0.3,
};

const userPhotoResultsGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
  gap: 8,
};

const userPhotoResultStyle: CSSProperties = {
  padding: "10px 11px",
  border: "1px solid #e8e5d8",
  borderRadius: 10,
  background: "#faf9f4",
};

const userPhotoResultMetaStyle: CSSProperties = {
  color: "#7b7565",
  fontSize: 12,
  marginTop: 5,
};

const compactCodeListStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 6,
  marginTop: 8,
  alignItems: "center",
};

const userPhotoResultCodesStyle: CSSProperties = {
  ...compactCodeListStyle,
  color: "#59543f",
  fontFamily: "ui-monospace, monospace",
  fontSize: 11.5,
  lineHeight: 1.5,
  overflowWrap: "anywhere",
};

const compactCodePillStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  padding: "4px 8px",
  borderRadius: 999,
  background: "#e9f7ef",
  border: "1px solid #bddfc8",
  color: "#245b34",
  fontFamily: "ui-monospace, monospace",
  fontSize: 10.5,
  fontWeight: 700,
  lineHeight: 1.2,
  overflowWrap: "anywhere",
};

const compactCodeToggleStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  minWidth: 42,
  padding: "4px 8px",
  borderRadius: 999,
  background: "#f2efe4",
  border: "1px solid #ddd7c3",
  color: "#5d564c",
  fontSize: 10.5,
  fontWeight: 800,
  cursor: "pointer",
};

const userPhotoResultStatsStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 8,
  fontSize: 11.5,
  fontWeight: 700,
  marginTop: 7,
};

const jobErrorStyle: CSSProperties = {
  marginTop: 12,
  padding: "9px 10px",
  borderRadius: 8,
  background: "#fff1f0",
  color: "#b42318",
  fontSize: 12.5,
};

const photoToastStyle: CSSProperties = {
  position: "fixed",
  top: "calc(18px + var(--safe-top, 0px))",
  left: "50%",
  transform: "translateX(-50%)",
  zIndex: 2000,
  display: "flex",
  alignItems: "flex-start",
  gap: 9,
  flexDirection: "column",
  minWidth: "min(360px, calc(100vw - 40px))",
  padding: "13px 42px 13px 15px",
  borderRadius: 12,
  color: "#fff",
  boxShadow: "0 12px 30px rgba(43, 42, 34, 0.2)",
  fontSize: 13,
  animation: "admin-toast-in 180ms ease-out",
};

const processingTrackStyle: CSSProperties = {
  height: 5,
  marginTop: 10,
  width: "min(360px, 100%)",
  overflow: "hidden",
  borderRadius: 999,
  background: "#ece8d9",
};

const processingBarStyle: CSSProperties = {
  height: "100%",
  minWidth: 18,
  borderRadius: 999,
  background: "linear-gradient(90deg, #bdb184 0%, #dfe8b9 45%, #6d9c46 70%, #bdb184 100%)",
  backgroundSize: "220% 100%",
  animation: "admin-progress-shimmer 1.8s linear infinite",
  transition: "width 400ms ease",
};

const processingDotStyle: CSSProperties = {
  display: "inline-block",
  color: "#6d9c46",
  animation: "admin-processing-dot 1.1s ease-in-out infinite",
};

const toastCloseStyle: CSSProperties = {
  position: "absolute",
  top: 8,
  right: 10,
  border: 0,
  background: "transparent",
  color: "#fff",
  fontSize: 20,
  lineHeight: 1,
  cursor: "pointer",
};

const activeInventoryCardStyle: CSSProperties = {
  background:
    "linear-gradient(135deg, rgba(99, 153, 34, 0.06), rgba(99, 153, 34, 0.02))",
  border: "1px solid rgba(99, 153, 34, 0.22)",
  borderRadius: 16,
  padding: "18px 20px",
  marginBottom: 20,
};

const dialogBackdropStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 2100,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 20,
  background: "rgba(31, 36, 48, 0.34)",
  backdropFilter: "blur(5px)",
};

const dialogStyle: CSSProperties = {
  width: "min(100%, 420px)",
  padding: 24,
  borderRadius: 20,
  background: "#fffdf8",
  border: "1px solid rgba(189, 177, 132, 0.35)",
  boxShadow: "0 24px 70px rgba(31, 36, 48, 0.25)",
};

const dialogIconStyle: CSSProperties = {
  width: 38,
  height: 38,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  borderRadius: "50%",
  background: "#fff1df",
  color: "#a15c08",
  fontWeight: 900,
  fontSize: 20,
};

const dialogTitleStyle: CSSProperties = {
  margin: "17px 0 7px",
  color: "#2b2a22",
  fontSize: 19,
};

const dialogMessageStyle: CSSProperties = {
  margin: 0,
  color: "#716b5e",
  fontSize: 14,
  lineHeight: 1.55,
};

const dialogActionsStyle: CSSProperties = {
  display: "flex",
  justifyContent: "flex-end",
  gap: 10,
  marginTop: 24,
};

const dialogCancelStyle: CSSProperties = {
  border: "1px solid #e4dfcf",
  borderRadius: 10,
  padding: "10px 14px",
  background: "#fff",
  color: "#59543f",
  fontWeight: 700,
  cursor: "pointer",
};

const formGridStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 14,
};

const inputStyle: CSSProperties = {
  width: "100%",
  fontSize: 14,
  padding: "10px 12px",
  borderRadius: 10,
  border: "1.5px solid #e9e6d8",
  background: "#faf9f4",
  outline: "none",
  transition: "border-color 0.15s ease, box-shadow 0.15s ease",
};

const feedbackStyle: CSSProperties = {
  marginTop: 12,
  fontSize: 13.5,
  color: "#59543f",
  background: "#faf9f4",
  padding: "8px 12px",
  borderRadius: 8,
};

const hintTextStyle: CSSProperties = {
  marginTop: 18,
  fontSize: 13,
  color: "#9a927a",
  lineHeight: 1.6,
};

const userRowStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  background: "#ffffff",
  border: "1px solid #eeece0",
  borderRadius: 14,
  padding: "14px 18px",
  gap: 12,
  flexWrap: "wrap",
};

const primaryBtnStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 7,
  background: "linear-gradient(135deg, #bdb184, #a89968)",
  color: "#2b2a22",
  border: "none",
  borderRadius: 10,
  padding: "10px 16px",
  fontSize: 13.5,
  fontWeight: 700,
  cursor: "pointer",
  boxShadow: "0 6px 16px rgba(189, 177, 132, 0.3)",
  whiteSpace: "nowrap",
};

const ghostBtnStyle: CSSProperties = {
  background: "none",
  border: "1px solid #eeece0",
  color: "#59543f",
  cursor: "pointer",
  fontSize: 13,
  fontWeight: 700,
  padding: "8px 14px",
  borderRadius: 10,
  whiteSpace: "nowrap",
};

const dangerBtnStyle: CSSProperties = {
  background: "none",
  border: "1px solid rgba(192, 86, 79, 0.35)",
  color: "#8f3b36",
  cursor: "pointer",
  fontSize: 13,
  fontWeight: 700,
  padding: "8px 14px",
  borderRadius: 10,
  whiteSpace: "nowrap",
};
