import axios from 'axios';

export const api = axios.create({ baseURL: '/api', withCredentials: true });

let onUnauthorized = null;
export const setUnauthorizedHandler = (fn) => { onUnauthorized = fn; };

api.interceptors.response.use(
  (r) => r,
  (err) => {
    const url = err.config?.url || '';
    if (err.response?.status === 401 && !url.includes('/auth/') && onUnauthorized) onUnauthorized();
    return Promise.reject(err);
  },
);

export const errMsg = (e) => e?.response?.data?.error || e?.message || 'Something went wrong';

/** Remove empty values so optional fields are omitted. */
export const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== '' && v !== null && v !== undefined));
