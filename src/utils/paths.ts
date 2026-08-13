export const withBase = (path = '') => `${import.meta.env.BASE_URL}${path.startsWith('/') ? path.slice(1) : path}`;
