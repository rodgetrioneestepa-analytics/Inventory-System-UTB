export interface User {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'staff';
}
export interface Page<T> {
  rows: T[];
  total: number;
  page: number;
  limit: number;
}
export interface StockBalance {
  balance: number | null;
  available: number | null;
  expired: number | null;
}
export interface PostedResult {
  id: string;
  duplicate: boolean;
}
