import axios from 'axios';

const baseUrl = (process.env.REACT_APP_API_BASE_URL as string)
  || (process.env.EXPO_PUBLIC_API_BASE_URL as string)
  || (process.env.API_BASE_URL as string)
  || 'http://localhost:8000/api';

/** Default client — generous timeout for most requests. */
const apiClient = axios.create({
  baseURL: baseUrl,
  timeout: 30000,
});

/** Long-running client for AI analysis endpoints (news + vision). */
const aiClient = axios.create({
  baseURL: baseUrl,
  timeout: 120000,
});

export { aiClient };
export default apiClient;
