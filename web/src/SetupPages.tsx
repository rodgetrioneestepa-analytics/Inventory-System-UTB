import { useEffect, useState } from 'react';
import { useSearchParams, NavLink } from 'react-router-dom';
import { Plus, Pencil, FileUp, Archive, Utensils, PackagePlus } from 'lucide-react';
import { api, date, key, localNow, money, number, toISO } from './api';
import { useApp, PageHeader } from './App';
import {
  Badge,
  DataTable,
  Fields,
  FormModal,
  LinesEditor,
  Loading,
  Modal,
  Notice,
  Pager,
  SearchBox,
  useData,
  type Field,
  type Row,
  type Column,
} from './components';

export const options = (rows: Row[], label = 'name') =>
  rows.map((r) => ({ value: r.id, label: `${r[label]}${r.sku ? ' · ' + r.sku : ''}` }));
export const unitOptions = ['g', 'kg', 'ml', 'l', 'piece', 'bottle', 'pack'].map((u) => ({
  value: u,
  label: u,
}));
export const eventFields: Field[] = [
  { name: 'reference', label: 'Reference' },
  { name: 'occurred_at', label: 'Date & time (Manila)', type: 'datetime-local' },
  { name: 'reason', label: 'Reason', type: 'textarea' },
];
export const eventBody = (v: Row) => ({
  key: v.key,
  reference: v.reference,
  occurred_at: toISO(v.occurred_at),
  reason: v.reason,
});
export const eventInitial = () => ({
  key: key(),
  occurred_at: localNow(),
  reason: '',
  reference: '',
});
const itemFields: Field[] = [
  { name: 'sku', label: 'SKU' },
  { name: 'name', label: 'Item name' },
  { name: 'category', label: 'Category' },
  {
    name: 'base_unit',
    label: 'Base unit',
    type: 'select',
    options: ['g', 'ml', 'piece', 'bottle'].map((x) => ({ value: x, label: x })),
  },
  { name: 'location', label: 'Storage location' },
  { name: 'reorder_point', label: 'Reorder point (base units)', type: 'number' },
  { name: 'target', label: 'Target stock (base units)', type: 'number' },
  { name: 'expiry_tracking', label: 'Track expiry dates', type: 'checkbox', required: false },
  { name: 'archived', label: 'Archived', type: 'checkbox', required: false },
];
const productFields: Field[] = [
  { name: 'sku', label: 'Menu SKU' },
  { name: 'source_name', label: 'Product name' },
  { name: 'category', label: 'Category' },
  {
    name: 'selling_price',
    label: 'Confirmed current selling price (₱)',
    type: 'number',
    required: false,
    help: 'Leave blank until confirmed. Zero-price items are allowed.',
  },
  { name: 'archived', label: 'Archived', type: 'checkbox', required: false },
];
export function useList(path: string) {
  const { revision } = useApp();
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState('');
  useEffect(() => setPage(1), [q, filter]);
  const d = useData(
    `${path}${path.includes('?') ? '&' : '?'}q=${encodeURIComponent(q)}&page=${page}${filter}`,
    revision,
  );
  return { ...d, q, setQ, page, setPage, filter, setFilter };
}
function ErrorOrLoading({ error, loading }: { error: string; loading: boolean }) {
  return error ? <Notice kind="error">{error}</Notice> : loading ? <Loading /> : null;
}
export function InventoryPage() {
  const ctx = useApp();
  const list = useList('/inventory');
  const [status, setStatus] = useState('');
  const [category, setCategory] = useState('');
  const [archived, setArchived] = useState(false);
  const lookup = useData('/lookups', ctx.revision);
  const [params, setParams] = useSearchParams();
  useEffect(
    () =>
      list.setFilter(
        `&status=${status}&category=${encodeURIComponent(category)}${archived ? '&archived=all' : ''}`,
      ),
    [status, category, archived],
  );
  function edit(item?: Row) {
    ctx.dialog(
      <FormModal
        title={item ? 'Edit inventory item' : 'Add inventory item'}
        fields={itemFields.map((f) => ({
          ...f,
          disabled: !!item?.opening_configured && ['base_unit', 'expiry_tracking'].includes(f.name),
        }))}
        initial={
          item
            ? { ...item, expiry_tracking: !!item.expiry_tracking, archived: !!item.archived }
            : {
                base_unit: '',
                expiry_tracking: false,
                archived: false,
                reorder_point: '',
                target: '',
              }
        }
        onClose={ctx.close}
        onSubmit={async (v) => {
          await api('/inventory' + (item ? '/' + item.id : ''), item ? 'PUT' : 'POST', {
            ...v,
            reorder_point: Number(v.reorder_point),
            target: Number(v.target),
          });
          ctx.refresh();
          ctx.notify(
            item
              ? 'Inventory item updated.'
              : 'Inventory item added. Set its opening stock before use.',
          );
        }}
      />,
    );
  }
  function opening(item: Row) {
    ctx.dialog(
      <FormModal
        title={'Set opening stock · ' + item.name}
        fields={[
          ...eventFields,
          { name: 'quantity', label: 'Counted opening quantity', type: 'number' },
          { name: 'unit', label: 'Unit', type: 'select', options: unitOptions },
          { name: 'batch_label', label: 'Batch label' },
          ...(item.expiry_tracking
            ? [{ name: 'expiry_date', label: 'Expiry date', type: 'date' }]
            : []),
        ]}
        initial={{ ...eventInitial(), unit: item.base_unit }}
        onClose={ctx.close}
        submit="Post opening balance"
        onSubmit={async (v) => {
          if (!confirm('Post this opening balance? It can only be set once.'))
            throw new Error('Posting cancelled.');
          await api(`/inventory/${item.id}/opening`, 'POST', {
            ...eventBody(v),
            quantity: Number(v.quantity),
            unit: v.unit,
            batch_label: v.batch_label,
            expiry_date: v.expiry_date || null,
          });
          ctx.refresh();
          ctx.notify('Opening balance posted with an audit reference.');
        }}
      >
        <Notice>
          This is a physical stock count. An unknown balance remains unconfigured until posted.
        </Notice>
      </FormModal>,
    );
  }
  useEffect(() => {
    const item = lookup.data?.items.find((i: Row) => i.id === params.get('opening'));
    if (item && ctx.user.role === 'admin') {
      opening(item);
      setParams({}, { replace: true });
    }
  }, [lookup.data, params]);
  function pack(item: Row) {
    ctx.dialog(
      <FormModal
        title={'Configure pack size · ' + item.name}
        fields={[
          {
            name: 'factor',
            label: `1 pack contains how many ${item.base_unit}?`,
            type: 'number',
            min: 0.000001,
          },
        ]}
        onClose={ctx.close}
        onSubmit={async (v) => {
          await api(`/inventory/${item.id}/conversions`, 'PUT', {
            from_unit: 'pack',
            factor: Number(v.factor),
          });
          ctx.refresh();
          ctx.notify(
            'Explicit pack conversion saved. Existing recipe versions retain their base quantities.',
          );
        }}
      />,
    );
  }
  function batches(item: Row) {
    ctx.dialog(<BatchDialog item={item} onClose={ctx.close} />);
  }
  const columns: Column[] = [
    {
      key: 'name',
      label: 'Item',
      render: (r) => (
        <div className="cell-title">
          <strong>{r.name}</strong>
          <small>
            {r.sku} · {r.category}
            {r.archived ? ' · Archived' : ''}
          </small>
        </div>
      ),
    },
    { key: 'location', label: 'Location' },
    {
      key: 'balance',
      label: 'Book stock',
      render: (r) =>
        r.balance === null ? (
          <Badge tone="amber">Opening stock not configured</Badge>
        ) : (
          <span>
            {number(r.balance)} <small>{r.base_unit}</small>
          </span>
        ),
    },
    {
      key: 'available',
      label: 'Available',
      render: (r) =>
        r.available === null ? (
          'Not configured'
        ) : (
          <span className="numeric">
            {number(r.available)} {r.base_unit}
          </span>
        ),
    },
    {
      key: 'status',
      label: 'Status',
      render: (r) => (
        <Badge tone={r.status === 'healthy' ? 'green' : r.status === 'out' ? 'red' : 'amber'}>
          {r.status === 'unconfigured'
            ? 'Needs opening'
            : r.status === 'low'
              ? 'Low stock'
              : r.status === 'out'
                ? 'Out of stock'
                : 'Healthy'}
        </Badge>
      ),
    },
    {
      key: 'actions',
      label: 'Actions',
      render: (r) => (
        <div className="row-actions">
          <button className="text-link" onClick={() => batches(r)}>
            Batches
          </button>
          {ctx.user.role === 'admin' && (
            <>
              {!r.opening_configured ? (
                <button className="text-link" onClick={() => opening(r)}>
                  Set opening stock
                </button>
              ) : null}
              <button className="icon-btn" aria-label={'Edit ' + r.name} onClick={() => edit(r)}>
                <Pencil size={15} />
              </button>
              <button
                className="icon-btn"
                aria-label={'Configure pack ' + r.name}
                onClick={() => pack(r)}
              >
                <PackagePlus size={16} />
              </button>
            </>
          )}
        </div>
      ),
    },
  ];
  return (
    <>
      <PageHeader
        eyebrow="STOCKROOM"
        title="Inventory"
        description="Physical items, clear balances and a record behind every change."
        actions={
          ctx.user.role === 'admin' && (
            <button onClick={() => edit()}>
              <Plus size={17} />
              Add item
            </button>
          )
        }
      />
      <section className="panel">
        <div className="table-toolbar">
          <SearchBox value={list.q} onChange={list.setQ} />
          <select
            aria-label="Category filter"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            <option value="">All categories</option>
            {[...new Set<string>(lookup.data?.items.map((i: Row) => i.category) ?? [])].map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
          <select
            aria-label="Stock status"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="">All stock statuses</option>
            <option value="unconfigured">Awaiting opening</option>
            <option value="low">Low stock</option>
            <option value="out">Out of stock</option>
            <option value="healthy">Healthy</option>
          </select>
          <label className="inline-check">
            <input
              type="checkbox"
              checked={archived}
              onChange={(e) => setArchived(e.target.checked)}
            />
            Include archived
          </label>
        </div>
        <ErrorOrLoading error={list.error} loading={list.loading} />
        {list.data && !list.loading && (
          <>
            <DataTable rows={list.data.rows} columns={columns} />
            <Pager page={list.page} onChange={list.setPage} total={list.data.total} />
          </>
        )}
      </section>
      <p className="footnote">
        Available stock excludes expired batches. Stock is calculated from the posted ledger, in
        each item’s base unit.
      </p>
    </>
  );
}
function BatchDialog({ item, onClose }: { item: Row; onClose: () => void }) {
  const d = useData(`/inventory/${item.id}/batches`);
  const c = useData(`/inventory/${item.id}/conversions`);
  return (
    <Modal title={'Batches & units · ' + item.name} onClose={onClose}>
      <div className="modal-body">
        <ErrorOrLoading error={d.error} loading={d.loading} />
        {d.data && (
          <DataTable
            rows={d.data}
            columns={[
              { key: 'label', label: 'Batch' },
              { key: 'expiry_date', label: 'Expiry' },
              {
                key: 'quantity',
                label: `Book balance (${item.base_unit})`,
                render: (r) => number(r.quantity),
              },
            ]}
          />
        )}
        <p>
          Base unit: <strong>{item.base_unit}</strong>.{' '}
          {item.base_unit === 'g'
            ? '1 kg = 1,000 g.'
            : item.base_unit === 'ml'
              ? '1 l = 1,000 ml.'
              : ''}
        </p>
        {c.data?.length ? (
          c.data.map((r: Row) => (
            <p key={r.id}>
              1 {r.from_unit} = {r.factor} {item.base_unit}
            </p>
          ))
        ) : (
          <p>Pack size: Not configured.</p>
        )}
      </div>
    </Modal>
  );
}
export function ProductsPage() {
  const ctx = useApp();
  const list = useList('/products');
  const lookup = useData('/lookups', ctx.revision);
  const [params, setParams] = useSearchParams();
  const [unmapped, setUnmapped] = useState(false);
  const [archived, setArchived] = useState(false);
  useEffect(
    () => list.setFilter(`${unmapped ? '&status=unmapped' : ''}${archived ? '&archived=all' : ''}`),
    [unmapped, archived],
  );
  function edit(product?: Row) {
    ctx.dialog(
      <FormModal
        title={product ? 'Edit menu product' : 'Add menu product'}
        fields={productFields}
        initial={
          product
            ? {
                ...product,
                archived: !!product.archived,
                selling_price: product.selling_price ?? '',
              }
            : { archived: false }
        }
        onClose={ctx.close}
        onSubmit={async (v) => {
          await api('/products' + (product ? '/' + product.id : ''), product ? 'PUT' : 'POST', {
            ...v,
            selling_price:
              v.selling_price === '' || v.selling_price === undefined
                ? null
                : Number(v.selling_price),
          });
          ctx.refresh();
          ctx.notify('Menu product saved.');
        }}
      />,
    );
  }
  function recipe(product: Row) {
    ctx.dialog(<RecipeDialog product={product} items={lookup.data?.items ?? []} />);
  }
  useEffect(() => {
    const p = lookup.data?.products.find((p: Row) => p.id === params.get('recipe'));
    if (p) {
      recipe(p);
      setParams({}, { replace: true });
    }
  }, [lookup.data, params]);
  return (
    <>
      <PageHeader
        eyebrow="FROM MENU TO STOCK"
        title="Menu & recipes"
        description="Map what you serve to what you use. Confirm each recipe yourself."
        actions={
          <>
            <NavLink className="button secondary" to="/imports">
              <FileUp size={17} />
              Import catalog
            </NavLink>
            <button onClick={() => edit()}>
              <Plus size={17} />
              Add product
            </button>
          </>
        }
      />
      <section className="panel">
        <div className="table-toolbar">
          <SearchBox value={list.q} onChange={list.setQ} />
          <label className="inline-check">
            <input
              type="checkbox"
              checked={unmapped}
              onChange={(e) => setUnmapped(e.target.checked)}
            />
            Awaiting recipe only
          </label>
          <label className="inline-check">
            <input
              type="checkbox"
              checked={archived}
              onChange={(e) => setArchived(e.target.checked)}
            />
            Include archived
          </label>
        </div>
        <ErrorOrLoading {...list} />
        {list.data && !list.loading && (
          <>
            <DataTable
              rows={list.data.rows}
              columns={[
                {
                  key: 'source_name',
                  label: 'Menu product',
                  render: (r) => (
                    <div className="cell-title">
                      <strong>{r.source_name}</strong>
                      <small>
                        {r.sku}
                        {r.archived ? ' · Archived' : ''}
                      </small>
                    </div>
                  ),
                },
                { key: 'category', label: 'Category' },
                {
                  key: 'selling_price',
                  label: 'Current price',
                  render: (r) => money(r.selling_price),
                },
                {
                  key: 'recipe',
                  label: 'Recipe',
                  render: (r) => (
                    <Badge tone={r.recipe_version_id ? 'green' : 'amber'}>
                      {r.recipe_version_id ? 'Mapped' : 'Not configured'}
                    </Badge>
                  ),
                },
                {
                  key: 'actions',
                  label: 'Actions',
                  render: (r) => (
                    <div className="row-actions">
                      <button className="text-link" onClick={() => recipe(r)}>
                        <Utensils size={14} />
                        {r.recipe_version_id ? 'View / revise recipe' : 'Map recipe'}
                      </button>
                      <button
                        className="icon-btn"
                        aria-label={'Edit ' + r.source_name}
                        onClick={() => edit(r)}
                      >
                        <Pencil size={15} />
                      </button>
                    </div>
                  ),
                },
              ]}
            />
            <Pager page={list.page} onChange={list.setPage} total={list.data.total} />
          </>
        )}
      </section>
      <p className="footnote">
        Catalog imports preserve names and categories only. Recipe versions and confirmed current
        prices are never overwritten by reimports.
      </p>
    </>
  );
}
function RecipeDialog({ product, items }: { product: Row; items: Row[] }) {
  const ctx = useApp();
  const history = useData(`/products/${product.id}/recipes`);
  const [lines, setLines] = useState<Row[]>([{ item_id: '', quantity: '', unit: '' }]);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (history.data?.[0])
      setLines(
        history.data[0].ingredients.map((i: Row) => ({
          item_id: i.item_id,
          quantity: i.quantity,
          unit: i.base_unit,
        })),
      );
  }, [history.data]);
  const fields: Field[] = [
    { name: 'item_id', label: 'Inventory item', type: 'select', options: options(items) },
    { name: 'quantity', label: 'Quantity per serving', type: 'number', min: 0.000001 },
    { name: 'unit', label: 'Unit', type: 'select', options: unitOptions },
  ];
  return (
    <Modal title={'Recipe · ' + product.source_name} onClose={ctx.close}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError('');
          try {
            await api(`/products/${product.id}/recipes`, 'POST', {
              reason,
              ingredients: lines.map((l) => ({ ...l, quantity: Number(l.quantity) })),
            });
            ctx.refresh();
            ctx.notify('New immutable recipe version published.');
            ctx.close();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="modal-body">
          <Notice>
            Enter confirmed quantities for one serving, including packaging and extras. Previous
            versions remain attached to past sales.
          </Notice>
          {history.error && <Notice kind="error">{history.error}</Notice>}
          <LinesEditor
            lines={lines}
            onChange={setLines}
            fields={fields}
            blank={() => ({ item_id: '', quantity: '', unit: '' })}
            label="Ingredient"
          />
          <label>
            Reason for this version
            <textarea required value={reason} onChange={(e) => setReason(e.target.value)} />
          </label>
          {history.data?.length > 0 && (
            <details>
              <summary>Version history ({history.data.length})</summary>
              {history.data.map((v: Row) => (
                <div className="history-entry" key={v.id}>
                  <strong>Version {v.version}</strong> · {date(v.created_at)}
                  <p>{v.reason}</p>
                  {v.ingredients.map((i: Row) => (
                    <small key={i.id}>
                      {i.name}: {number(i.quantity)} {i.base_unit} per serving
                      <br />
                    </small>
                  ))}
                </div>
              ))}
            </details>
          )}
          {error && <Notice kind="error">{error}</Notice>}
        </div>
        <div className="modal-foot">
          <button type="button" className="secondary" onClick={ctx.close}>
            Cancel
          </button>
          <button disabled={busy || history.loading}>
            {busy ? 'Publishing…' : 'Publish recipe version'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
export function SuppliersPage() {
  const ctx = useApp();
  const list = useList('/suppliers');
  function edit(supplier?: Row) {
    ctx.dialog(
      <FormModal
        title={supplier ? 'Edit supplier' : 'Add supplier'}
        fields={[
          { name: 'name', label: 'Supplier name' },
          { name: 'contact', label: 'Contact / phone', required: false },
          { name: 'email', label: 'Email', type: 'email', required: false },
          { name: 'address', label: 'Address', type: 'textarea', required: false },
          { name: 'archived', label: 'Archived', type: 'checkbox', required: false },
        ]}
        initial={
          supplier
            ? { ...supplier, archived: !!supplier.archived }
            : { contact: '', email: '', address: '', archived: false }
        }
        onClose={ctx.close}
        onSubmit={async (v) => {
          await api(
            '/suppliers' + (supplier ? '/' + supplier.id : ''),
            supplier ? 'PUT' : 'POST',
            v,
          );
          ctx.refresh();
          ctx.notify('Supplier saved.');
        }}
      />,
    );
  }
  return (
    <>
      <PageHeader
        eyebrow="YOUR SUPPLY NETWORK"
        title="Suppliers"
        description="Keep your real supplier contacts ready for the next order."
        actions={
          <button onClick={() => edit()}>
            <Plus size={17} />
            Add supplier
          </button>
        }
      />
      <section className="panel">
        <div className="table-toolbar">
          <SearchBox value={list.q} onChange={list.setQ} />
          <label className="inline-check">
            <input
              type="checkbox"
              onChange={(e) => list.setFilter(e.target.checked ? '&archived=all' : '')}
            />
            Include archived
          </label>
        </div>
        <ErrorOrLoading {...list} />
        {list.data && !list.loading && (
          <>
            <DataTable
              rows={list.data.rows}
              columns={[
                {
                  key: 'name',
                  label: 'Supplier',
                  render: (r) => (
                    <strong>
                      {r.name}
                      {r.archived ? ' · Archived' : ''}
                    </strong>
                  ),
                },
                { key: 'contact', label: 'Contact' },
                { key: 'email', label: 'Email' },
                { key: 'address', label: 'Address' },
                {
                  key: 'actions',
                  label: 'Actions',
                  render: (r) => (
                    <button className="text-link" onClick={() => edit(r)}>
                      <Pencil size={15} />
                      Edit
                    </button>
                  ),
                },
              ]}
            />
            <Pager page={list.page} onChange={list.setPage} total={list.data.total} />
          </>
        )}
      </section>
    </>
  );
}
export function UsersPage() {
  const ctx = useApp();
  const list = useList('/users');
  const settings = useData('/settings', ctx.revision);
  const audit = useData('/audit?limit=25', ctx.revision);
  const [tab, setTab] = useState('users');
  const fields: Field[] = [
    { name: 'name', label: 'Display name' },
    { name: 'email', label: 'Email address', type: 'email' },
    {
      name: 'role',
      label: 'Role',
      type: 'select',
      options: [
        { value: 'admin', label: 'Owner / Admin' },
        { value: 'staff', label: 'Inventory staff' },
      ],
    },
    {
      name: 'password',
      label: 'Initial password',
      type: 'password',
      help: '12–72 characters. Share securely; the user can change it.',
    },
  ];
  function create() {
    ctx.dialog(
      <FormModal
        title="Create user"
        fields={fields}
        initial={{ role: 'staff' }}
        onClose={ctx.close}
        onSubmit={async (v) => {
          await api('/users', 'POST', v);
          ctx.refresh();
          ctx.notify('User created.');
        }}
      />,
    );
  }
  function edit(u: Row) {
    ctx.dialog(
      <FormModal
        title={'Access · ' + u.name}
        fields={[
          fields[0],
          fields[2],
          { name: 'active', label: 'Account active', type: 'checkbox', required: false },
        ]}
        initial={{ ...u, active: !!u.active }}
        onClose={ctx.close}
        onSubmit={async (v) => {
          await api('/users/' + u.id, 'PUT', { name: v.name, role: v.role, active: v.active });
          ctx.refresh();
          ctx.notify('Access updated. Existing sessions for this account were revoked.');
        }}
      />,
    );
  }
  function reset(u: Row) {
    ctx.dialog(
      <FormModal
        title={'Reset password · ' + u.name}
        fields={[fields[3]]}
        onClose={ctx.close}
        onSubmit={async (v) => {
          await api('/users/' + u.id + '/password', 'POST', v);
          ctx.refresh();
          ctx.notify('Password reset and account sessions revoked.');
        }}
      />,
    );
  }
  function ownPassword() {
    ctx.dialog(
      <FormModal
        title="Change your password"
        fields={[
          { name: 'current_password', label: 'Current password', type: 'password' },
          { name: 'password', label: 'New password', type: 'password' },
        ]}
        onClose={ctx.close}
        onSubmit={async (v) => {
          await api('/auth/password', 'POST', v);
          window.location.reload();
        }}
      />,
    );
  }
  return (
    <>
      <PageHeader
        eyebrow="WORKSPACE ADMINISTRATION"
        title="Users & settings"
        description="Manage access and review how your workspace operates."
        actions={
          <>
            <button className="secondary" onClick={ownPassword}>
              Change my password
            </button>
            <button onClick={create}>
              <Plus size={17} />
              Create user
            </button>
          </>
        }
      />
      <div className="tabs">
        {['users', 'settings', 'audit'].map((t) => (
          <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
            {t === 'audit' ? 'Audit log' : t[0].toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>
      <section className="panel">
        {tab === 'users' ? (
          <>
            <ErrorOrLoading {...list} />
            {list.data && (
              <>
                <DataTable
                  rows={list.data.rows}
                  columns={[
                    { key: 'name', label: 'Name' },
                    { key: 'email', label: 'Email' },
                    {
                      key: 'role',
                      label: 'Role',
                      render: (r) => (
                        <Badge>{r.role === 'admin' ? 'Owner / Admin' : 'Inventory staff'}</Badge>
                      ),
                    },
                    {
                      key: 'active',
                      label: 'Status',
                      render: (r) => (
                        <Badge tone={r.active ? 'green' : 'red'}>
                          {r.active ? 'Active' : 'Disabled'}
                        </Badge>
                      ),
                    },
                    {
                      key: 'actions',
                      label: 'Actions',
                      render: (r) => (
                        <div className="row-actions">
                          <button className="text-link" onClick={() => edit(r)}>
                            Edit access
                          </button>
                          <button className="text-link" onClick={() => reset(r)}>
                            Reset password
                          </button>
                        </div>
                      ),
                    },
                  ]}
                />
                <Pager page={list.page} onChange={list.setPage} total={list.data.total} />
              </>
            )}
          </>
        ) : tab === 'settings' ? (
          <div className="settings-list">
            {settings.data &&
              Object.entries(settings.data).map(([k, v]) => (
                <div key={k}>
                  <strong>{k.replaceAll('_', ' ')}</strong>
                  <span>{String(v)}</span>
                </div>
              ))}
          </div>
        ) : (
          <>
            {audit.error && <Notice kind="error">{audit.error}</Notice>}
            {audit.data && (
              <DataTable
                rows={audit.data.rows}
                columns={[
                  {
                    key: 'created_at',
                    label: 'Recorded (Manila)',
                    render: (r) => date(r.created_at),
                  },
                  { key: 'actor', label: 'User' },
                  { key: 'action', label: 'Action' },
                  { key: 'entity_type', label: 'Entity' },
                  {
                    key: 'details',
                    label: 'Details',
                    render: (r) => (
                      <details>
                        <summary>View change</summary>
                        <pre>{JSON.stringify(JSON.parse(r.details), null, 2)}</pre>
                      </details>
                    ),
                  },
                ]}
              />
            )}
          </>
        )}
      </section>
    </>
  );
}
