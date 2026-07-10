import { useState, useEffect, useMemo } from 'react'
import { Loader2, Save, User } from 'lucide-react'
import { toast } from 'sonner'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar'
import { BlossomUploadField } from '@/components/upload/BlossomUploadField'
import { IMAGE_UPLOAD_ACCEPT } from '@/lib/constants'
import { buildMetadataEvent, type ProfileMetadata } from '@/lib/nostr/events'
import { signAndPublish } from '@/lib/nostr/publish'
import { useUserStore, type UserProfile } from '@/stores/userStore'

interface EditProfileDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  profile: UserProfile | null
  onSaved: (metadata: ProfileMetadata) => void
}

// Plain text fields (picture/banner use uploads, about uses a textarea).
const TEXT_FIELDS: { key: string; label: string; placeholder: string }[] = [
  { key: 'display_name', label: 'Name', placeholder: 'Your name' },
  { key: 'nip05', label: 'NIP-05', placeholder: 'you@example.com' },
  { key: 'lud16', label: 'Lightning address', placeholder: 'you@walletofsatoshi.com' },
  { key: 'website', label: 'Website', placeholder: 'https://…' },
]

const FORM_KEYS = ['display_name', 'about', 'picture', 'banner', 'nip05', 'lud16', 'website']

export function EditProfileDialog({ open, onOpenChange, profile, onSaved }: EditProfileDialogProps) {
  const [form, setForm] = useState<Record<string, string>>({})
  const [initial, setInitial] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    const next: Record<string, string> = {}
    for (const k of FORM_KEYS) next[k] = (profile?.[k] as string) ?? ''
    setForm(next)
    setInitial(next)
  }, [open, profile])

  const set = (key: string, value: string) => setForm((p) => ({ ...p, [key]: value }))

  const dirty = useMemo(() => JSON.stringify(form) !== JSON.stringify(initial), [form, initial])
  // Allow publishing when something changed, or when there's no profile event yet.
  const canPublish = !profile || dirty

  const handleSave = async () => {
    setSaving(true)
    try {
      // Preserve metadata keys we don't expose in the form (e.g. existing username).
      const base: ProfileMetadata = {}
      if (profile) {
        for (const [k, v] of Object.entries(profile)) {
          if (k === 'pubkey' || k === 'npub' || k === 'created_at') continue
          base[k] = v
        }
      }
      const metadata: ProfileMetadata = { ...base }
      for (const k of FORM_KEYS) {
        const v = form[k]?.trim()
        if (v) metadata[k] = v
        else delete metadata[k]
      }

      const res = await signAndPublish(buildMetadataEvent(metadata))
      if (!res.success) throw new Error(res.error || 'Failed to publish')

      useUserStore.getState().clearProfileCache()
      onSaved(metadata)
      toast.success('Profile updated')
      onOpenChange(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update profile')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-[#1c1c1c] border-[#262626] max-w-xl max-h-[85vh] overflow-auto">
        <DialogHeader>
          <DialogTitle className="text-neutral-100">Edit profile</DialogTitle>
          <DialogDescription className="text-neutral-400">
            Publishes your profile metadata (kind 0) to your relays.
          </DialogDescription>
        </DialogHeader>

        <div className="min-w-0 space-y-4 py-1">
          {/* Live preview */}
          <div className="overflow-hidden rounded-lg border border-[#262626] bg-[#171717]">
            <div className="relative h-28 bg-gradient-to-br from-purple-900/40 to-[#212121]">
              {form.banner && <img src={form.banner} alt="" className="h-full w-full object-cover" />}
            </div>
            <div className="px-4 pb-3">
              <Avatar className="-mt-8 h-16 w-16 ring-4 ring-[#171717]">
                {form.picture ? <AvatarImage src={form.picture} alt="" /> : null}
                <AvatarFallback className="bg-gradient-to-br from-purple-600 to-purple-800 text-white"><User className="h-7 w-7" /></AvatarFallback>
              </Avatar>
              <p className="mt-2 font-semibold text-white truncate">{form.display_name || 'Your name'}</p>
              {form.about && <p className="mt-1 text-sm text-neutral-400 line-clamp-3 whitespace-pre-wrap">{form.about}</p>}
            </div>
          </div>

          {/* Profile picture upload */}
          <div className="space-y-1.5">
            <label className="text-xs text-neutral-400">Profile picture</label>
            <BlossomUploadField
              accept={IMAGE_UPLOAD_ACCEPT}
              label="Drop an image or click to upload"
              sublabel="Mirrored to up to 3 servers"
              onUploaded={(r) => set('picture', r.url)}
              resetAfter
            />
            <Input
              value={form.picture ?? ''}
              onChange={(e) => set('picture', e.target.value)}
              placeholder="Image URL (or upload above)"
              className="bg-[#212121] border-[#262626] text-white text-xs font-mono"
            />
          </div>

          {/* Banner upload */}
          <div className="space-y-1.5">
            <label className="text-xs text-neutral-400">Banner</label>
            <BlossomUploadField
              accept={IMAGE_UPLOAD_ACCEPT}
              label="Drop an image or click to upload"
              sublabel="Mirrored to up to 3 servers"
              onUploaded={(r) => set('banner', r.url)}
              resetAfter
            />
            <Input
              value={form.banner ?? ''}
              onChange={(e) => set('banner', e.target.value)}
              placeholder="Image URL (or upload above)"
              className="bg-[#212121] border-[#262626] text-white text-xs font-mono"
            />
          </div>

          {/* About / bio */}
          <div className="space-y-1">
            <label className="text-xs text-neutral-400">Bio</label>
            <Textarea
              value={form.about ?? ''}
              onChange={(e) => set('about', e.target.value)}
              placeholder="Tell people about yourself"
              rows={3}
              className="bg-[#212121] border-[#262626] text-white resize-none"
            />
          </div>

          {/* Text fields */}
          {TEXT_FIELDS.map((f) => (
            <div key={f.key} className="space-y-1">
              <label className="text-xs text-neutral-400">{f.label}</label>
              <Input
                value={form[f.key] ?? ''}
                onChange={(e) => set(f.key, e.target.value)}
                placeholder={f.placeholder}
                className="bg-[#212121] border-[#262626] text-white"
              />
            </div>
          ))}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} className="border-[#262626]">
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving || !canPublish} className="bg-purple-600 hover:bg-purple-700">
            {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
            Publish changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
