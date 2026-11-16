import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
  type FormEvent,
} from 'react';
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import {
  Leaf,
  LayoutDashboard,
  Boxes,
  Utensils,
  Truck,
  ClipboardList,
  ArrowLeftRight,
  Scale,
  ReceiptText,
  FileUp,
  ChartNoAxesCombined,
  Users,
  LogOut,
  Menu,
  CircleHelp,
  ArrowUpRight,
} from 'lucide-react';
import type { User } from '../../shared/api';
import { api, currentUser, setCSRF } from './api';
import { Notice, Loading, useData, Badge, FormModal } from './components';
import { InventoryPage, ProductsPage, SuppliersPage, UsersPage } from './SetupPages';
import {
  OrdersPage,
  MovementsPage,
  AdjustmentsPage,
  SalesPage,
  ImportsPage,
  ReportsPage,
} from './OperationsPages';

type AppContext = {
  user: User;
  revision: number;
  refresh: () => void;
  dialog: (node: ReactNode) => void;
  close: () => void;
  notify: (s: string) => void;
};
const Context = createContext<AppContext>(null!);
export const useApp = () => useContext(Context);
const links = [
  { path: '/', label: 'Overview', icon: LayoutDashboard, group: 'WORKSPACE' },
  { path: '/inventory', label: 'Inventory', icon: Boxes },
  { path: '/products', label: 'Menu & recipes', icon: Utensils, admin: true },
  { path: '/suppliers', label: 'Suppliers', icon: Truck, admin: true },
  { path: '/orders', label: 'Purchasing & receiving', icon: ClipboardList, group: 'OPERATIONS' },
  { path: '/movements', label: 'Stock movements', icon: ArrowLeftRight },
  { path: '/adjustments', label: 'Wastage & counts', icon: Scale },
  { path: '/sales', label: 'Operational sales', icon: ReceiptText, admin: true },
  { path: '/imports', label: 'CSV imports', icon: FileUp, admin: true },
  { path: '/reports', label: 'Reports', icon: ChartNoAxesCombined, group: 'MANAGEMENT' },
  { path: '/settings', label: 'Users & settings', icon: Users, admin: true },
];
export function App() {
  const [user, setUser] = useState<User | null>(null);
  const [checking, setChecking] = useState(true);
  const [revision, setRevision] = useState(0);
  const [modal, setModal] = useState<ReactNode>();
  const [message, setMessage] = useState('');
  const [open, setOpen] = useState(false);
  const location = useLocation();
  useEffect(() => {
    currentUser()
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setChecking(false));
  }, []);
  useEffect(() => {
    setOpen(false);
    setModal(undefined);
  }, [location.pathname]);
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(''), 7000);
    return () => clearTimeout(timer);
  }, [message]);
  useEffect(() => {
    const onFocus = () => {
      currentUser()
        .then(setUser)
        .catch(() => setUser(null));
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);
  if (checking) return <Loading />;
  if (!user) return <Login onLogin={setUser} />;
  const title = links.find((l) => l.path === location.pathname)?.label ?? 'Overview';
  const ctx: AppContext = {
    user,
    revision,
    refresh: () => setRevision((r) => r + 1),
    dialog: setModal,
    close: () => setModal(undefined),
    notify: setMessage,
  };
  return (
    <Context.Provider value={ctx}>
      <div className="app-shell">
        <a className="skip" href="#main">
          Skip to content
        </a>
        {open && (
          <button
            className="sidebar-scrim"
            aria-label="Close navigation"
            onClick={() => setOpen(false)}
          />
        )}
        <aside className={open ? 'sidebar open' : 'sidebar'}>
          <NavLink className="brand" to="/">
            <div className="brand-icon">
              <Leaf size={27} />
            </div>
            <div>
              under the balete<span>INVENTORY</span>
            </div>
          </NavLink>
          <div className="workspace-label">
            <span className="live-dot" />
            Restaurant workspace
          </div>
          <nav>
            {links
              .filter((l) => !l.admin || user.role === 'admin')
              .map((l) => (
                <div key={l.path}>
                  {l.group && <div className="nav-group">{l.group}</div>}
                  <NavLink to={l.path} end={l.path === '/'}>
                    <l.icon size={19} />
                    {l.label}
                  </NavLink>
                </div>
              ))}
          </nav>
          <div className="sidebar-note">
            <CircleHelp size={19} />
            <div>
              Every movement matters.<p>Posted records keep their audit trail.</p>
            </div>
          </div>
          <div className="profile">
            <button
              className="avatar"
              aria-label="Change my password"
              title="Change my password"
              onClick={() =>
                setModal(
                  <FormModal
                    title="Change your password"
                    fields={[
                      { name: 'current_password', label: 'Current password', type: 'password' },
                      { name: 'password', label: 'New password', type: 'password' },
                    ]}
                    onClose={() => setModal(undefined)}
                    onSubmit={async (value) => {
                      await api('/auth/password', 'POST', value);
                      setUser(null);
                      setModal(undefined);
                      setCSRF('');
                    }}
                  />,
                )
              }
            >
              {user.name.slice(0, 2).toUpperCase()}
            </button>
            <div>
              <strong>{user.name}</strong>
              <small>{user.role === 'admin' ? 'Owner / Administrator' : 'Inventory staff'}</small>
            </div>
            <button
              className="icon-btn"
              aria-label="Sign out"
              onClick={async () => {
                try {
                  await api('/auth/logout', 'POST');
                  setUser(null);
                  setCSRF('');
                } catch (e) {
                  setMessage((e as Error).message);
                }
              }}
            >
              <LogOut size={17} />
            </button>
          </div>
        </aside>
        <div className="main-shell">
          <header className="topbar">
            <div>
              <button
                className="icon-btn mobile-menu"
                aria-label="Open navigation"
                onClick={() => setOpen(true)}
              >
                <Menu />
              </button>
              <span className="breadcrumb">
                Workspace <span>/</span> <strong>{title}</strong>
              </span>
            </div>
            <div className="topbar-right">
              <span className="live-dot" />
              Live inventory<span className="timezone">Asia/Manila</span>
            </div>
          </header>
          <main id="main">
            {message && <Notice kind="success">{message}</Notice>}
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/inventory" element={<InventoryPage />} />
              <Route
                path="/products"
                element={user.role === 'admin' ? <ProductsPage /> : <Navigate to="/" />}
              />
              <Route
                path="/suppliers"
                element={user.role === 'admin' ? <SuppliersPage /> : <Navigate to="/" />}
              />
              <Route path="/orders" element={<OrdersPage />} />
              <Route path="/movements" element={<MovementsPage />} />
              <Route path="/adjustments" element={<AdjustmentsPage />} />
              <Route
                path="/sales"
                element={user.role === 'admin' ? <SalesPage /> : <Navigate to="/" />}
              />
              <Route
                path="/imports"
                element={user.role === 'admin' ? <ImportsPage /> : <Navigate to="/" />}
              />
              <Route path="/reports" element={<ReportsPage />} />
              <Route
                path="/settings"
                element={user.role === 'admin' ? <UsersPage /> : <Navigate to="/" />}
              />
              <Route path="*" element={<Navigate to="/" />} />
            </Routes>
          </main>
          <footer className="app-footer">
            UNDER THE BALETE <span>Inventory with accountability · Quezon City, Philippines</span>
          </footer>
        </div>
        {modal}
      </div>
    </Context.Provider>
  );
}
function Login({ onLogin }: { onLogin: (u: User) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const d = await api('/auth/login', 'POST', { email, password });
      setCSRF(d.csrf);
      onLogin(d.user);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="login-layout">
      <div className="login-story">
        <div className="login-brand">
          <Leaf size={38} />
          under the balete
        </div>
        <div>
          <div className="eyebrow">RESTAURANT · CAFÉ · BAR</div>
          <h1>
            A little care.
            <br />
            In every detail.
          </h1>
          <p>Know what’s on hand. Make room for what matters.</p>
        </div>
        <span>Rooted in Quezon City, Philippines.</span>
      </div>
      <div className="login-form">
        <form onSubmit={submit}>
          <Badge tone="green">INVENTORY WORKSPACE</Badge>
          <h2>Welcome back.</h2>
          <p>Sign in to manage your restaurant’s inventory.</p>
          <label>
            Email address
            <input
              autoComplete="username"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label>
            Password
            <input
              autoComplete="current-password"
              type="password"
              required
              maxLength={72}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          {error && <Notice kind="error">{error}</Notice>}
          <button disabled={busy} className="login-button">
            {busy ? 'Signing in…' : 'Sign in to workspace'}
            <ArrowUpRight size={18} />
          </button>
          <small>
            First time here? Create your administrator account using the local setup command in the
            README.
          </small>
        </form>
      </div>
    </div>
  );
}
export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow: string;
  title: string;
  description: string;
  actions?: ReactNode;
}) {
  return (
    <div className="page-header">
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      <div className="page-actions">{actions}</div>
    </div>
  );
}
function Dashboard() {
  const { revision, user } = useApp();
  const dashboard = useData('/dashboard', revision);
  if (dashboard.loading) return <Loading />;
  if (dashboard.error) return <Notice kind="error">{dashboard.error}</Notice>;
  const data = dashboard.data;
  const cards = [
    ['Configured items', data.configured, Boxes, 'Opening balances posted'],
    ['Low stock', data.low, ArrowLeftRight, 'At or below reorder point'],
    ['Out of stock', data.out, Scale, 'No unexpired stock available'],
    ['Expiring batches', data.expiring, ClipboardList, 'Expired or due within 7 days'],
    ['Awaiting opening', data.awaiting_opening, Boxes, 'Count required before use'],
    ['Awaiting recipes', data.awaiting_recipe, Utensils, 'Menu products to configure'],
  ];
  return (
    <>
      <PageHeader
        eyebrow="THE DAILY PICTURE"
        title="A clear view of your stock."
        description={'Welcome, ' + user.name + '. Here’s what needs your attention.'}
      />
      <div className="overview-banner">
        <div>
          <Badge tone="light">LIVE STOCK LEDGER</Badge>
          <h2>
            Good service starts
            <br />
            with knowing what’s on hand.
          </h2>
          <p>Every receipt, serving and count, accounted for.</p>
          <NavLink to="/inventory">
            View inventory <ArrowUpRight size={17} />
          </NavLink>
        </div>
        <div className="banner-leaves" aria-hidden="true">
          <Leaf size={180} strokeWidth={0.65} />
          <Leaf size={100} strokeWidth={0.7} />
        </div>
      </div>
      <div className="metric-grid">
        {cards.map(([label, value, Icon, description]: any) => (
          <div className="metric" key={label}>
            <div className="metric-top">
              <span>{label}</span>
              <Icon size={19} />
            </div>
            <strong>{value}</strong>
            <small>{description}</small>
          </div>
        ))}
      </div>
      <div className="dashboard-columns">
        <section className="panel">
          <div className="panel-title">
            <h2>Finish your setup</h2>
            <Badge>{data.awaiting_opening + data.awaiting_recipe} pending</Badge>
          </div>
          {!data.setup_items.length && !data.setup_products.length ? (
            <div className="empty">
              {data.configured
                ? 'Your setup queue is clear.'
                : 'Start by adding inventory items and importing your menu catalog.'}
            </div>
          ) : (
            <div className="setup-list">
              {data.setup_items.map((i: any) => (
                <div key={i.id}>
                  <span>
                    <strong>{i.name}</strong>
                    <small>Opening stock not configured</small>
                  </span>
                  <NavLink className="text-link" to={'/inventory?opening=' + i.id}>
                    Set opening stock <ArrowUpRight size={14} />
                  </NavLink>
                </div>
              ))}
              {user.role === 'admin' &&
                data.setup_products.map((p: any) => (
                  <div key={p.id}>
                    <span>
                      <strong>{p.source_name}</strong>
                      <small>{p.category} · Recipe not configured</small>
                    </span>
                    <NavLink className="text-link" to={'/products?recipe=' + p.id}>
                      Map recipe <ArrowUpRight size={14} />
                    </NavLink>
                  </div>
                ))}
            </div>
          )}
        </section>
        <section className="panel">
          <div className="panel-title">
            <h2>Batch watch</h2>
            <Badge tone="amber">7 day window</Badge>
          </div>
          {data.batches.length ? (
            <div className="setup-list">
              {data.batches.map((b: any) => (
                <div key={b.id}>
                  <span>
                    <strong>{b.name}</strong>
                    <small>
                      {b.label} · {b.quantity} {b.base_unit}
                    </small>
                  </span>
                  <Badge tone="amber">{b.expiry_date}</Badge>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty">
              <Leaf size={30} />
              No expired or soon-to-expire batches.
            </div>
          )}
          <p className="panel-note">
            Expired stock is excluded from available stock. Sales use the earliest unexpired batches
            first.
          </p>
        </section>
      </div>
    </>
  );
}
