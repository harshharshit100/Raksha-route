import { createContext, useContext, useState } from "react";
import { disconnectSocket } from "../socket";

const AuthContext = createContext(null);

function clearStoredSession() {
  localStorage.removeItem("raksharoute_token");
  localStorage.removeItem("raksharoute_user");
}

function restoreUser() {
  try {
    const token = localStorage.getItem("raksharoute_token");
    if (!token) {
      clearStoredSession();
      return null;
    }

    const raw = localStorage.getItem("raksharoute_user");
    if (!raw) {
      clearStoredSession();
      return null;
    }

    const user = JSON.parse(raw);
    if (!user || typeof user !== "object" || Array.isArray(user)) {
      clearStoredSession();
      return null;
    }
    return user;
  } catch {
    clearStoredSession();
    return null;
  }
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(restoreUser);

  const login = (userData) => {
    // A socket authenticated for a previous account must never retain that
    // account's private rooms after a login in the same browser tab.
    disconnectSocket();
    localStorage.setItem("raksharoute_user", JSON.stringify(userData));
    setUser(userData);
  };

  const logout = () => {
    disconnectSocket();
    clearStoredSession();
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

// Context modules conventionally co-locate the hook with the provider;
// Fast Refresh simply won't hot-reload the hook itself (fine here).
// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
