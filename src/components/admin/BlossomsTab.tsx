import { useState, useEffect, useCallback } from 'react'
import { Search, Download, Trash2, Loader2, ShieldPlus, X, RefreshCw, AlertTriangle, ChevronUp, ChevronDown } from 'lucide-react'
import { nip19 } from 'nostr-tools'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Pagination } from '@/components/shared/Pagination'
import {
  MANAGED_BLOSSOMS, listBlobs, deleteBlob, getWhitelist, addWhitelist, removeWhitelist,
  formatBytes, type BlobsPage, type BlobSort, type WhitelistInfo,
} from '@/lib/blossom/adminApi'

const PER_PAGE = 50

export function BlossomsTab() {
  const [nodeUrl, setNodeUrl] = useState(MANAGED_BLOSSOMS[0].url)

  return (
    <div className="space-y-6">
      <NodeSelector value={nodeUrl} onChange={setNodeUrl} />
      <BlobBrowser nodeUrl={nodeUrl} />
      <WhitelistManager nodeUrl={nodeUrl} />
    </div>
  )
}

function NodeSelector({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center gap-2">
      <label className="text-xs font-medium text-neutral-400">Blossom node</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-md border border-[#262626] bg-[#1c1c1c] px-2.5 py-1.5 text-sm text-neutral-200 focus:outline-none focus:ring-1 focus:ring-purple-500"
      >
        {MANAGED_BLOSSOMS.map((n) => (
          <option key={n.url} value={n.url}>{n.label}</option>
        ))}
      </select>
    </div>
  )
}

// ─── Blob browser ───────────────────────────────────────────────────

function formatDate(unix: number): string {
  if (!unix) return '—'
  return new Date(unix * 1000).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

function BlobBrowser({ nodeUrl }: { nodeUrl: string }) {
  const [search, setSearch] = useState('')
  const [debounced, setDebounced] = useState('')
  const [exts, setExts] = useState<string[]>([])
  const [sort, setSort] = useState<BlobSort>('date')
  const [dir, setDir] = useState<'asc' | 'desc'>('desc')
  const [page, setPage] = useState(1)
  const [data, setData] = useState<BlobsPage | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<{ hash: string } | null>(null)

  useEffect(() => {
    const t = setTimeout(() => { setDebounced(search.trim()); setPage(1) }, 300)
    return () => clearTimeout(t)
  }, [search])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setData(await listBlobs(nodeUrl, { search: debounced, ext: exts, sort, dir, page, per: PER_PAGE }))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load blobs')
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [nodeUrl, debounced, exts, sort, dir, page])

  useEffect(() => { load() }, [load])

  const toggleExt = (ext: string) => {
    setExts((prev) => prev.includes(ext) ? prev.filter((e) => e !== ext) : [...prev, ext])
    setPage(1)
  }
  const toggleSort = (field: BlobSort) => {
    if (sort === field) setDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else { setSort(field); setDir('desc') }
    setPage(1)
  }

  return (
    <section className="rounded-xl border border-[#262626] bg-[#171717] p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-neutral-200">Stored files{data ? ` (${data.total})` : ''}</h3>
        <Tooltip>
          <TooltipTrigger asChild>
            <button onClick={load} className="text-neutral-500 hover:text-neutral-300">
              <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
            </button>
          </TooltipTrigger>
          <TooltipContent>Refresh</TooltipContent>
        </Tooltip>
      </div>

      <div className="relative mb-3">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-500" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by hash…"
          className="w-full rounded-md border border-[#262626] bg-[#1c1c1c] py-2 pl-9 pr-3 text-sm text-neutral-200 placeholder:text-neutral-600 focus:outline-none focus:ring-1 focus:ring-purple-500"
        />
      </div>

      {/* Type filter toggles */}
      {data && data.types.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] uppercase tracking-wide text-neutral-500">Types:</span>
          {data.types.map((t) => {
            const on = exts.includes(t)
            return (
              <button
                key={t}
                onClick={() => toggleExt(t)}
                className={cn(
                  'rounded-full border px-2.5 py-0.5 text-xs transition-colors',
                  on ? 'border-purple-500 bg-purple-600/20 text-purple-300' : 'border-[#333] text-neutral-400 hover:border-[#505050] hover:text-neutral-200',
                )}
              >
                .{t}
              </button>
            )
          })}
          {exts.length > 0 && (
            <button onClick={() => { setExts([]); setPage(1) }} className="ml-1 text-xs text-neutral-500 hover:text-neutral-300">clear</button>
          )}
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 rounded-md border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-400">
          <AlertTriangle className="h-4 w-4 flex-shrink-0" /> {error}
        </div>
      )}

      {!error && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#262626] text-left text-[11px] uppercase tracking-wide text-neutral-500">
                <th className="py-2 pr-2 font-medium">Hash</th>
                <th className="py-2 px-2 font-medium">Type</th>
                <SortTh label="Size" field="size" sort={sort} dir={dir} onSort={toggleSort} align="right" />
                <SortTh label="Added" field="date" sort={sort} dir={dir} onSort={toggleSort} align="right" />
                <th className="py-2 pl-2 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {data?.blobs.map((b) => (
                <tr key={b.hash} className="border-b border-[#1f1f1f] hover:bg-[#1c1c1c]">
                  <td className="py-2 pr-2 font-mono text-xs text-neutral-300" title={b.hash}>
                    {b.hash.slice(0, 12)}…{b.hash.slice(-6)}
                  </td>
                  <td className="py-2 px-2 text-xs text-neutral-500">{b.ext || '—'}</td>
                  <td className="py-2 px-2 text-right text-xs text-neutral-400">{formatBytes(b.size)}</td>
                  <td className="py-2 px-2 text-right text-xs text-neutral-400">{formatDate(b.added)}</td>
                  <td className="py-2 pl-2">
                    <div className="flex items-center justify-end gap-1">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <a
                            href={b.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="rounded p-1.5 text-neutral-400 transition-colors hover:bg-[#2a2a2a] hover:text-white"
                          >
                            <Download className="h-4 w-4" />
                          </a>
                        </TooltipTrigger>
                        <TooltipContent>Download</TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            onClick={() => setConfirm({ hash: b.hash })}
                            className="rounded p-1.5 text-neutral-400 transition-colors hover:bg-red-500/15 hover:text-red-400"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent>Delete</TooltipContent>
                      </Tooltip>
                    </div>
                  </td>
                </tr>
              ))}
              {data && data.blobs.length === 0 && (
                <tr><td colSpan={5} className="py-6 text-center text-xs text-neutral-600">No files{debounced || exts.length ? ' match your filters' : ''}.</td></tr>
              )}
              {loading && !data && (
                <tr><td colSpan={5} className="py-6 text-center text-neutral-500"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {data && data.pages > 1 && (
        <Pagination page={page} totalPages={data.pages} onPage={setPage} />
      )}

      {confirm && (
        <DeleteConfirm nodeUrl={nodeUrl} hash={confirm.hash} onClose={() => setConfirm(null)} onDeleted={() => { setConfirm(null); load() }} />
      )}
    </section>
  )
}

function SortTh({ label, field, sort, dir, onSort, align }: {
  label: string; field: BlobSort; sort: BlobSort; dir: 'asc' | 'desc'; onSort: (f: BlobSort) => void; align: 'left' | 'right'
}) {
  const active = sort === field
  return (
    <th className={cn('py-2 px-2 font-medium', align === 'right' ? 'text-right' : 'text-left')}>
      <button
        onClick={() => onSort(field)}
        className={cn('inline-flex items-center gap-1 hover:text-neutral-300', active ? 'text-neutral-200' : '')}
      >
        {label}
        {active && (dir === 'asc' ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />)}
      </button>
    </th>
  )
}

function DeleteConfirm({ nodeUrl, hash, onClose, onDeleted }: {
  nodeUrl: string; hash: string; onClose: () => void; onDeleted: () => void
}) {
  const [typed, setTyped] = useState('')
  const [deleting, setDeleting] = useState(false)
  const match = typed.trim() === hash

  const doDelete = async () => {
    if (!match) return
    setDeleting(true)
    try {
      await deleteBlob(nodeUrl, hash) // bare hash; node resolves the extension + auth binds to it
      toast.success('File deleted')
      onDeleted()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Delete failed')
      setDeleting(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-w-md border-[#262626] bg-[#1c1c1c]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-red-400">
            <AlertTriangle className="h-5 w-5" /> Delete this file?
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-sm text-neutral-400">
            This permanently removes the blob from storage. It cannot be undone. To confirm, type the
            full hash below:
          </p>
          <code className="block break-all rounded-md border border-[#262626] bg-[#161616] p-2 font-mono text-xs text-neutral-300">
            {hash}
          </code>
          <input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder="Paste the hash to confirm"
            className="w-full rounded-md border border-[#262626] bg-[#161616] px-3 py-2 font-mono text-xs text-neutral-200 placeholder:text-neutral-600 focus:outline-none focus:ring-1 focus:ring-red-500"
            autoFocus
          />
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={onClose} className="text-neutral-400 hover:text-white">Cancel</Button>
            <Button onClick={doDelete} disabled={!match || deleting} className="bg-red-600 text-white hover:bg-red-700 disabled:opacity-40">
              {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />} Delete
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ─── Upload-size whitelist ──────────────────────────────────────────

function WhitelistManager({ nodeUrl }: { nodeUrl: string }) {
  const [info, setInfo] = useState<WhitelistInfo | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [input, setInput] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setInfo(await getWhitelist(nodeUrl))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load whitelist')
      setInfo(null)
    } finally {
      setLoading(false)
    }
  }, [nodeUrl])

  useEffect(() => { load() }, [load])

  const add = async () => {
    const pk = input.trim()
    if (!pk) return
    setBusy(true)
    try {
      await addWhitelist(nodeUrl, pk, note.trim() || undefined)
      toast.success('Added to whitelist')
      setInput(''); setNote('')
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to add')
    } finally {
      setBusy(false)
    }
  }

  const remove = async (pubkey: string) => {
    try {
      await removeWhitelist(nodeUrl, pubkey)
      toast.success('Removed')
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to remove')
    }
  }

  return (
    <section className="rounded-xl border border-[#262626] bg-[#171717] p-4">
      <div className="mb-1 flex items-center gap-2">
        <ShieldPlus className="h-4 w-4 text-purple-400" />
        <h3 className="text-sm font-semibold text-neutral-200">Upload-size whitelist</h3>
      </div>
      <p className="mb-3 text-xs text-neutral-500">
        {info
          ? `Whitelisted npubs can upload up to ${info.whitelisted_mb} MB (5× the normal ${info.limit_mb} MB).`
          : 'Grant specific npubs a raised upload cap.'}
      </p>

      <div className="mb-3 flex flex-wrap gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="npub… or hex pubkey"
          className="min-w-[220px] flex-1 rounded-md border border-[#262626] bg-[#1c1c1c] px-3 py-2 text-sm text-neutral-200 placeholder:text-neutral-600 focus:outline-none focus:ring-1 focus:ring-purple-500"
        />
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="note (optional)"
          className="w-40 rounded-md border border-[#262626] bg-[#1c1c1c] px-3 py-2 text-sm text-neutral-200 placeholder:text-neutral-600 focus:outline-none focus:ring-1 focus:ring-purple-500"
        />
        <Button onClick={add} disabled={busy || !input.trim()} className="bg-purple-600 text-white hover:bg-purple-700">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldPlus className="h-4 w-4" />} Add
        </Button>
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}
      {loading && !info && <Loader2 className="h-4 w-4 animate-spin text-neutral-500" />}

      {info && info.entries.length > 0 && (
        <ul className="divide-y divide-[#1f1f1f]">
          {info.entries.map((e) => (
            <li key={e.pubkey} className="flex items-center justify-between gap-2 py-2">
              <div className="min-w-0">
                <p className="truncate font-mono text-xs text-neutral-300" title={e.pubkey}>{toNpub(e.pubkey)}</p>
                {e.note && <p className="truncate text-[11px] text-neutral-500">{e.note}</p>}
              </div>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => remove(e.pubkey)}
                    className="rounded p-1.5 text-neutral-400 transition-colors hover:bg-red-500/15 hover:text-red-400"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>Remove</TooltipContent>
              </Tooltip>
            </li>
          ))}
        </ul>
      )}
      {info && info.entries.length === 0 && <p className="text-xs text-neutral-600">No whitelisted npubs.</p>}
    </section>
  )
}

function toNpub(hex: string): string {
  try {
    const npub = nip19.npubEncode(hex)
    return npub.slice(0, 16) + '…' + npub.slice(-8)
  } catch {
    return hex.slice(0, 12) + '…'
  }
}
