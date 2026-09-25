import axios from "axios";

// VITE_API_URL should point at the API prefix (for example,
// http://localhost:5001/api). Leaving it unset uses the same-origin /api path,
// which Vite proxies in development and Vercel rewrites in production.
const API = axios.create({
  baseURL: import.meta.env.VITE_API_URL || "/api",
});

// Callers historically used both "/api/..." and "/ambulances" style paths.
// Strip a duplicate leading /api so both forms work with the same baseURL.
API.interceptors.request.use((config) => {
  if (typeof config.url === "string" && /^\/api(?:\/|$)/.test(config.url)) {
    config.url = config.url.replace(/^\/api/, "") || "/";
  }

  // Attach the stored JWT to every request
  const token = localStorage.getItem("raksharoute_token");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Axios errors without a response are transport failures (offline, timeout,
// DNS/CORS, or an unavailable server), not errors in the API response body.
export function isApiConnectionError(error) {
  return axios.isAxiosError(error) && !error.response && error.code !== "ERR_CANCELED";
}

// If the server says the token is invalid/expired, clear the session
API.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401 && localStorage.getItem("raksharoute_token")) {
      localStorage.removeItem("raksharoute_token");
      localStorage.removeItem("raksharoute_user");
      window.location.reload();
    }
    return Promise.reject(err);
  }
);

export default API;
