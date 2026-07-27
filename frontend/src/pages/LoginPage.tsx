import { useState } from "react";
import type { CSSProperties, FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { TicketIcon } from "../components/icons";

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      const user = await login(username.trim(), password);

      if (user.role === "admin") {
        navigate("/admin");
      } else {
        navigate("/scan");
      }
    } catch (err) {
      setError("Nom d'utilisateur ou mot de passe incorrect !");
      console.error(err);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div style={pageStyle}>
      <style>{`
        @media (max-width: 480px) {
          .login-card { padding: 28px 20px !important; border-radius: 20px !important; }
          .login-logo-img { height: 40px !important; }
        }
        .login-input:focus {
          border-color: #bdb184 !important;
          box-shadow: 0 0 0 4px rgba(189, 177, 132, 0.18) !important;
        }
        .login-eye-btn:hover { opacity: 1 !important; }
        .login-submit-btn:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 10px 24px rgba(189, 177, 132, 0.4); }
        .login-submit-btn:disabled { opacity: 0.7; cursor: not-allowed; }
      `}</style>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          width: "100%",
          maxWidth: 420,
        }}
      >
        {/* Logo top, no background */}
        <div style={logoWrapStyle}>
          <img
            src="/rafinity.png"
            alt="Rafinity"
            className="login-logo-img"
            style={logoImgStyle}
          />
        </div>

        <form onSubmit={handleSubmit} className="login-card" style={cardStyle}>
          <div style={{ textAlign: "center", marginBottom: 6 }}>
            <h1 style={titleStyle}>Bon retour</h1>
            <p style={subtitleStyle}>Connectez-vous à Rafinity Inventory</p>
          </div>

          <label style={labelStyle}>
            <span style={labelTextStyle}>Nom d'utilisateur</span>
            <input
              className="login-input"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              autoCapitalize="none"
              required
              style={inputStyle}
            />
          </label>

          <label style={labelStyle}>
            <span style={labelTextStyle}>Mot de passe</span>
            <div
              style={{
                position: "relative",
                display: "flex",
                alignItems: "center",
              }}
            >
              <input
                className="login-input"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
                style={{ ...inputStyle, paddingRight: 44, width: "100%" }}
              />
              <button
                type="button"
                className="login-eye-btn"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={
                  showPassword
                    ? "Masquer le mot de passe"
                    : "Afficher le mot de passe"
                }
                style={eyeBtnStyle}
              >
                {showPassword ? <EyeOffIcon /> : <EyeIcon />}
              </button>
            </div>
          </label>

          {error && <p style={errorStyle}>{error}</p>}

          <button
            className="login-submit-btn"
            type="submit"
            disabled={isSubmitting}
            style={submitBtnStyle}
          >
            <TicketIcon size={18} />
            {isSubmitting ? "Connexion…" : "Se connecter"}
          </button>
        </form>
      </div>
    </div>
  );
}

function EyeIcon() {
  return (
    <svg
      width="19"
      height="19"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg
      width="19"
      height="19"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
      <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 11 7 11 7a13.16 13.16 0 0 1-1.67 2.68" />
      <path d="M6.61 6.61A13.52 13.52 0 0 0 1 12s4 7 11 7a10.44 10.44 0 0 0 5-1.27" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  );
}

const pageStyle: CSSProperties = {
  minHeight: "100dvh",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 24,
  background: "linear-gradient(160deg, #f7f6f1 0%, #f2f0e6 45%, #eeece0 100%)",
};

const logoWrapStyle: CSSProperties = {
  marginBottom: 28,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

const logoImgStyle: CSSProperties = {
  height: 52,
  width: "auto",
  objectFit: "contain",
};

const cardStyle: CSSProperties = {
  padding: "36px 32px",
  width: "100%",
  display: "flex",
  flexDirection: "column",
  gap: 18,
  background: "#ffffff",
  borderRadius: 24,
  boxShadow:
    "0 20px 50px rgba(80, 74, 45, 0.10), 0 2px 8px rgba(80, 74, 45, 0.06)",
  border: "1px solid rgba(189, 177, 132, 0.18)",
  boxSizing: "border-box",
};

const titleStyle: CSSProperties = {
  fontSize: 22,
  fontWeight: 700,
  margin: 0,
  color: "#2b2a22",
  letterSpacing: -0.3,
};

const subtitleStyle: CSSProperties = {
  fontSize: 13.5,
  color: "#9a927a",
  margin: "6px 0 0",
};

const labelStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
};

const labelTextStyle: CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: "#59543f",
};

const inputStyle: CSSProperties = {
  fontSize: 15,
  padding: "12px 14px",
  borderRadius: 12,
  border: "1.5px solid #e9e6d8",
  outline: "none",
  background: "#faf9f4",
  transition: "border-color 0.15s ease, box-shadow 0.15s ease",
  width: "100%",
  boxSizing: "border-box",
};

const eyeBtnStyle: CSSProperties = {
  position: "absolute",
  right: 10,
  background: "none",
  border: "none",
  padding: 6,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  cursor: "pointer",
  color: "#9a927a",
  opacity: 0.75,
  transition: "opacity 0.15s ease",
};

const errorStyle: CSSProperties = {
  color: "#c0564f",
  fontSize: 13.5,
  background: "#fdf2f1",
  padding: "10px 14px",
  borderRadius: 12,
  margin: 0,
  border: "1px solid rgba(192, 86, 79, 0.22)",
};

const submitBtnStyle: CSSProperties = {
  marginTop: 6,
  width: "100%",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 8,
  padding: "13px 18px",
  fontSize: 15,
  fontWeight: 600,
  color: "#2b2a22",
  background: "linear-gradient(135deg, #bdb184, #cfc499)",
  border: "none",
  borderRadius: 12,
  cursor: "pointer",
  boxShadow: "0 8px 20px rgba(189, 177, 132, 0.35)",
  transition: "transform 0.15s ease, box-shadow 0.15s ease",
};
