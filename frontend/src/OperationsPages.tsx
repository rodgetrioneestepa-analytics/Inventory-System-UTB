import { useEffect, useState, type FormEvent } from 'react';
import { Plus, Eye, Download, Printer, Check, RotateCcw, FileUp } from 'lucide-react';
import { api, date, key, localNow, money, number, toISO, uploadCSV } from './api';
import { PageHeader, useApp } from './App';
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
  type Row,
  type Field,
  type Column,
} from './components';
import { eventBody, eventFields, eventInitial, options, unitOptions, useList } from './SetupPages';

export function OrdersPage() {
  const ctx = useApp();
  const list = useList('/purchase-orders');
  return (
    <>
      <PageHeader
        eyebrow="ORDER TO STOCKROOM"
        title="Purchasing & receiving"
        description="Plan purchases, record real deliveries and see what’s still due."
        actions={
          ctx.user.role === 'admin' && (
            <button onClick={() => ctx.dialog(<OrderEditor />)}>
              <Plus size={17} />
              New purchase order
            </button>
          )
        }
      />
      <section className="panel">
        <div className="table-toolbar">
          <SearchBox value={list.q} onChange={list.setQ} />
          <select
            aria-label="Order status"
            onChange={(e) => list.setFilter('&status=' + e.target.value)}
          >
            <option value="">All statuses</option>
            {['draft', 'ordered', 'partial', 'complete', 'cancelled'].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </div>
        {list.error && <Notice kind="error">{list.error}</Notice>}
        {list.loading ? (
          <Loading />
        ) : (
          list.data && (
            <>
              <DataTable
                rows={list.data.rows}
                columns={[
                  {
                    key: 'reference',
                    label: 'Order reference',
                    render: (r) => <strong>{r.reference}</strong>,
                  },
                  { key: 'supplier_name', label: 'Supplier' },
                  { key: 'expected_date', label: 'Expected delivery' },
                  {
                    key: 'status',
                    label: 'Status',
                    render: (r) => (
                      <Badge
                        tone={
                          r.status === 'complete'
                            ? 'green'
                            : r.status === 'partial'
                              ? 'amber'
                              : 'neutral'
                        }
                      >
                        {r.status}
                      </Badge>
                    ),
                  },
                  {
                    key: 'actions',
                    label: 'Actions',
                    render: (r) => (
                      <button
                        className="text-link"
                        onClick={() => ctx.dialog(<OrderDetail orderId={r.id} />)}
                      >
                        <Eye size={15} />
                        View / receive
                      </button>
                    ),
                  },
                ]}
              />
              <Pager page={list.page} total={list.data.total} onChange={list.setPage} />
            </>
          )
        )}
      </section>
      <p className="footnote">
        Draft and submitted purchase orders never change stock. Only a posted receipt adds
        inventory.
      </p>
    </>
  );
}
function OrderEditor() {
  const ctx = useApp();
  const lookup = useData('/lookups', ctx.revision);
  const [value, setValue] = useState<Row>({});
  const [lines, setLines] = useState<Row[]>([
    { item_id: '', quantity: '', unit: '', unit_cost: '' },
  ]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Modal title="New purchase order" onClose={ctx.close}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setError('');
          setBusy(true);
          try {
            await api('/purchase-orders', 'POST', {
              ...value,
              lines: lines.map((l) => ({
                ...l,
                quantity: Number(l.quantity),
                unit_cost: Number(l.unit_cost),
              })),
            });
            ctx.refresh();
            ctx.notify('Purchase order saved as a draft.');
            ctx.close();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="modal-body">
          {lookup.error && <Notice kind="error">{lookup.error}</Notice>}
          <Fields
            fields={[
              { name: 'reference', label: 'PO reference' },
              {
                name: 'supplier_id',
                label: 'Supplier',
                type: 'select',
                options: options(lookup.data?.suppliers ?? []),
              },
              { name: 'expected_date', label: 'Expected date', type: 'date' },
            ]}
            value={value}
            onChange={setValue}
          />
          <LinesEditor
            lines={lines}
            onChange={setLines}
            blank={() => ({ item_id: '', quantity: '', unit: '', unit_cost: '' })}
            fields={[
              {
                name: 'item_id',
                label: 'Inventory item',
                type: 'select',
                options: options(lookup.data?.items ?? []),
              },
              { name: 'quantity', label: 'Ordered quantity', type: 'number', min: 0.000001 },
              { name: 'unit', label: 'Ordering unit', type: 'select', options: unitOptions },
              { name: 'unit_cost', label: 'Purchase cost per ordering unit (₱)', type: 'number' },
            ]}
          />
          {error && <Notice kind="error">{error}</Notice>}
        </div>
        <div className="modal-foot">
          <button type="button" className="secondary" onClick={ctx.close}>
            Cancel
          </button>
          <button disabled={busy}>{busy ? 'Saving…' : 'Save draft order'}</button>
        </div>
      </form>
    </Modal>
  );
}
function OrderDetail({ orderId }: { orderId: string }) {
  const ctx = useApp();
  const d = useData('/purchase-orders/' + orderId, ctx.revision);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function status(status: string) {
    setBusy(true);
    setError('');
    try {
      await api(`/purchase-orders/${orderId}/status`, 'POST', { status });
      ctx.refresh();
      ctx.notify('Order ' + status + '.');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={'Purchase order' + (d.data ? ' · ' + d.data.reference : '')} onClose={ctx.close}>
      <div className="modal-body">
        {d.loading ? (
          <Loading />
        ) : d.error ? (
          <Notice kind="error">{d.error}</Notice>
        ) : (
          d.data && (
            <>
              <div className="detail-strip">
                <span>{d.data.supplier_name}</span>
                <Badge>{d.data.status}</Badge>
                <span>Expected {d.data.expected_date}</span>
              </div>
              <DataTable
                rows={d.data.lines}
                columns={[
                  { key: 'name', label: 'Item' },
                  {
                    key: 'quantity',
                    label: 'Ordered',
                    render: (r) => number(r.quantity) + ' ' + r.base_unit,
                  },
                  { key: 'received', label: 'Received', render: (r) => number(r.received) },
                  { key: 'remaining', label: 'Remaining', render: (r) => number(r.remaining) },
                  {
                    key: 'unit_cost',
                    label: 'Cost / base unit',
                    render: (r) => money(r.unit_cost),
                  },
                ]}
              />
              <Notice>
                Quantities are displayed in base units. Received totals exclude reversed receipts.
              </Notice>
            </>
          )
        )}
        {error && <Notice kind="error">{error}</Notice>}
      </div>
      <div className="modal-foot">
        {ctx.user.role === 'admin' && d.data?.status === 'draft' && (
          <button disabled={busy} onClick={() => status('ordered')}>
            <Check size={16} />
            Submit order
          </button>
        )}
        {ctx.user.role === 'admin' && ['draft', 'ordered'].includes(d.data?.status) && (
          <button
            className="secondary"
            disabled={busy}
            onClick={() => {
              if (confirm('Cancel this unreceived order?')) status('cancelled');
            }}
          >
            Cancel order
          </button>
        )}
        {['ordered', 'partial', 'complete'].includes(d.data?.status) && (
          <button onClick={() => ctx.dialog(<ReceiveDialog po={d.data} />)}>
            <Plus size={16} />
            Record delivery
          </button>
        )}
        <button className="secondary" onClick={ctx.close}>
          Close
        </button>
      </div>
    </Modal>
  );
}
function ReceiveDialog({ po }: { po: Row }) {
  const ctx = useApp();
  const [value, setValue] = useState<Row>({
    ...eventInitial(),
    delivery_reference: '',
    over_receipt_reason: '',
  });
  const blank = () => ({
    po_line_id: '',
    quantity: '',
    unit: '',
    batch_label: '',
    expiry_date: '',
  });
  const [lines, setLines] = useState<Row[]>([blank()]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <Modal title={'Receive delivery · ' + po.reference} onClose={ctx.close}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError('');
          try {
            if (!confirm('Post this receipt and add the delivered stock?'))
              throw new Error('Posting cancelled.');
            await api(`/purchase-orders/${po.id}/receive`, 'POST', {
              ...eventBody(value),
              delivery_reference: value.delivery_reference,
              over_receipt_reason: value.over_receipt_reason || undefined,
              lines: lines.map((l) => ({
                ...l,
                quantity: Number(l.quantity),
                expiry_date: l.expiry_date || null,
              })),
            });
            ctx.refresh();
            ctx.notify('Delivery posted. Stock increased exactly once.');
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
            All received items need opening stock configured first. A delivery reference can only be
            posted once.
          </Notice>
          <Fields
            fields={[
              ...eventFields,
              { name: 'delivery_reference', label: 'Unique delivery reference' },
              ...(ctx.user.role === 'admin'
                ? [
                    {
                      name: 'over_receipt_reason',
                      label: 'Over-receipt exception reason (optional)',
                      required: false,
                    },
                  ]
                : []),
            ]}
            value={value}
            onChange={setValue}
          />
          <LinesEditor
            lines={lines}
            onChange={setLines}
            blank={blank}
            fields={[
              {
                name: 'po_line_id',
                label: 'Order line',
                type: 'select',
                options: po.lines.map((l: Row) => ({
                  value: l.id,
                  label: `${l.name} · ${l.remaining} ${l.base_unit} remaining${l.expiry_tracking ? ' · expiry required' : ''}`,
                })),
              },
              { name: 'quantity', label: 'Received quantity', type: 'number', min: 0.000001 },
              { name: 'unit', label: 'Unit', type: 'select', options: unitOptions },
              { name: 'batch_label', label: 'Batch label' },
              {
                name: 'expiry_date',
                label: 'Expiry date (tracked items only)',
                type: 'date',
                required: false,
              },
            ]}
          />
          {error && <Notice kind="error">{error}</Notice>}
        </div>
        <div className="modal-foot">
          <button type="button" className="secondary" onClick={ctx.close}>
            Cancel
          </button>
          <button disabled={busy}>{busy ? 'Posting…' : 'Post receipt'}</button>
        </div>
      </form>
    </Modal>
  );
}
export function reverseDialog(event: Row, ctx: ReturnType<typeof useApp>) {
  ctx.dialog(
    <FormModal
      title={'Reverse event · ' + (event.reference ?? event.transaction_reference)}
      fields={eventFields}
      initial={eventInitial()}
      submit="Post linked reversal"
      onClose={ctx.close}
      onSubmit={async (v) => {
        if (!confirm('Post a compensating reversal? The original event will remain in the ledger.'))
          throw new Error('Reversal cancelled.');
        await api(`/events/${event.event_id ?? event.id}/reverse`, 'POST', eventBody(v));
        ctx.refresh();
        ctx.notify('Linked reversal posted. Original records preserved.');
      }}
    >
      <Notice>
        Receipts can only be reversed while their quantities remain in the original batches. Reverse
        dependent consumption first.
      </Notice>
    </FormModal>,
  );
}
export function MovementsPage() {
  const ctx = useApp();
  const list = useList('/movements');
  const lookup = useData('/lookups', ctx.revision);
  const [filters, setFilters] = useState<Row>({});
  useEffect(() => {
    const p = new URLSearchParams();
    for (const k of ['type', 'item', 'actor']) if (filters[k]) p.set(k, filters[k]);
    if (filters.from) p.set('from', toISO(filters.from));
    if (filters.to) p.set('to', toISO(filters.to));
    list.setFilter('&' + p.toString());
  }, [filters]);
  return (
    <>
      <PageHeader
        eyebrow="THE AUDIT TRAIL"
        title="Stock movements"
        description="An append-only record of what changed, why and who posted it."
      />
      <section className="panel">
        <div className="table-toolbar">
          <SearchBox value={list.q} onChange={list.setQ} />
        </div>
        <div className="filter-fields">
          <Fields
            value={filters}
            onChange={setFilters}
            fields={[
              {
                name: 'type',
                label: 'Movement type',
                type: 'select',
                required: false,
                options: ['opening', 'receipt', 'sale', 'wastage', 'count', 'reversal'].map(
                  (s) => ({ value: s, label: s }),
                ),
              },
              {
                name: 'item',
                label: 'Item',
                type: 'select',
                required: false,
                options: options(lookup.data?.items ?? []),
              },
              ...(ctx.user.role === 'admin'
                ? [
                    {
                      name: 'actor',
                      label: 'Actor',
                      type: 'select',
                      required: false,
                      options: options(lookup.data?.users ?? []),
                    } as Field,
                  ]
                : []),
              { name: 'from', label: 'From (Manila)', type: 'datetime-local', required: false },
              { name: 'to', label: 'To (Manila)', type: 'datetime-local', required: false },
            ]}
          />
        </div>
        {list.error && <Notice kind="error">{list.error}</Notice>}
        {list.loading ? (
          <Loading />
        ) : (
          list.data && (
            <>
              <DataTable
                rows={list.data.rows}
                columns={[
                  {
                    key: 'occurred_at',
                    label: 'Occurred (Manila)',
                    render: (r) => (
                      <div className="cell-title">
                        {date(r.occurred_at)}
                        <small>Recorded {date(r.created_at)}</small>
                      </div>
                    ),
                  },
                  {
                    key: 'item_name',
                    label: 'Item / batch',
                    render: (r) => (
                      <div className="cell-title">
                        <strong>{r.item_name}</strong>
                        <small>{r.batch_label}</small>
                      </div>
                    ),
                  },
                  { key: 'kind', label: 'Type', render: (r) => <Badge>{r.kind}</Badge> },
                  {
                    key: 'quantity',
                    label: 'Change',
                    render: (r) => (
                      <strong className={r.quantity < 0 ? 'negative' : 'positive'}>
                        {r.quantity > 0 ? '+' : ''}
                        {number(r.quantity)} {r.base_unit}
                      </strong>
                    ),
                  },
                  {
                    key: 'reference',
                    label: 'Reference / reason',
                    render: (r) => (
                      <div className="cell-title">
                        {r.reference}
                        <small>
                          {r.reason} · {r.source}
                        </small>
                      </div>
                    ),
                  },
                  { key: 'actor', label: 'Posted by' },
                  {
                    key: 'actions',
                    label: 'Correction',
                    render: (r) =>
                      r.reversed ? (
                        <Badge>Reversed</Badge>
                      ) : ctx.user.role === 'admin' &&
                        ['receipt', 'sale', 'count', 'wastage'].includes(r.kind) ? (
                        <button className="text-link" onClick={() => reverseDialog(r, ctx)}>
                          <RotateCcw size={14} />
                          Reverse event
                        </button>
                      ) : r.kind === 'reversal' ? (
                        <small>Linked correction</small>
                      ) : (
                        '—'
                      ),
                  },
                ]}
              />
              <Pager page={list.page} total={list.data.total} onChange={list.setPage} />
            </>
          )
        )}
      </section>
    </>
  );
}
export function AdjustmentsPage() {
  const ctx = useApp();
  const list = useList('/events');
  return (
    <>
      <PageHeader
        eyebrow="RECONCILE WITH REALITY"
        title="Wastage & stock counts"
        description="Record losses and physical counts with a reason behind every adjustment."
        actions={
          <>
            <button
              className="secondary"
              onClick={() => ctx.dialog(<AdjustmentDialog mode="wastage" />)}
            >
              <Plus size={17} />
              Record wastage
            </button>
            <button onClick={() => ctx.dialog(<AdjustmentDialog mode="count" />)}>
              <Plus size={17} />
              Physical count
            </button>
          </>
        }
      />
      <div className="info-grid">
        <div className="panel intro-card">
          <h2>Wastage</h2>
          <p>
            Record expired, damaged or otherwise unusable stock. Expired batches can be selected for
            disposal.
          </p>
        </div>
        <div className="panel intro-card">
          <h2>Physical counts</h2>
          <p>
            Count each batch, review the book balance and post the difference. A stale count is
            rejected if stock changes.
          </p>
        </div>
      </div>
      <section className="panel">
        <div className="panel-title">
          <h2>Posted stock events</h2>
          <Badge>Audited</Badge>
        </div>
        {list.error && <Notice kind="error">{list.error}</Notice>}
        {list.loading ? (
          <Loading />
        ) : (
          list.data && (
            <>
              <DataTable
                rows={list.data.rows}
                columns={[
                  {
                    key: 'occurred_at',
                    label: 'Date (Manila)',
                    render: (r) => date(r.occurred_at),
                  },
                  { key: 'kind', label: 'Event type', render: (r) => <Badge>{r.kind}</Badge> },
                  { key: 'reference', label: 'Reference' },
                  { key: 'reason', label: 'Reason' },
                  { key: 'actor', label: 'Posted by' },
                  {
                    key: 'actions',
                    label: 'Correction',
                    render: (r) =>
                      r.reversed ? (
                        <Badge>Reversed</Badge>
                      ) : ctx.user.role === 'admin' &&
                        ['wastage', 'count', 'sale', 'receipt'].includes(r.kind) ? (
                        <button className="text-link" onClick={() => reverseDialog(r, ctx)}>
                          Reverse
                        </button>
                      ) : (
                        '—'
                      ),
                  },
                ]}
              />
              <Pager page={list.page} total={list.data.total} onChange={list.setPage} />
            </>
          )
        )}
      </section>
    </>
  );
}
function AdjustmentDialog({ mode }: { mode: 'count' | 'wastage' }) {
  const ctx = useApp();
  const lookup = useData('/lookups', ctx.revision);
  const [value, setValue] = useState<Row>({
    ...eventInitial(),
    item_id: '',
    batch_id: '',
    quantity: '',
    counted: '',
    unit: '',
    category: '',
  });
  const batches = useData(
    value.item_id ? `/inventory/${value.item_id}/batches` : '/inventory/nonexistent/batches',
    ctx.revision,
  );
  const [preview, setPreview] = useState<Row>();
  const [body, setBody] = useState<Row>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const items = (lookup.data?.items ?? []).filter((i: Row) => i.opening_configured);
  const item = items.find((i: Row) => i.id === value.item_id);
  function update(v: Row) {
    if (v.item_id !== value.item_id) {
      v.batch_id = '';
      v.unit = items.find((i: Row) => i.id === v.item_id)?.base_unit ?? '';
    }
    setValue(v);
    setPreview(undefined);
    setBody(undefined);
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (mode === 'count' && !preview) {
        const batch = batches.data?.find((b: Row) => b.id === value.batch_id);
        const b = {
          ...eventBody(value),
          lines: [
            {
              item_id: value.item_id,
              batch_id: value.batch_id,
              counted: Number(value.counted),
              expected_book: batch?.quantity,
              unit: value.unit,
            },
          ],
        };
        const p = await api('/counts/preview', 'POST', b);
        setPreview(p);
        setBody(b);
      } else {
        if (
          !confirm('Post this stock ' + (mode === 'count' ? 'count adjustment' : 'wastage') + '?')
        )
          throw new Error('Posting cancelled.');
        const b =
          mode === 'count'
            ? body
            : {
                ...eventBody(value),
                category: value.category,
                lines: [
                  {
                    item_id: value.item_id,
                    batch_id: value.batch_id || undefined,
                    quantity: Number(value.quantity),
                    unit: value.unit,
                  },
                ],
              };
        await api(mode === 'count' ? '/counts' : '/wastage', 'POST', b);
        ctx.refresh();
        ctx.notify(
          mode === 'count'
            ? 'Physical count adjustment posted.'
            : 'Wastage posted with audit details.',
        );
        ctx.close();
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={mode === 'count' ? 'Physical stock count' : 'Record wastage'} onClose={ctx.close}>
      <form onSubmit={submit}>
        <div className="modal-body">
          <Fields
            value={value}
            onChange={update}
            fields={[
              ...eventFields,
              {
                name: 'item_id',
                label: 'Configured inventory item',
                type: 'select',
                options: options(items),
              },
              {
                name: 'batch_id',
                label: mode === 'count' ? 'Counted batch' : 'Batch (optional; oldest expiry first)',
                type: 'select',
                required: mode === 'count',
                options: (batches.data ?? []).map((b: Row) => ({
                  value: b.id,
                  label: `${b.label} · ${number(b.quantity)} ${item?.base_unit ?? ''}${b.expiry_date ? ' · expires ' + b.expiry_date : ''}`,
                })),
              },
              {
                name: mode === 'count' ? 'counted' : 'quantity',
                label: mode === 'count' ? 'Physical counted balance' : 'Wasted quantity',
                type: 'number',
                min: mode === 'count' ? 0 : 0.000001,
              },
              { name: 'unit', label: 'Unit', type: 'select', options: unitOptions },
              ...(mode === 'wastage'
                ? [
                    {
                      name: 'category',
                      label: 'Waste category',
                      help: 'For example: expired, damaged, preparation loss.',
                    },
                  ]
                : []),
            ]}
          />
          {preview && (
            <div className="preview">
              <h3>Count preview</h3>
              <DataTable
                rows={preview.lines}
                columns={[
                  { key: 'book', label: 'Book stock', render: (r) => number(r.book) },
                  { key: 'counted', label: 'Counted', render: (r) => number(r.counted) },
                  {
                    key: 'delta',
                    label: 'Ledger adjustment',
                    render: (r) => (
                      <strong>
                        {number(r.delta)} {r.unit}
                      </strong>
                    ),
                  },
                ]}
              />
            </div>
          )}
          {error && <Notice kind="error">{error}</Notice>}
        </div>
        <div className="modal-foot">
          <button type="button" className="secondary" onClick={ctx.close}>
            Cancel
          </button>
          <button disabled={busy}>
            {busy
              ? 'Working…'
              : mode === 'count' && !preview
                ? 'Preview difference'
                : 'Post ' + (mode === 'count' ? 'count adjustment' : 'wastage')}
          </button>
        </div>
      </form>
    </Modal>
  );
}
export function SalesPage() {
  const ctx = useApp();
  const list = useList('/sales');
  return (
    <>
      <PageHeader
        eyebrow="SERVINGS TO STOCK"
        title="Operational sales"
        description="Post genuine dated transactions with confirmed recipe consumption."
        actions={
          <button onClick={() => ctx.dialog(<SaleDialog />)}>
            <Plus size={17} />
            Record sale
          </button>
        }
      />
      <Notice>
        Only genuine, dated sales belong here. Free items still consume their configured ingredients
        and packaging.
      </Notice>
      <section className="panel">
        <div className="table-toolbar">
          <SearchBox value={list.q} onChange={list.setQ} />
        </div>
        {list.error && <Notice kind="error">{list.error}</Notice>}
        {list.loading ? (
          <Loading />
        ) : (
          list.data && (
            <>
              <DataTable
                rows={list.data.rows}
                columns={[
                  {
                    key: 'transaction_reference',
                    label: 'Transaction',
                    render: (r) => <strong>{r.transaction_reference}</strong>,
                  },
                  {
                    key: 'transaction_date',
                    label: 'Date (Manila)',
                    render: (r) => date(r.transaction_date),
                  },
                  { key: 'total', label: 'Recorded amount', render: (r) => money(r.total) },
                  { key: 'actor', label: 'Posted by' },
                  {
                    key: 'status',
                    label: 'Status',
                    render: (r) => (
                      <Badge tone={r.voided ? 'neutral' : 'green'}>
                        {r.voided ? 'Voided' : 'Posted'}
                      </Badge>
                    ),
                  },
                  {
                    key: 'actions',
                    label: 'Actions',
                    render: (r) => (
                      <div className="row-actions">
                        <button
                          className="text-link"
                          onClick={() => ctx.dialog(<SaleDetail saleId={r.id} />)}
                        >
                          Details
                        </button>
                        {!r.voided && (
                          <button className="text-link" onClick={() => reverseDialog(r, ctx)}>
                            Void sale
                          </button>
                        )}
                      </div>
                    ),
                  },
                ]}
              />
              <Pager page={list.page} total={list.data.total} onChange={list.setPage} />
            </>
          )
        )}
      </section>
    </>
  );
}
function SaleDetail({ saleId }: { saleId: string }) {
  const ctx = useApp();
  const d = useData('/sales/' + saleId);
  return (
    <Modal title="Sale details" onClose={ctx.close}>
      <div className="modal-body">
        {d.loading ? (
          <Loading />
        ) : d.error ? (
          <Notice kind="error">{d.error}</Notice>
        ) : (
          <>
            <p>
              <strong>{d.data?.transaction_reference}</strong> · {date(d.data.transaction_date)}
            </p>
            <DataTable
              rows={d.data.lines}
              columns={[
                { key: 'line_number', label: 'Line' },
                { key: 'source_name', label: 'Product' },
                { key: 'quantity', label: 'Quantity' },
                { key: 'unit_price', label: 'Price', render: (r) => money(r.unit_price) },
                { key: 'sales_amount', label: 'Amount', render: (r) => money(r.sales_amount) },
                { key: 'recipe_version_id', label: 'Immutable recipe version' },
              ]}
            />
          </>
        )}
      </div>
    </Modal>
  );
}
function SaleDialog() {
  const ctx = useApp();
  const lookup = useData('/lookups', ctx.revision);
  const [value, setValue] = useState(eventInitial());
  const blank = () => ({ product_id: '', quantity: '', unit_price: '', sales_amount: '' });
  const [lines, setLines] = useState<Row[]>([blank()]);
  const [preview, setPreview] = useState<Row>();
  const [body, setBody] = useState<Row>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const clear = () => {
    setPreview(undefined);
    setBody(undefined);
  };
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (!preview) {
        const b = {
          ...eventBody(value),
          lines: lines.map((l, i) => ({
            line_number: i + 1,
            product_id: l.product_id,
            quantity: Number(l.quantity),
            unit_price: Number(l.unit_price),
            sales_amount: Number(l.sales_amount),
          })),
        };
        const p = await api('/sales/preview', 'POST', b);
        setPreview(p);
        setBody(b);
      } else {
        if (!confirm('Post this sale and its displayed stock deductions?'))
          throw new Error('Posting cancelled.');
        await api('/sales', 'POST', body);
        ctx.refresh();
        ctx.notify('Sale and recipe consumption posted atomically.');
        ctx.close();
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Record genuine operational sale" onClose={ctx.close}>
      <form onSubmit={submit}>
        <div className="modal-body">
          <Fields
            value={value}
            onChange={(v) => {
              setValue(v as typeof value);
              clear();
            }}
            fields={eventFields}
          />
          <LinesEditor
            lines={lines}
            onChange={(v) => {
              setLines(v);
              clear();
            }}
            blank={blank}
            fields={[
              {
                name: 'product_id',
                label: 'Menu product',
                type: 'select',
                options: options(lookup.data?.products ?? [], 'source_name'),
              },
              { name: 'quantity', label: 'Units sold', type: 'number', min: 0.000001 },
              { name: 'unit_price', label: 'Confirmed actual unit price (₱)', type: 'number' },
              {
                name: 'sales_amount',
                label: 'Recorded line amount (₱)',
                type: 'number',
                help: 'Must equal quantity × unit price within ₱0.01.',
              },
            ]}
          />
          {preview && (
            <div className="preview">
              <h3>Required stock consumption</h3>
              <DataTable
                rows={preview.consumption}
                columns={[
                  { key: 'name', label: 'Item' },
                  {
                    key: 'quantity',
                    label: 'Required',
                    render: (r) => number(r.quantity) + ' ' + r.unit,
                  },
                  { key: 'available', label: 'Available', render: (r) => number(r.available) },
                  {
                    key: 'shortage',
                    label: 'Shortage',
                    render: (r) => (
                      <span className={r.shortage ? 'negative' : ''}>{number(r.shortage)}</span>
                    ),
                  },
                ]}
              />
              <Notice kind={preview.can_post ? 'success' : 'error'}>
                {preview.can_post
                  ? 'Stock is sufficient. Posting rechecks availability inside the transaction.'
                  : 'Insufficient available stock. Receive stock or correct the sale before posting.'}
              </Notice>
            </div>
          )}
          {error && <Notice kind="error">{error}</Notice>}
        </div>
        <div className="modal-foot">
          <button type="button" className="secondary" onClick={ctx.close}>
            Cancel
          </button>
          <button disabled={busy || (preview && !preview.can_post)}>
            {busy ? 'Working…' : preview ? 'Confirm & post sale' : 'Preview consumption'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
export function ImportsPage() {
  const ctx = useApp();
  const list = useList('/imports');
  const [kind, setKind] = useState('catalog');
  const [file, setFile] = useState<File>();
  const [preview, setPreview] = useState<Row>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function upload() {
    if (!file) return;
    setBusy(true);
    setError('');
    setPreview(undefined);
    try {
      const p = await uploadCSV(kind, file);
      setPreview(p);
      ctx.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function confirmImport() {
    setBusy(true);
    setError('');
    try {
      if (!confirm('Confirm this import? Review the preview and all validation results first.'))
        return;
      const result = await api('/imports/' + preview!.id + '/confirm', 'POST');
      ctx.refresh();
      ctx.notify(
        result.duplicate
          ? 'This file was already confirmed. No duplicate records created.'
          : 'Import confirmed.',
      );
      setPreview(await api('/imports/' + preview!.id));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageHeader
        eyebrow="BRING YOUR RECORDS TOGETHER"
        title="CSV imports"
        description="Preview first. Confirm once. Keep catalog and operational records separate."
      />
      <div className="import-layout">
        <section className="panel import-upload">
          <h2>Prepare an import</h2>
          <label>
            Import purpose
            <select
              value={kind}
              onChange={(e) => {
                setKind(e.target.value);
                setPreview(undefined);
                setError('');
              }}
            >
              <option value="catalog">Menu catalog · names & categories only</option>
              <option value="sales">Genuine dated operational sales</option>
            </select>
          </label>
          <p>
            {kind === 'catalog'
              ? 'Required columns: ProductName, Category. All transaction, quantity, price and amount columns are discarded.'
              : 'Required: TransactionID, TransactionDate, LineNumber, ProductSKUorID, Qty, UnitPrice, SalesAmount. Use ISO 8601 dates with +08:00 or Z.'}
          </p>
          {kind === 'sales' && (
            <a className="text-link" href="/api/templates/operational-sales.csv" download>
              <Download size={15} />
              Download blank sales template
            </a>
          )}
          <label className="file-drop">
            <FileUp size={28} />
            <strong>{file?.name ?? 'Choose a CSV file'}</strong>
            <span>Maximum 20 MiB · Up to 150,000 rows</span>
            <input
              aria-label="CSV file"
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => {
                setFile(e.target.files?.[0]);
                setPreview(undefined);
              }}
            />
          </label>
          <button disabled={!file || busy} onClick={upload}>
            {busy ? 'Validating…' : 'Upload & preview'}
          </button>
          <p className="footnote">
            Uploading never changes stock. Operational sales are revalidated together before
            confirmation.
          </p>
        </section>
        <section className="panel import-preview">
          <h2>Import preview</h2>
          {error && <Notice kind="error">{error}</Notice>}
          {!preview ? (
            <div className="empty">Choose a file to review its validation results.</div>
          ) : (
            <>
              <div className="detail-strip">
                <Badge tone={preview.status === 'confirmed' ? 'green' : 'amber'}>
                  {preview.status}
                </Badge>
                <span>{preview.filename}</span>
              </div>
              <div className="summary-grid">
                {Object.entries(preview.summary).map(([k, v]) => (
                  <div key={k}>
                    <strong>{String(v)}</strong>
                    <span>{k.replaceAll('_', ' ')}</span>
                  </div>
                ))}
              </div>
              <small className="hash">SHA-256: {preview.hash}</small>
              {preview.error_count > 0 && (
                <>
                  <Notice kind="error">
                    {preview.error_count} errors. Correct the source file and upload again. No
                    partial confirmation is allowed.
                  </Notice>
                  <a
                    className="text-link"
                    href={`/api/imports/${preview.id}/rejected.csv`}
                    download
                  >
                    <Download size={15} />
                    Download all rejected rows
                  </a>
                  <DataTable
                    rows={preview.preview.errors}
                    columns={[
                      { key: 'row', label: 'Source row' },
                      { key: 'reason', label: 'Reason' },
                    ]}
                  />
                </>
              )}
              {preview.preview.products && (
                <details>
                  <summary>Catalog products ({preview.preview.products.length})</summary>
                  <DataTable
                    rows={preview.preview.products}
                    columns={[
                      { key: 'source_name', label: 'Product' },
                      { key: 'category', label: 'Category' },
                    ]}
                  />
                </details>
              )}
              {preview.preview.consumption && (
                <DataTable
                  rows={preview.preview.consumption}
                  columns={[
                    { key: 'name', label: 'Item' },
                    { key: 'quantity', label: 'File consumption' },
                    { key: 'available', label: 'Available' },
                  ]}
                />
              )}
              <button
                disabled={busy || preview.status === 'confirmed' || preview.error_count > 0}
                onClick={confirmImport}
              >
                {preview.status === 'confirmed' ? 'Already confirmed' : 'Confirm import'}
              </button>
            </>
          )}
        </section>
      </div>
      <section className="panel">
        <div className="panel-title">
          <h2>Import history</h2>
          <Badge>Traceable by file hash</Badge>
        </div>
        {list.error && <Notice kind="error">{list.error}</Notice>}
        {list.data && (
          <>
            <DataTable
              rows={list.data.rows}
              columns={[
                { key: 'filename', label: 'File' },
                { key: 'kind', label: 'Purpose' },
                {
                  key: 'created_at',
                  label: 'Uploaded (Manila)',
                  render: (r) => date(r.created_at),
                },
                {
                  key: 'status',
                  label: 'Status',
                  render: (r) => (
                    <Badge tone={r.status === 'confirmed' ? 'green' : 'amber'}>{r.status}</Badge>
                  ),
                },
                { key: 'summary', label: 'Source rows', render: (r) => number(r.summary.rows) },
                {
                  key: 'actions',
                  label: 'Actions',
                  render: (r) => (
                    <button
                      className="text-link"
                      onClick={async () => {
                        setError('');
                        try {
                          setPreview(await api('/imports/' + r.id));
                        } catch (e) {
                          setError((e as Error).message);
                        }
                      }}
                    >
                      Review
                    </button>
                  ),
                },
              ]}
            />
            <Pager page={list.page} total={list.data.total} onChange={list.setPage} />
          </>
        )}
      </section>
    </>
  );
}
export function ReportsPage() {
  const ctx = useApp();
  const [report, setReport] = useState('stock');
  const [page, setPage] = useState(1);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const dates = `${from ? '&from=' + encodeURIComponent(toISO(from)) : ''}${to ? '&to=' + encodeURIComponent(toISO(to)) : ''}`;
  const d = useData(`/reports/${report}?page=${page}${dates}`, ctx.revision);
  const [printing, setPrinting] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    setPage(1);
  }, [report, from, to]);
  const names: Row = {
    stock: 'Stock on hand',
    'low-stock': 'Low & out of stock',
    receipts: 'Receipt movements',
    usage: 'Recipe consumption',
    expiry: 'Batch expiry',
  };
  const columns: Column[] =
    report === 'stock' || report === 'low-stock'
      ? [
          { key: 'sku', label: 'SKU' },
          { key: 'name', label: 'Item' },
          { key: 'unit', label: 'Unit' },
          { key: 'location', label: 'Location' },
          { key: 'balance', label: 'Book balance' },
          { key: 'available', label: 'Available' },
          { key: 'expired', label: 'Expired' },
          { key: 'status', label: 'Status' },
        ]
      : report === 'expiry'
        ? [
            { key: 'sku', label: 'SKU' },
            { key: 'name', label: 'Item' },
            { key: 'label', label: 'Batch' },
            { key: 'expiry_date', label: 'Expiry' },
            { key: 'quantity', label: 'Quantity' },
            { key: 'base_unit', label: 'Unit' },
            { key: 'status', label: 'Status' },
          ]
        : [
            { key: 'occurred_at', label: 'Occurred (Manila)', render: (r) => date(r.occurred_at) },
            { key: 'item_name', label: 'Item' },
            { key: 'quantity', label: 'Signed quantity' },
            { key: 'base_unit', label: 'Unit' },
            { key: 'reference', label: 'Reference' },
            { key: 'actor', label: 'Actor' },
            { key: 'reversed', label: 'Reversed', render: (r) => (r.reversed ? 'Yes' : 'No') },
          ];
  async function print() {
    setPrinting(true);
    setError('');
    try {
      const pages = await api(`/reports/${report}?page=1&limit=200${dates}`);
      let rows = [...pages.rows];
      for (let p = 2; p <= Math.ceil(pages.total / 200); p++)
        rows.push(...(await api(`/reports/${report}?page=${p}&limit=200${dates}`)).rows);
      const doc = window.open('', '_blank');
      if (!doc) throw new Error('Allow popups to print the full report.');
      const esc = (s: any) =>
        String(s ?? '').replace(
          /[&<>"']/g,
          (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
        );
      doc.document.write(
        `<html><head><title>${esc(names[report])}</title><style>body{font:12px system-ui;margin:30px}table{border-collapse:collapse;width:100%}th,td{padding:7px;border:1px solid #ddd;text-align:left}thead{display:table-header-group}</style></head><body><h1>Under the Balete Inventory</h1><h2>${esc(names[report])}</h2><p>Generated ${esc(date(new Date().toISOString()))} · Asia/Manila · ${rows.length} records</p><table><thead><tr>${columns.map((c) => '<th>' + esc(c.label) + '</th>').join('')}</tr></thead><tbody>${rows.map((r) => '<tr>' + columns.map((c) => '<td>' + esc(r[c.key]) + '</td>').join('') + '</tr>').join('')}</tbody></table></body></html>`,
      );
      doc.document.close();
      doc.focus();
      doc.print();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPrinting(false);
    }
  }
  return (
    <>
      <PageHeader
        eyebrow="RECORDS YOU CAN RELY ON"
        title="Inventory reports"
        description="Real posted inventory data, ready to review, export or print."
        actions={
          <>
            <a
              className="button secondary"
              href={`/api/reports/${report}?format=csv${dates}`}
              download
            >
              <Download size={17} />
              Export CSV
            </a>
            <button disabled={printing} onClick={print}>
              <Printer size={17} />
              {printing ? 'Preparing…' : 'Print full report'}
            </button>
          </>
        }
      />
      <section className="panel">
        <div className="table-toolbar">
          <select aria-label="Report" value={report} onChange={(e) => setReport(e.target.value)}>
            {Object.entries(names).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
          {['receipts', 'usage'].includes(report) && (
            <>
              <label>
                From (Manila)
                <input
                  type="datetime-local"
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                />
              </label>
              <label>
                To (Manila)
                <input type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)} />
              </label>
            </>
          )}
        </div>
        {error && <Notice kind="error">{error}</Notice>}
        {d.error && <Notice kind="error">{d.error}</Notice>}
        {d.loading ? (
          <Loading />
        ) : (
          d.data && (
            <>
              <DataTable rows={d.data.rows} columns={columns} />
              <Pager page={page} total={d.data.total} onChange={setPage} />
            </>
          )
        )}
      </section>
      <p className="footnote">
        Receipt and usage reports show original posted movements, including a reversal flag. Review
        linked reversals in the movement ledger for net corrections. Valuation requires a defined
        costing method; selling prices are never used as inventory costs.
      </p>
    </>
  );
}
