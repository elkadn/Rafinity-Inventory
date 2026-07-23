import { useEffect, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { useAuth } from "../context/AuthContext";
import {
  adminListDays,
  adminUserDayScans,
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
  type MergedDayDto,
  type AuthUserDto,
  type ActiveInventoryDto,
  type DeletionDto,
} from "../lib/api";
import { DownloadIcon } from "../components/icons";

type View =
  | { kind: "days" }
  | { kind: "day"; date: string }
  | { kind: "user"; date: string; userId: string }
  | { kind: "merged"; date: string }
  | { kind: "users" }
  | { kind: "inventory" }
  | { kind: "deletions" };

type NavKey = "days" | "inventory" | "deletions" | "users";

const NAV_ITEMS: { key: NavKey; label: string; icon: ReactNode }[] = [
  { key: "days", label: "Scans", icon: <ScanIcon /> },
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

  useEffect(() => {
    if (!token) return;
    adminListDays(token)
      .then(setDays)
      .finally(() => setLoading(false));
    fetchActiveInventory(token)
      .then(setActiveInventory)
      .catch(() => {});
  }, [token]);

  const activeNav = navKeyForView(view);

  const goTo = (key: NavKey) => {
    if (key === "days") setView({ kind: "days" });
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
        .admin-input:focus, .admin-select:focus {
          border-color: #bdb184 !important;
          box-shadow: 0 0 0 3px rgba(189, 177, 132, 0.16) !important;
        }
        @media (max-width: 860px) {
          .admin-sidebar { display: none !important; }
          .admin-mobile-nav { display: flex !important; }
          .admin-main { margin-left: 0 !important; }
          .admin-content { padding: 16px !important; }
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
              Administration
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
  if (loading) return <PageSkeleton />;

  return (
    <div>
      <PageHeader
        title="Scans par journée"
        subtitle="Consultez les codes scannés, jour par jour"
      />
      {days.length === 0 ? (
        <EmptyState text="Aucun scan enregistré pour l'instant." />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {days.map((d) => (
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

  useEffect(() => {
    if (!token) return;
    adminUserDayScans(token, date, userId).then(setData);
  }, [token, date, userId]);

  if (!data) return <PageSkeleton />;

  const filteredScans = data.scans.filter((scan) =>
    scan.code.toLowerCase().includes(searchTerm.toLowerCase())
  );

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
          <DownloadIcon size={15} /> Export CSV
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
        }))}
        metaLabel="Méthode"
      />
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
          <DownloadIcon size={15} /> Export CSV fusionné
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
  const [feedback, setFeedback] = useState<string | null>(null);

  const handleSet = async () => {
    if (!token || !date) return;
    setFeedback(null);
    try {
      const inv = await adminSetInventory(token, {
        inventory_date: date,
        label: label || undefined,
      });
      onChanged(inv);
      setFeedback(`Inventaire actif défini sur ${date}.`);
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : "Erreur");
    }
  };

  const handleClear = async () => {
    if (!token) return;
    if (
      !window.confirm(
        "Supprimer l'inventaire actif ? Les scanners reviendront à la date du jour.",
      )
    )
      return;
    await adminClearInventory(token);
    onChanged(null);
    setFeedback("Inventaire actif supprimé.");
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
            <DangerButton onClick={handleClear}>Désactiver</DangerButton>
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
              placeholder="ex : Inventaire juin 2026"
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
        {feedback && <div style={feedbackStyle}>{feedback}</div>}
      </div>

      <p style={hintTextStyle}>
        Une fois un inventaire actif défini, tous les scanners enregistrent
        leurs codes sous la date d'inventaire choisie (et non la date réelle du
        scan). Les scanners connectés détectent le changement en moins de 30
        secondes automatiquement.
      </p>
    </div>
  );
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

  // Correction ici : on appelle load() avec undefined pour tout charger
  const handleClearFilter = () => {
    setFilterDate("");
    load(undefined); // Recharger sans filtre
  };

  const handleFilter = () => {
    load(filterDate || undefined);
  };

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
          {deletions.map((d, i) => (
            <div
              key={d.id}
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr 1fr 1.6fr",
                padding: "12px 18px",
                fontSize: 13.5,
                borderBottom:
                  i < deletions.length - 1 ? "1px solid #eeece0" : "none",
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
      )}
    </div>
  );
}

// --------------------------------------------------------------------- //
function UserManagementView() {
  const { token } = useAuth();
  const [users, setUsers] = useState<AuthUserDto[]>([]);
  const [form, setForm] = useState({
    username: "",
    password: "",
    nom: "",
    prenom: "",
    role: "scanner" as "scanner" | "admin",
    ip_poste: "",
  });
  const [feedback, setFeedback] = useState<string | null>(null);

  const load = () => {
    if (token) adminListUsers(token).then(setUsers);
  };
  useEffect(load, [token]);

  const handleCreate = async () => {
    if (!token) return;
    setFeedback(null);
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
      setFeedback("Utilisateur créé.");
      load();
    } catch (err) {
      setFeedback(
        err instanceof Error ? err.message : "Erreur lors de la création.",
      );
    }
  };

  const toggleStatus = async (u: AuthUserDto) => {
    if (!token) return;
    await adminUpdateUser(token, u.id, {
      statut: u.statut === "actif" ? "inactif" : "actif",
    });
    load();
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
        {feedback && <div style={feedbackStyle}>{feedback}</div>}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {users.map((u) => (
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
                {u.ip_poste && (
                  <span style={{ fontSize: 12, color: "#9a927a" }}>
                    {u.ip_poste}
                  </span>
                )}
              </div>
            </div>
            <GhostButton onClick={() => toggleStatus(u)}>
              {u.statut === "actif" ? "Désactiver" : "Activer"}
            </GhostButton>
          </div>
        ))}
      </div>
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
}: {
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button className="admin-ghost-btn" onClick={onClick} style={ghostBtnStyle}>
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

function iconProps() {
  return {
    width: 17,
    height: 17,
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

const panelStyle: CSSProperties = {
  background: "#ffffff",
  border: "1px solid #eeece0",
  borderRadius: 16,
  padding: 22,
};

const activeInventoryCardStyle: CSSProperties = {
  background:
    "linear-gradient(135deg, rgba(99, 153, 34, 0.06), rgba(99, 153, 34, 0.02))",
  border: "1px solid rgba(99, 153, 34, 0.22)",
  borderRadius: 16,
  padding: "18px 20px",
  marginBottom: 20,
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
